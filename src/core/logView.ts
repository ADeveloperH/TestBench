/** 展示投影不代替平台原始模型；列表和用例引擎不得反向消费伪造的字段。 */
export type LogColumnId = "timestamp" | "pid" | "tid" | "tag" | "process" | "module" | "level" | "semanticLevel" | "message";
export interface LogViewColumn { id: LogColumnId; label: string }
export interface LogFindState { open: boolean; query: string; caseSensitive: boolean; useRegex: boolean; currentMatch: number }
export interface LogViewportScrollCommand { seq: number; kind: "key" | "top" | "bottom" | "index"; key?: string; index?: number }
/** 平台来源记录不可变；复用已有投影，避免高频日志每批重建全部行对象。 */
export function cacheLogProjection<T extends object, V>(project: (record: T) => V): (record: T) => V {
  const cache = new WeakMap<T, V>();
  return (record) => {
    if (!cache.has(record)) cache.set(record, project(record));
    return cache.get(record)!;
  };
}
export interface LogViewRecord<T> {
  key: string;
  platform: "android" | "ios";
  timestamp: string;
  pid: string | null;
  tid: string | null;
  tag: string | null;
  process: string | null;
  module: string | null;
  rawLevel: string;
  semanticLevel: string | null;
  semanticLevelSource: string | null;
  message: string;
  raw: string;
  encodingStatus: "valid" | "suspected_mojibake";
  encodingRecovered?: boolean;
  truncated: boolean;
  original: T;
}
export const LOG_VIEW_CAPABILITIES = {
  android: { levelMode: "minimum", tagFilter: true, appFilter: true, semanticFilter: false, testTabs: true },
  ios: { levelMode: "exact", tagFilter: false, appFilter: false, semanticFilter: true, testTabs: false },
} as const;
export const LOG_VIEW_COLUMNS: Record<"android" | "ios", readonly LogViewColumn[]> = {
  android: [{ id: "timestamp", label: "时间" }, { id: "pid", label: "PID" }, { id: "tid", label: "TID" }, { id: "level", label: "级别" }, { id: "tag", label: "Tag" }, { id: "message", label: "内容" }],
  ios: [{ id: "timestamp", label: "时间" }, { id: "process", label: "进程" }, { id: "pid", label: "PID" }, { id: "level", label: "原始级别" }, { id: "semanticLevel", label: "Unity 推断" }, { id: "message", label: "内容" }],
};

export function logViewCell(record: LogViewRecord<unknown>, column: LogColumnId): string {
  if (column === "level") return record.rawLevel;
  return record[column] ?? "—";
}

export function logLevelColor(platform: "android" | "ios", level: string): string {
  const colors: Record<string, string> = platform === "android"
    ? { V: "#9e9e9e", D: "#56a8f5", I: "#4fc877", W: "#f5a623", E: "#f5576c", F: "#b084f7", A: "#b084f7" }
    : { notice: "#9e9e9e", debug: "#56a8f5", info: "#4fc877", warning: "#f5a623", error: "#f5576c", fault: "#b084f7", critical: "#b084f7" };
  return colors[level] ?? "var(--text-dim)";
}
export function semanticLevelColor(level: string | null): string {
  return ({ info: "#4fc877", warning: "#f5a623", error: "#f5576c", exception: "#b084f7" } as Record<string, string>)[level ?? ""] ?? "var(--text-dim)";
}

export function createLogSearch(query: string, regex: boolean): { matches: (raw: string) => boolean; error: string | null } {
  if (!query.trim()) return { matches: () => true, error: null };
  if (regex) {
    try {
      const expression = new RegExp(query, "i");
      return { matches: (raw) => expression.test(raw), error: null };
    } catch { return { matches: () => false, error: "正则表达式无效" }; }
  }
  const needle = query.trim().toLocaleLowerCase();
  return { matches: (raw) => raw.toLocaleLowerCase().includes(needle), error: null };
}
