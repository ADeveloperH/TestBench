import type { ComponentProps, ReactNode } from "react";
import { HistoryInput } from "../../components/HistoryInput";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";

export function LogFilterToolbar({ paused, pauseDisabled, onPause, onClear, onExport, children, shortcuts = true, exportDisabled = false }: {
  paused: boolean; pauseDisabled: boolean; onPause: () => void; onClear: () => void; onExport: () => void; children: ReactNode; shortcuts?: boolean; exportDisabled?: boolean;
}) {
  return <div className="toolbar-row toolbar-filter-row">
    <div className="toolbar-group tab-processing-actions">
      <button className={`toolbar-icon-action ${paused ? "active" : ""}`} disabled={pauseDisabled} onClick={onPause} title={`只暂停/继续当前 Tab${shortcuts ? "（空格）" : ""}`}>
        <Icon name="pause" /><span className="toolbar-action-label">{paused ? "继续" : "暂停"}</span>
      </button>
      <button className="toolbar-icon-action" onClick={onClear} title={`只清空当前 Tab${shortcuts ? "（⌘/Ctrl+L）" : ""}`}><Icon name="trash" /><span className="toolbar-action-label">清空</span></button>
      <button className="toolbar-icon-action" disabled={exportDisabled} onClick={onExport} title={`导出当前 Tab${shortcuts ? "（⌘/Ctrl+E）" : ""}`}><Icon name="export" /><span className="toolbar-action-label">导出</span></button>
    </div>
    {children}
  </div>;
}

export function LogSearchInput({ regex, onRegexChange, ...input }: ComponentProps<typeof HistoryInput> & { regex: boolean; onRegexChange: (value: boolean) => void }) {
  return <div className="toolbar-search-with-regex">
    <HistoryInput {...input} />
    <button type="button" className={`toolbar-regex-toggle ${regex ? "on" : ""}`} aria-pressed={regex} title="正则表达式" onMouseDown={(e) => e.preventDefault()} onClick={() => onRegexChange(!regex)}>.*</button>
  </div>;
}

export function SavedFilterControls({ value, options, onChange, onSave, expanded = false }: {
  value: string; options: Array<{ id: string; name: string }>; onChange: (id: string) => void; onSave: () => void; expanded?: boolean;
}) {
  return <><label className="toolbar-field-label">过滤器</label>
    <Select className="filter-select" title="已保存的过滤器" value={value} options={[{ value: "", label: "（当前过滤）" }, ...options.map((item) => ({ value: item.id, label: item.name }))]} onChange={onChange} />
    <div className="toolbar-filter-save"><button className={`toolbar-icon-action ${expanded ? "active" : ""}`} onClick={onSave} title="保存当前筛选" aria-expanded={expanded}><Icon name="bookmark" /><span className="toolbar-action-label">保存筛选</span></button></div>
  </>;
}
