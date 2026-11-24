import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Select } from "../../components/Select";

/** 一个入口保留两个独立条件，不把 Apple 级别强制映射为 Unity 级别。 */
export function IosLevelFilter({ level, semantic, levels, onChange }: {
  level: string; semantic: string; levels: string[];
  onChange: (patch: { level?: string; semantic?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      setPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 250)) });
    };
    const outside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target) && !target.closest('.ios-level-options')) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    place(); panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const summary = [level ? `原始 ${level}` : '', semantic ? `Unity ${semantic === 'unknown' ? '未知' : semantic}` : ''].filter(Boolean).join(' + ') || '全部级别';
  return <>
    <button ref={trigger} type="button" className="ios-level-trigger" title={summary} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>{summary}<span aria-hidden="true"> ▾</span></button>
    {open && createPortal(<div ref={panel} className="ios-level-panel" role="dialog" aria-label="iOS 级别筛选" style={{ position: 'fixed', ...position }}>
      <label>Apple 原始级别<Select title="Apple 原始级别（精确匹配）" value={level} onChange={(level) => onChange({ level })} menuClassName="ios-level-options" options={[{ value: '', label: '全部原始级别' }, ...levels.map((value) => ({ value, label: value }))]} /></label>
      <label>Unity 推断级别<Select title="Unity 推断级别" value={semantic} onChange={(semantic) => onChange({ semantic })} menuClassName="ios-level-options" options={[{ value: '', label: '全部推断级别' }, ...['info', 'warning', 'error', 'exception', 'unknown'].map((value) => ({ value, label: value === 'unknown' ? '未知（无推断证据）' : value }))]} /></label>
      <p>两组条件同时生效。notice 不等于 Unity Info；推断可能未知。</p>
      <div className="ios-level-actions"><button type="button" onClick={() => onChange({ level: '', semantic: '' })}>重置级别</button><button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>完成</button></div>
    </div>, document.body)}
  </>;
}
