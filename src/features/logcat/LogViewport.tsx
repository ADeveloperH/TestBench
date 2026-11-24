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
import { logViewCell, logLevelColor, semanticLevelColor, type LogViewRecord, type LogViewColumn, type LogColumnId, type LogFindState, type LogViewportScrollCommand } from "../../core/logView";
import { buildFindIndex, liveOccurrenceIndex, findTextRanges, EMPTY_FIND_INDEX as EMPTY_INDEX, type FindIndex } from "./logFind";
import { loadLogColumnWidths, saveLogColumnWidths, logColumnSize } from "./logColumnWidths";
import { measureLogRows } from "./logRowMeasurement";
import { canHandleLogShortcut } from "./logShortcuts";

const ROW_HEIGHT = 20;
const LONG_THRESHOLD = 1200;
// 跟随暂停的迟滞区间：距底部 < 48px 恢复跟随，> 160px 才判定为「滚离底部」暂停跟随，
// 中间地带保持原状态，轻微滑动不会误触发暂停。
const RESUME_DISTANCE = 48;
const PAUSE_DISTANCE = 160;
// Ctrl+F 查找索引的刷新周期：日志持续涌入时，匹配统计按此周期重算（避免每 80ms 全量扫描）。
const FIND_REFRESH_MS = 400;

function highlightText(text: string, query: string, caseSensitive: boolean, useRegex: boolean, start: number, currentOccurrence: number): ReactNode {
  const ranges = findTextRanges(text, query, caseSensitive, useRegex) ?? [];
  const out: ReactNode[] = []; let last = 0;
  ranges.forEach((range, index) => {
    if (range.from > last) out.push(text.slice(last, range.from));
    out.push(<mark key={index} className={start + index === currentOccurrence ? "find-hit current" : "find-hit"} data-find-occurrence={start + index}>{text.slice(range.from, range.to)}</mark>);
    last = range.to;
  });
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Props {
  platform: "android" | "ios";
  columns: readonly LogViewColumn[];
  emptyMessage?: string;
  entries: LogViewRecord<unknown>[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClearSelection: () => void;
  scrollCommand: LogViewportScrollCommand | null;
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
export function LogViewport({
  platform,
  columns,
  emptyMessage,
  entries,
  selectedKey,
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
  const findScope = `${tabId}\u0000${layoutKey}`;
  const [findSnapshot, setFindSnapshot] = useState<{ rows: LogViewRecord<unknown>[]; scope: string }>({ rows: [], scope: "" });
  const findInputRef = useRef<HTMLInputElement>(null);
  const findScrollFrameRef = useRef<number | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(
    () => () => {
      if (findScrollFrameRef.current != null) {
        cancelAnimationFrame(findScrollFrameRef.current);
      }
    },
    [],
  );

  // —— 表头列宽（拖拽调整） ——
  const [colWidths, setColWidths] = useState(() => loadLogColumnWidths(platform));
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const colDragRef = useRef<{
    col: LogColumnId;
    startX: number;
    startW: number;
  } | null>(null);

  const startColResize = (col: LogColumnId) => (e: ReactMouseEvent<HTMLSpanElement>) => {
    e.currentTarget.focus();
    e.preventDefault();
    e.stopPropagation();
    resizeCleanup.current?.();
    colDragRef.current = { col, startX: e.clientX, startW: colWidths[col] };
    const onMove = (ev: MouseEvent) => {
      if (!colDragRef.current) return;
      const w = Math.min(
        logColumnSize(col, platform)[2],
        Math.max(
          logColumnSize(col, platform)[1],
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
      resizeCleanup.current = null;
      saveLogColumnWidths(platform, colWidthsRef.current);
    };
    resizeCleanup.current = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
      resizeCleanup.current = null;
    };
    document.body.classList.add("col-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const resetColWidth = (col: LogColumnId) => () => {
    setColWidths((prev) => ({ ...prev, [col]: logColumnSize(col, platform)[0] }));
  };

  useEffect(() => { saveLogColumnWidths(platform, colWidths); }, [platform, colWidths]);
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanup.current?.(), []);
  const dataColumns = columns.filter((column) => column.id !== "message");
  const findFields = useMemo(() => ["message" as const, ...columns.filter((column) => ["tag", "process", "module"].includes(column.id)).map((column) => column.id)], [columns]);
  const minimumWidth = 22 + 200 + dataColumns.reduce((total, column) => total + colWidths[column.id], 0);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    // 筛选后同一 index 会对应不同日志。使用日志 ID 作为测量缓存键，
    // 避免旧日志的行高套用到新结果上造成行重叠。
    getItemKey: (index) => entries[index]?.key ?? index,
    estimateSize: () => ROW_HEIGHT,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 30,
  });

  // Tag/搜索/过滤器或日志 Tab 改变后，主动重新测量可见行。
  // ResizeObserver 在 WebView 中偶尔会晚一帧，下一帧再测一次可避免
  // 必须调整窗口尺寸后才恢复的日志重叠问题。
  useLayoutEffect(() => {
    setExpandedId(null);
    virtualizer.measure();
    const measureRenderedRows = () => measureLogRows(parentRef.current, virtualizer);
    measureRenderedRows();
    const frame = requestAnimationFrame(measureRenderedRows);
    return () => cancelAnimationFrame(frame);
    // virtualizer 实例会随渲染变化，只以明确的布局 key 作为重测条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  useLayoutEffect(() => {
    virtualizer.measure();
    measureLogRows(parentRef.current, virtualizer);
  }, [colWidths]);

  // 实时跟随时 virtualizer 的 ref 测量可能因 isScrolling 跳过；
  // RO 对尺寸未变的已挂载行也不会重发通知。每次提交用真实高度补齐，
  // 避免缓存清空后或滚动中新挂载的多行记录一直使用 20px 估值。
  useLayoutEffect(() => { measureLogRows(parentRef.current, virtualizer); });

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      virtualizer.measure();
      measureLogRows(el, virtualizer);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    } else if (kind === "key" && scrollCommand.key != null) {
      updateFollowLatest(false);
      const idx = entries.findIndex((e) => e.key === scrollCommand.key);
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: "center" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollCommand]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // —— 查找：节流刷新快照 + 匹配索引 ——
  useEffect(() => {
    if (!searchOpen) return;
    const refresh = () => setFindSnapshot({ rows: entriesRef.current, scope: findScope });
    refresh();
    const t = setInterval(
      refresh,
      FIND_REFRESH_MS,
    );
    return () => clearInterval(t);
  }, [searchOpen, findScope]);

  const findIndex = useMemo(
    () =>
      searchOpen && findSnapshot.scope === findScope
        ? buildFindIndex(findSnapshot.rows, query, caseSensitive, useRegex, findFields)
        : EMPTY_INDEX,
    [searchOpen, findSnapshot, findScope, query, caseSensitive, useRegex, findFields],
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
      if (!canHandleLogShortcut(e, { allowTarget: findInputRef.current, allowButton: true })) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        updateFind({ open: true });
        return;
      }
      if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, tabId, findState]);

  // 查询/选项变化时重置到第一个匹配并跳过去。
  const queryKeysRef = useRef(new Map<string, string>());
  useEffect(() => {
    const maximum = Math.max(0, findIndex.total - 1);
    if (searchOpen && findSnapshot.scope === findScope && currentMatch > maximum) updateFind({ currentMatch: maximum });
  }, [findIndex.total, searchOpen, currentMatch, findSnapshot.scope, findScope]);
  useEffect(() => {
    const key = `${query}\u0000${caseSensitive}\u0000${useRegex}`;
    if (!searchOpen || findSnapshot.scope !== findScope || queryKeysRef.current.get(tabId) === key) return;
    if (findIndex.total > 0 && liveOccurrenceIndex(entries, findIndex, 0) < 0) return;
    queryKeysRef.current.set(tabId, key);
    updateFind({ currentMatch: 0 });
    if (findIndex.total > 0) scrollToOccurrence(0, findIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, query, caseSensitive, useRegex, findIndex, tabId, findSnapshot.scope, findScope]);

  const scrollToOccurrence = (occ: number, idx: FindIndex = findIndex) => {
    if (occ < 0 || occ >= idx.total) return;
    // 快照可能略旧：优先用 id 定位到当前列表里的真实行。
    const liveIdx = liveOccurrenceIndex(entries, idx, occ);
    if (liveIdx < 0) return; // 旧查找快照已被展示窗口淘汰，不按旧下标跳到另一条。
    const target = liveIdx;
    const entry = entries[target];
    const messageHit = idx.byId.get(entry.key)?.fields.message;
    if (messageHit && occ >= messageHit.start && occ < messageHit.start + messageHit.count
      && !entry.message.includes("\n") && entry.message.length > LONG_THRESHOLD) setExpandedId(entry.key);
    updateFollowLatest(false);
    virtualizer.scrollToIndex(target, { align: "center" });

    // 虚拟列表首次只能按估算行高定位。合并日志可能包含很长的正文和调用栈，
    // 因此目标行渲染并完成测量后，再把这一行内的具体命中滚到视口中央。
    if (findScrollFrameRef.current != null) {
      cancelAnimationFrame(findScrollFrameRef.current);
    }
    let attempts = 0;
    const locateExactHit = () => {
      findScrollFrameRef.current = requestAnimationFrame(() => {
        const hit = parentRef.current?.querySelector<HTMLElement>(
          `[data-find-occurrence="${occ}"]`,
        );
        if (hit) {
          hit.scrollIntoView({ block: "center", inline: "nearest" });
          const el = parentRef.current;
          if (el) {
            lastScrollTopRef.current = el.scrollTop;
            tabScrollOffsetsRef.current.set(
              displayedTabIdRef.current,
              el.scrollTop,
            );
          }
          findScrollFrameRef.current = null;
          return;
        }

        // 动态行高修正后目标行可能暂时移出渲染窗口，重新按实测高度定位。
        attempts += 1;
        if (attempts < 4) {
          virtualizer.scrollToIndex(target, { align: "center" });
          locateExactHit();
        } else {
          findScrollFrameRef.current = null;
        }
      });
    };
    locateExactHit();
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
    <div className="log-pane" data-log-platform={platform}>
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
        <div className="log-head-wrap" style={{ minWidth: minimumWidth }}>
          <div className="log-head" style={{ width: "100%" }}>
            <span className="log-expand" />
            {dataColumns.map(({ id: key, label }) => (
              <span
                key={key}
                className="log-head-cell"
                style={{ width: colWidths[key] }}
                title={label}
              >
                <span className="log-head-label">{label}</span>
                <span
                  className="col-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-label={`调整「${label}」列宽`}
                  aria-orientation="vertical"
                  aria-valuenow={colWidths[key]}
                  aria-valuemin={logColumnSize(key, platform)[1]}
                  aria-valuemax={logColumnSize(key, platform)[2]}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const [, min, max] = logColumnSize(key, platform);
                    setColWidths((current) => ({ ...current, [key]: Math.min(max, Math.max(min, current[key] + (event.key === "ArrowRight" ? 10 : -10))) }));
                  }}
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
        {entries.length === 0 && emptyMessage && <div className="log-empty">{emptyMessage}</div>}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            minWidth: minimumWidth,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const entry = entries[vi.index];
            const color = logLevelColor(platform, entry.rawLevel);
            const selected = entry.key === selectedKey;
            // 只有「单行超长」才折叠；多行（如合并后的堆栈）直接完整显示
            const isLong =
              !entry.message.includes("\n") &&
              entry.message.length > LONG_THRESHOLD;
            const isExpanded = expandedId === entry.key;
            const clamped = isLong && !isExpanded;
            const rowInfo = findIndex.byId.get(entry.key);
            return (
              <div
                key={entry.key}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                className={selected ? "log-row selected" : "log-row"}
                onClick={() => {
                  updateFollowLatest(false);
                  onSelect(entry.key);
                }}
                onDoubleClick={() => {
                  if (isLong) toggleExpand(entry.key);
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
                        toggleExpand(entry.key);
                      }}
                    >
                      {isExpanded ? "▾" : "▸"}
                    </button>
                  )}
                </span>
                {dataColumns.map((column) => {
                  const text = logViewCell(entry, column.id);
                  const match = rowInfo?.fields[column.id];
                  const fieldColor = column.id === "semanticLevel" ? semanticLevelColor(entry.semanticLevel) : ["level", "tag"].includes(column.id) ? color : undefined;
                  return <span key={column.id} className={`log-${column.id === "timestamp" ? "time" : column.id}`} style={{ width: colWidths[column.id], color: fieldColor }} title={text}>
                    {match && match.count ? highlightText(text, query, caseSensitive, useRegex, match.start, currentMatch) : text}
                  </span>;
                })}
                <span
                  className={clamped ? "log-msg clamped" : "log-msg"}
                  title={
                    clamped
                      ? `双击展开完整日志（${entry.raw.length} 字符）`
                      : undefined
                  }
                >
                  {entry.encodingRecovered ? <span className="log-record-flag">[编码还原] </span> : entry.encodingStatus !== "valid" && <span className="log-record-flag">[疑似乱码] </span>}
                  {entry.truncated && <span className="log-record-flag">[截断] </span>}
                  {rowInfo?.fields.message?.count
                    ? highlightText(entry.message, query, caseSensitive, useRegex, rowInfo.fields.message.start, currentMatch)
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
