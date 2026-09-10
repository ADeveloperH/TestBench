import { appendDisplayEntry } from "../../core/logcat";
import type { LogEntry } from "../../core/types";

export interface IncrementalFilterCache {
  key: string;
  firstSourceId: number;
  lastSourceId: number;
  entries: LogEntry[];
}

export interface ProjectionResult {
  entries: LogEntry[];
  blockedCount: number;
}

export interface ProjectionCache extends ProjectionResult {
  key: string;
  firstSourceId: number;
  lastSourceId: number;
  lastDisplay: LogEntry | null;
  lastVisible: boolean;
  lastBlocked: boolean;
  blockedIds: number[];
}

function firstId(entries: LogEntry[]): number {
  return entries[0]?.id ?? -1;
}

function lastId(entries: LogEntry[]): number {
  return entries[entries.length - 1]?.id ?? -1;
}

function firstIndexAfter(entries: LogEntry[], id: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entries[middle].id <= id) low = middle + 1;
    else high = middle;
  }
  return low;
}

function canAppend(
  cache: { key: string; firstSourceId: number; lastSourceId: number },
  source: LogEntry[],
  key: string,
): boolean {
  if (cache.key !== key || source.length === 0) return false;
  const sourceFirstId = firstId(source);
  const sourceLastId = lastId(source);
  return (
    cache.lastSourceId >= sourceFirstId &&
    cache.lastSourceId <= sourceLastId
  );
}

/** 对追加式日志数组做增量过滤；日志窗口淘汰或 ID 重置时自动完整重建。 */
export function updateIncrementalFilter(
  cache: IncrementalFilterCache | undefined,
  source: LogEntry[],
  key: string,
  predicate: (entry: LogEntry) => boolean,
): IncrementalFilterCache {
  if (source.length === 0) {
    return { key, firstSourceId: -1, lastSourceId: -1, entries: [] };
  }

  if (!cache || !canAppend(cache, source, key)) {
    return {
      key,
      firstSourceId: firstId(source),
      lastSourceId: lastId(source),
      entries: source.filter(predicate),
    };
  }

  const start = firstIndexAfter(source, cache.lastSourceId);
  const sourceFirstId = firstId(source);
  const retained =
    cache.firstSourceId === sourceFirstId
      ? cache.entries
      : cache.entries.filter((entry) => entry.id >= sourceFirstId);
  if (start >= source.length && retained === cache.entries) return cache;
  const appended = source.slice(start).filter(predicate);
  return {
    ...cache,
    firstSourceId: sourceFirstId,
    lastSourceId: lastId(source),
    entries: appended.length > 0 ? [...retained, ...appended] : retained,
  };
}

interface ProjectionOptions {
  mergeStack: boolean;
  acceptSource?: (entry: LogEntry) => boolean;
  include: (entry: LogEntry) => boolean;
  blocked: (entry: LogEntry) => boolean;
  showBlocked: boolean;
}

function applyEntry(
  cache: ProjectionCache,
  entry: LogEntry,
  options: ProjectionOptions,
): void {
  const holder = cache.lastDisplay ? [cache.lastDisplay] : [];
  appendDisplayEntry(holder, entry, options.mergeStack);
  const merged = cache.lastDisplay != null && holder.length === 1;
  const nextDisplay = holder[holder.length - 1];

  if (merged) {
    if (
      cache.lastVisible &&
      cache.entries[cache.entries.length - 1]?.id === cache.lastDisplay?.id
    ) {
      cache.entries.pop();
    }
    if (
      cache.lastBlocked &&
      cache.blockedIds[cache.blockedIds.length - 1] === cache.lastDisplay?.id
    ) {
      cache.blockedIds.pop();
      cache.blockedCount -= 1;
    }
  }

  const included = options.include(nextDisplay);
  const blocked = included && options.blocked(nextDisplay);
  const visible = included && (options.showBlocked || !blocked);
  if (visible) cache.entries.push(nextDisplay);
  if (blocked) {
    cache.blockedIds.push(nextDisplay.id);
    cache.blockedCount += 1;
  }
  cache.lastDisplay = nextDisplay;
  cache.lastVisible = visible;
  cache.lastBlocked = blocked;
}

/**
 * 缓存某个 Tab 的最终展示投影。相同配置下只处理新增日志；切换回来直接复用。
 * 缓存只保留筛选后的数组和最后一个展示组，不复制整份原始日志。
 */
export function updateProjection(
  cache: ProjectionCache | undefined,
  source: LogEntry[],
  key: string,
  options: ProjectionOptions,
): ProjectionCache {
  if (source.length === 0) {
    return {
      key,
      firstSourceId: -1,
      lastSourceId: -1,
      entries: [],
      blockedCount: 0,
      lastDisplay: null,
      lastVisible: false,
      lastBlocked: false,
      blockedIds: [],
    };
  }

  let next: ProjectionCache;
  let start = 0;
  if (cache && canAppend(cache, source, key)) {
    start = firstIndexAfter(source, cache.lastSourceId);
    const sourceFirstId = firstId(source);
    const entries =
      cache.firstSourceId === sourceFirstId
        ? cache.entries
        : cache.entries.filter((entry) => entry.id >= sourceFirstId);
    const blockedIds =
      cache.firstSourceId === sourceFirstId
        ? cache.blockedIds
        : cache.blockedIds.filter((id) => id >= sourceFirstId);
    if (
      start >= source.length &&
      entries === cache.entries &&
      blockedIds === cache.blockedIds
    ) {
      return cache;
    }
    const keepLastDisplay = (cache.lastDisplay?.id ?? sourceFirstId) >= sourceFirstId;
    next = {
      ...cache,
      firstSourceId: sourceFirstId,
      entries: [...entries],
      blockedIds: [...blockedIds],
      blockedCount: blockedIds.length,
      lastDisplay: keepLastDisplay ? cache.lastDisplay : null,
      lastVisible: keepLastDisplay ? cache.lastVisible : false,
      lastBlocked: keepLastDisplay ? cache.lastBlocked : false,
    };
  } else {
    next = {
      key,
      firstSourceId: firstId(source),
      lastSourceId: -1,
      entries: [],
      blockedCount: 0,
      lastDisplay: null,
      lastVisible: false,
      lastBlocked: false,
      blockedIds: [],
    };
  }

  for (let i = start; i < source.length; i += 1) {
    if (!options.acceptSource || options.acceptSource(source[i])) {
      applyEntry(next, source[i], options);
    }
  }
  next.lastSourceId = lastId(source);
  return next;
}
