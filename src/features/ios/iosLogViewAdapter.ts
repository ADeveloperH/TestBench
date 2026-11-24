import { createLogSearch, type LogViewRecord } from "../../core/logView";
import type { IosLogRecord } from "./iosTypes";
import type { IosViewState } from "./useIosWorkspaceTabs";
import { getIosLogDisplay } from "./iosLogEncoding";
import { isIosLogBlocked, type IosLogBlockingPreferences } from "./iosLogBlocking";

const fallbackIds = new WeakMap<IosLogRecord, number>();
let nextFallbackId = 0;
export function projectIosLog(record: IosLogRecord, deviceKey: string, sessionId: string): LogViewRecord<IosLogRecord> {
  const display = getIosLogDisplay(record);
  if (record.sequence == null && !fallbackIds.has(record)) fallbackIds.set(record, ++nextFallbackId);
  return { key: JSON.stringify(["ios", deviceKey, record.sessionId ?? sessionId, record.sequence ?? `local:${fallbackIds.get(record)}`]),
    platform: "ios", timestamp: record.timestamp, pid: record.pid == null ? null : String(record.pid),
    tid: null, tag: null, process: record.process, module: record.module, rawLevel: record.level,
    semanticLevel: record.semanticLevel, semanticLevelSource: record.semanticLevelSource,
    message: display.message, raw: record.raw, encodingStatus: record.encodingStatus, encodingRecovered: display.recovered, truncated: record.truncated, original: record };
}

export function createIosMarkerFilter(value: string) {
  const terms = value.split(/[,，]/).map((term) => term.trim().toLowerCase()).filter(Boolean);
  const included = terms.filter((term) => !term.startsWith("!"));
  const excluded = terms.filter((term) => term.startsWith("!")).map((term) => term.slice(1).trim()).filter(Boolean);
  return (message: string) => {
    const text = message.toLowerCase();
    return (!included.length || included.some((term) => text.includes(term))) && excluded.every((term) => !text.includes(term));
  };
}

export function selectIosRecords(records: IosLogRecord[], view: IosViewState, blocking?: IosLogBlockingPreferences) {
  const source = (view.snapshot ?? records).filter((record) => (record.sequence ?? Infinity) > view.clearedThrough
    && (view.kind !== "test" || (!!view.testRun && record.sessionId === view.testRun.sessionId && (record.sequence ?? -1) > view.testRun.afterSequence)));
  if (view.kind === "test") return { source, records: source, error: null, blockedCount: 0 };
  const search = createLogSearch(view.search, view.regex);
  const matchesMarker = createIosMarkerFilter(view.markers ?? "");
  let blockedCount = 0;
  const filtered = source.filter((record) => {
    if (isIosLogBlocked(record, blocking)) {
      blockedCount++;
      if (!view.showBlockedLogs) return false;
    }
    if (view.level && record.level !== view.level) return false;
    if (view.semantic && !(view.semantic === "unknown" ? record.semanticLevel == null : record.semanticLevel === view.semantic)) return false;
    const display = getIosLogDisplay(record);
    return matchesMarker(display.recovered ? `${record.message}\n${display.message}` : record.message)
      && (search.matches(record.raw) || (display.recovered && search.matches(display.message)));
  });
  return { source, records: filtered, error: search.error, blockedCount };
}

export function selectIosLogs(records: IosLogRecord[], view: IosViewState, deviceKey = "probe", sessionId = "probe") {
  const selection = selectIosRecords(records, view);
  return { ...selection, rows: selection.records.map((record) => projectIosLog(record, deviceKey, sessionId)) };
}
