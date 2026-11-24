import { advanceCaseState, computeStatus, initCaseState, type CaseState } from "../testcases/testCaseEvaluation";
import type { TestLogEntry } from "../testcases/testLogEntry";
import { evalExpr } from "../testcases/engine";
import type { TestCaseResult } from "../testcases/useTestCases";
import { getIosLogDisplay } from "./iosLogEncoding";
import { hasValidIosMaxToponEvidence, IOS_ADJUST_REVENUE_CASE_ID, IOS_MAX_TOPON_CASE_ID, IOS_UA_ADJUST_CASE_ID } from "./iosAttributionBusinessDefinitions";
import { hasZeroIosRequestEcpm, IOS_REQUEST_ECPM_CASE_ID } from "./iosRequestEcpm";
import { acceptsIosBusinessSource, mayHaveIosBusinessSource } from "./iosBusinessSources";
import { IOS_CRASH_CASE_ID, IOS_CRASH_EVIDENCE, type IosCrashReport } from "./iosCrashCase";
import { IOS_PILOT_BUNDLE, IOS_PILOT_CASES, IOS_PILOT_PROCESS } from "./iosPilotCases";
import type { IosLogRecord, IosProbeStatus } from "./iosTypes";
import type { IosWorkspaceTab } from "./useIosWorkspaceTabs";

export interface IosPilotEvidence extends TestLogEntry { record: IosLogRecord; deviceKey: string; sessionId: string }
export interface IosPilotRuntime {
  key: string; deviceKey: string; sessionId: string; lastSequence: number;
  states: Record<string, CaseState>; incomplete: boolean; limitedContent: boolean; interrupted: boolean;
  ended: boolean; absenceSuspended: boolean; lastClockAt: number | null;
  crashSince: number; crashIncidents: Set<string>;
}
const crashCase = IOS_PILOT_CASES.find(tc => tc.id === IOS_CRASH_CASE_ID);
export const iosCrashMonitoringEnabled = crashCase?.enabled === true;
export function canStartIosPilot(bundleId: string, executable: string | null, scope: { processFilter: string; exactProcess: boolean } | null,
  status: IosProbeStatus, deviceKey: string | null, busy: boolean) {
  return !busy && !!deviceKey && status.deviceKey === deviceKey && status.state === "running" && !!status.sessionId
    && bundleId === IOS_PILOT_BUNDLE && executable === IOS_PILOT_PROCESS
    && scope?.exactProcess === true && scope.processFilter === IOS_PILOT_PROCESS;
}
export function createIosPilotRuntime(tab: IosWorkspaceTab, deviceKey: string): IosPilotRuntime | null {
  if (tab.kind !== "test" || tab.testBundleId !== IOS_PILOT_BUNDLE || !tab.testRun) return null;
  return { key: `${deviceKey}:${tab.id}:${tab.testRun.key}`, deviceKey, sessionId: tab.testRun.sessionId,
    lastSequence: tab.testRun.afterSequence, states: Object.fromEntries(IOS_PILOT_CASES.map(tc => [tc.id, initCaseState(tc)])),
    incomplete: false, limitedContent: false, interrupted: false,
    ended: false, absenceSuspended: false, lastClockAt: null,
    crashSince: tab.testRun.startedAt ?? Number.POSITIVE_INFINITY, crashIncidents: new Set() };
}

export function advanceIosCrashReports(runtime: IosPilotRuntime, reports: IosCrashReport[], status: IosProbeStatus): boolean {
  if (!crashCase?.enabled || status.state !== "running" || runtime.ended
    || status.deviceKey !== runtime.deviceKey || status.sessionId !== runtime.sessionId) return false;

  let changed = false;
  for (const report of reports) {
    if (report.bundleId !== IOS_PILOT_BUNDLE || report.process !== IOS_PILOT_PROCESS
      || !Number.isFinite(report.capturedAt) || report.capturedAt < runtime.crashSince
      || runtime.crashIncidents.has(report.incidentId)) continue;
    runtime.crashIncidents.add(report.incidentId);
    const captured = new Date(report.capturedAt).toISOString();
    const raw = `${IOS_CRASH_EVIDENCE}\n时间 ${captured}\n应用 ${report.bundleId}\n进程 ${report.process} · PID ${report.pid}\nIncident ID ${report.incidentId}`;
    const record: IosLogRecord = { sessionId: runtime.sessionId, timestamp: captured, device: "",
      process: report.process, module: "Apple .ips", pid: report.pid, level: "—", semanticLevel: null,
      semanticLevelSource: null, encodingStatus: "valid", truncated: false, message: IOS_CRASH_EVIDENCE, raw };
    const entry: IosPilotEvidence = { id: -runtime.crashIncidents.size, date: captured.slice(0, 10), time: captured.slice(11, 19),
      pid: String(report.pid), module: record.module, message: record.message, raw, record,
      deviceKey: runtime.deviceKey, sessionId: runtime.sessionId };
    const state = runtime.states[crashCase.id] ??= initCaseState(crashCase);
    advanceCaseState(crashCase, state, entry, performance.now());
    changed = true;
  }
  return changed;
}

/** 单调接收侧时钟；调度长时间停顿时，保守放弃正在观察的负向窗口。 */
function observeClock(runtime: IosPilotRuntime, status: IosProbeStatus, now: number): boolean {
  const waiting = Object.values(runtime.states).some(cs => cs.rules.some(st => st.absence === "waiting" && !st.hit));
  const stalled = runtime.lastClockAt !== null && (now < runtime.lastClockAt || now - runtime.lastClockAt > 5000);
  const suspended = runtime.absenceSuspended || (waiting && stalled);
  const ended = runtime.ended || status.state !== "running";
  const incomplete = runtime.incomplete || status.backendDroppedCount > 0 || !!status.storageError;
  const interrupted = runtime.interrupted || status.state === "error";
  const changed = suspended !== runtime.absenceSuspended || ended !== runtime.ended
    || incomplete !== runtime.incomplete || interrupted !== runtime.interrupted;
  runtime.incomplete = incomplete; runtime.interrupted = interrupted;
  runtime.absenceSuspended = suspended; runtime.ended = ended; runtime.lastClockAt = now;
  return changed;
}

/** 根部周期检查；没有锚点、队列未排空、采集中断或内容不完整时不制造缺失结论。 */
export function tickIosPilot(runtime: IosPilotRuntime, status: IosProbeStatus, now = performance.now(), deferAbsence = false): boolean {
  if (status.deviceKey !== runtime.deviceKey || status.sessionId !== runtime.sessionId) return false;
  let changed = observeClock(runtime, status, now);
  if (deferAbsence || runtime.ended || runtime.absenceSuspended || runtime.incomplete || runtime.limitedContent
    || status.backendDroppedCount > 0 || !!status.storageError
    || runtime.lastSequence < status.emittedCount || status.receivedCount > status.emittedCount) return changed;
  for (const tc of IOS_PILOT_CASES) {
    if (tc.enabled === false) continue;
    const cs = runtime.states[tc.id] ??= initCaseState(tc);
    for (let i = 0; i < tc.rules.length; i++) {
      const rule = tc.rules[i]; const st = cs.rules[i];
      if (rule.absence && st.absence === "waiting" && !st.hit && now - st.anchorAt >= rule.absence.withinSec * 1000) {
        st.hit = true; st.missing = true; st.triggeredAt = now; changed = true;
      }
    }
  }
  return changed;
}
/** 消费原始序列，不接受视图筛选或展示屏蔽后的输入。可在终态补入同会话的尾批。 */
export function advanceIosPilot(runtime: IosPilotRuntime, records: IosLogRecord[], status: IosProbeStatus, now = performance.now(), deferAbsence = false): boolean {
  if (status.deviceKey !== runtime.deviceKey || status.sessionId !== runtime.sessionId) return false;
  let changed = observeClock(runtime, status, now);
  // 活跃缓冲按 sequence 单调排列，只扫描本轮尚未消费的尾部。
  let low = 0; let high = records.length;
  while (low < high) { const middle = (low + high) >> 1;
    if ((records[middle].sequence ?? -1) <= runtime.lastSequence) low = middle + 1; else high = middle; }
  for (let index = low; index < records.length; index++) {
    const record = records[index];
    const seq = record.sequence;
    if (record.sessionId !== runtime.sessionId || seq == null || seq <= runtime.lastSequence) continue;
    if (seq !== runtime.lastSequence + 1) runtime.incomplete = true;
    runtime.lastSequence = seq; changed = true;
    if (record.process !== IOS_PILOT_PROCESS || !mayHaveIosBusinessSource(record.module, record.message)) continue;
    const display = getIosLogDisplay(record);
    const cases = IOS_PILOT_CASES.filter(tc => tc.id !== IOS_CRASH_CASE_ID && tc.enabled !== false && acceptsIosBusinessSource(tc.id, record.module, display.message));
    if (!cases.length) continue;
    if (record.truncated || record.message.includes("<private>") || (record.encodingStatus === "suspected_mojibake" && !display.recovered)) runtime.limitedContent = true;
    const entry: IosPilotEvidence = { id: seq, date: record.timestamp.slice(0, 6), time: record.timestamp.slice(7),
      pid: record.pid == null ? null : String(record.pid), module: record.module, message: display.message, raw: record.raw,
      record, deviceKey: runtime.deviceKey, sessionId: runtime.sessionId };
    for (const tc of cases) {
      if (tc.id === IOS_REQUEST_ECPM_CASE_ID && !hasZeroIosRequestEcpm(entry.message)) continue;
      if (tc.id === IOS_MAX_TOPON_CASE_ID && (record.truncated || !hasValidIosMaxToponEvidence(entry.message))) continue;
      if ((tc.id === IOS_UA_ADJUST_CASE_ID || tc.id === IOS_ADJUST_REVENUE_CASE_ID) && record.truncated) continue;
      const cs = runtime.states[tc.id] ??= initCaseState(tc);
      for (let i = 0; i < tc.rules.length; i++) {
        const rule = tc.rules[i];
        if (rule.absence && !cs.rules[i].hit && evalExpr(rule.absence.anchor, entry)) cs.rules[i].anchorEntry = entry;
      }
      advanceCaseState(tc, cs, entry, now);
    }
  }
  return tickIosPilot(runtime, status, now, deferAbsence) || changed;
}
export function iosPilotResults(runtime: IosPilotRuntime | null): TestCaseResult[] {
  return IOS_PILOT_CASES.map(tc => {
    const state = runtime?.states[tc.id] ?? initCaseState(tc);
    return { testCase: tc, status: computeStatus(tc, state), ruleHits: state.rules.map(hit => ({ ...hit, entries: [...hit.entries] })) };
  });
}
export function isIosPilotEvidence(entry: TestLogEntry): entry is IosPilotEvidence {
  return "record" in entry && "deviceKey" in entry && "sessionId" in entry;
}
