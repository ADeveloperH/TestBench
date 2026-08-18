import { useEffect, useRef, useState, type ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** 完整文本（悬停提示 / 截断兜底用） */
  fullLabel?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  title?: string;
  className?: string;
}

/**
 * 自绘下拉选择：替代原生 <select>。
 * 原生 select 的弹出菜单在 Tauri/WKWebView（macOS）中定位错误
 * （见 tauri-apps/tauri#1911），自绘菜单位置完全可控。
 */
export function Select({ value, options, onChange, title, className }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
          {options.map((o) => {
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
