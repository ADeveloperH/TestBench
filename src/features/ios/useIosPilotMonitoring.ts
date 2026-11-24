import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { advanceIosCrashReports, advanceIosPilot, createIosPilotRuntime, iosCrashMonitoringEnabled, iosPilotResults, tickIosPilot, type IosPilotRuntime } from "./iosPilotMonitoring";
import { initCaseState } from "../testcases/testCaseEvaluation";
import { IOS_PILOT_BUNDLE, IOS_PILOT_CASES, IOS_PILOT_PROCESS } from "./iosPilotCases";
import { IOS_CRASH_CASE_ID, type IosCrashReport } from "./iosCrashCase";
import type { IosWorkspaceTab } from "./useIosWorkspaceTabs";
import type { IosLogRecord, IosProbeStatus } from "./iosTypes";

/** 根部调用，设置页/Probe/后台 Tab 均持续消费；UI 卸载不决定测试生命周期。 */
export function useIosPilotMonitoring(deviceKey: string | null, tabs: IosWorkspaceTab[], records: IosLogRecord[], status: IosProbeStatus, captureBusy = false) {
  const runtimes = useRef(new Map<string, IosPilotRuntime>());
  const [, invalidate] = useState(0);
  const latest = useRef({ deviceKey, tabs, status, captureBusy }); latest.current = { deviceKey, tabs, status, captureBusy };
  useEffect(() => {
    if (!IOS_PILOT_CASES.some(tc => tc.enabled !== false && tc.rules.some(rule => rule.absence))) return;
    const timer = setInterval(() => {
      const { deviceKey: key, tabs: currentTabs, status: currentStatus, captureBusy: busy } = latest.current;
      if (!key) return;
      let changed = false;
      for (const tab of currentTabs) {
        if (!tab.testRun) continue;
        const runtime = runtimes.current.get(`${key}:${tab.id}:${tab.testRun.key}`);
        if (runtime) changed = tickIosPilot(runtime, currentStatus, performance.now(), busy) || changed;
      }
      if (changed) invalidate(v => v + 1);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!deviceKey) return;
    const alive = new Set<string>(); let changed = false;
    for (const tab of tabs) {
      const initial = createIosPilotRuntime(tab, deviceKey);
      if (!initial) continue;
      alive.add(initial.key);
      let runtime = runtimes.current.get(initial.key);
      if (!runtime) { runtime = initial; runtimes.current.set(initial.key, runtime); changed = true; }
      changed = advanceIosPilot(runtime, records, status, performance.now(), captureBusy) || changed;
    }
    for (const [key, value] of runtimes.current) if (value.deviceKey === deviceKey && !alive.has(key)) runtimes.current.delete(key);
    while (runtimes.current.size > 24) runtimes.current.delete(runtimes.current.keys().next().value!);
    if (changed) invalidate(v => v + 1);
  }, [deviceKey, tabs, records, status, captureBusy]);

  const crashSession = iosCrashMonitoringEnabled && !captureBusy && status.state === "running" && status.deviceKey === deviceKey
    && tabs.some(tab => tab.kind === "test" && tab.testRun?.startedAt && tab.testBundleId === IOS_PILOT_BUNDLE
      && tab.testRun.sessionId === status.sessionId) ? status.sessionId : null;
  useEffect(() => {
    if (!crashSession || !deviceKey || !isTauri()) return;
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const reports = await invoke<IosCrashReport[]>("ios_probe_crash_reports", {
          sessionId: crashSession, bundleId: IOS_PILOT_BUNDLE, process: IOS_PILOT_PROCESS,
        });
        const context = latest.current;
        if (disposed || context.deviceKey !== deviceKey || context.captureBusy) return;
        let changed = false;
        for (const tab of context.tabs) {
          if (!tab.testRun || tab.testRun.sessionId !== crashSession) continue;
          const runtime = runtimes.current.get(`${deviceKey}:${tab.id}:${tab.testRun.key}`);
          if (runtime) changed = advanceIosCrashReports(runtime, reports, context.status) || changed;
        }
        if (changed) invalidate(v => v + 1);
      } catch { /* 设备服务暂时不可用时不产生失败判定。 */ }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [crashSession, deviceKey]);

  const runtimeFor = (tab: IosWorkspaceTab) => deviceKey && tab.testRun ? runtimes.current.get(`${deviceKey}:${tab.id}:${tab.testRun.key}`) ?? null : null;
  return {
    forTab: (tab: IosWorkspaceTab) => { const runtime = runtimeFor(tab); return { runtime, results: iosPilotResults(runtime) }; },
    resetCase: (tab: IosWorkspaceTab, id: string) => {
      const runtime = runtimeFor(tab); const tc = IOS_PILOT_CASES.find(tc => tc.id === id);
      if (runtime && tc) {
        runtime.states[id] = initCaseState(tc);
        if (id === IOS_CRASH_CASE_ID) runtime.crashSince = Date.now();
        invalidate(v => v + 1);
      }
    },
  };
}
