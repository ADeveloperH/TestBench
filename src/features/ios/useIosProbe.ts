import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_LOG_ENTRIES, LOG_TRIM_CHUNK } from "../../core/logRetention";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { markIosDeviceUnavailable, matchesIosSession, type IosSessionIdentity } from "./iosSessionEvents";
import type {
  IosDoctorReport,
  IosLogBatch,
  IosLogRecord,
  IosProbeStatus,
  IosSessionEvent,
} from "./iosTypes";

const EMPTY_STATUS: IosProbeStatus = {
  sessionId: null,
  deviceKey: null,
  state: "idle",
  error: null,
  sessionDir: null,
  storageError: null,
  receivedCount: 0,
  emittedCount: 0,
  backendDroppedCount: 0,
  frontendDroppedCount: 0,
};
// 启动身份绑定前的队列上限独立于稳定采集的展示窗口。
const MAX_STARTUP_RECORDS = 5_000;

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export function useIosProbe(onDeviceUnavailable?: (deviceKey: string) => void) {
  const [doctor, setDoctor] = useState<IosDoctorReport | null>(null);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [scope, setScope] = useState<{ processFilter: string; exactProcess: boolean } | null>(null);
  const [status, setStatus] = useState<IosProbeStatus>(EMPTY_STATUS);
  const [records, setRecords] = useState<IosLogRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const recordsRef = useRef<IosLogRecord[]>([]);
  const selectedRef = useRef(selectedDevice);
  selectedRef.current = selectedDevice;
  const sessionRef = useRef<string | null>(null);
  const operation = useRef(0);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const accepting = useRef(false);
  const pending = useRef<IosLogBatch[]>([]);
  const pendingDropped = useRef<Record<string, number>>({});
  const unavailableCallback = useRef(onDeviceUnavailable);
  const deviceRevision = useRef(0);
  unavailableCallback.current = onDeviceUnavailable;

  const refreshStatus = useCallback(async (expected?: IosSessionIdentity, op = operation.current) => {
    const next = await invoke<IosProbeStatus>("ios_probe_status");
    if (mounted.current && op === operation.current && (!next.deviceKey || next.deviceKey === `ios:${selectedRef.current}`) && (!expected ||
      (matchesIosSession(expected, selectedRef.current, sessionRef.current) && next.sessionId === expected.sessionId && next.deviceKey === expected.deviceKey))) setStatus(next);
    return next;
  }, []);

  const applyError = useCallback((event: IosSessionEvent) => {
    if (!event.error || !matchesIosSession(event, selectedRef.current, sessionRef.current)) return;
    setError(event.error.message);
    if (event.error.kind === "DeviceDisconnected") {
      deviceRevision.current += 1;
      unavailableCallback.current?.(event.deviceKey);
      setDoctor((current) => current ? { ...current, devices: markIosDeviceUnavailable(current.devices, event.deviceKey) } : current);
    }
  }, []);

  const applyBatch = useCallback((payload: IosLogBatch) => {
    if (!matchesIosSession(payload, selectedRef.current, sessionRef.current)) return;
    const appended = [...recordsRef.current, ...payload.records.map((record, index) => ({ ...record, sessionId: payload.sessionId, sequence: payload.firstSequence + index }))];
    const dropped = appended.length > MAX_LOG_ENTRIES + LOG_TRIM_CHUNK ? appended.length - MAX_LOG_ENTRIES : 0;
    recordsRef.current = dropped ? appended.slice(dropped) : appended;
    setRecords(recordsRef.current);
    if (dropped) void invoke("ios_probe_report_frontend_dropped", { count: dropped });
    setStatus((current) => {
      const sameSession = current.sessionId === payload.sessionId && current.deviceKey === payload.deviceKey;
      const count = (previous: number, next: number) => sameSession ? Math.max(previous, next) : next;
      return { ...current, sessionId: payload.sessionId, deviceKey: payload.deviceKey,
        // stop 的响应可能先于 WebView 收到尾批；只补展示，不把 idle/error 改回 running。
        state: accepting.current ? "running" : current.state,
        receivedCount: count(current.receivedCount, payload.receivedCount), emittedCount: count(current.emittedCount, payload.emittedCount),
        backendDroppedCount: count(current.backendDroppedCount, payload.backendDroppedCount), frontendDroppedCount: count(current.frontendDroppedCount, payload.frontendDroppedCount) };
    });
  }, []);

  const refresh = useCallback(async () => {
    const op = operation.current;
    const revision = deviceRevision.current;
    setBusy(true);
    setError("");
    try {
      const report = await invoke<IosDoctorReport>("ios_probe_doctor");
      if (!mounted.current || op !== operation.current || revision !== deviceRevision.current) return;
      setDoctor(report);
      setSelectedDevice((current) =>
        accepting.current || report.devices.some((device) => device.id === current)
          ? current
          : (report.devices.find((device) =>
              device.capabilities.includes("syslog"),
            )?.id ?? ""),
      );
      await refreshStatus(undefined, op);
    } catch (cause) {
      if (mounted.current && op === operation.current) setError(messageOf(cause));
    } finally {
      if (mounted.current && op === operation.current) setBusy(false);
    }
  }, [refreshStatus]);

  const start = useCallback(async (target?: { processFilter: string; exactProcess: boolean }) => {
    if (!selectedDevice) return;
    const op = ++operation.current;
    const nextScope = { processFilter: (target?.processFilter ?? processFilter).trim(), exactProcess: target?.exactProcess ?? false };
    setBusy(true);
    setError("");
    try {
      await ready.current;
      if (op !== operation.current) return;
      sessionRef.current = null;
      pending.current = [];
      pendingDropped.current = {};
      accepting.current = true;
      recordsRef.current = [];
      setRecords([]);
      await invoke("ios_probe_start_logs", {
        deviceId: selectedDevice,
        processFilter: nextScope.processFilter || null,
        exactProcess: nextScope.exactProcess,
      });
      if (op !== operation.current || !mounted.current) return;
      setScope(nextScope);
      if (target) setProcessFilter(target.processFilter);
      const next = await refreshStatus(undefined, op);
      if (!mounted.current || op !== operation.current || next.deviceKey !== `ios:${selectedRef.current}`) return;
      sessionRef.current = next.sessionId;
      pending.current.forEach(applyBatch);
      const startupDropped = pendingDropped.current[next.sessionId ?? ""] ?? 0;
      if (startupDropped) void invoke("ios_probe_report_frontend_dropped", { count: startupDropped });
      pending.current = [];
      pendingDropped.current = {};
      setStatus(next);
      if (next.sessionId && next.deviceKey) applyError({ sessionId: next.sessionId, deviceKey: next.deviceKey, error: next.error });
    } catch (cause) {
      if (op === operation.current) {
        accepting.current = false;
        pending.current = [];
        if (mounted.current) setError(messageOf(cause));
      }
    } finally {
      if (mounted.current && op === operation.current) setBusy(false);
    }
  }, [processFilter, refreshStatus, selectedDevice, applyBatch, applyError]);

  const stop = useCallback(async () => {
    const op = ++operation.current;
    setBusy(true);
    setError("");
    try {
      accepting.current = false;
      pending.current = [];
      await invoke("ios_probe_stop_logs");
      await refreshStatus(undefined, op);
    } catch (cause) {
      if (mounted.current && op === operation.current) setError(messageOf(cause));
    } finally {
      if (mounted.current && op === operation.current) setBusy(false);
    }
  }, [refreshStatus]);

  useEffect(() => {
    mounted.current = true;
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const keep = (unlisten: () => void) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    const subscribe = async () => {
      keep(
        await listen<IosLogBatch>("ios-probe-logs", ({ payload }) => {
          // 停止期间后端仍会刷新尾批；仅保留已绑定当前会话的接收资格。
          if (disposed || (!accepting.current && !matchesIosSession(payload, selectedRef.current, sessionRef.current))) return;
          if (payload.deviceKey !== `ios:${selectedRef.current}`) return;
          if (!sessionRef.current) {
            pending.current.push(payload);
            let excess = pending.current.reduce((total, batch) => total + batch.records.length, 0) - MAX_STARTUP_RECORDS;
            while (excess > 0 && pending.current.length) {
              const first = pending.current[0];
              const count = Math.min(excess, first.records.length);
              pendingDropped.current[first.sessionId] = (pendingDropped.current[first.sessionId] ?? 0) + count;
              if (count === first.records.length) pending.current.shift();
              else pending.current[0] = { ...first, firstSequence: first.firstSequence + count, records: first.records.slice(count) };
              excess -= count;
            }
          } else applyBatch(payload);
        }),
      );
      keep(
        await listen<IosSessionEvent>("ios-probe-started", ({ payload }) => {
          if (!disposed && matchesIosSession(payload, selectedRef.current, sessionRef.current)) void refreshStatus(payload);
        }),
      );
      keep(
        await listen<IosSessionEvent>("ios-probe-stopped", ({ payload }) => {
          if (!disposed && matchesIosSession(payload, selectedRef.current, sessionRef.current)) void refreshStatus(payload);
        }),
      );
      keep(
        await listen<IosSessionEvent>("ios-probe-error", ({ payload }) => {
          if (!disposed && matchesIosSession(payload, selectedRef.current, sessionRef.current)) {
            applyError(payload);
            void refreshStatus(payload);
          }
        }),
      );
    };
    ready.current = subscribe().catch((cause) => {
      if (!disposed) setError(`订阅 iOS 日志事件失败：${messageOf(cause)}`);
    });
    // 枚举由正式设备发现或 Probe 的刷新按钮触发；根部订阅不自动占用设备服务。
    return () => {
      disposed = true;
      mounted.current = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [refreshStatus, applyBatch, applyError]);

  return {
    doctor,
    devices: doctor?.devices ?? [],
    selectedDevice,
    setSelectedDevice,
    processFilter,
    scope,
    setProcessFilter,
    status,
    records,
    busy,
    error,
    refresh,
    start,
    stop,
    clear: () => {
      recordsRef.current = [];
      setRecords([]);
    },
  };
}
