import { useState } from "react";
import { DEFAULT_BACKDOOR } from "../../core/apps";
import type { AppInfo } from "../../core/apps";
import type { Favorite, ListKind, Prefs } from "./usePrefs";
import type { SavedFilter } from "../filters/useSavedFilters";
import type { TestCasesStore } from "../testcases/useTestCasesStore";
import type { FilterState } from "../../core/types";
import { FilterManager } from "../filters/FilterManager";
import { TestCaseManager } from "../testcases/TestCaseManager";

export type ManageTab = "apps" | "search" | "tags" | "testcases" | "filters";

interface Props {
  prefs: Prefs;
  effectiveApps: AppInfo[];
  testCaseStore: TestCasesStore;
  initialTab?: ManageTab;
  onAddApp: (name: string, pkg: string) => void;
  onRemoveApp: (pkg: string) => void;
  onSetAppOrder: (order: string[]) => void;
  onSetBackdoorOverride: (pkg: string, activity: string) => void;
  onAddFavorite: (kind: ListKind, value: string, description: string) => void;
  onRemoveFavorite: (kind: ListKind, value: string) => void;
  onUpdateFavoriteDescription: (
    kind: ListKind,
    value: string,
    description: string,
  ) => void;
  onMoveFavorite: (kind: ListKind, fromIndex: number, toIndex: number) => void;
  onRemoveHistory: (kind: ListKind, value: string) => void;
  onClearHistory: (kind: ListKind) => void;
  savedFilters: SavedFilter[];
  onSaveFilter: (name: string, filters: FilterState) => string;
  onRenameFilter: (id: string, name: string) => void;
  onUpdateFilter: (id: string, filters: FilterState) => void;
  onDeleteFilter: (id: string) => void;
  onMoveFilter: (fromIndex: number, toIndex: number) => void;
  onBack: () => void;
}

export function ManagePage(props: Props) {
  const [tab, setTab] = useState<ManageTab>(props.initialTab ?? "apps");
  const [appName, setAppName] = useState("");
  const [appPkg, setAppPkg] = useState("");
  const [appBackdoor, setAppBackdoor] = useState("");
  const [editingBackdoor, setEditingBackdoor] = useState<string | null>(null);
  const [editBackdoor, setEditBackdoor] = useState("");
  const [searchFav, setSearchFav] = useState("");
  const [searchDesc, setSearchDesc] = useState("");
  const [tagFav, setTagFav] = useState("");
  const [tagDesc, setTagDesc] = useState("");

  const isAdded = (pkg: string) =>
    props.prefs.addedApps.some((a) => a.package === pkg);

  const backdoorOf = (pkg: string) =>
    props.prefs.backdoorOverrides[pkg] ?? DEFAULT_BACKDOOR;

  const moveAppTo = (index: number, toIndex: number) => {
    const ordered = props.effectiveApps.map((a) => a.package);
    const n = ordered.length;
    if (
      index < 0 ||
      index >= n ||
      toIndex < 0 ||
      toIndex >= n ||
      index === toIndex
    ) {
      return;
    }
    const [item] = ordered.splice(index, 1);
    ordered.splice(toIndex, 0, item);
    props.onSetAppOrder(ordered);
  };

  const startEditBackdoor = (pkg: string, current: string) => {
    setEditingBackdoor(pkg);
    setEditBackdoor(current);
  };

  const saveBackdoor = () => {
    if (editingBackdoor) {
      props.onSetBackdoorOverride(editingBackdoor, editBackdoor);
    }
    setEditingBackdoor(null);
  };

  return (
    <div className="manage-page">
      <div className="manage-header">
        <button onClick={props.onBack}>← 返回</button>
        <h1>设置</h1>
      </div>

      <div className="manage-tabs">
        <button className={tab === "apps" ? "active" : ""} onClick={() => setTab("apps")}>
          应用
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          搜索
        </button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}>
          Tag
        </button>
        <button
          className={tab === "testcases" ? "active" : ""}
          onClick={() => setTab("testcases")}
        >
          测试用例
        </button>
        <button
          className={tab === "filters" ? "active" : ""}
          onClick={() => setTab("filters")}
        >
          过滤器
        </button>
      </div>

      {tab === "apps" && (
        <section className="manage-section">
          <h2>应用清单（内置 + 手动）</h2>
          <div className="manage-add">
            <input
              placeholder="应用名"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
            />
            <input
              placeholder="包名（com.xxx.xxx）"
              value={appPkg}
              onChange={(e) => setAppPkg(e.target.value)}
            />
            <input
              placeholder="后门 Activity（可选）"
              value={appBackdoor}
              onChange={(e) => setAppBackdoor(e.target.value)}
            />
            <button
              onClick={() => {
                const n = appName.trim();
                const p = appPkg.trim();
                if (!n || !p) return;
                props.onAddApp(n, p);
                if (appBackdoor.trim()) {
                  props.onSetBackdoorOverride(p, appBackdoor);
                }
                setAppName("");
                setAppPkg("");
                setAppBackdoor("");
              }}
            >
              添加
            </button>
          </div>
          <ul className="manage-list">
            {props.effectiveApps.map((a, i) => {
              const last = props.effectiveApps.length - 1;
              const backdoor = backdoorOf(a.package);
              return (
                <li key={a.package} className="manage-item manage-app-item">
                  <div className="manage-app-main">
                    <span className="manage-name">{a.name}</span>
                    <span className="manage-pkg">{a.package}</span>
                    {isAdded(a.package) && (
                      <span className="manage-badge">手动</span>
                    )}
                    <button
                      className="manage-move"
                      disabled={i === 0}
                      title="置顶"
                      onClick={() => moveAppTo(i, 0)}
                    >
                      ⏫
                    </button>
                    <button
                      className="manage-move"
                      disabled={i === 0}
                      title="上移"
                      onClick={() => moveAppTo(i, i - 1)}
                    >
                      ↑
                    </button>
                    <button
                      className="manage-move"
                      disabled={i === last}
                      title="下移"
                      onClick={() => moveAppTo(i, i + 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="manage-move"
                      disabled={i === last}
                      title="置底"
                      onClick={() => moveAppTo(i, last)}
                    >
                      ⏬
                    </button>
                    <button
                      className="manage-del"
                      title="删除"
                      onClick={() => props.onRemoveApp(a.package)}
                    >
                      删除
                    </button>
                  </div>
                  <div className="manage-app-sub">
                    {editingBackdoor === a.package ? (
                      <input
                        className="manage-desc-input"
                        placeholder="后门 Activity"
                        value={editBackdoor}
                        autoFocus
                        onChange={(e) => setEditBackdoor(e.target.value)}
                        onBlur={saveBackdoor}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveBackdoor();
                          if (e.key === "Escape") setEditingBackdoor(null);
                        }}
                      />
                    ) : (
                      <>
                        <span className="manage-desc" title={backdoor}>
                          后门：{backdoor}
                        </span>
                        <button
                          className="manage-move"
                          title="编辑后门 Activity"
                          onClick={() => startEditBackdoor(a.package, backdoor)}
                        >
                          ✎
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tab === "search" && (
        <ListSection
          title="搜索"
          kind="search"
          favorites={props.prefs.searchFavorites}
          history={props.prefs.searchHistory}
          favValue={searchFav}
          setFavValue={setSearchFav}
          favDesc={searchDesc}
          setFavDesc={setSearchDesc}
          onAddFavorite={(v, d) => props.onAddFavorite("search", v, d)}
          onRemoveFavorite={(v) => props.onRemoveFavorite("search", v)}
          onUpdateDescription={(v, d) =>
            props.onUpdateFavoriteDescription("search", v, d)
          }
          onMoveFavorite={(from, to) => props.onMoveFavorite("search", from, to)}
          onRemoveHistory={(v) => props.onRemoveHistory("search", v)}
          onClearHistory={() => props.onClearHistory("search")}
        />
      )}

      {tab === "tags" && (
        <ListSection
          title="Tag"
          kind="tags"
          favorites={props.prefs.tagFavorites}
          history={props.prefs.tagHistory}
          favValue={tagFav}
          setFavValue={setTagFav}
          favDesc={tagDesc}
          setFavDesc={setTagDesc}
          onAddFavorite={(v, d) => props.onAddFavorite("tags", v, d)}
          onRemoveFavorite={(v) => props.onRemoveFavorite("tags", v)}
          onUpdateDescription={(v, d) =>
            props.onUpdateFavoriteDescription("tags", v, d)
          }
          onMoveFavorite={(from, to) => props.onMoveFavorite("tags", from, to)}
          onRemoveHistory={(v) => props.onRemoveHistory("tags", v)}
          onClearHistory={() => props.onClearHistory("tags")}
        />
      )}

      {tab === "testcases" && (
        <TestCaseManager store={props.testCaseStore} apps={props.effectiveApps} />
      )}

      {tab === "filters" && (
        <FilterManager
          savedFilters={props.savedFilters}
          apps={props.effectiveApps}
          onSave={props.onSaveFilter}
          onRename={props.onRenameFilter}
          onUpdate={props.onUpdateFilter}
          onDelete={props.onDeleteFilter}
          onMove={props.onMoveFilter}
        />
      )}
    </div>
  );
}

interface ListSectionProps {
  title: string;
  kind: ListKind;
  favorites: Favorite[];
  history: string[];
  favValue: string;
  setFavValue: (v: string) => void;
  favDesc: string;
  setFavDesc: (v: string) => void;
  onAddFavorite: (value: string, description: string) => void;
  onRemoveFavorite: (value: string) => void;
  onUpdateDescription: (value: string, description: string) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  onRemoveHistory: (value: string) => void;
  onClearHistory: () => void;
}

function ListSection(p: ListSectionProps) {
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");

  const startEdit = (f: Favorite) => {
    setEditingValue(f.value);
    setEditDesc(f.description);
  };

  const saveEdit = () => {
    if (editingValue) p.onUpdateDescription(editingValue, editDesc);
    setEditingValue(null);
  };

  return (
    <section className="manage-section">
      <h2>常用{p.title}</h2>
      <div className="manage-add">
        <input
          placeholder={`常用${p.title}内容`}
          value={p.favValue}
          onChange={(e) => p.setFavValue(e.target.value)}
        />
        <input
          placeholder="描述（悬停提示，可选）"
          value={p.favDesc}
          onChange={(e) => p.setFavDesc(e.target.value)}
        />
        <button
          onClick={() => {
            const v = p.favValue.trim();
            if (!v) return;
            p.onAddFavorite(v, p.favDesc);
            p.setFavValue("");
            p.setFavDesc("");
          }}
        >
          添加
        </button>
      </div>
      <ul className="manage-list">
        {p.favorites.map((f, i) => {
          const last = p.favorites.length - 1;
          const editing = editingValue === f.value;
          return (
            <li key={f.value} className="manage-item">
              <span className="manage-name" title={f.description || f.value}>
                {f.value}
              </span>
              {editing ? (
                <input
                  className="manage-desc-input"
                  placeholder="描述"
                  value={editDesc}
                  autoFocus
                  onChange={(e) => setEditDesc(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") setEditingValue(null);
                  }}
                />
              ) : (
                <>
                  {f.description && (
                    <span className="manage-desc" title={f.description}>
                      {f.description}
                    </span>
                  )}
                  <button
                    className="manage-move"
                    title="编辑描述"
                    onClick={() => startEdit(f)}
                  >
                    ✎
                  </button>
                </>
              )}
              <button
                className="manage-move"
                disabled={i === 0}
                title="置顶"
                onClick={() => p.onMoveFavorite(i, 0)}
              >
                ⏫
              </button>
              <button
                className="manage-move"
                disabled={i === 0}
                title="上移"
                onClick={() => p.onMoveFavorite(i, i - 1)}
              >
                ↑
              </button>
              <button
                className="manage-move"
                disabled={i === last}
                title="下移"
                onClick={() => p.onMoveFavorite(i, i + 1)}
              >
                ↓
              </button>
              <button
                className="manage-move"
                disabled={i === last}
                title="置底"
                onClick={() => p.onMoveFavorite(i, last)}
              >
                ⏬
              </button>
              <button className="manage-del" onClick={() => p.onRemoveFavorite(f.value)}>
                删除
              </button>
            </li>
          );
        })}
      </ul>

      <h2>{p.title}历史</h2>
      <div className="manage-list-head">
        <span className="count">{p.history.length} 条</span>
        <button onClick={p.onClearHistory} disabled={p.history.length === 0}>
          清空历史
        </button>
      </div>
      <ul className="manage-list">
        {p.history.map((h) => (
          <li key={h} className="manage-item">
            <span className="manage-name">{h}</span>
            <button className="manage-del" onClick={() => p.onRemoveHistory(h)}>
              删除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
