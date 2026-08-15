import { useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  text?: string;
  className?: string;
  children: React.ReactNode;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
}

/** 即时显示的悬浮提示（替代原生 title，避免出现延迟）。 */
export function Tip({ text, className, children, onMouseDown }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(
    null,
  );

  return (
    <>
      <span
        className={className}
        onMouseDown={onMouseDown}
        onMouseEnter={(e) => {
          if (!text) return;
          const r = e.currentTarget.getBoundingClientRect();
          const above = r.bottom + 80 > window.innerHeight;
          setPos({ x: r.left, y: above ? r.top - 4 : r.bottom + 4, above });
        }}
        onMouseLeave={() => setPos(null)}
      >
        {children}
      </span>
      {pos &&
        text &&
        createPortal(
          <div
            className="tip-box"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: pos.above ? "translateY(-100%)" : undefined,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
