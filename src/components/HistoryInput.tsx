import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Favorite } from "../features/settings/usePrefs";
import { Tip } from "./Tip";

interface Props {
  value: string;
  onChange: (v: string) => void;
  favorites: Favorite[];
  history: string[];
  onAddHistory: (v: string) => void;
  onPin: (v: string, description: string) => void;
  onUnpin: (v: string) => void;
  onRemoveHistory: (v: string) => void;
  placeholder?: string;
  /** 内置常用的 value 集合：内置项不可取消常用。 */
  protectedValues?: Set<string>;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/** 受控的「历史 + 常用」输入框，数据由外部（usePrefs）提供。 */
export function HistoryInput({
  value,
  onChange,
  favorites,
  history,
  onAddHistory,
  onPin,
  onUnpin,
  onRemoveHistory,
  placeholder,
  protectedValues,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<string | null>(null);
  const [pinDescription, setPinDescription] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] =
    useState<DropdownPosition | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 置于 body 的浮层不受筛选工具栏滚动区域裁切。
  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;

      const width = Math.min(360, Math.max(220, rect.width));
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(300, Math.max(120, openAbove ? spaceAbove - 4 : spaceBelow));
      const top = openAbove
        ? Math.max(8, rect.top - maxHeight - 4)
        : rect.bottom + 4;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8),
      );

      setDropdownPosition({ top, left, width, maxHeight });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const select = (v: string) => {
    onChange(v);
    onAddHistory(v);
    setOpen(false);
  };

  const openPinDialog = (v: string) => {
    setPinTarget(v);
    setPinDescription("");
  };

  const savePin = () => {
    if (!pinTarget) return;
    onPin(pinTarget, pinDescription.trim());
    setPinTarget(null);
  };

  const showDropdown = open && (favorites.length > 0 || history.length > 0);

  const dropdown = showDropdown && dropdownPosition && (
    <div
      ref={dropdownRef}
      className="history-dropdown history-dropdown-floating"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
        maxHeight: dropdownPosition.maxHeight,
      }}
    >
      {favorites.length > 0 && (
        <>
          <div className="history-title">常用</div>
          {favorites.map((f) => {
            const builtin = protectedValues?.has(f.value);
            return (
              <div key={f.value} className="history-item">
                <Tip
                  className="history-text"
                  text={f.description || undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(f.value);
                  }}
                >
                  {f.value}
                </Tip>
                <button
                  className="history-btn"
                  title={builtin ? "内置常用，不可取消" : "取消常用"}
                  disabled={builtin}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onUnpin(f.value);
                  }}
                >
                  ★
                </button>
              </div>
            );
          })}
        </>
      )}
      {history.length > 0 && (
        <>
          <div className="history-title">历史</div>
          {history.map((h) => (
            <div key={h} className="history-item">
              <span
                className="history-text"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(h);
                }}
              >
                {h}
              </span>
              <button
                className="history-btn"
                title="设为常用"
                onMouseDown={(e) => {
                  e.preventDefault();
                  openPinDialog(h);
                }}
              >
                ☆
              </button>
              <button
                className="history-btn danger"
                title="删除"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onRemoveHistory(h);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );

  return (
    <div className="history-input" ref={rootRef}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => onAddHistory(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAddHistory(value);
        }}
      />
      {dropdown && createPortal(dropdown, document.body)}
      {pinTarget &&
        createPortal(
          <div
            className="save-description-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setPinTarget(null);
            }}
          >
            <div className="save-description-dialog" role="dialog" aria-modal="true" aria-label="设为常用">
              <h3>设为常用</h3>
              <p>{pinTarget}</p>
              <input
                value={pinDescription}
                autoFocus
                placeholder="描述（可选，用于提示说明）"
                onChange={(e) => setPinDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePin();
                  if (e.key === "Escape") setPinTarget(null);
                }}
              />
              <div className="save-description-actions">
                <button onClick={() => setPinTarget(null)}>取消</button>
                <button className="primary-action" onClick={savePin}>保存</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
