import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LogEntry, LogLevel, ScrollCommand } from "../../core/types";
import type { LogFindState } from "./useLogTabs";

const ROW_HEIGHT = 20;
const LONG_THRESHOLD = 1200;
// 跟随暂停的迟滞区间：距底部 < 48px 恢复跟随，> 160px 才判定为「滚离底部」暂停跟随，
// 中间地带保持原状态，轻微滑动不会误触发暂停。
const RESUME_DISTANCE = 48;
const PAUSE_DISTANCE = 160;
// Ctrl+F 查找索引的刷新周期：日志持续涌入时，匹配统计按此周期重算（避免每 80ms 全量扫描）。
const FIND_REFRESH_MS = 400;

// ============ 表头列宽（可拖拽调整，持久化） ============

type ColKey = "time" | "pid" | "tid" | "level" | "tag";

const COL_DEFAULTS: Record<ColKey, number> = {
  time: 150,
  pid: 72,
  tid: 72,
  level: 40,
  tag: 200,
};

const COL_MIN: Record<ColKey, number> = {
  time: 70,
  pid: 44,
  tid: 44,
  level: 40,
  tag: 70,
};

const COL_MAX: Record<ColKey, number> = {
  time: 320,
  pid: 140,
  tid: 140,
  level: 80,
  tag: 420,
};

const COL_WIDTHS_KEY = "log-col-widths-v1";

/** 列说明：表头文案与悬停提示。 */
const COL_HEADERS: { key: ColKey; label: string; tip: string }[] = [
  { key: "time", label: "时间", tip: "日志时间" },
  { key: "pid", label: "PID", tip: "进程 ID" },
  { key: "tid", label: "TID", tip: "线程 ID" },
  { key: "level", label: "级别", tip: "日志级别" },
  { key: "tag", label: "Tag", tip: "日志标签" },
];

function loadColWidths(): Record<ColKey, number> {
  const out = { ...COL_DEFAULTS };
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Record<ColKey, number>>;
      for (const k of Object.keys(COL_DEFAULTS) as ColKey[]) {
        if (typeof d[k] === "number") {
          out[k] = Math.min(COL_MAX[k], Math.max(COL_MIN[k], d[k]));
        }
      }
      // 旧默认时间列 132px 放不下完整时间（08-18 05:37:14.241），迁移到新默认；
      // 用户手动拖过的其他宽度原样保留。
      if (out.time === 132) out.time = COL_DEFAULTS.time;
    }
  } catch {
    // 忽略损坏的缓存
  }
  return out;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  V: "#9e9e9e",
  D: "#56a8f5",
  I: "#4fc877",
  W: "#f5a623",
  E: "#f5576c",
  F: "#b084f7",
  A: "#b084f7",
};

// ============ Ctrl+F 查找（Android Studio Logcat 风格） ============

/** 某一行的匹配信息：start = 全列表起始匹配序号，count = 该行匹配数，msgCount = 消息部分匹配数。 */
interface FindRowInfo {
  rowIndex: number;
  id: number;
  start: number;
  count: number;
  msgCount: number;
}

interface FindIndex {
  /** 查询是否有效（正则编译失败为 false） */
  valid: boolean;
  total: number;
  rows: FindRowInfo[];
  byId: Map<number, { start: number; count: number; msgCount: number }>;
}

const EMPTY_INDEX: FindIndex = { valid: true, total: 0, rows: [], byId: new Map() };

function countRegexMatches(re: RegExp, text: string): number {
  let n = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length > 0) n += 1;
    if (m.index === re.lastIndex) re.lastIndex += 1; // 防止零宽匹配死循环
  }
  return n;
}

function countLiteralMatches(
  text: string,
  needle: string,
  caseSensitive: boolean,
): number {
  if (!needle) return 0;
  const hay = caseSensitive ? text : text.toLowerCase();
  let n = 0;
  let idx = hay.indexOf(needle);
  while (idx >= 0) {
    n += 1;
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return n;
}

/** 全量扫描当前日志，构建匹配索引（查找条打开时按 FIND_REFRESH_MS 节流重算）。 */
function buildFindIndex(
  rows: LogEntry[],
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): FindIndex {
  if (!query) return EMPTY_INDEX;
  let re: RegExp | null = null;
  if (useRegex) {
    try {
      re = new RegExp(query, caseSensitive ? "g" : "gi");
    } catch {
      return { valid: false, total: 0, rows: [], byId: new Map() };
    }
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  const list: FindRowInfo[] = [];
  const byId = new Map<number, { start: number; count: number; msgCount: number }>();
  let total = 0;
  rows.forEach((e, rowIndex) => {
    const msgCount = re
      ? countRegexMatches(re, e.message)
      : countLiteralMatches(e.message, needle, caseSensitive);
    const tagCount = re
      ? countRegexMatches(re, e.tag)
      : countLiteralMatches(e.tag, needle, caseSensitive);
    const count = msgCount + tagCount;
    if (count > 0) {
      list.push({ rowIndex, id: e.id, start: total, count, msgCount });
      byId.set(e.id, { start: total, count, msgCount });
      total += count;
    }
  });
  return { valid: true, total, rows: list, byId };
}

/** 二分查找某个匹配序号所在的行。 */
function rowOfOccurrence(idx: FindIndex, occ: number): FindRowInfo | null {
  const rows = idx.rows;
  if (rows.length === 0) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].start <= occ) lo = mid;
    else hi = mid - 1;
  }
  return rows[lo];
}

/** 把 text 中的匹配片段渲染为高亮 <mark>（当前匹配用橙色、其余淡黄）。 */
function highlightText(
  text: string,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  rowInfo: { start: number; count: number; msgCount: number },
  currentOccurrence: number,
  isTag: boolean,
): ReactNode {
  const occStart = rowInfo.start + (isTag ? rowInfo.msgCount : 0);
  let re: RegExp | null = null;
  if (useRegex && query) {
    try {
      re = new RegExp(query, caseSensitive ? "g" : "gi");
    } catch {
      re = null;
    }
  }
  const out: ReactNode[] = [];
  let last = 0;
  let occ = occStart;
  let key = 0;
  const push = (from: number, to: number, matched: string) => {
    if (matched.length === 0) return; // 跳过零宽匹配
    if (from > last) out.push(text.slice(last, from));
    out.push(
      <mark
        key={key++}
        className={occ === currentOccurrence ? "find-hit current" : "find-hit"}
      >
        {matched}
      </mark>,
    );
    occ += 1;
    last = to;
  };
  if (re) {
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      push(i, i + m[0].length, m[0]);
    }
  } else if (query) {
    const needle = caseSensitive ? query : query.toLowerCase();
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i >= 0) {
      push(i, i + needle.length, text.slice(i, i + needle.length));
      i = hay.indexOf(needle, i + needle.length);
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Props {
  entries: LogEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClearSelection: () => void;
  scrollCommand: ScrollCommand | null;
  /** 筛选或 Tab 切换时变化，用于主动清空虚拟列表的旧行高缓存。 */
  layoutKey: string;
  tabId: string;
  followLatest: boolean;
  onFollowLatestChange: (follow: boolean) => void;
  findState: LogFindState;
  onFindStateChange: (state: LogFindState) => void;
}

/**
 * 跟随最新日志采用 Chrome DevTools Console 风格：
 * 默认一直跟随；向上滚动查看历史时自动暂停跟随，
 * 并浮现「回到最新」浮动按钮；点击或滚回底部后恢复跟随。
 * Ctrl/Cmd+F 打开 Android Studio Logcat 风格的查找条（高亮 + 上一个/下一个 + 计数 + 正则/大小写）。
 */
export function LogList({
  entries,
  selectedId,
  onSelect,
  onClearSelection,
  scrollCommand,
  layoutKey,
  tabId,
  followLatest,
  onFollowLatestChange,
  findState,
  onFindStateChange,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(followLatest);
  followLatestRef.current = followLatest;
  const lastScrollTopRef = useRef(0);
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef<number | null>(null);
  const tabScrollOffsetsRef = useRef(new Map<string, number>());
  const displayedTabIdRef = useRef(tabId);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const updateFollowLatest = (follow: boolean) => {
    if (followLatestRef.current === follow) return;
    followLatestRef.current = follow;
    onFollowLatestChange(follow);
  };

  const scrollToLatest = () => {
    const el = parentRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
    tabScrollOffsetsRef.current.set(displayedTabIdRef.current, el.scrollTop);
  };

  // 用户滚轮、触控或拖动滚动条期间，暂时禁止新日志抢占位置。
  // 如果手势结束时仍未超过 160px 暂停阈值，则继续原有的跟随行为。
  const beginUserScrolling = () => {
    userScrollingRef.current = true;
    if (userScrollTimerRef.current != null) {
      window.clearTimeout(userScrollTimerRef.current);
      userScrollTimerRef.current = null;
    }
  };

  const finishUserScrolling = () => {
    if (userScrollTimerRef.current != null) {
      window.clearTimeout(userScrollTimerRef.current);
    }
    userScrollTimerRef.current = window.setTimeout(() => {
      userScrollingRef.current = false;
      userScrollTimerRef.current = null;
      if (followLatestRef.current) scrollToLatest();
    }, 220);
  };

  const markUserScrolling = () => {
    beginUserScrolling();
    finishUserScrolling();
  };

  useEffect(
    () => () => {
      if (userScrollTimerRef.current != null) {
        window.clearTimeout(userScrollTimerRef.current);
      }
    },
    [],
  );

  // —— Ctrl+F 查找状态 ——
  const {
    open: searchOpen,
    query,
    caseSensitive,
    useRegex,
    currentMatch,
  } = findState;
  const updateFind = (patch: Partial<LogFindState>) => {
    onFindStateChange({ ...findState, ...patch });
  };
  const [findSnapshot, setFindSnapshot] = useState<LogEntry[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // —— 表头列宽（拖拽调整） ——
  const [colWidths, setColWidths] = useState(loadColWidths);
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const colDragRef = useRef<{
    col: ColKey;
    startX: number;
    startW: number;
  } | null>(null);

  const startColResize = (col: ColKey) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    colDragRef.current = { col, startX: e.clientX, startW: colWidths[col] };
    const onMove = (ev: MouseEvent) => {
      if (!colDragRef.current) return;
      const w = Math.min(
        COL_MAX[col],
        Math.max(
          COL_MIN[col],
          colDragRef.current.startW + (ev.clientX - colDragRef.current.startX),
        ),
      );
      setColWidths((prev) => ({ ...prev, [col]: w }));
    };
    const onUp = () => {
      colDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
      try {
        localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidthsRef.current));
      } catch {
        // 忽略写入失败
      }
    };
    document.body.classList.add("col-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const resetColWidth = (col: ColKey) => () => {
    setColWidths((prev) => ({ ...prev, [col]: COL_DEFAULTS[col] }));
  };

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    // 筛选后同一 index 会对应不同日志。使用日志 ID 作为测量缓存键，
    // 避免旧日志的行高套用到新结果上造成行重叠。
    getItemKey: (index) => entries[index]?.id ?? index,
    estimateSize: () => ROW_HEIGHT,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 30,
  });

  // Tag/搜索/过滤器或日志 Tab 改变后，主动重新测量可见行。
  // ResizeObserver 在 WebView 中偶尔会晚一帧，下一帧再测一次可避免
  // 必须调整窗口尺寸后才恢复的日志重叠问题。
  useLayoutEffect(() => {
    setExpandedId(null);
    const measureRenderedRows = () => {
      parentRef.current
        ?.querySelectorAll<HTMLElement>(".log-row[data-index]")
        .forEach((row) => virtualizer.measureElement(row));
    };
    measureRenderedRows();
    const frame = requestAnimationFrame(measureRenderedRows);
    return () => cancelAnimationFrame(frame);
    // virtualizer 实例会随渲染变化，只以明确的布局 key 作为重测条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // 切换 Tab 时恢复各自的浏览位置；仍在跟随的 Tab 直接显示最新日志。
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    displayedTabIdRef.current = tabId;
    if (followLatestRef.current) {
      scrollToLatest();
    } else {
      const saved = tabScrollOffsetsRef.current.get(tabId);
      if (saved != null) el.scrollTop = saved;
      lastScrollTopRef.current = el.scrollTop;
    }
    // 只在 Tab 身份变化时恢复，不让日志/测量变化重复执行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 只有用户主动向上滚动（scrollTop 变小）才视为「滚离底部」；
    // 行高测量导致的内容增长（scrollTop 不变或变大）不会误触发暂停。
    const scrolledUp = el.scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    tabScrollOffsetsRef.current.set(displayedTabIdRef.current, el.scrollTop);
    // 只允许用户产生的滚动改变跟随状态；详情展开、虚拟列表测量和
    // 程序定位造成的 scroll 事件不能擅自恢复跟随。
    if (!userScrollingRef.current) return;
    finishUserScrolling();
    if (dist < RESUME_DISTANCE) {
      // 回到底部附近 → 恢复跟随
      updateFollowLatest(true);
    } else if (dist > PAUSE_DISTANCE && scrolledUp) {
      // 明显向上滚动 → 暂停跟随
      updateFollowLatest(false);
    }
    // 中间地带保持当前状态（迟滞），轻微滑动不改变跟随状态
  };

  // 视图在底部时保持贴底：
  // - 新日志到达（entries 变化）重新锚定；
  // - 行高测量更新（总高度变化）也会重新锚定，避免估计高度与实际高度
  //   的差值把视图「顶」到真实底部上方导致跟随中断。
  const totalSize = virtualizer.getTotalSize();
  useEffect(() => {
    const el = parentRef.current;
    if (followLatestRef.current && !userScrollingRef.current && el) {
      scrollToLatest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, totalSize, followLatest, tabId]);

  // 回到最新：滚到底部并恢复跟随。
  const backToLatest = () => {
    userScrollingRef.current = false;
    onClearSelection();
    updateFollowLatest(true);
    scrollToLatest();
  };

  // 收到滚动指令时执行：定位到指定日志 / 跳到最早、最新、指定行号。
  useEffect(() => {
    if (!scrollCommand || entries.length === 0) return;
    const { kind } = scrollCommand;
    if (kind === "top") {
      updateFollowLatest(false);
      virtualizer.scrollToIndex(0, { align: "start" });
    } else if (kind === "bottom") {
      updateFollowLatest(true);
      virtualizer.scrollToIndex(entries.length - 1, { align: "end" });
    } else if (kind === "index" && scrollCommand.index != null) {
      updateFollowLatest(false);
      const idx = Math.min(Math.max(scrollCommand.index, 0), entries.length - 1);
      virtualizer.scrollToIndex(idx, { align: "center" });
    } else if (kind === "id" && scrollCommand.id != null) {
      updateFollowLatest(false);
      const idx = entries.findIndex((e) => e.id === scrollCommand.id);
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: "center" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollCommand]);

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // —— 查找：节流刷新快照 + 匹配索引 ——
  useEffect(() => {
    if (!searchOpen) return;
    setFindSnapshot(entriesRef.current);
    const t = setInterval(
      () => setFindSnapshot(entriesRef.current),
      FIND_REFRESH_MS,
    );
    return () => clearInterval(t);
  }, [searchOpen]);

  const findIndex = useMemo(
    () =>
      searchOpen
        ? buildFindIndex(findSnapshot, query, caseSensitive, useRegex)
        : EMPTY_INDEX,
    [searchOpen, findSnapshot, query, caseSensitive, useRegex],
  );

  const closeFind = () => {
    onFindStateChange({
      open: false,
      query: "",
      currentMatch: 0,
      caseSensitive: false,
      useRegex: false,
    });
  };

  useEffect(() => {
    if (searchOpen) findInputRef.current?.focus();
  }, [searchOpen, tabId]);

  // 全局快捷键：Ctrl/Cmd+F 打开查找，Esc 关闭。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        updateFind({ open: true });
        return;
      }
      if (e.key === "Escape" && !inField && searchOpen) {
        e.preventDefault();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, tabId]);

  // 查询/选项变化时重置到第一个匹配并跳过去。
  const queryKeysRef = useRef(new Map<string, string>());
  useEffect(() => {
    const key = `${query}\u0000${caseSensitive}\u0000${useRegex}`;
    if (!searchOpen || queryKeysRef.current.get(tabId) === key) return;
    queryKeysRef.current.set(tabId, key);
    updateFind({ currentMatch: 0 });
    if (findIndex.total > 0) scrollToOccurrence(0, findIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, query, caseSensitive, useRegex, findIndex, tabId]);

  const scrollToOccurrence = (occ: number, idx: FindIndex = findIndex) => {
    if (occ < 0 || occ >= idx.total) return;
    const row = rowOfOccurrence(idx, occ);
    if (!row) return;
    // 快照可能略旧：优先用 id 定位到当前列表里的真实行。
    const liveIdx = entries.findIndex((e) => e.id === row.id);
    const target =
      liveIdx >= 0 ? liveIdx : Math.min(row.rowIndex, entries.length - 1);
    updateFollowLatest(false);
    virtualizer.scrollToIndex(target, { align: "center" });
  };

  const goNext = () => {
    if (!searchOpen || findIndex.total === 0) return;
    const next = Math.min(currentMatch + 1, findIndex.total - 1);
    updateFind({ currentMatch: next });
    scrollToOccurrence(next);
  };

  const goPrev = () => {
    if (!searchOpen || findIndex.total === 0) return;
    const next = Math.max(currentMatch - 1, 0);
    updateFind({ currentMatch: next });
    scrollToOccurrence(next);
  };

  return (
    <div className="log-pane">
      <div
        className="log-list"
        ref={parentRef}
        onScroll={onScroll}
        onWheel={markUserScrolling}
        onPointerDown={markUserScrolling}
        onPointerUp={finishUserScrolling}
        onPointerCancel={finishUserScrolling}
        onTouchStart={markUserScrolling}
        onTouchEnd={finishUserScrolling}
      >
        {/* 固定表头：sticky 于滚动容器内，与数据行同宽，天然对齐；列宽可拖拽调整 */}
        <div className="log-head-wrap">
          <div className="log-head">
            <span className="log-expand" />
            {COL_HEADERS.map(({ key, label, tip }) => (
              <span
                key={key}
                className="log-head-cell"
                style={{ width: colWidths[key] }}
                title={tip}
              >
                <span className="log-head-label">{label}</span>
                <span
                  className="col-resizer"
                  title={`拖动调整「${label}」列宽（双击重置）`}
                  onMouseDown={startColResize(key)}
                  onDoubleClick={resetColWidth(key)}
                />
              </span>
            ))}
            <span className="log-msg log-head-cell" title="日志内容">
              内容
            </span>
          </div>
        </div>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const entry = entries[vi.index];
            const color = LEVEL_COLORS[entry.level] ?? "#9e9e9e";
            const selected = entry.id === selectedId;
            // 只有「单行超长」才折叠；多行（如合并后的堆栈）直接完整显示
            const isLong =
              !entry.message.includes("\n") &&
              entry.message.length > LONG_THRESHOLD;
            const isExpanded = expandedId === entry.id;
            const clamped = isLong && !isExpanded;
            const rowInfo = findIndex.byId.get(entry.id);
            return (
              <div
                key={entry.id}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                className={selected ? "log-row selected" : "log-row"}
                onClick={() => {
                  updateFollowLatest(false);
                  onSelect(entry.id);
                }}
                onDoubleClick={() => {
                  if (isLong) toggleExpand(entry.id);
                }}
                title={
                  isLong
                    ? isExpanded
                      ? "双击收起"
                      : `双击展开完整日志（${entry.raw.length} 字符）`
                    : undefined
                }
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <span className="log-expand">
                  {isLong && (
                    <button
                      className="log-expand-btn"
                      title={isExpanded ? "收起" : "展开完整日志"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(entry.id);
                      }}
                    >
                      {isExpanded ? "▾" : "▸"}
                    </button>
                  )}
                </span>
                <span className="log-time" style={{ width: colWidths.time }}>
                  {entry.date} {entry.time}
                </span>
                <span className="log-pid" style={{ width: colWidths.pid }}>
                  {entry.pid}
                </span>
                <span className="log-tid" style={{ width: colWidths.tid }}>
                  {entry.tid}
                </span>
                <span
                  className="log-level"
                  style={{ color, width: colWidths.level }}
                >
                  {entry.level}
                </span>
                <span className="log-tag" style={{ color, width: colWidths.tag }}>
                  {rowInfo
                    ? highlightText(
                        entry.tag,
                        query,
                        caseSensitive,
                        useRegex,
                        rowInfo,
                        currentMatch,
                        true,
                      )
                    : entry.tag}
                </span>
                <span
                  className={clamped ? "log-msg clamped" : "log-msg"}
                  title={
                    clamped
                      ? `双击展开完整日志（${entry.raw.length} 字符）`
                      : undefined
                  }
                >
                  {rowInfo
                    ? highlightText(
                        entry.message,
                        query,
                        caseSensitive,
                        useRegex,
                        rowInfo,
                        currentMatch,
                        false,
                      )
                    : entry.message}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {searchOpen && (
        <div className="find-bar">
          <input
            ref={findInputRef}
            value={query}
            onChange={(e) => updateFind({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) goPrev();
                else goNext();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                goPrev();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                goNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
            placeholder="查找"
          />
          <span className="find-count">
            {!findIndex.valid
              ? "无效正则"
              : findIndex.total > 0
                ? `${Math.min(currentMatch + 1, findIndex.total)} / ${findIndex.total}`
                : "无匹配"}
          </span>
          <button
            className="find-btn"
            onClick={goPrev}
            title="上一个匹配（Shift+Enter / ↑）"
          >
            ▲
          </button>
          <button
            className="find-btn"
            onClick={goNext}
            title="下一个匹配（Enter / ↓）"
          >
            ▼
          </button>
          <button
            className={`find-btn ${caseSensitive ? "on" : ""}`}
            onClick={() => updateFind({ caseSensitive: !caseSensitive })}
            title="区分大小写"
          >
            Aa
          </button>
          <button
            className={`find-btn ${useRegex ? "on" : ""}`}
            onClick={() => updateFind({ useRegex: !useRegex })}
            title="正则表达式"
          >
            .*
          </button>
          <button className="find-btn" onClick={closeFind} title="关闭（Esc）">
            ×
          </button>
        </div>
      )}
      {!followLatest && entries.length > 0 && (
        <button
          className="back-latest"
          onClick={backToLatest}
          title="回到最新日志"
        >
          <span className="back-arrow">↓</span> 回到最新日志
        </button>
      )}
    </div>
  );
}
