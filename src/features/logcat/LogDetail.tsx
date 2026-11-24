import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export function clampDetailHeight(height: number, area: number): number {
  return Math.min(600, Math.max(80, Math.floor(area * 0.5)), Math.max(80, height));
}
export function LogDetail({ raw, platform, onClose, actions, metadata, onCopyResult, restoredMessage }: {
  raw: string; platform: "android" | "ios"; onClose: () => void; actions?: ReactNode; metadata?: ReactNode; onCopyResult?: (error: unknown | null) => void;
  restoredMessage?: string;
}) {
  const storageKey = platform === "android" ? "log-detail-height-v1" : "ios-log-detail-height-v1";
  const [height, setHeight] = useState(() => {
    try { const saved = Number(localStorage.getItem(storageKey)); return saved >= 80 && saved <= 600 ? saved : 220; } catch { return 220; }
  });
  const [copyStatus, setCopyStatus] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => setCopyStatus(""), [raw]);
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const clamp = () => setHeight((value) => clampDetailHeight(value, parent.clientHeight));
    clamp();
    const observer = new ResizeObserver(clamp); observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const resize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    event.preventDefault();
    dragCleanup.current?.();
    const startY = event.clientY; const startHeight = height; let finalHeight = height;
    const move = (next: MouseEvent) => {
      finalHeight = clampDetailHeight(startHeight + startY - next.clientY, root.current?.parentElement?.clientHeight ?? 0);
      setHeight(finalHeight);
    };
    const cleanup = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.body.classList.remove("detail-resizing"); dragCleanup.current = null;
    };
    const up = () => { cleanup(); try { localStorage.setItem(storageKey, String(finalHeight)); } catch { /* 忽略不可写缓存。 */ } };
    dragCleanup.current = cleanup;
    document.body.classList.add("detail-resizing");
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  };
  const copy = async () => {
    try { await writeText(raw); setCopyStatus("复制成功"); onCopyResult?.(null); }
    catch (error) { setCopyStatus(`复制失败：${String(error)}`); onCopyResult?.(error); }
  };
  return <div className="log-detail" style={{ height }} ref={root}>
    <div className="log-detail-resizer" title="拖动调整详情高度" onMouseDown={resize} role="separator" tabIndex={0} aria-label="调整详情高度" aria-orientation="horizontal" aria-valuenow={height}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const next = clampDetailHeight(height + (event.key === "ArrowUp" ? 10 : -10), root.current?.parentElement?.clientHeight ?? 0);
        setHeight(next); try { localStorage.setItem(storageKey, String(next)); } catch { /* 忽略不可写缓存。 */ }
      }} />
    <div className="log-detail-head"><span className="log-detail-title">日志详情</span>{actions}
      <button onClick={() => void copy()}>{restoredMessage ? "复制原文" : "复制"}</button><button onClick={onClose}>关闭</button>
    </div>
    {metadata && <div className="log-detail-meta">{metadata}</div>}
    {copyStatus && <div className="log-detail-meta" role="status">{copyStatus}</div>}
    <pre className="log-detail-body">{restoredMessage != null ? <>编码还原正文（原文保留）{"\n"}{restoredMessage}{"\n\n—— 日志原文 ——\n"}{raw}</> : raw}</pre>
  </div>;
}
