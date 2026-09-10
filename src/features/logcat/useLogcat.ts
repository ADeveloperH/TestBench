import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { error as logError, info } from "@tauri-apps/plugin-log";
import { LongLogParser, stripAnsi } from "../../core/logcat";
import type { Device, FilterState, LogEntry } from "../../core/types";

// 前端日志统一走 tauri-plugin-log（写入文件与终端），失败时静默忽略。
const log = {
  info: (m: string) => {
    info(m).catch(() => {});
  },
  error: (m: string) => {
    logError(m).catch(() => {});
  },
};

const MAX_ENTRIES = 100_000;
const TRIM_CHUNK = 5_000;
const MAX_PENDING_LINES = 50_000;
const MAX_LINES_PER_TICK = 5_000;
const UI_FLUSH_MS = 150;

export type { FilterState };

export interface UseLogcatResult {
  devices: Device[];
  selectedDevice: string | null;
  setSelectedDevice: (s: string) => void;
  /** 刷新设备列表；silent=true 时失败不弹错误（供轮询使用） */
  refreshDevices: (silent?: boolean) => Promise<void>;
  buffer: string;
  setBuffer: (b: string) => void;
  running: boolean;
  paused: boolean;
  setPaused: (p: boolean) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => Promise<void>;
  exportLogs: (entries?: LogEntry[]) => Promise<void>;
  /** 导出 Rust 侧保存的完整会话，不受前端内存窗口限制。 */
  exportSessionLogs: () => Promise<void>;
  /** 前端展示队列因超载丢弃的原始行数。 */
  droppedLines: number;
  entries: LogEntry[];
  /** 原始缓冲（未经过滤），供测试用例引擎使用 */
  allEntries: LogEntry[];
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  /** 设备未就绪（adb 输出 waiting for device），显示等待提示 */
  waiting: boolean;
}

export function useLogcat(
  initialFilters?: FilterState,
  preserveLogsForTests = false,
): UseLogcatResult {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [buffer, setBuffer] = useState("main");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [droppedLines, setDroppedLines] = useState(0);
  const [filters, setFilters] = useState<FilterState>(() =>
    initialFilters
      ? { ...initialFilters, pid: "" }
      : {
          minLevel: "V",
          search: "",
          regex: false,
          tags: "",
          pid: "",
          app: "",
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  /** 未经过展示合并的原始 Logcat 记录。 */
  const bufferRef = useRef<LogEntry[]>([]);
  const pendingRef = useRef<string[]>([]);
  const pendingHeadRef = useRef(0);
  const parserRef = useRef(new LongLogParser());
  const idRef = useRef(0);
  const pausedRef = useRef(false);
  const runningRef = useRef(false);
  const manualStopRef = useRef(false);
  const selectedDeviceRef = useRef<string | null>(null);
  const bufferForResumeRef = useRef(buffer);
  const refreshDevicesInFlightRef = useRef(false);
  const preserveLogsForTestsRef = useRef(preserveLogsForTests);
  preserveLogsForTestsRef.current = preserveLogsForTests;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    bufferForResumeRef.current = buffer;
  }, [buffer]);

  const refreshDevices = useCallback(async (silent = false) => {
    if (refreshDevicesInFlightRef.current) return;
    refreshDevicesInFlightRef.current = true;
    log.info("刷新设备列表");
    try {
      const list = await invoke<Device[]>("list_devices");
      log.info(`设备列表返回 ${list.length} 台`);
      setDevices((prev) => {
        // 列表无变化时不触发重渲染（轮询每 3 秒一次）
        const same =
          prev.length === list.length &&
          prev.every(
            (d, i) => d.serial === list[i].serial && d.state === list[i].state,
          );
        return same ? prev : list;
      });
      setSelectedDevice((prev) => {
        if (prev && list.some((d) => d.serial === prev)) return prev;
        const online = list.find((d) => d.state === "device");
        return online ? online.serial : (list[0]?.serial ?? null);
      });
    } catch (e) {
      log.error(`刷新设备列表失败：${String(e)}`);
      // 轮询时的瞬时失败静默处理，避免 adb 抖动反复弹错误横幅
      if (!silent) setError(String(e));
    } finally {
      refreshDevicesInFlightRef.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    if (!selectedDevice) return;
    manualStopRef.current = false;
    log.info(`开始抓取日志：device=${selectedDevice} buffer=${buffer}`);
    setError(null);
    bufferRef.current = [];
    pendingRef.current = [];
    pendingHeadRef.current = 0;
    parserRef.current.reset();
    idRef.current = 0;
    setEntries([]);
    setDroppedLines(0);
    try {
      await invoke("start_logcat", {
        device: selectedDevice,
        buffer: buffer === "all" ? null : buffer,
        newSession: true,
      });
      log.info("start_logcat 调用成功");
      setRunning(true);
    } catch (e) {
      log.error(`start_logcat 失败：${String(e)}`);
      setError(String(e));
    }
  }, [selectedDevice, buffer]);

  const stop = useCallback(async () => {
    manualStopRef.current = true;
    log.info("停止抓取日志");
    try {
      await invoke("stop_logcat");
    } catch (e) {
      log.error(`stop_logcat 失败：${String(e)}`);
      setError(String(e));
    }
    setRunning(false);
  }, []);

  const clear = useCallback(async () => {
    log.info("清空日志");
    bufferRef.current = [];
    pendingRef.current = [];
    pendingHeadRef.current = 0;
    parserRef.current.reset();
    idRef.current = 0;
    setEntries([]);
    setDroppedLines(0);
    if (selectedDevice) {
      try {
        await invoke("clear_log", { device: selectedDevice });
      } catch (e) {
        log.error(`clear_log 失败：${String(e)}`);
        setError(String(e));
      }
    }
  }, [selectedDevice]);

  // 订阅日志事件
  useEffect(() => {
    let disposed = false;
    const cleanups: UnlistenFn[] = [];

    listen<string[]>("logcat-lines", (e) => {
      pendingRef.current.push(...e.payload);
      // 前端消费不过来时不能让事件队列无限增长。丢弃展示窗口中的旧行，
      // 避免高频日志把主线程和内存同时拖垮。
      const queued = pendingRef.current.length - pendingHeadRef.current;
      if (queued > MAX_PENDING_LINES && !preserveLogsForTestsRef.current) {
        const nextHead = pendingRef.current.length - MAX_PENDING_LINES;
        setDroppedLines((count) => count + nextHead - pendingHeadRef.current);
        pendingHeadRef.current = nextHead;
        parserRef.current.reset();
      }
      if (
        pendingHeadRef.current > 10_000 &&
        pendingHeadRef.current * 2 > pendingRef.current.length
      ) {
        pendingRef.current = pendingRef.current.slice(pendingHeadRef.current);
        pendingHeadRef.current = 0;
      }
      setWaiting(false);
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    listen("logcat-waiting", () => setWaiting(true)).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    listen("logcat-started", () => setRunning(true)).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    listen("logcat-stopped", () => {
      setRunning(false);
      // 非手动停止时自动重连（如 WiFi adb 掉线）
      if (manualStopRef.current) return;
      const device = selectedDeviceRef.current;
      if (!device) return;
      const buf = bufferForResumeRef.current;
      setTimeout(() => {
        if (manualStopRef.current || disposed) return;
        invoke("start_logcat", {
          device,
          buffer: buf === "all" ? null : buf,
          newSession: false,
        })
          .then(() => setRunning(true))
          .catch((e) => log.error(`自动重连失败：${String(e)}`));
      }, 2000);
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    listen<string>("logcat-error", (e) => {
      log.error(`logcat 错误：${e.payload}`);
      setError(e.payload);
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  // 批量刷新循环：把积压的行合并进缓冲，限制重渲染频率。
  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      const start = pendingHeadRef.current;
      const end = Math.min(start + MAX_LINES_PER_TICK, pendingRef.current.length);
      if (start >= end) return;
      let changed = false;
      for (let i = start; i < end; i += 1) {
        const line = pendingRef.current[i];
        const parsed = parserRef.current.pushLine(stripAnsi(line));
        for (const item of parsed) {
          const entry: LogEntry = { ...item, id: idRef.current++ };
          bufferRef.current.push(entry);
          changed = true;
        }
      }
      pendingHeadRef.current = end;
      if (pendingHeadRef.current === pendingRef.current.length) {
        pendingRef.current = [];
        pendingHeadRef.current = 0;
      }
      if (bufferRef.current.length > MAX_ENTRIES + TRIM_CHUNK) {
        bufferRef.current = bufferRef.current.slice(
          bufferRef.current.length - MAX_ENTRIES,
        );
      }
      if (changed) setEntries(bufferRef.current.slice());
    }, UI_FLUSH_MS);
    return () => clearInterval(timer);
  }, []);

  // 首次加载设备。
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // 每 3 秒静默轮询设备列表：自动感知插拔（插入自动选中并开始采集，
  // 拔出自动切换到其他在线设备或置空），无需手动刷新。
  useEffect(() => {
    const timer = setInterval(() => {
      refreshDevices(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshDevices]);

  // 设备变化 → 自动开始抓取。
  useEffect(() => {
    if (selectedDevice) start();
    // 仅依赖设备选择，避免 buffer 变化时重复触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  // buffer 变化 → 运行中则重启抓取。
  const prevBufferRef = useRef(buffer);
  useEffect(() => {
    if (prevBufferRef.current !== buffer) {
      prevBufferRef.current = buffer;
      if (runningRef.current) start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  const exportLogs = useCallback(async (items?: LogEntry[]) => {
    const output = items ?? entries;
    log.info(`导出日志，共 ${output.length} 条`);
    try {
      const text = output.map((e) => e.raw).join("\n");
      const saved = await invoke<string | null>("export_logs", { text });
      if (saved) {
        log.info(`日志已导出到：${saved}`);
        setError(null);
      }
    } catch (e) {
      log.error(`导出失败：${String(e)}`);
      setError(String(e));
    }
  }, [entries]);

  const exportSessionLogs = useCallback(async () => {
    try {
      const saved = await invoke<string | null>("export_session_logs");
      if (saved) setError(null);
    } catch (e) {
      log.error(`完整会话导出失败：${String(e)}`);
      setError(String(e));
    }
  }, []);

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    refreshDevices,
    buffer,
    setBuffer,
    running,
    paused,
    setPaused,
    start,
    stop,
    clear,
    exportLogs,
    exportSessionLogs,
    droppedLines,
    entries,
    allEntries: entries,
    filters,
    setFilters,
    error,
    setError,
    waiting,
  };
}
