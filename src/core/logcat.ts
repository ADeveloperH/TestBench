import { LEVEL_SEVERITY } from "./types";
import type { FilterState, LogEntry, LogLevel } from "./types";

export type ParsedLogEntry = Omit<LogEntry, "id">;

// `adb logcat -v long` 的记录头格式：
// [ MM-DD HH:MM:SS.mmm  PID:TID LEVEL/TAG ]
// TID 在旧系统上可能是十六进制；Tag 会为了对齐带尾部空格。
const LONG_HEADER_RE =
  /^\[\s*(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+):\s*(\S+)\s+([VDIWEFA])\/(.*?)\s*\]$/;

const BUFFER_DIVIDER_RE = /^---------\s+(?:beginning of|switch to)\s+/;

interface PendingLongEntry {
  date: string;
  time: string;
  pid: string;
  tid: string;
  level: LogLevel;
  tag: string;
  header: string;
  messageLines: string[];
}

/**
 * 有状态地解析 `logcat -v long` 输出。
 *
 * long 格式为每个底层日志记录提供独立的头和空行分隔，因此消息中的换行可以
 * 保留在同一个 LogEntry 中，不再依赖时间戳或堆栈正则猜测记录边界。
 */
export class LongLogParser {
  private pending: PendingLongEntry | null = null;

  pushLine(line: string): ParsedLogEntry[] {
    const out: ParsedLogEntry[] = [];
    const header = parseLongHeader(line);

    if (header) {
      const previous = this.flush();
      if (previous) out.push(previous);
      this.pending = { ...header, header: line, messageLines: [] };
      return out;
    }

    if (BUFFER_DIVIDER_RE.test(line)) {
      const previous = this.flush();
      if (previous) out.push(previous);
      return out;
    }

    if (!this.pending) return out;

    // long 格式用空行结束一条记录，不把格式分隔符带进消息与导出内容。
    if (line.length === 0) {
      const entry = this.flush();
      if (entry) out.push(entry);
      return out;
    }

    this.pending.messageLines.push(line);
    return out;
  }

  flush(): ParsedLogEntry | null {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return null;
    const message = pending.messageLines.join("\n");
    return {
      date: pending.date,
      time: pending.time,
      pid: pending.pid,
      tid: pending.tid,
      level: pending.level,
      tag: pending.tag,
      message,
      raw: [pending.header, ...pending.messageLines].join("\n"),
    };
  }

  reset(): void {
    this.pending = null;
  }
}

function parseLongHeader(
  line: string,
): Omit<PendingLongEntry, "header" | "messageLines"> | null {
  const match = LONG_HEADER_RE.exec(line);
  if (!match) return null;
  const [, date, time, pid, tid, level, tag] = match;
  return {
    date,
    time,
    pid,
    tid,
    level: level as LogLevel,
    tag: tag.trim(),
  };
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** 去除 ANSI 颜色/控制转义序列（如 \x1b[31m），避免在纯文本列表里显示成乱码。 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

const STACK_MAX_GAP_MS = 250;

const STACK_CONTINUATION_PATTERNS = [
  // Java / Kotlin / .NET：at package.Class.method(File.kt:12)
  /^\s*at\s+.+\([^)]*\)\s*$/,
  /^\s*Caused by:\s+.+$/,
  /^\s*Suppressed:\s+.+$/,
  /^\s*\.\.\.\s+\d+\s+more\s*$/,
  /^\s*--- End of .* stack trace ---\s*$/,
  /^\s*Rethrow as\s+.+$/,
  // Native tombstone / debuggerd backtrace。
  /^\s*#\d+\s+(?:pc\s+)?[0-9a-fA-F]+\s+.+$/,
  // Unity / C#：Namespace.Type:Method(args) 或后接 (at Assets/...:12)。
  /^\s*[A-Za-z_][\w.+<>`\[\]-]*:[A-Za-z_][\w.+<>`\[\]-]*\s*\(.*\)(?:\s+\(at\s+.+:\d+\))?\s*$/,
  /^\s*\(at\s+.+:\d+\)\s*$/,
];

function isStackContinuation(message: string): boolean {
  return STACK_CONTINUATION_PATTERNS.some((pattern) => pattern.test(message));
}

function sameStackContext(a: LogEntry, b: LogEntry): boolean {
  return (
    a.pid === b.pid &&
    a.tid === b.tid &&
    a.tag === b.tag &&
    a.level === b.level &&
    timestampGapMs(
      a.groupEndDate ?? a.date,
      a.groupEndTime ?? a.time,
      b.date,
      b.time,
    ) <= STACK_MAX_GAP_MS
  );
}

function timestampGapMs(
  leftDate: string,
  leftTime: string,
  rightDate: string,
  rightTime: string,
): number {
  const left = timestampToMs(leftDate, leftTime);
  const right = timestampToMs(rightDate, rightTime);
  if (left == null || right == null || right < left) return Number.POSITIVE_INFINITY;
  return right - left;
}

function timestampToMs(date: string, time: string): number | null {
  const match = /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d+)$/.exec(
    `${date} ${time}`,
  );
  if (!match) return null;
  const [, month, day, hour, minute, second, fraction] = match;
  const millis = Number(fraction.padEnd(3, "0").slice(0, 3));
  return Date.UTC(
    2000,
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millis,
  );
}

/**
 * 把明确的、由多次 Log 调用输出的堆栈续行合并到上一条展示记录。
 * 原始记录数组不应调用此函数修改；它只负责构建界面展示数据。
 */
export function appendDisplayEntry(
  display: LogEntry[],
  entry: LogEntry,
  mergeStack: boolean,
): void {
  const last = display[display.length - 1];
  if (
    mergeStack &&
    last &&
    isStackContinuation(entry.message) &&
    sameStackContext(last, entry)
  ) {
    display[display.length - 1] = {
      ...last,
      message: `${last.message}\n  ${entry.message.trimStart()}`,
      raw: `${last.raw}\n${entry.raw}`,
      groupEndDate: entry.date,
      groupEndTime: entry.time,
    };
    return;
  }
  display.push(entry);
}

/** 从原始日志重建展示列表，供“合并堆栈”设置切换时使用。 */
export function buildDisplayEntries(
  entries: LogEntry[],
  mergeStack: boolean,
): LogEntry[] {
  if (!mergeStack) return entries.slice();
  const display: LogEntry[] = [];
  for (const entry of entries) appendDisplayEntry(display, entry, true);
  return display;
}

/** 在展示分组完成后过滤，命中堆栈任意一行时保留整个日志组。 */
export function filterLogEntries(
  entries: LogEntry[],
  filters: FilterState,
): LogEntry[] {
  const minSeverity = LEVEL_SEVERITY[filters.minLevel];
  const tags = filters.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const includeTags = tags.filter((tag) => !tag.startsWith("!"));
  const excludeTags = tags
    .filter((tag) => tag.startsWith("!"))
    .map((tag) => tag.slice(1).trim())
    .filter(Boolean);
  const pids = filters.pid
    .split(",")
    .map((pid) => pid.trim())
    .filter(Boolean);

  let search: RegExp | null = null;
  if (filters.search) {
    try {
      search = filters.regex
        ? new RegExp(filters.search, "i")
        : new RegExp(escapeRegExp(filters.search), "i");
    } catch {
      search = null;
    }
  }

  return entries.filter((entry) => {
    if (LEVEL_SEVERITY[entry.level] < minSeverity) return false;
    if (pids.length > 0 && !pids.includes(entry.pid)) return false;
    const normalizedTag = entry.tag.toLowerCase();
    if (
      includeTags.length > 0 &&
      !includeTags.some((tag) => normalizedTag.includes(tag.toLowerCase()))
    ) {
      return false;
    }
    if (
      excludeTags.some((tag) => normalizedTag.includes(tag.toLowerCase()))
    ) {
      return false;
    }
    return !search || search.test(entry.message) || search.test(entry.tag);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
