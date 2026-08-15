import type { LogEntry, LogLevel } from "./types";

// `adb logcat -v threadtime` 的输出格式：
// MM-DD HH:MM:SS.mmm  PID  TID  LEVEL Tag: message
const HEADER_RE =
  /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*)$/;

/**
 * 解析一行 logcat 输出。若该行没有标准头（即多行消息的续行），返回 null，
 * 调用方应把它追加到上一条消息之后。
 */
export function parseLogLine(line: string, id: number): LogEntry | null {
  const m = HEADER_RE.exec(line);
  if (!m) return null;
  const [, date, time, pid, tid, level, rest] = m;
  let tag = "";
  let message = rest;
  const idx = rest.indexOf(": ");
  if (idx >= 0) {
    // tag 列可能带尾部空格（logcat 对齐），需 trim 后再比较
    tag = rest.slice(0, idx).trim();
    message = rest.slice(idx + 2);
  }
  return {
    id,
    date,
    time,
    pid,
    tid,
    level: level as LogLevel,
    tag,
    message,
    raw: line,
  };
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** 去除 ANSI 颜色/控制转义序列（如 \x1b[31m），避免在纯文本列表里显示成乱码。 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
