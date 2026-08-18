import { useEffect, useRef, useState, type ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** 完整文本（悬停提示 / 截断兜底 / 搜索匹配用） */
  fullLabel?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  title?: string;
  className?: string;
  /** 是否在菜单顶部显示搜索框（按 fullLabel/label 文本过滤） */
  searchable?: boolean;
  /** 搜索框占位提示 */
  searchPlaceholder?: string;
}

/** 选项的纯文本表示（搜索匹配用）。 */
function textOf(o: SelectOption): string {
  if (typeof o.label === "string") return o.label;
  return o.fullLabel ?? "";
}

/**
 * 自绘下拉选择：替代原生 <select>。
 * 原生 select 的弹出菜单在 Tauri/WKWebView（macOS）中定位错误
 * （见 tauri-apps/tauri#1911），自绘菜单位置完全可控。
 */
export function Select({
  value,
  options,
  onChange,
  title,
  className,
  searchable = false,
  searchPlaceholder = "搜索…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFilter(""); // 每次打开清空搜索
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? options.filter((o) => textOf(o).toLowerCase().includes(needle))
    : options;

  return (
    <div
      className={className ? `select-wrap ${className}` : "select-wrap"}
      ref={rootRef}
    >
      <button
        type="button"
        className={`select-trigger ${open ? "open" : ""}`}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="select-label">
          {current ? current.label : value || "—"}
        </span>
        <span className="select-arrow">▾</span>
      </button>
      {open && (
        <div className="select-menu">
          {searchable && (
            <input
              className="select-search"
              placeholder={searchPlaceholder}
              value={filter}
              autoFocus
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && visible.length > 0) {
                  // 回车选择第一个匹配项
                  e.preventDefault();
                  onChange(visible[0].value);
                  setOpen(false);
                }
              }}
            />
          )}
          {visible.length === 0 && (
            <div className="select-no-match">无匹配项</div>
          )}
          {visible.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                className={`select-option ${selected ? "selected" : ""}`}
                title={
                  o.fullLabel ??
                  (typeof o.label === "string" ? o.label : undefined)
                }
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="select-check">{selected ? "✓" : ""}</span>
                <span className="select-option-label">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
