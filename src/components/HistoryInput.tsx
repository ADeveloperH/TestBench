import { useEffect, useRef, useState } from "react";
import type { Favorite } from "../features/settings/usePrefs";
import { Tip } from "./Tip";

interface Props {
  value: string;
  onChange: (v: string) => void;
  favorites: Favorite[];
  history: string[];
  onAddHistory: (v: string) => void;
  onPin: (v: string) => void;
  onUnpin: (v: string) => void;
  onRemoveHistory: (v: string) => void;
  placeholder?: string;
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
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const select = (v: string) => {
    onChange(v);
    onAddHistory(v);
    setOpen(false);
  };

  const showDropdown = open && (favorites.length > 0 || history.length > 0);

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
      {showDropdown && (
        <div className="history-dropdown">
          {favorites.length > 0 && (
            <>
              <div className="history-title">常用</div>
              {favorites.map((f) => (
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
                    title="取消常用"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onUnpin(f.value);
                    }}
                  >
                    ★
                  </button>
                </div>
              ))}
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
                      onPin(h);
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
      )}
    </div>
  );
}
