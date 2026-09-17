import type { LogEntry } from "./types";

export type ParsedLogEntry = Omit<LogEntry, "id">;

const FRAME_PREFIX = "__TB_LOG_V1__";
const FRAME_RE = /^__TB_LOG_V1__\|([0-9a-f]{32})\|(\d+)\/(\d+)\|([A-Za-z0-9+/=.]*)$/;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PENDING_GROUPS = 256;

interface ChunkFrame {
  groupId: string;
  part: number;
  total: number;
  content: string;
}

interface PendingGroup {
  total: number;
  firstSeenAt: number;
  lastSeenAt: number;
  entries: Map<number, ParsedLogEntry>;
  parts: Map<number, string>;
}

/**
 * Reassembles the versioned chunk protocol emitted by NetworkLogger on Android.
 * Physical transport entries stay hidden; callers only receive logical entries.
 */
export class ChunkedLogAssembler {
  private readonly groups = new Map<string, PendingGroup>();

  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  push(entry: ParsedLogEntry, now = Date.now()): ParsedLogEntry[] {
    const frame = parseFrame(entry.message);
    if (!frame) return [entry];

    const output = this.flushExpired(now);
    let group = this.groups.get(frame.groupId);
    if (group && group.total !== frame.total) {
      output.push(buildIncompleteEntry(group, "分段总数不一致"));
      this.groups.delete(frame.groupId);
      group = undefined;
    }

    if (!group) {
      if (this.groups.size >= MAX_PENDING_GROUPS) {
        const oldest = this.groups.entries().next().value as
          | [string, PendingGroup]
          | undefined;
        if (oldest) {
          output.push(buildIncompleteEntry(oldest[1], "等待队列已满"));
          this.groups.delete(oldest[0]);
        }
      }
      group = {
        total: frame.total,
        firstSeenAt: now,
        lastSeenAt: now,
        entries: new Map(),
        parts: new Map(),
      };
      this.groups.set(frame.groupId, group);
    }

    group.lastSeenAt = now;
    group.entries.set(frame.part, entry);
    group.parts.set(frame.part, frame.content);

    if (group.parts.size !== group.total) return output;

    this.groups.delete(frame.groupId);
    const assembled = buildCompleteEntry(group);
    output.push(assembled ?? buildIncompleteEntry(group, "分段内容无法解码"));
    return output;
  }

  flushExpired(now = Date.now()): ParsedLogEntry[] {
    const output: ParsedLogEntry[] = [];
    for (const [groupId, group] of this.groups) {
      if (now - group.lastSeenAt < this.timeoutMs) continue;
      output.push(buildIncompleteEntry(group, "等待分段超时"));
      this.groups.delete(groupId);
    }
    return output;
  }

  reset(): void {
    this.groups.clear();
  }
}

function parseFrame(message: string): ChunkFrame | null {
  if (!message.startsWith(FRAME_PREFIX)) return null;
  const match = FRAME_RE.exec(message);
  if (!match) return null;
  const part = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total)) return null;
  if (total < 1 || part < 1 || part > total) return null;
  return {
    groupId: match[1],
    part,
    total,
    content: match[4],
  };
}

function buildCompleteEntry(group: PendingGroup): ParsedLogEntry | null {
  const metadata = group.entries.get(1) ?? group.entries.values().next().value;
  if (!metadata) return null;

  let encoded = "";
  for (let part = 1; part <= group.total; part += 1) {
    const content = group.parts.get(part);
    if (content == null) return null;
    encoded += content;
  }

  const separator = encoded.indexOf(".");
  if (separator < 0) return null;
  try {
    const message = decodeUtf8Base64(encoded.slice(0, separator));
    const stackTrace = decodeUtf8Base64(encoded.slice(separator + 1));
    const combined = stackTrace ? `${message}\n${stackTrace}` : message;
    const header = metadata.raw.split("\n", 1)[0];
    return {
      ...metadata,
      message: combined,
      raw: combined ? `${header}\n${combined}` : header,
    };
  } catch {
    return null;
  }
}

function buildIncompleteEntry(group: PendingGroup, reason: string): ParsedLogEntry {
  const orderedEntries = [...group.entries.entries()].sort(([a], [b]) => a - b);
  const metadata = orderedEntries[0]?.[1];
  if (!metadata) {
    throw new Error("Cannot build an incomplete chunk entry without metadata");
  }
  const received = orderedEntries.map(([part]) => part).join(", ");
  const message =
    `[TestBench 分段日志不完整：${reason}；` +
    `收到 ${group.entries.size}/${group.total} 段（${received}）]`;
  const header = metadata.raw.split("\n", 1)[0];
  return {
    ...metadata,
    message,
    raw: `${header}\n${message}`,
  };
}

function decodeUtf8Base64(value: string): string {
  if (!value) return "";
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
