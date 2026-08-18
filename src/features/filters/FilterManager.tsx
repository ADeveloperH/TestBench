import { useState } from "react";
import type { AppInfo } from "../../core/apps";
import type { SavedFilter } from "./useSavedFilters";
import type { FilterState, LogLevel } from "../../core/types";
import { LEVELS, LEVEL_LABELS } from "../../core/types";
import { BUILTIN_FILTER_IDS } from "../../core/builtins";
import { Select } from "../../components/Select";

interface Props {
  savedFilters: SavedFilter[];
  apps: AppInfo[];
  onSave: (name: string, filters: FilterState) => string;
  onRename: (id: string, name: string) => void;
  onUpdate: (id: string, filters: FilterState) => void;
  onDelete: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}

const EMPTY: FilterState = {
  minLevel: "V",
  search: "",
  regex: false,
  tags: "",
  pid: "",
  app: "",
};

function summary(f: SavedFilter): string {
  const parts: string[] = [];
  if (f.filters.minLevel !== "V") {
    parts.push(`级别≥${LEVEL_LABELS[f.filters.minLevel]}`);
  }
  if (f.filters.search) {
    parts.push(`搜索「${f.filters.search}」${f.filters.regex ? "（正则）" : ""}`);
  }
  if (f.filters.tags) parts.push(`Tag「${f.filters.tags}」`);
  if (f.filters.app) parts.push(`应用「${f.filters.app}」`);
  return parts.length ? parts.join(" · ") : "（无过滤条件）";
}

export function FilterManager(props: Props) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY);

  const patch = (p: Partial<FilterState>) =>
    setDraftFilters((d) => ({ ...d, ...p }));

  const startEdit = (f: SavedFilter) => {
    setEditingId(f.id);
    setDraftName(f.name);
    setDraftFilters({ ...f.filters });
  };

  const saveEdit = () => {
    if (!editingId || !draftName.trim()) return;
    props.onRename(editingId, draftName.trim());
    props.onUpdate(editingId, { ...draftFilters, pid: "" });
    setEditingId(null);
  };

  const handleAdd = () => {
    const n = newName.trim();
    if (!n) return;
    const id = props.onSave(n, { ...EMPTY });
    setNewName("");
    setEditingId(id);
    setDraftName(n);
    setDraftFilters({ ...EMPTY });
  };

  return (
    <section className="manage-section">
      <h2>过滤器（已保存的过滤条件组合）</h2>
      <div className="manage-add">
        <input
          placeholder="过滤器名称"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button onClick={handleAdd}>添加</button>
      </div>

      {props.savedFilters.length === 0 && (
        <div className="count">
          还没有保存的过滤器。可在日志页设置过滤条件后「保存」，或点「添加」新建一个空过滤器再编辑。
        </div>
      )}

      <ul className="manage-list">
        {props.savedFilters.map((f, i) => {
          const last = props.savedFilters.length - 1;
          const editing = editingId === f.id;
          const builtin = BUILTIN_FILTER_IDS.has(f.id);
          return (
            <li
              key={f.id}
              className={
                editing
                  ? "manage-item manage-filter-item editing"
                  : "manage-item manage-filter-item"
              }
            >
              {editing ? (
                <div className="manage-filter-edit">
                  <div className="manage-filter-row">
                    <input
                      placeholder="名称"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                    />
                    <label className="checkbox">
                      级别
                      <Select
                        className="filter-level-select"
                        title="最低日志级别"
                        value={draftFilters.minLevel}
                        options={LEVELS.map((l) => ({
                          value: l,
                          label: LEVEL_LABELS[l],
                        }))}
                        onChange={(v) => patch({ minLevel: v as LogLevel })}
                      />
                    </label>
                  </div>
                  <div className="manage-filter-row">
                    <input
                      placeholder="搜索（消息或 Tag）"
                      value={draftFilters.search}
                      onChange={(e) => patch({ search: e.target.value })}
                    />
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={draftFilters.regex}
                        onChange={(e) => patch({ regex: e.target.checked })}
                      />
                      正则
                    </label>
                    <input
                      placeholder="Tag（逗号分隔）"
                      value={draftFilters.tags}
                      onChange={(e) => patch({ tags: e.target.value })}
                    />
                    <Select
                      className="filter-app-select"
                      title="按应用过滤"
                      value={draftFilters.app ?? ""}
                      options={[
                        { value: "", label: "全部应用", fullLabel: "全部应用" },
                        ...props.apps.map((a) => ({
                          value: a.package,
                          label: `${a.name}（${a.package}）`,
                          fullLabel: `${a.name}（${a.package}）`,
                        })),
                      ]}
                      onChange={(v) => patch({ app: v })}
                    />
                  </div>
                  <div className="manage-filter-row">
                    <button onClick={saveEdit} disabled={!draftName.trim()}>
                      保存
                    </button>
                    <button onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="manage-filter-main">
                  <span className="manage-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="manage-desc" title={summary(f)}>
                    {summary(f)}
                  </span>
                  {builtin && <span className="manage-badge">内置</span>}
                  <button
                    className="manage-move"
                    disabled={builtin}
                    title={builtin ? "内置过滤器不可编辑" : "编辑"}
                    onClick={() => startEdit(f)}
                  >
                    ✎
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === 0 || builtin}
                    title={builtin ? "内置过滤器不可移动" : "置顶"}
                    onClick={() => props.onMove(i, 0)}
                  >
                    ⏫
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === 0 || builtin}
                    title={builtin ? "内置过滤器不可移动" : "上移"}
                    onClick={() => props.onMove(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === last || builtin}
                    title={builtin ? "内置过滤器不可移动" : "下移"}
                    onClick={() => props.onMove(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === last || builtin}
                    title={builtin ? "内置过滤器不可移动" : "置底"}
                    onClick={() => props.onMove(i, last)}
                  >
                    ⏬
                  </button>
                  <button
                    className="manage-del"
                    disabled={builtin}
                    title={builtin ? "内置过滤器不可删除" : "删除"}
                    onClick={() => props.onDelete(f.id)}
                  >
                    删除
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
