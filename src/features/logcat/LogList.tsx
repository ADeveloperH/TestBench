import { useMemo } from "react";
import type { LogEntry, ScrollCommand } from "../../core/types";
import { cacheLogProjection, LOG_VIEW_COLUMNS, type LogViewportScrollCommand } from "../../core/logView";
import type { LogFindState } from "./useLogTabs";
import { androidLogRowKey, projectAndroidLog } from "./logViewAdapter";
import { LogViewport } from "./LogViewport";

interface Props {
  entries: LogEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClearSelection: () => void;
  scrollCommand: ScrollCommand | null;
  layoutKey: string;
  tabId: string;
  followLatest: boolean;
  onFollowLatestChange: (follow: boolean) => void;
  findState: LogFindState;
  onFindStateChange: (state: LogFindState) => void;
  deviceKey?: string;
  sessionId?: string;
}

/** 保留 Android 调用方的数字 ID/定位接口，渲染由两端共用 viewport 提供。 */
export function LogList({ entries, selectedId, onSelect, scrollCommand, deviceKey = "android", sessionId = "legacy", ...props }: Props) {
  const project = useMemo(() => cacheLogProjection((entry: LogEntry) => projectAndroidLog(entry, deviceKey, sessionId)), [deviceKey, sessionId]);
  const rows = useMemo(() => entries.map(project), [entries, project]);
  const command = useMemo<LogViewportScrollCommand | null>(() => !scrollCommand ? null
    : scrollCommand.kind === "id" ? { seq: scrollCommand.seq, kind: "key", key: scrollCommand.id == null ? undefined : androidLogRowKey(scrollCommand.id, deviceKey, sessionId) }
      : { ...scrollCommand, kind: scrollCommand.kind }, [scrollCommand, deviceKey, sessionId]);
  return <LogViewport key={`android:${deviceKey}:${sessionId}`} {...props} platform="android" columns={LOG_VIEW_COLUMNS.android}
    entries={rows} selectedKey={selectedId == null ? null : androidLogRowKey(selectedId, deviceKey, sessionId)}
    onSelect={(key) => { const id = rows.find((row) => row.key === key)?.original.id; if (id != null) onSelect(id); }}
    scrollCommand={command} />;
}
