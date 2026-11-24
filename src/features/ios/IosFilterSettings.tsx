import { useState } from "react";
import { HistoryInput } from "../../components/HistoryInput";
import { Select } from "../../components/Select";
import { createLogSearch } from "../../core/logView";
import type { IosFilterPreferences, IosSavedFilter } from "./iosFilterPreferences";

export function IosFilterSettings({ preferences, onChange }: {
  preferences: IosFilterPreferences; onChange: (update: (current: IosFilterPreferences) => IosFilterPreferences) => void;
}) {
  const [markerDraft, setMarkerDraft] = useState("");
  const [editing, setEditing] = useState<IosSavedFilter | null>(null);
  return <section className="manage-section">
    <h2>iOS 日志过滤器</h2><p>仅用于 iOS 业务标记、原文搜索和级别筛选，与 Android 过滤器独立。</p>
    <h3>业务标记常用与历史</h3><p>匹配正文，不是原生 Tag；与 Android Tag 常用及 iOS 全文搜索独立。</p>
    <HistoryInput value={markerDraft} onChange={setMarkerDraft} placeholder="管理业务标记收藏与历史"
      favorites={preferences.markerFavorites} history={preferences.markerHistory} onAddHistory={() => {}}
      onPin={(value, description) => onChange((current) => ({ ...current, markerFavorites: [...current.markerFavorites.filter((item) => item.value !== value), { value, description }] }))}
      onUnpin={(value) => onChange((current) => ({ ...current, markerFavorites: current.markerFavorites.filter((item) => item.value !== value) }))}
      onRemoveHistory={(value) => onChange((current) => ({ ...current, markerHistory: current.markerHistory.filter((item) => item !== value) }))} />
    {!preferences.savedFilters.length && <p>暂无保存的 iOS 筛选，可在日志页保存当前筛选。</p>}
    <ul className="manage-list">{preferences.savedFilters.map((filter, index) => <li key={filter.id} className="manage-item">
      <div className="manage-name"><strong>{filter.name}</strong><div className="manage-desc">{filter.filters.markers || "全部标记"} · {filter.filters.search || "全部原文"} · {filter.filters.regex ? "正则" : "文字"} · {filter.filters.level || "全部原始级别"} · {filter.filters.semantic || "全部推断级别"}</div></div>
      <button onClick={() => setEditing({ ...filter, filters: { ...filter.filters } })}>编辑</button>
      <button disabled={index === 0} onClick={() => onChange((current) => { const list = [...current.savedFilters]; [list[index - 1], list[index]] = [list[index], list[index - 1]]; return { ...current, savedFilters: list }; })}>上移</button>
      <button className="danger" onClick={() => onChange((current) => ({ ...current, savedFilters: current.savedFilters.filter((item) => item.id !== filter.id) }))}>删除</button>
    </li>)}</ul>
    {editing && <form className="ios-filter-editor" onSubmit={(event) => { event.preventDefault(); if (!editing.name.trim()) return;
      onChange((current) => ({ ...current, savedFilters: current.savedFilters.map((item) => item.id === editing.id ? { ...editing, name: editing.name.trim() } : item) })); setEditing(null); }}>
      <label>名称<input aria-label="iOS 筛选名称" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
      <label>业务标记<input aria-label="iOS 筛选业务标记" value={editing.filters.markers} onChange={(event) => setEditing({ ...editing, filters: { ...editing.filters, markers: event.target.value } })} /></label>
      <label>搜索<input aria-label="iOS 筛选搜索" value={editing.filters.search} onChange={(event) => setEditing({ ...editing, filters: { ...editing.filters, search: event.target.value } })} /></label>
      <label><input type="checkbox" checked={editing.filters.regex} onChange={(event) => setEditing({ ...editing, filters: { ...editing.filters, regex: event.target.checked } })} />正则表达式</label>
      <label>原始级别<input aria-label="iOS 筛选原始级别" placeholder="留空为全部" value={editing.filters.level} onChange={(event) => setEditing({ ...editing, filters: { ...editing.filters, level: event.target.value } })} /></label>
      <Select title="iOS 筛选推断级别" value={editing.filters.semantic} onChange={(semantic) => setEditing({ ...editing, filters: { ...editing.filters, semantic } })} options={[{ value: "", label: "全部推断级别" }, ...["info", "warning", "error", "exception", "unknown"].map((value) => ({ value, label: value === "unknown" ? "无推断级别" : value }))]} />
      {createLogSearch(editing.filters.search, editing.filters.regex).error && <span role="alert">正则表达式无效</span>}
      <button type="button" onClick={() => setEditing(null)}>取消</button><button type="submit" disabled={!editing.name.trim()}>保存</button>
    </form>}
  </section>;
}
