import { useState } from "react";
import { createPortal } from "react-dom";
import { Select } from "../../components/Select";
import type { useIosApplications } from "./useIosApplications";
import { HistoryInput } from "../../components/HistoryInput";
import { IosLevelFilter } from "./IosLevelFilter";
import { LogFilterToolbar, LogSearchInput, SavedFilterControls } from "../logcat/LogFilterToolbar";
import { iosFilterValues, type IosFilterPreferences } from "./iosFilterPreferences";
import type { useIosWorkspaceActions } from "./useIosWorkspaceActions";
import type { IosViewState } from "./useIosWorkspaceTabs";
import type { IosLogRecord } from "./iosTypes";
import { IOS_PILOT_APP_NAME } from "./iosPilotTarget";

export function IosWorkspaceToolbar({ view, onChange, records, running, preferences, updatePreferences, applications, captureScope, busy, actions, searchFavorites, onPinSearch, onUnpinSearch, protectedSearchValues, canRestartTest, onRestartTest }: {
  canRestartTest?: boolean; onRestartTest?: () => void;
  searchFavorites: Array<{ value: string; description: string }>;
  onPinSearch: (value: string, description: string) => void; onUnpinSearch: (value: string) => void; protectedSearchValues: Set<string>;
  view: IosViewState; onChange: (patch: Partial<IosViewState>) => void; records: IosLogRecord[]; running: boolean; busy: boolean;
  preferences: IosFilterPreferences; updatePreferences: (update: (current: IosFilterPreferences) => IosFilterPreferences) => void;
  applications: ReturnType<typeof useIosApplications>;
  captureScope: { processFilter: string; exactProcess: boolean } | null;
  actions: ReturnType<typeof useIosWorkspaceActions>;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const selected = actions.selection;
  const levels = [...new Set([...records.map((record) => record.level), ...(view.level ? [view.level] : [])])].sort();
  const changeFilter = (patch: Partial<IosViewState>) => onChange({ ...patch, activeFilterId: "" });
  const save = () => {
    if (!name.trim()) return;
    const id = `ios_filter_${crypto.randomUUID()}`;
    updatePreferences((current) => ({ ...current, savedFilters: [...current.savedFilters, { id, name: name.trim(), filters: iosFilterValues(view) }] }));
    onChange({ activeFilterId: id });
    setName(""); setSaving(false);
  };
  if (view.kind === "test") return <LogFilterToolbar exportDisabled={!actions.canExport} paused={view.snapshot !== null} pauseDisabled={!actions.canPause}
    onPause={actions.pause} onClear={actions.clear} onExport={() => void actions.exportCurrent()}>
    <span className="test-monitor-context">iOS 用例 · {IOS_PILOT_APP_NAME} · 仅监测已绑定的采集会话</span>
    <button disabled={!canRestartTest} onClick={onRestartTest}>重新开始测试</button>
    <span className="count toolbar-log-count">共 {selected.records.length} 条 · 测试日志不使用普通筛选或降噪</span>
  </LogFilterToolbar>;
  return <>
    <LogFilterToolbar exportDisabled={!actions.canExport} paused={view.snapshot !== null} pauseDisabled={!actions.canPause} onPause={actions.pause}
      onClear={actions.clear} onExport={() => void actions.exportCurrent()}>
      <label className="toolbar-field-label">应用</label>
      <fieldset className="ios-app-picker" disabled={running || busy} title={running || busy ? "先停止采集再切换应用；全部 Tab 共用采集范围" : "按应用可执行文件名精确匹配，不代表 PID/扩展进程归属"}>
        <Select className="app-select" title="选择 iOS 应用" searchable searchPlaceholder="搜索应用名或 Bundle ID…"
          value={applications.bundleId} onChange={applications.select}
          options={[{ value: "", label: "全部应用", fullLabel: "全部应用" },
            ...(!applications.apps.some((app) => app.bundleId === applications.bundleId) && applications.bundleId ? [{ value: applications.bundleId, label: `${applications.bundleId}（待确认）` }] : []),
            ...applications.apps.map((app) => ({ value: app.bundleId, label: `${app.name}（${app.bundleId}）${app.installed === false ? " · 未安装" : app.installed === null ? " · 状态未知" : !app.executable ? " · 无进程映射" : ""}`, fullLabel: `${app.name} ${app.bundleId} ${app.executable ?? ""}` }))]} />
        <button type="button" disabled={applications.loading} onClick={() => void applications.refresh()} title="刷新配置应用的安装状态与进程映射">{applications.loading ? "加载中…" : "刷新应用"}</button>
      </fieldset>
      <label className="toolbar-field-label">级别</label>
      <IosLevelFilter level={view.level} semantic={view.semantic} levels={levels} onChange={changeFilter} />
      <div className="ios-marker-input" title="匹配正文中的业务标记，非原生 Tag；逗号分隔包含项为或，!排除，可输入 [LevelFlow]">
        <HistoryInput value={view.markers ?? ""} onChange={(markers) => changeFilter({ markers })} placeholder="业务标记（逗号分隔，!排除）"
          favorites={preferences.markerFavorites} history={preferences.markerHistory}
          onAddHistory={(value) => updatePreferences((current) => ({ ...current, markerHistory: [value, ...current.markerHistory.filter((item) => item !== value)].slice(0, 30) }))}
          onPin={(value, description) => updatePreferences((current) => ({ ...current, markerFavorites: [...current.markerFavorites.filter((item) => item.value !== value), { value, description }] }))}
          onUnpin={(value) => updatePreferences((current) => ({ ...current, markerFavorites: current.markerFavorites.filter((item) => item.value !== value) }))}
          onRemoveHistory={(value) => updatePreferences((current) => ({ ...current, markerHistory: current.markerHistory.filter((item) => item !== value) }))} />
      </div>
      <span className="tab-processing-separator" />
      <LogSearchInput value={view.search} onChange={(search) => changeFilter({ search })} placeholder="搜索（原文 / 还原文本）" regex={view.regex} onRegexChange={(regex) => changeFilter({ regex })}
        favorites={searchFavorites} history={preferences.history} protectedValues={protectedSearchValues}
        onAddHistory={(value) => updatePreferences((current) => ({ ...current, history: [value, ...current.history.filter((item) => item !== value)].slice(0, 30) }))}
        onPin={onPinSearch}
        onUnpin={onUnpinSearch}
        onRemoveHistory={(value) => updatePreferences((current) => ({ ...current, history: current.history.filter((item) => item !== value) }))} />
      <SavedFilterControls value={preferences.savedFilters.some((filter) => filter.id === view.activeFilterId) ? view.activeFilterId : ""} options={preferences.savedFilters}
        onChange={(id) => { const filter = preferences.savedFilters.find((item) => item.id === id); onChange(filter ? { ...filter.filters, activeFilterId: id } : { activeFilterId: "" }); }}
        onSave={() => setSaving(true)} expanded={saving} />
      {selected.blockedCount > 0 && <button type="button" className={`toolbar-icon-action tag-block-visibility ${view.showBlockedLogs ? "active" : ""}`}
        title="当前窗口内命中 iOS 屏蔽规则的数量；点击临时显示或隐藏，原始日志仍保留" onClick={() => onChange({ showBlockedLogs: !view.showBlockedLogs })}>
        {view.showBlockedLogs ? `屏蔽日志已显示 ${selected.blockedCount}` : `已隐藏 ${selected.blockedCount}`}</button>}
      <span className="count toolbar-log-count" role="status">共 {selected.records.length} / {selected.source.length} 条{view.snapshot ? " · 展示已暂停" : ""}{selected.error && <span className="log-drop-warning"> · {selected.error}</span>}</span>
    </LogFilterToolbar>
    {(applications.error || (applications.bundleId && applications.target.error && !applications.loading)) && <div className="ios-app-scope-notice" role="alert">{applications.error || applications.target.error}；不会自动改采全部应用。</div>}
    {running && captureScope && (!captureScope.exactProcess || captureScope.processFilter !== applications.target.executable) && <div className="ios-app-scope-notice" role="status">当前会话来自 {captureScope.exactProcess ? "其他应用选择" : "Probe 手动筛选"}：{captureScope.processFilter || "全部进程"}；停止后按正式页所选应用重新采集。</div>}
    {saving && createPortal(<div className="save-description-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaving(false); }}>
      <div className="save-description-dialog" role="dialog" aria-modal="true" aria-label="保存 iOS 筛选" onKeyDown={(event) => { if (event.key === "Escape") setSaving(false); }}>
        <h3>保存当前筛选</h3><p>保存 iOS 业务标记、搜索、正则及原始/推断级别；采集进程和运行状态不保存。</p>
        <input autoFocus value={name} placeholder="筛选描述" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} />
        <div className="save-description-actions"><button onClick={() => setSaving(false)}>取消</button><button className="primary-action" disabled={!name.trim()} onClick={save}>保存</button></div>
      </div></div>, document.body)}
  </>;
}
