import type { LogEntry } from "../../core/types";
import type { LogViewRecord } from "../../core/logView";

export const androidLogRowKey = (id: number, deviceKey: string, sessionId: string) => JSON.stringify(["android", deviceKey, sessionId, id]);

export function projectAndroidLog(record: LogEntry, deviceKey: string, sessionId: string): LogViewRecord<LogEntry> {
  return { key: androidLogRowKey(record.id, deviceKey, sessionId), platform: "android",
    timestamp: `${record.date} ${record.time}`, pid: record.pid || null, tid: record.tid || null,
    tag: record.tag, process: null, module: null, rawLevel: record.level,
    semanticLevel: null, semanticLevelSource: null, message: record.message, raw: record.raw,
    encodingStatus: "valid", truncated: false, original: record };
}
