import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Select } from "../../components/Select";

interface Policy { autoCleanup: boolean; retainDays: number; maxBytes: number }
interface CleanupResult { deletedCount: number; freedBytes: number; skippedCount: number; errors: string[] }
interface Status {
  settings: Policy; needsConfirmation: boolean; totalBytes: number; historyCount: number;
  protectedCount: number; protectedBytes: number; overTarget: boolean; unknownCount: number;
  warnings: string[]; lastCleanup: CleanupResult | null;
}
interface Preview {
  id: string; mode: "save" | "rules" | "all"; sessionCount: number; bytes: number;
  protectedCount: number; protectedBytes: number; remainingBytes: number; settings: Policy;
}
function bytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}
const samePolicy = (a: Policy, b: Policy) => a.autoCleanup === b.autoCleanup && a.retainDays === b.retainDays && a.maxBytes === b.maxBytes;

export function LogStorageSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const loading = useRef(0);
  const requestSequence = useRef(0);
  const refresh = useCallback(async (reset = false) => {
    if (loading.current && !reset) return;
    const request = ++requestSequence.current;
    loading.current = request; setRefreshing(true);
    try {
      const next = await invoke<Status>("log_storage_status");
      if (!mounted.current || loading.current !== request) return;
      setStatus(next); setDraft(previous => reset || !previous ? next.settings : previous);
      setError("");
    } catch (e) { if (mounted.current && loading.current === request) setError(String(e)); }
    finally { if (loading.current === request) { loading.current = 0; if (mounted.current) setRefreshing(false); } }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refresh]);

  const prepare = async (mode: Preview["mode"]) => {
    if (!draft || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const next = await invoke<Preview>("log_storage_preview", { mode, settings: mode === "save" ? draft : null });
      if (mounted.current) setPreview(next);
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true); setError("");
    try {
      const result = await invoke<CleanupResult>("log_storage_confirm", { id: preview.id });
      if (!mounted.current) return;
      setPreview(null);
      setMessage(`${preview.mode === "save" ? "设置已保存。" : "清理完成。"}已清理 ${result.deletedCount} 个会话，释放 ${bytes(result.freedBytes)}${result.skippedCount ? `；${result.skippedCount} 个会话因占用、内容变化或清理失败跳过` : ""}。`);
      if (result.errors.length) setError(result.errors.join("\n"));
      await refresh(true);
      // refresh成功不应抹掉本次部分清理失败的具体信息。
      if (result.errors.length && mounted.current) setError(result.errors.join("\n"));
    } catch (e) { if (mounted.current) { setPreview(null); setError(String(e)); } }
    finally { if (mounted.current) setBusy(false); }
  };
  const openDirectory = async () => {
    try { await invoke("log_storage_open_directory"); }
    catch (e) { setError(String(e)); }
  };
  const changed = !!status && !!draft && !samePolicy(status.settings, draft);
  return <article className="log-storage-settings" aria-labelledby="log-storage-title">
    <div className="log-storage-heading">
      <div><h3 id="log-storage-title">日志存储</h3><p>管理本机原始 logcat 日志，保留完整会话导出能力。</p></div>
      <button disabled={busy || refreshing} onClick={() => void refresh()}>{refreshing ? "统计中…" : "刷新统计"}</button>
    </div>
    {status && <>
      <dl className="log-storage-stats">
        <div><dt>日志总占用</dt><dd>{bytes(status.totalBytes)}</dd></div>
        <div><dt>历史会话</dt><dd>{status.historyCount} 个</dd></div>
        <div><dt>受保护会话</dt><dd>{status.protectedCount} 个 · {bytes(status.protectedBytes)}</dd></div>
      </dl>
      {status.needsConfirmation && <p className="log-storage-notice">首次启用自动清理需要确认，现有历史日志尚未自动删除。请先退出旧版 TestBench，检查下方规则后点击“预览并启用”。</p>}
      {status.overTarget && <p className="log-storage-notice">当前占用超过容量目标。清理只处理可删除的历史会话；受保护日志不会被截断。</p>}
      {status.unknownCount > 0 && <p className="log-storage-note">另有 {status.unknownCount} 项格式未知或无法安全读取，已跳过，不计入可管理容量。</p>}
    </>}
    {draft && <>
      <div className="log-storage-fields">
        <label className="log-storage-checkbox"><input type="checkbox" checked={draft.autoCleanup} disabled={busy}
          onChange={e => setDraft({ ...draft, autoCleanup: e.target.checked })} />自动清理历史日志</label>
        <label><span>保留时间</span><Select title="历史日志保留时间" disabled={busy} value={String(draft.retainDays)}
          options={Array.from(new Set([1, 3, 7, 14, 30, 90, draft.retainDays])).sort((a,b) => a-b).map(n => ({ value: String(n), label: `${n} 天` }))}
          onChange={v => setDraft({ ...draft, retainDays: Number(v) })} /></label>
        <label><span>容量清理目标</span><Select title="日志容量清理目标" disabled={busy} value={String(draft.maxBytes)}
          options={Array.from(new Set([500_000_000, 1_000_000_000, 2_000_000_000, 5_000_000_000, draft.maxBytes])).sort((a,b) => a-b).map(n => ({ value: String(n), label: bytes(n) }))}
          onChange={v => setDraft({ ...draft, maxBytes: Number(v) })} /></label>
      </div>
      <p className="log-storage-note">先清理过期会话，再按最旧优先清理到容量目标。当前会话（含停止后）及导出中的日志受保护，可能使总占用暂时超出目标。设置仅保存在本机。</p>
      <div className="log-storage-actions">
        <button className="primary" disabled={busy || (!changed && !status?.needsConfirmation)} onClick={() => void prepare("save")}>
          {status?.needsConfirmation && draft.autoCleanup ? "预览并启用" : "保存设置"}</button>
        <button disabled={busy || !status || changed} onClick={() => void prepare("rules")} title={changed ? "请先保存设置，再按规则清理" : undefined}>按规则清理</button>
        <button className="danger" disabled={busy || !status || changed} onClick={() => void prepare("all")}>清空历史日志</button>
        <button disabled={busy} onClick={() => void openDirectory()}>打开日志目录</button>
      </div>
    </>}
    {message && <p className="settings-inline-status" role="status">{message}</p>}
    {error && <p className="log-storage-error" role="alert">{error}</p>}
    {!status && !refreshing && <button onClick={() => void refresh()}>重试读取</button>}
    {status?.warnings.map(w => <p className="log-storage-note" key={w}>{w}</p>)}
    {status?.lastCleanup?.errors.map(e => <p className="log-storage-error" key={e}>{e}</p>)}
    {preview && <CleanupConfirmation preview={preview} busy={busy} onCancel={() => { if (!busy) setPreview(null); }} onConfirm={() => void confirm()} />}
  </article>;
}

function CleanupConfirmation({ preview, busy, onCancel, onConfirm }: { preview: Preview; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel); onCancelRef.current = onCancel;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancelRef.current(); }
      if (event.key === "Tab") {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons?.length) { event.preventDefault(); return; }
        const first = buttons[0], last = buttons[buttons.length-1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); previous?.focus(); };
  }, []);
  const saving = preview.mode === "save";
  return createPortal(<div className="save-description-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <div ref={dialog} className="save-description-dialog log-storage-dialog" role="dialog" aria-modal="true" aria-labelledby="log-storage-confirm-title">
      <h3 id="log-storage-confirm-title">{saving ? "确认日志存储设置" : preview.mode === "all" ? "清空历史日志" : "按规则清理历史日志"}</h3>
      {saving && <p>自动清理{preview.settings.autoCleanup ? "开启" : "关闭"}，保留 {preview.settings.retainDays} 天，容量目标 {bytes(preview.settings.maxBytes)}。</p>}
      <p>本次预计删除 <strong>{preview.sessionCount} 个会话</strong>，释放 <strong>{bytes(preview.bytes)}</strong>。删除后无法恢复，请先备份需要保留的日志。</p>
      <p>保留 {preview.protectedCount} 个受保护会话（{bytes(preview.protectedBytes)}）；预计剩余 {bytes(preview.remainingBytes)}。确认后新建、被占用或内容变化的会话会跳过。</p>
      <div className="save-description-actions">
        <button ref={cancel} disabled={busy} onClick={onCancel}>取消</button>
        <button className={preview.sessionCount ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>{busy ? "处理中…" : saving ? "确认保存" : "确认清理"}</button>
      </div>
    </div>
  </div>, document.body);
}
