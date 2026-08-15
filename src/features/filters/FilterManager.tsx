import { useState } from "react";
import type { AppInfo } from "../../core/apps";
import type { SavedFilter } from "./useSavedFilters";
import type { FilterState, LogLevel } from "../../core/types";
import { LEVELS, LEVEL_LABELS } from "../../core/types";

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
                      <select
                        value={draftFilters.minLevel}
                        onChange={(e) =>
                          patch({ minLevel: e.target.value as LogLevel })
                        }
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {LEVEL_LABELS[l]}
                          </option>
                        ))}
                      </select>
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
                    <select
                      value={draftFilters.app ?? ""}
                      onChange={(e) => patch({ app: e.target.value })}
                    >
                      <option value="">全部应用</option>
                      {props.apps.map((a) => (
                        <option key={a.package} value={a.package}>
                          {a.name}（{a.package}）
                        </option>
                      ))}
                    </select>
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
                  <button
                    className="manage-move"
                    title="编辑"
                    onClick={() => startEdit(f)}
                  >
                    ✎
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === 0}
                    title="置顶"
                    onClick={() => props.onMove(i, 0)}
                  >
                    ⏫
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === 0}
                    title="上移"
                    onClick={() => props.onMove(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === last}
                    title="下移"
                    onClick={() => props.onMove(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="manage-move"
                    disabled={i === last}
                    title="置底"
                    onClick={() => props.onMove(i, last)}
                  >
                    ⏬
                  </button>
                  <button
                    className="manage-del"
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
