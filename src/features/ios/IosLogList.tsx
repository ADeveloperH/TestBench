import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Select } from "../../components/Select";
import type { IosLogRecord } from "./iosTypes";
import { emptyIosView, type IosViewState } from "./useIosWorkspaceTabs";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { selectIosLogs } from "./iosLogViewAdapter";
import { getIosLogDisplay } from "./iosLogEncoding";

export function IosLogList({ records, dropped, statusText, view, onViewChange, showControls = true, deviceKey = "probe", sessionId = "probe" }: {
  records: IosLogRecord[]; dropped: number; statusText?: string; view?: IosViewState;
  onViewChange?: (patch: Partial<IosViewState>) => void; showControls?: boolean; deviceKey?: string; sessionId?: string;
}) {
  const [local, setLocal] = useState(emptyIosView);
  const state = view ?? local;
  const update = (patch: Partial<IosViewState>) => onViewChange ? onViewChange(patch) : setLocal((current) => ({ ...current, ...patch }));
  const { search, level, semantic, follow, snapshot, selected } = state;
  const selection = useMemo(() => selectIosLogs(records, state, deviceKey, sessionId), [records, state, deviceKey, sessionId]);
  const { source } = selection;
  const setSearch = (search: string) => update({ search });
  const setLevel = (level: string) => update({ level });
  const setSemantic = (semantic: string) => update({ semantic });
  const setFollow = (follow: boolean) => update({ follow });
  const setSelected = (selected: IosLogRecord | null) => update({ selected });
  const parent = useRef<HTMLDivElement>(null);
  const exportDisplayed = async () => {
    try {
      const saved = await invoke<string | null>("export_logs", { text: filtered.map((record) => record.raw).join("\n") });
      if (saved) await message(`当前 Tab 已导出：${saved}`, { title: "导出完成", kind: "info" });
    } catch (error) { await message(String(error), { title: "导出失败", kind: "error" }); }
  };
  const levels = useMemo(() => [...new Set(records.map((record) => record.level))].sort(), [records]);
  const filtered = selection.records;
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 28,
    getItemKey: (index) => selection.rows[index].key,
    overscan: 15,
  });
  useEffect(() => {
    if (follow && filtered.length) virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
  }, [filtered, follow, virtualizer]);
  useEffect(() => {
    if (!records.length && !view) setLocal((current) => ({ ...current, selected: null, snapshot: null }));
  }, [records]);

  return <section className="ios-log-workspace">
    {showControls && <div className="ios-log-filters">
      <input aria-label="搜索 iOS 日志" placeholder="搜索原文或还原文本…" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Select title="Apple 原始级别" value={level} onChange={setLevel} options={[
        { value: "", label: "全部原始级别" },
        ...[...new Set([...levels, ...(level ? [level] : [])])].map((value) => ({ value, label: value })),
      ]} />
      <Select title="Unity 推断级别" value={semantic} onChange={setSemantic} options={[
        { value: "", label: "全部 Unity 推断级别" },
        ...["info", "warning", "error", "exception"].map((value) => ({ value, label: value })),
        { value: "unknown", label: "无推断级别" },
      ]} />
      <label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />跟随最新</label>
      <button onClick={() => update({ snapshot: snapshot ? null : [...records] })}>{snapshot ? "恢复展示" : "暂停展示"}</button>
      <span>{filtered.length} / {source.length} 条{snapshot ? " · 展示已暂停，后台继续采集" : ""}</span>
      <button disabled={!filtered.length} onClick={exportDisplayed} title="仅导出当前 Tab 筛选后的原文；完整会话请停止后从更多菜单导出">导出当前 Tab</button>
    </div>}
    {selection.error && <div className="ios-log-note" role="alert">{selection.error}</div>}
    <div className="ios-log-note">Unity 级别来自特征推断；原始级别保持 Apple 输出。显示窗口保留最近 10 万条，超过 10.5 万条时批量淘汰旧记录。完整会话请停止采集后从“更多”导出；后端丢弃为事件队列丢弃，展示淘汰不删除落盘记录。</div>
    {statusText && <div className="ios-log-note" role="status">{statusText}</div>}
    {dropped > 0 && <div className="ios-log-note" role="status">展示窗口已淘汰 {dropped} 条；原始日志由后端独立落盘。</div>}
    <div className="ios-log-scroll" ref={parent} onWheel={() => setFollow(false)} aria-label="iOS 日志列表">
      {!filtered.length && <div className="ios-log-note">{records.length ? "没有匹配的日志" : "等待日志；请开始采集并操作目标应用"}</div>}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const record = filtered[row.index];
          return <button key={row.key} className={`ios-log-row${selected === record ? " selected" : ""}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: row.size, transform: `translateY(${row.start}px)` }} onClick={() => setSelected(record)}>
            <span>{record.timestamp}</span><span>{record.process}[{record.pid ?? "?"}]</span>
            <span>{record.level}</span><span>{record.semanticLevel ?? "—"}</span>
            <span>{selection.rows[row.index].encodingRecovered ? "[编码还原] " : record.encodingStatus !== "valid" ? "[疑似乱码] " : ""}{record.truncated ? "[截断] " : ""}{selection.rows[row.index].message}</span>
          </button>;
        })}
      </div>
    </div>
    {selected && <div className="ios-log-detail">
      <div><strong>日志原文</strong><span> · {selected.module ?? "无模块"} · {selected.semanticLevelSource ?? "无推断来源"}</span><button onClick={() => setSelected(null)}>关闭详情</button></div>
      {getIosLogDisplay(selected).recovered && <><strong>编码还原正文（MacRoman → UTF-8）</strong><pre>{getIosLogDisplay(selected).message}</pre><strong>日志原文</strong></>}
      <pre>{selected.raw}</pre>
    </div>}
  </section>;
}
