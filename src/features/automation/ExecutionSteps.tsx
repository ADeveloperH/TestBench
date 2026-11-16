import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { Step } from "./model";

interface View { follow: boolean; top: number }
// Transient per-run view state, independent of saved execution parameters.
const views = new Map<string, View>();

export function ExecutionSteps({ steps, sessionKey }: { steps: Step[]; sessionKey: string }) {
  const list = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const lastTop = useRef(0);
  const gesture = useRef(false);
  const pointerDown = useRef(false);
  const resetting = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remember = () => {
    views.delete(sessionKey);
    views.set(sessionKey, { follow: follow.current, top: list.current?.scrollTop ?? 0 });
    if (views.size > 64) { const oldest = views.keys().next().value; if (oldest) views.delete(oldest); }
  };
  const setFollow = (value: boolean) => { follow.current = value; setFollowing(value); remember(); };
  const toLatest = () => {
    const el = list.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    lastTop.current = el.scrollTop;
    remember();
  };
  const markGesture = () => {
    resetting.current = false;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    gesture.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      gesture.current = false;
      if (follow.current && !pointerDown.current) toLatest();
    }, 220);
  };
  useLayoutEffect(() => {
    const saved = views.get(sessionKey);
    follow.current = saved?.follow ?? true;
    setFollowing(follow.current);
    gesture.current = false; pointerDown.current = false;
    resetting.current = follow.current;
    if (timer.current) clearTimeout(timer.current);
    if (list.current) {
      if (follow.current) toLatest();
      else { list.current.scrollTop = saved?.top ?? 0; lastTop.current = list.current.scrollTop; }
    }
    // A previous task's kinetic/keyboard scrolling can outlive its final event.
    // Ignore that tail; a fresh user gesture cancels this guard immediately.
    const settle = setTimeout(() => { resetting.current = false; if (follow.current) toLatest(); }, 220);
    resetTimer.current = settle;
    return () => clearTimeout(settle);
    // Only a new task or remount restores the saved view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  useLayoutEffect(() => {
    if (follow.current && !gesture.current && !pointerDown.current) toLatest();
    else if (list.current) lastTop.current = list.current.scrollTop;
    // Includes updates with a fixed 300-step window and changed row heights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, following, sessionKey]);
  useEffect(() => {
    const release = () => { if (pointerDown.current) { pointerDown.current = false; markGesture(); } };
    window.addEventListener("pointerup", release);
    const observer = new ResizeObserver(() => {
      if (follow.current && !gesture.current && !pointerDown.current) toLatest();
      else if (list.current) lastTop.current = list.current.scrollTop;
    });
    if (list.current) observer.observe(list.current);
    return () => {
      window.removeEventListener("pointerup", release); observer.disconnect();
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const up = el.scrollTop < lastTop.current;
    const down = el.scrollTop > lastTop.current;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    lastTop.current = el.scrollTop;
    if (resetting.current) { remember(); return; }
    // Also recognize native/accessibility scrollbar scrolling without wheel events.
    // Programmatic positioning and layout updates synchronize lastTop themselves.
    if (distance <= 8 && down) setFollow(true);
    else if (distance > 8 && up) setFollow(false);
    remember();
  };
  const occurrences = new Map<string, number>();
  return <section>
    <div className="automation-section-head"><h3>执行过程</h3>{steps.length > 0 && (following ? <span className="automation-follow-state">跟随最新</span> : <button onClick={() => { gesture.current = false; pointerDown.current = false; setFollow(true); toLatest(); }} title="回到最新步骤">回到最新</button>)}</div>
    {!steps.length && <div className="automation-execution-empty"><Icon name="automation" /><p>运行后显示实际执行步骤</p><span>关卡准备 → 开始录制 → 真实玩法 → 结束片段 → 视频交付</span></div>}
    <ol ref={list} className="automation-steps" hidden={!steps.length} tabIndex={0} aria-label="执行过程列表" onScroll={onScroll}
      onWheel={(e) => { markGesture(); if (e.deltaY < 0) setFollow(false); }}
      onPointerDown={() => { pointerDown.current = true; markGesture(); }} onPointerCancel={() => { pointerDown.current = false; markGesture(); }}
      onTouchStart={markGesture} onTouchMove={markGesture} onTouchEnd={markGesture}
      onKeyDown={(e) => { if (["ArrowUp", "PageUp", "Home"].includes(e.key)) { markGesture(); setFollow(false); } else if (e.key === "End") { e.preventDefault(); gesture.current = false; setFollow(true); toLatest(); } else if (["ArrowDown", "PageDown", " "].includes(e.key)) markGesture(); }}>
      {steps.map((step, index) => {
        const identity = `${step.Graph}:${step.Node}:${step.Started ?? index}`;
        const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
        return <li key={`${identity}:${occurrence}`} className={step.Status}><span className="automation-step-symbol">{step.Status === "passed" ? "✓" : step.Status === "running" ? "●" : "!"}</span><div><strong>{step.Title || step.Node}</strong><small>{step.Graph} · {step.Node}{step.ErrorCode ? ` · ${step.ErrorCode}` : ""}</small>{step.Detail && <p>{step.Detail}</p>}</div><time>{step.Duration > 0 ? `${step.Duration.toFixed(1)}s` : ""}</time></li>;
      })}
    </ol>
  </section>;
}
