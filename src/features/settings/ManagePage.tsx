import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DEFAULT_BACKDOOR, isBuiltinApp } from "../../core/apps";
import type { AppInfo } from "../../core/apps";
import {
  getBuiltinSearchValues,
  getBuiltinTagValues,
} from "../../core/builtinRegistry";
import {
  applyRemoteConfigDirect,
  buildRemoteConfigFromState,
  REMOTE_CONFIG_EDIT_URL,
  refreshRemoteConfig,
  validateRemoteConfig,
} from "../../core/remoteConfig";
import type { Favorite, ListKind, Prefs } from "./usePrefs";
import type { SavedFilter } from "../filters/useSavedFilters";
import type { TestCasesStore } from "../testcases/useTestCasesStore";
import type { FilterState } from "../../core/types";
import { FilterManager } from "../filters/FilterManager";
import { TestCaseManager } from "../testcases/TestCaseManager";

export type ManageTab =
  | "apps"
  | "search"
  | "tags"
  | "testcases"
  | "filters"
  | "help"
  | "publish";

/** 是否调试模式：仅开发构建（pnpm tauri dev）显示「发布配置」页。 */
const IS_DEBUG = import.meta.env.DEV;

/** 发布凭据（fine-grained PAT）的本地存储 key。 */
const PUBLISH_TOKEN_KEY = "remote-config-publish-token";

/** 检查更新命令的返回结构（与 Rust 端 check_update 对应）。 */
interface UpdateInfo {
  current: string;
  latest: string;
  has_update: boolean;
  name: string;
  url: string;
  notes: string;
  error: string | null;
}

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
  onExportConfig: () => Promise<string>;
  onImportConfig: () => Promise<string>;
  onExportDebugLog: () => Promise<string>;
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
  const [configMsg, setConfigMsg] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  // 发布配置页（仅调试模式）
  const [remoteJson, setRemoteJson] = useState("");
  const [publishMsg, setPublishMsg] = useState("");
  // 维护者凭据：fine-grained PAT，只保存在本机 localStorage（调试包不含凭据）
  const [publishToken, setPublishToken] = useState(
    () => localStorage.getItem(PUBLISH_TOKEN_KEY) ?? "",
  );
  const [tokenInput, setTokenInput] = useState("");
  const [showTokenInput, setShowTokenInput] = useState(!publishToken);
  const [publishBusy, setPublishBusy] = useState(false);

  const doExport = async () => {
    setConfigMsg(await props.onExportConfig());
  };

  const doImport = async () => {
    setConfigMsg(await props.onImportConfig());
  };

  const doExportDebug = async () => {
    setConfigMsg(await props.onExportDebugLog());
  };

  const doRefreshConfig = async () => {
    setConfigMsg("正在刷新远程配置…");
    const status = await refreshRemoteConfig(true);
    setConfigMsg(`内置配置：${status.detail}`);
  };

  const doCheckUpdate = async () => {
    setUpdateBusy(true);
    setUpdateInfo(null);
    try {
      setUpdateInfo(await invoke<UpdateInfo>("check_update"));
    } catch (e) {
      setUpdateInfo({
        current: "",
        latest: "",
        has_update: false,
        name: "",
        url: "",
        notes: "",
        error: String(e),
      });
    } finally {
      setUpdateBusy(false);
    }
  };

  const doOpenRelease = async () => {
    if (updateInfo?.url) {
      await invoke("open_in_browser", { url: updateInfo.url });
    }
  };

  const doGenerateRemoteJson = () => {
    const cfg = buildRemoteConfigFromState({
      apps: props.effectiveApps,
      searchFavorites: props.prefs.searchFavorites,
      tagFavorites: props.prefs.tagFavorites,
      filters: props.savedFilters,
      testCases: props.testCaseStore.cases,
    });
    setRemoteJson(JSON.stringify(cfg, null, 2));
    setPublishMsg("已根据当前生效配置生成 JSON");
  };

  const doValidateRemoteJson = () => {
    try {
      const data: unknown = JSON.parse(remoteJson);
      const cfg = validateRemoteConfig(data);
      setPublishMsg(
        `校验通过（schemaVersion ${cfg.schemaVersion}：应用 ${cfg.apps?.length ?? 0} 个、搜索常用 ${cfg.searchFavorites?.length ?? 0} 条、Tag 常用 ${cfg.tagFavorites?.length ?? 0} 条、过滤器 ${cfg.filters?.length ?? 0} 个、测试用例 ${cfg.testCases?.length ?? 0} 条）`,
      );
    } catch (e) {
      setPublishMsg(`校验失败：${String(e)}`);
    }
  };

  const doCopyRemoteJson = async () => {
    await writeText(remoteJson);
    setPublishMsg("已复制到剪贴板");
  };

  const doOpenEditor = async () => {
    await invoke("open_in_browser", { url: REMOTE_CONFIG_EDIT_URL });
    setPublishMsg("已打开 GitHub 网页编辑器，粘贴 JSON 并提交即可生效");
  };

  const doSaveToken = () => {
    const t = tokenInput.trim();
    if (!t) {
      setPublishMsg("请输入 Token");
      return;
    }
    localStorage.setItem(PUBLISH_TOKEN_KEY, t);
    setPublishToken(t);
    setTokenInput("");
    setShowTokenInput(false);
    setPublishMsg("凭据已保存（仅保存在本机）");
  };

  const doClearToken = () => {
    localStorage.removeItem(PUBLISH_TOKEN_KEY);
    setPublishToken("");
    setShowTokenInput(true);
    setPublishMsg("凭据已清除");
  };

  const doVerifyToken = async () => {
    const t = publishToken || tokenInput.trim();
    if (!t) {
      setPublishMsg("请先粘贴并保存 GitHub Token");
      return;
    }
    try {
      setPublishMsg(await invoke<string>("verify_publish_token", { token: t }));
    } catch (e) {
      setPublishMsg(`凭据检查：${String(e)}`);
    }
  };

  const doPublish = async () => {
    if (!remoteJson.trim()) {
      setPublishMsg("请先生成配置 JSON");
      return;
    }
    if (!publishToken) {
      setPublishMsg("请先粘贴并保存 GitHub Token");
      return;
    }
    // 发布前本地校验
    try {
      const cfg = validateRemoteConfig(JSON.parse(remoteJson));
      setPublishBusy(true);
      try {
        const commitUrl = await invoke<string>("publish_remote_config", {
          token: publishToken,
          content: remoteJson,
        });
        // 本地立即应用，无需等 raw 缓存刷新
        const status = applyRemoteConfigDirect(cfg);
        setPublishMsg(`已发布并生效：${status.detail}；提交：${commitUrl}`);
        await invoke("open_in_browser", { url: commitUrl });
      } finally {
        setPublishBusy(false);
      }
    } catch (e) {
      setPublishMsg(`发布失败：${String(e)}`);
    }
  };

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
    <div className="manage-page settings-page">
      <div className="manage-header">
        <button onClick={props.onBack}>← 返回</button>
        <h1>设置</h1>
        <div className="manage-header-actions">
          <button onClick={doExport}>导出配置</button>
          <button onClick={doImport}>导入配置</button>
          <button onClick={doExportDebug}>导出调试日志</button>
          <button onClick={doRefreshConfig} title="拉取最新的内置配置">
            刷新配置
          </button>
          <button onClick={doCheckUpdate} disabled={updateBusy}>
            {updateBusy ? "检查中…" : "检查更新"}
          </button>
          {updateInfo?.has_update && (
            <button onClick={doOpenRelease} title="在浏览器打开下载页">
              打开下载页
            </button>
          )}
          {configMsg && <span className="count">{configMsg}</span>}
        </div>
      </div>
      {(updateInfo?.has_update || updateInfo?.error) && (
        <div className="manage-update-banner">
          {updateInfo.has_update ? (
            <>
              发现新版本 <b>v{updateInfo.latest}</b>（当前 v{updateInfo.current}）
              ，点击「打开下载页」到 GitHub Releases 下载安装。
            </>
          ) : (
            <>检查更新失败：{updateInfo.error}</>
          )}
        </div>
      )}
      {updateInfo && !updateInfo.has_update && !updateInfo.error && (
        <div className="manage-update-banner">
          已是最新版本 v{updateInfo.current}。
        </div>
      )}

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
          className={tab === "filters" ? "active" : ""}
          onClick={() => setTab("filters")}
        >
          过滤器
        </button>
        <button
          className={tab === "testcases" ? "active" : ""}
          onClick={() => setTab("testcases")}
        >
          测试用例
        </button>
        <button
          className={tab === "help" ? "active" : ""}
          onClick={() => setTab("help")}
        >
          帮助
        </button>
        {IS_DEBUG && (
          <button
            className={tab === "publish" ? "active" : ""}
            onClick={() => setTab("publish")}
            title="仅调试模式可见：生成 remote-config.json 并发布到仓库"
          >
            发布配置
          </button>
        )}
      </div>

      <div className="manage-content">
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
                    {isBuiltinApp(a.package) && (
                      <span className="manage-badge">内置</span>
                    )}
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
                      disabled={isBuiltinApp(a.package)}
                      title={
                        isBuiltinApp(a.package)
                          ? "内置应用不可删除"
                          : "删除"
                      }
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
          builtinValues={getBuiltinSearchValues()}
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
          builtinValues={getBuiltinTagValues()}
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

      {tab === "help" && (
        <section className="manage-section">
          <h2>快捷键</h2>
          <ul className="manage-list">
            <li className="manage-item">
              <span className="manage-name">暂停 / 继续抓取</span>
              <span className="manage-pkg">空格</span>
            </li>
            <li className="manage-item">
              <span className="manage-name">复制所选日志</span>
              <span className="manage-pkg">⌘ / Ctrl + C</span>
            </li>
            <li className="manage-item">
              <span className="manage-name">清空日志</span>
              <span className="manage-pkg">⌘ / Ctrl + L</span>
            </li>
            <li className="manage-item">
              <span className="manage-name">导出日志</span>
              <span className="manage-pkg">⌘ / Ctrl + E</span>
            </li>
            <li className="manage-item">
              <span className="manage-name">展开 / 收起长日志</span>
              <span className="manage-pkg">双击日志行</span>
            </li>
          </ul>

          <h2>小技巧</h2>
          <ul className="manage-list">
            <li className="manage-item">
              <span className="manage-name">
                把 APK 文件拖进窗口，即可安装到当前设备
              </span>
            </li>
            <li className="manage-item">
              <span className="manage-name">
                关闭窗口会最小化到系统托盘、抓日志不中断；退出请用托盘菜单
              </span>
            </li>
            <li className="manage-item">
              <span className="manage-name">
                遇到问题点右上角「导出调试日志」，把报告发给维护者排查
              </span>
            </li>
          </ul>
        </section>
      )}

      {tab === "publish" && (
        <section className="manage-section">
          <h2>发布内置配置（仅调试模式）</h2>
          <p className="manage-desc">
            把当前界面上的配置（内置 + 本地）生成为 remote-config.json，
            一键提交到仓库后，所有用户下次启动自动更新，无需发版。
            JSON 各字段对应：apps=应用、searchFavorites=搜索常用、
            tagFavorites=Tag 常用、filters=过滤器、testCases=测试用例。
          </p>
          <div className="manage-add">
            <button onClick={doGenerateRemoteJson}>生成配置 JSON</button>
            <button onClick={doValidateRemoteJson}>校验</button>
            <button onClick={doCopyRemoteJson}>复制</button>
            <button
              onClick={doPublish}
              disabled={publishBusy || !publishToken || !remoteJson.trim()}
              title={
                !publishToken
                  ? "请先保存 GitHub Token"
                  : "提交到仓库（需要 Token 有本仓库 Contents 写权限）"
              }
            >
              {publishBusy ? "发布中…" : "发布到远程"}
            </button>
            <button onClick={doOpenEditor} title="打开 GitHub 网页编辑器手动修改">
              网页编辑器
            </button>
          </div>
          {publishMsg && <span className="count">{publishMsg}</span>}
          <div className="manage-token-row">
            {showTokenInput ? (
              <>
                <input
                  type="password"
                  className="manage-token-input"
                  placeholder="粘贴 fine-grained PAT（仅本机保存）"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                />
                <button onClick={doSaveToken}>保存凭据</button>
                <button onClick={doVerifyToken}>测试凭据</button>
              </>
            ) : (
              <>
                <span className="count">已配置发布凭据（仅本机保存）</span>
                <button onClick={doVerifyToken}>测试凭据</button>
                <button onClick={doClearToken}>清除凭据</button>
              </>
            )}
          </div>
          <p className="manage-desc">
            凭据为 GitHub fine-grained PAT：仅授权
            ADeveloperH/TestBench 一个仓库、Contents 读写权限即可；只保存在本机，
            调试包本身不含任何凭据。
          </p>
          <p className="count">
            当前生效配置：应用 {props.effectiveApps.length} · 搜索常用{" "}
            {props.prefs.searchFavorites.length} · Tag 常用{" "}
            {props.prefs.tagFavorites.length} · 过滤器 {props.savedFilters.length}{" "}
            · 测试用例 {props.testCaseStore.cases.length}
          </p>
          <textarea
            className="remote-config-editor"
            value={remoteJson}
            onChange={(e) => setRemoteJson(e.target.value)}
            spellCheck={false}
            placeholder="点「生成配置 JSON」或直接粘贴 remote-config.json 内容"
          />
        </section>
      )}
      </div>
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
  /** 内置常用的 value 集合：内置项不可删除/移动/编辑。 */
  builtinValues: Set<string>;
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
          const builtin = p.builtinValues.has(f.value);
          return (
            <li key={f.value} className="manage-item">
              <span className="manage-name" title={f.description || f.value}>
                {f.value}
              </span>
              {builtin && <span className="manage-badge">内置</span>}
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
                    disabled={builtin}
                    title={builtin ? "内置常用不可编辑" : "编辑描述"}
                    onClick={() => startEdit(f)}
                  >
                    ✎
                  </button>
                </>
              )}
              <button
                className="manage-move"
                disabled={i === 0 || builtin}
                title={builtin ? "内置常用不可移动" : "置顶"}
                onClick={() => p.onMoveFavorite(i, 0)}
              >
                ⏫
              </button>
              <button
                className="manage-move"
                disabled={i === 0 || builtin}
                title={builtin ? "内置常用不可移动" : "上移"}
                onClick={() => p.onMoveFavorite(i, i - 1)}
              >
                ↑
              </button>
              <button
                className="manage-move"
                disabled={i === last || builtin}
                title={builtin ? "内置常用不可移动" : "下移"}
                onClick={() => p.onMoveFavorite(i, i + 1)}
              >
                ↓
              </button>
              <button
                className="manage-move"
                disabled={i === last || builtin}
                title={builtin ? "内置常用不可移动" : "置底"}
                onClick={() => p.onMoveFavorite(i, last)}
              >
                ⏬
              </button>
              <button
                className="manage-del"
                disabled={builtin}
                title={builtin ? "内置常用不可删除" : "删除"}
                onClick={() => p.onRemoveFavorite(f.value)}
              >
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
