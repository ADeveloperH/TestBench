import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  /** 菜单通过 Portal 渲染到 body 时附加的样式类，用于弹框等独立层级。 */
  menuClassName?: string;
}

/** 选项的纯文本表示（搜索匹配用）。 */
function textOf(o: SelectOption): string {
  if (typeof o.label === "string") return o.label;
  return o.fullLabel ?? "";
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
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
  menuClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!open) return;
    setFilter(""); // 每次打开清空搜索
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
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

  // 菜单渲染到 body，避免被工具栏的滚动区域裁切；同时随窗口和容器滚动更新位置。
  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;

      const width = Math.min(
        searchable ? 560 : 400,
        Math.max(rect.width, searchable ? 420 : rect.width),
      );
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(320, Math.max(120, openAbove ? spaceAbove - 4 : spaceBelow));
      const top = openAbove
        ? Math.max(8, rect.top - maxHeight - 4)
        : rect.bottom + 4;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8),
      );

      setMenuPosition({ top, left, width, maxHeight });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, searchable]);

  const current = options.find((o) => o.value === value);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? options.filter((o) => textOf(o).toLowerCase().includes(needle))
    : options;

  const menu = open && (
    <div
      ref={menuRef}
      className={`select-menu select-menu-floating${menuClassName ? ` ${menuClassName}` : ""}`}
      style={
        menuPosition
          ? {
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width,
              maxWidth: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
            }
          : undefined
      }
    >
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
  );

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
        <span className="select-arrow" aria-hidden="true" />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}
