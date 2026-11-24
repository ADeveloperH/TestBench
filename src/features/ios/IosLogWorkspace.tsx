import { useEffect, useMemo, useState } from "react";
import { cacheLogProjection, LOG_VIEW_COLUMNS } from "../../core/logView";
import { LogViewport } from "../logcat/LogViewport";
import { LogWorkspaceFrame } from "../logcat/LogWorkspaceFrame";
import { LogDetail } from "../logcat/LogDetail";
import { projectIosLog } from "./iosLogViewAdapter";
import type { IosViewState } from "./useIosWorkspaceTabs";
import type { useIosWorkspaceActions } from "./useIosWorkspaceActions";
import type { IosLogRecord } from "./iosTypes";
import { getIosLogDisplay } from "./iosLogEncoding";
import { TestCaseSidebarView } from "../testcases/TestCaseSidebar";
import type { TestCaseResult } from "../testcases/useTestCases";
import type { TestLogEntry } from "../testcases/testLogEntry";
import { isIosPilotEvidence, type IosPilotEvidence } from "./iosPilotMonitoring";
import type { LogViewportScrollCommand } from "../../core/logView";

export function IosLogWorkspace({ view, onChange, actions, deviceKey, sessionId, tabId, fontSize, dropped, statusText, monitoring }: {
  monitoring?: { results: TestCaseResult[]; notice: string; canRestart: boolean; canResetCase: boolean; restart: () => void; resetCase: (id: string) => void };
  view: IosViewState; onChange: (patch: Partial<IosViewState>) => void; actions: ReturnType<typeof useIosWorkspaceActions>;
  deviceKey: string; sessionId: string; tabId: string; fontSize: number; dropped: number; statusText: string;
}) {
  const project = useMemo(() => cacheLogProjection((record: IosLogRecord) => projectIosLog(record, deviceKey, sessionId)), [deviceKey, sessionId]);
  const rows = useMemo(() => actions.selection.records.map(project), [actions.selection.records, project]);
  const [evidence, setEvidence] = useState<IosPilotEvidence | null>(null);
  const [scrollCommand, setScrollCommand] = useState<LogViewportScrollCommand | null>(null);
  useEffect(() => { setEvidence(null); setScrollCommand(null); }, [deviceKey, sessionId, tabId, view.testRun?.key, view.clearedThrough]);
  const locateEvidence = (entry: TestLogEntry) => {
    if (!isIosPilotEvidence(entry)) return;
    const visible = entry.deviceKey === deviceKey && entry.sessionId === sessionId
      ? actions.selection.records.find(r => r.sessionId === entry.sessionId && r.sequence === entry.id) : null;
    if (visible) {
      setEvidence(null); onChange({ selected: visible, follow: false });
      setScrollCommand(current => ({ seq: (current?.seq ?? 0) + 1, kind: "key", key: project(visible).key }));
    } else { onChange({ selected: null }); setEvidence(entry); }
  };
  const selectedKey = view.selected ? projectIosLog(view.selected, deviceKey, sessionId).key : null;
  const selected = evidence?.record ?? view.selected;
  const display = selected ? getIosLogDisplay(selected) : null;
  return <LogWorkspaceFrame sidebar={monitoring && <TestCaseSidebarView results={monitoring.results} resetAll={monitoring.restart} resetCase={monitoring.resetCase}
    resetDisabled={!monitoring.canRestart} resetCaseDisabled={!monitoring.canResetCase} scopePkg={view.testBundleId ?? ""} onLocate={() => {}} onLocateEvidence={locateEvidence}
    onClose={() => {}} closable={false} notice={monitoring.notice} />}>
    <LogViewport key={`${deviceKey}:${sessionId}`} platform="ios" columns={LOG_VIEW_COLUMNS.ios} entries={rows}
      selectedKey={selectedKey} onSelect={(key) => { setEvidence(null); onChange({ selected: key === selectedKey ? null : rows.find((row) => row.key === key)?.original ?? null }); }}
      onClearSelection={() => { setEvidence(null); onChange({ selected: null }); }} scrollCommand={scrollCommand} tabId={`${deviceKey}:${tabId}`}
      followLatest={view.follow} onFollowLatestChange={(follow) => onChange({ follow })}
      findState={view.find} onFindStateChange={(find) => onChange({ find })}
      layoutKey={`${deviceKey}:${sessionId}:${tabId}:${fontSize}:${view.markers}:${view.search}:${view.regex}:${view.level}:${view.semantic}:${view.clearedThrough}:${view.snapshot !== null}`}
      emptyMessage={actions.selection.error ?? (actions.selection.source.length ? "没有匹配的日志" : "等待日志；请开始采集并操作目标应用")} />
    {evidence && <div className="ios-app-scope-notice" role="status">
      {evidence.record.module === "Apple .ips" ? "Apple 崩溃报告摘要" : "命中证据不在当前显示范围，以下保留原始详情；未跳转到其他记录。"}
    </div>}
    {selected && <LogDetail platform="ios" raw={selected.raw} restoredMessage={display?.recovered ? display.message : undefined} onClose={() => { setEvidence(null); onChange({ selected: null }); }}
      metadata={<>{selected.process} · PID {selected.pid ?? "—"} · 模块 {selected.module ?? "—"} · 原始级别 {selected.level} · Unity 推断 {selected.semanticLevel ?? "未知"}（{selected.semanticLevelSource ?? "无推断来源"}）{display?.recovered ? " · 编码还原（MacRoman → UTF-8）" : selected.encodingStatus !== "valid" ? " · 疑似乱码" : ""}{selected.truncated ? " · 截断" : ""}</>} />}
    <div className="log-session-status" role="status" title="Unity 级别来自特征推断，原始级别保持 Apple 输出。展示窗口保留最近 10 万条，超过 10.5 万条时批量淘汰旧记录；仅在当前展示窗口内搜索。展示淘汰不删除独立落盘记录，完整会话停止后从更多导出。">
      {statusText}{dropped > 0 ? ` · 展示已淘汰 ${dropped} 条` : ""}{view.snapshot !== null ? " · 展示已暂停" : ""}
    </div>
  </LogWorkspaceFrame>;
}
