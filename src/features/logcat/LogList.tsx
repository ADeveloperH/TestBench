import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LogEntry, LogLevel, ScrollCommand } from "../../core/types";

const ROW_HEIGHT = 20;
const LONG_THRESHOLD = 1200;

const LEVEL_COLORS: Record<LogLevel, string> = {
  V: "#9e9e9e",
  D: "#56a8f5",
  I: "#4fc877",
  W: "#f5a623",
  E: "#f5576c",
  F: "#b084f7",
  A: "#b084f7",
};

interface Props {
  entries: LogEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  scrollCommand: ScrollCommand | null;
}

export function LogList({ entries, selectedId, onSelect, scrollCommand }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 30,
  });

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    autoScrollRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = parentRef.current;
    if (autoScrollRef.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  // 收到滚动指令时执行：定位到指定日志 / 跳到最早、最新、指定行号。
  useEffect(() => {
    if (!scrollCommand || entries.length === 0) return;
    const { kind } = scrollCommand;
    if (kind === "top") {
      virtualizer.scrollToIndex(0, { align: "start" });
    } else if (kind === "bottom") {
      virtualizer.scrollToIndex(entries.length - 1, { align: "end" });
    } else if (kind === "index" && scrollCommand.index != null) {
      const idx = Math.min(Math.max(scrollCommand.index, 0), entries.length - 1);
      virtualizer.scrollToIndex(idx, { align: "center" });
    } else if (kind === "id" && scrollCommand.id != null) {
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

  return (
    <div className="log-list" ref={parentRef} onScroll={onScroll}>
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
          const isLong = entry.raw.length > LONG_THRESHOLD;
          const isExpanded = expandedId === entry.id;
          const clamped = isLong && !isExpanded;
          return (
            <div
              key={entry.id}
              ref={virtualizer.measureElement}
              data-index={vi.index}
              className={selected ? "log-row selected" : "log-row"}
              onClick={() => onSelect(entry.id)}
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
              <span className="log-time">
                {entry.date} {entry.time}
              </span>
              <span className="log-pid">{entry.pid}</span>
              <span className="log-tid">{entry.tid}</span>
              <span className="log-level" style={{ color }}>
                {entry.level}
              </span>
              <span className="log-tag" style={{ color }}>
                {entry.tag}
              </span>
              <span
                className={clamped ? "log-msg clamped" : "log-msg"}
                title={
                  clamped
                    ? `双击展开完整日志（${entry.raw.length} 字符）`
                    : undefined
                }
              >
                {entry.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
