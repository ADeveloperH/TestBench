import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useLogcat } from "./features/logcat/useLogcat";
import { usePrefs } from "./features/settings/usePrefs";
import { useSavedFilters } from "./features/filters/useSavedFilters";
import { useTestCasesStore } from "./features/testcases/useTestCasesStore";
import {
  buildExportConfig,
  mergeConfig,
  parseImportConfig,
} from "./features/settings/config";
import { HistoryInput } from "./components/HistoryInput";
import { LogList } from "./features/logcat/LogList";
import { ManagePage, type ManageTab } from "./features/settings/ManagePage";
import { TestCaseSidebar } from "./features/testcases/TestCaseSidebar";
import { ToolsPage } from "./features/tools/ToolsPage";
import { WifiPanel } from "./features/devices/WifiPanel";
import { BUILTIN_APPS, DEFAULT_BACKDOOR, loadApps } from "./core/apps";
import type { AppInfo } from "./core/apps";
import { BUFFERS, LEVELS, LEVEL_LABELS } from "./core/types";
import type { DeviceInfo, LogLevel, ScrollCommand } from "./core/types";
import "./App.css";

export default function App() {
  const prefs = usePrefs();

  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    refreshDevices,
    buffer,
    setBuffer,
    running,
    paused,
    setPaused,
    start,
    stop,
    clear,
    exportLogs,
    entries,
    allEntries,
    filters,
    setFilters,
    error,
    setError,
  } = useLogcat(prefs.prefs.mergeStack);

  const [view, setView] = useState<"log" | "manage" | "tools">("log");
  const [showWifi, setShowWifi] = useState(false);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCases, setShowCases] = useState(false);
  const [manageTab, setManageTab] = useState<ManageTab>("apps");
  const testCaseStore = useTestCasesStore();
  const {
    savedFilters,
    saveFilter,
    deleteFilter,
    renameFilter,
    updateFilter,
    moveFilter,
    replaceFilters,
  } = useSavedFilters();
  const [activeFilterId, setActiveFilterId] = useState("");
  const [filterName, setFilterName] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [savedTip, setSavedTip] = useState("");

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;
  const [scrollCommand, setScrollCommand] = useState<ScrollCommand | null>(null);
  const prevFiltersRef = useRef(filters);

  // 过滤条件变化时，定位到选中的日志，方便查看上下文。
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.tags !== filters.tags ||
      prev.search !== filters.search ||
      prev.pid !== filters.pid ||
      prev.minLevel !== filters.minLevel;
    prevFiltersRef.current = filters;
    if (changed && selectedId != null && entries.some((e) => e.id === selectedId)) {
      setScrollCommand({ seq: Date.now(), kind: "id", id: selectedId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // 生效应用 = 手动添加（优先）∪ 内置/远程（排除已删除的），按名称排序。
  const effectiveApps = useMemo(() => {
    const map = new Map<string, AppInfo>();
    for (const a of prefs.prefs.addedApps) map.set(a.package, a);
    for (const a of apps) {
      if (!map.has(a.package) && !prefs.prefs.removedPackages.includes(a.package)) {
        map.set(a.package, a);
      }
    }
    const orderIndex = new Map(
      prefs.prefs.appOrder.map((pkg, i) => [pkg, i]),
    );
    return [...map.values()].sort((a, b) => {
      const ai = orderIndex.get(a.package);
      const bi = orderIndex.get(b.package);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.name.localeCompare(b.name, "zh");
    });
  }, [
    apps,
    prefs.prefs.addedApps,
    prefs.prefs.removedPackages,
    prefs.prefs.appOrder,
  ]);

  const loadAppsList = async () => {
    try {
      setApps(await loadApps());
    } catch (e) {
      setError(String(e));
      setApps(BUILTIN_APPS);
    }
  };

  const applyAppFilter = async (pkg: string) => {
    if (!pkg) {
      setFilters((f) => ({ ...f, pid: "", app: "" }));
      return;
    }
    try {
      const pids = await invoke<string[]>("resolve_pids", {
        device: selectedDevice,
        package: pkg,
      });
      if (pids.length === 0) {
        setError(`应用「${pkg}」当前未运行`);
        setFilters((f) => ({ ...f, pid: "", app: "" }));
      } else {
        setError(null);
        setFilters((f) => ({ ...f, pid: pids.join(","), app: pkg }));
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAppChange = (pkg: string) => {
    setSelectedPackage(pkg);
    applyAppFilter(pkg);
  };

  const handleRefreshApps = async () => {
    await loadAppsList();
    if (selectedPackage) await applyAppFilter(selectedPackage);
  };

  const getBackdoor = (pkg: string) =>
    prefs.prefs.backdoorOverrides[pkg] ?? DEFAULT_BACKDOOR;

  const handleOpenBackdoor = async (pkg: string) => {
    const out = await invoke<string>("open_backdoor", {
      device: selectedDevice,
      package: pkg,
      activity: getBackdoor(pkg),
    });
    return `后门已打开：${out}`;
  };

  const handleRestartApp = async (pkg: string) => {
    await invoke("restart_app", { device: selectedDevice, package: pkg });
    return "应用已重启";
  };

  const handleClearData = async (pkg: string) => {
    const out = await invoke<string>("clear_app_data", {
      device: selectedDevice,
      package: pkg,
    });
    return `清除结果：${out}`;
  };

  const handleUninstall = async (pkg: string) => {
    const out = await invoke<string>("uninstall_app", {
      device: selectedDevice,
      package: pkg,
    });
    return `卸载结果：${out}`;
  };

  const handleScreenshot = async () => {
    const path = await invoke<string | null>("screenshot", {
      device: selectedDevice,
    });
    if (!path) return "已取消截图";
    return `截图已保存：${path}`;
  };

  const handleInstallApk = async () => {
    const path = await invoke<string | null>("pick_apk");
    if (!path) return "已取消选择 APK";
    const out = await invoke<string>("install_apk", {
      device: selectedDevice,
      path,
    });
    return `安装结果：${out}`;
  };

  const handleDeviceInfo = async () => {
    return await invoke<DeviceInfo>("device_info", { device: selectedDevice });
  };

  const handleCurrentActivity = async () => {
    return await invoke<string>("current_activity", { device: selectedDevice });
  };

  const handleStartRecording = async (mbps: number) => {
    return await invoke<string | null>("start_recording", {
      device: selectedDevice,
      mbps,
    });
  };

  const handleStopRecording = async () => {
    return await invoke<string>("stop_recording");
  };

  const handleMirror = async (mbps: number) => {
    await invoke("mirror", { device: selectedDevice, mbps });
    return "投屏已启动，请在 scrcpy 窗口中操作";
  };

  const handleAppAlarm = async (pkg: string) => {
    return await invoke<string>("app_alarm", {
      device: selectedDevice,
      package: pkg,
    });
  };

  const handleAppPerformance = async (pkg: string) => {
    return await invoke<string>("app_performance", {
      device: selectedDevice,
      package: pkg,
    });
  };

  // 挂载时加载应用清单。
  useEffect(() => {
    loadAppsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 设备切换时重新解析所选应用的 PID（PID 是设备相关的）。
  useEffect(() => {
    setFilters((f) => ({ ...f, pid: "" }));
    if (selectedPackage && selectedDevice) {
      applyAppFilter(selectedPackage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  const markCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copySelected = async () => {
    if (!selectedEntry) return;
    try {
      await writeText(selectedEntry.raw);
      markCopied();
    } catch (e) {
      setError(`复制失败：${String(e)}`);
    }
  };

  const copyAll = async () => {
    try {
      await writeText(entries.map((e) => e.raw).join("\n"));
      markCopied();
    } catch (e) {
      setError(`复制失败：${String(e)}`);
    }
  };

  // 选中某行后，Cmd/Ctrl+C 复制该行；不干扰手动框选文本的复制。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const sel = window.getSelection();
        if (selectedEntry && sel && sel.isCollapsed) {
          e.preventDefault();
          writeText(selectedEntry.raw).catch((err) => setError(String(err)));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEntry, setError]);

  const handleSelect = (id: number) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const locateEntry = (id: number) => {
    setSelectedId(id);
    setScrollCommand({ seq: Date.now(), kind: "id", id });
  };

  const jumpToTop = () => setScrollCommand({ seq: Date.now(), kind: "top" });
  const jumpToBottom = () =>
    setScrollCommand({ seq: Date.now(), kind: "bottom" });
  const jumpToIndex = () => {
    const n = parseInt(jumpInput, 10);
    if (!Number.isNaN(n) && n >= 1) {
      setScrollCommand({ seq: Date.now(), kind: "index", index: n - 1 });
    }
  };

  const handleSaveFilter = () => {
    const name = filterName.trim();
    if (!name) return;
    const id = saveFilter(name, filters);
    setActiveFilterId(id);
    setFilterName("");
    setSavedTip(`已保存「${name}」`);
    setTimeout(() => setSavedTip(""), 2000);
  };

  const handleApplyFilter = (id: string) => {
    setActiveFilterId(id);
    const f = savedFilters.find((x) => x.id === id);
    if (!f) return;
    // 用展开新对象，确保即使内容与当前相同也会触发重新过滤
    setFilters({ ...f.filters });
    if (f.filters.app) {
      setSelectedPackage(f.filters.app);
      applyAppFilter(f.filters.app);
    } else {
      setSelectedPackage("");
    }
    setSavedTip(`已应用「${f.name}」`);
    setTimeout(() => setSavedTip(""), 2000);
  };

  const handleDeleteFilter = () => {
    if (!activeFilterId) return;
    deleteFilter(activeFilterId);
    setActiveFilterId("");
  };

  const handleExportConfig = async () => {
    try {
      const config = buildExportConfig(
        prefs.prefs,
        testCaseStore.cases,
        savedFilters,
      );
      const json = JSON.stringify(config, null, 2);
      const path = await invoke<string | null>("export_config", { text: json });
      return path ? `配置已导出：${path}` : "已取消导出";
    } catch (e) {
      return `导出失败：${String(e)}`;
    }
  };

  const handleImportConfig = async () => {
    try {
      const json = await invoke<string | null>("import_config");
      if (!json) return "已取消导入";
      const imported = parseImportConfig(json);
      const local = buildExportConfig(
        prefs.prefs,
        testCaseStore.cases,
        savedFilters,
      );
      const merged = mergeConfig(local, imported);
      prefs.replacePrefs(merged.prefs);
      testCaseStore.replaceCases(merged.testCases);
      replaceFilters(merged.savedFilters);
      return `已导入并合并（测试用例 ${merged.testCases.length} 条、过滤器 ${merged.savedFilters.length} 个）`;
    } catch (e) {
      return `导入失败：${String(e)}`;
    }
  };

  if (view === "manage") {
    return (
      <ManagePage
        prefs={prefs.prefs}
        effectiveApps={effectiveApps}
        testCaseStore={testCaseStore}
        initialTab={manageTab}
        onAddApp={(name, pkg) => prefs.addApp({ name, package: pkg })}
        onRemoveApp={(pkg) => prefs.removeApp(pkg)}
        onAddFavorite={(kind, v, d) => prefs.addFavorite(kind, v, d)}
        onRemoveFavorite={(kind, v) => prefs.removeFavorite(kind, v)}
        onUpdateFavoriteDescription={(kind, v, d) =>
          prefs.updateFavoriteDescription(kind, v, d)
        }
        onRemoveHistory={(kind, v) => prefs.removeHistory(kind, v)}
        onClearHistory={(kind) => prefs.clearHistory(kind)}
        onSetAppOrder={(order) => prefs.setAppOrder(order)}
        onSetBackdoorOverride={(pkg, a) => prefs.setBackdoorOverride(pkg, a)}
        onMoveFavorite={(kind, from, to) => prefs.moveFavorite(kind, from, to)}
        savedFilters={savedFilters}
        onSaveFilter={saveFilter}
        onRenameFilter={renameFilter}
        onUpdateFilter={updateFilter}
        onDeleteFilter={deleteFilter}
        onMoveFilter={moveFilter}
        onExportConfig={handleExportConfig}
        onImportConfig={handleImportConfig}
        onBack={() => setView("log")}
      />
    );
  }

  if (view === "tools") {
    return (
      <ToolsPage
        apps={effectiveApps}
        hasDevice={!!selectedDevice}
        onOpenBackdoor={handleOpenBackdoor}
        onRestartApp={handleRestartApp}
        onClearData={handleClearData}
        onUninstall={handleUninstall}
        onScreenshot={handleScreenshot}
        onInstallApk={handleInstallApk}
        onDeviceInfo={handleDeviceInfo}
        onCurrentActivity={handleCurrentActivity}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        onMirror={handleMirror}
        onAppAlarm={handleAppAlarm}
        onAppPerformance={handleAppPerformance}
        onBack={() => setView("log")}
      />
    );
  }

  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-row">
          <select
            value={selectedDevice ?? ""}
            onChange={(e) => setSelectedDevice(e.target.value)}
          >
            {devices.length === 0 && <option value="">无设备</option>}
            {devices.map((d) => (
              <option key={d.serial} value={d.serial}>
                {d.model || d.serial}（{d.transport === "wifi" ? "WiFi" : "USB"}）
              </option>
            ))}
          </select>
          <button onClick={refreshDevices} title="刷新设备列表">
            刷新
          </button>

          <label>缓冲区</label>
          <select value={buffer} onChange={(e) => setBuffer(e.target.value)}>
            {BUFFERS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>

          <label>级别</label>
          <select
            value={filters.minLevel}
            onChange={(e) =>
              setFilters({ ...filters, minLevel: e.target.value as LogLevel })
            }
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>

          {running ? (
            <button onClick={stop}>停止</button>
          ) : (
            <button onClick={start} disabled={!selectedDevice}>
              开始
            </button>
          )}

          <button
            className={paused ? "active" : ""}
            onClick={() => setPaused(!paused)}
            disabled={!running}
          >
            {paused ? "继续" : "暂停"}
          </button>

          <button onClick={clear}>清空</button>
          <button onClick={exportLogs}>导出</button>
          <button onClick={copySelected} disabled={!selectedEntry}>
            复制所选
          </button>
          <button onClick={copyAll} disabled={entries.length === 0}>
            复制全部
          </button>
          {copied && <span className="count">已复制 ✓</span>}
          <button onClick={() => setShowWifi(!showWifi)}>WiFi 连接</button>
          <button onClick={() => setView("tools")}>工具</button>
          <button
            className={showCases ? "active" : ""}
            onClick={() => setShowCases(!showCases)}
          >
            测试用例
          </button>
          <button
            onClick={() => {
              setManageTab("apps");
              setView("manage");
            }}
          >
            设置
          </button>
        </div>

        <div className="toolbar-row">
          <HistoryInput
            value={filters.search}
            onChange={(v) => setFilters({ ...filters, search: v })}
            favorites={prefs.prefs.searchFavorites}
            history={prefs.prefs.searchHistory}
            onAddHistory={(v) => prefs.addHistory("search", v)}
            onPin={(v) => prefs.addFavorite("search", v)}
            onUnpin={(v) => prefs.removeFavorite("search", v)}
            onRemoveHistory={(v) => prefs.removeHistory("search", v)}
            placeholder="搜索（消息或 Tag）"
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.regex}
              onChange={(e) =>
                setFilters({ ...filters, regex: e.target.checked })
              }
            />
            正则
          </label>
          <label
            className="checkbox"
            title="把 Unity 等引擎逐行输出的堆栈帧合并回上一条日志"
          >
            <input
              type="checkbox"
              checked={prefs.prefs.mergeStack}
              onChange={(e) => prefs.setMergeStack(e.target.checked)}
            />
            合并堆栈
          </label>
          <HistoryInput
            value={filters.tags}
            onChange={(v) => setFilters({ ...filters, tags: v })}
            favorites={prefs.prefs.tagFavorites}
            history={prefs.prefs.tagHistory}
            onAddHistory={(v) => prefs.addHistory("tags", v)}
            onPin={(v) => prefs.addFavorite("tags", v)}
            onUnpin={(v) => prefs.removeFavorite("tags", v)}
            onRemoveHistory={(v) => prefs.removeHistory("tags", v)}
            placeholder="Tag 过滤（逗号分隔）"
          />
          <label>应用</label>
          <select
            value={selectedPackage}
            onChange={(e) => handleAppChange(e.target.value)}
          >
            <option value="">全部应用</option>
            {effectiveApps.map((a) => (
              <option key={a.package} value={a.package}>
                {a.name}（{a.package}）
              </option>
            ))}
          </select>
          <button onClick={handleRefreshApps} title="重新拉取应用清单并刷新">
            刷新
          </button>
        </div>

        <div className="toolbar-row">
          <label>过滤器</label>
          <select
            value={activeFilterId}
            onChange={(e) => handleApplyFilter(e.target.value)}
          >
            <option value="">（当前过滤）</option>
            {savedFilters.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <input
            className="filter-name"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="保存为过滤器（名称）"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveFilter();
            }}
          />
          <button onClick={handleSaveFilter} disabled={!filterName.trim()}>
            保存
          </button>
          <button onClick={handleDeleteFilter} disabled={!activeFilterId}>
            删除
          </button>
          {savedTip && <span className="count">{savedTip}</span>}

          <span className="toolbar-sep" />

          <button onClick={jumpToTop}>最早</button>
          <button onClick={jumpToBottom}>最新</button>
          <input
            className="jump-input"
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder="行号"
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpToIndex();
            }}
          />
          <button onClick={jumpToIndex}>跳转</button>
          <span className="count">共 {entries.length} 条</span>
        </div>

        {showWifi && <WifiPanel onChanged={refreshDevices} />}
      </div>

      <div className="log-main">
        <div className="log-left">
          <LogList
            entries={entries}
            selectedId={selectedId}
            onSelect={handleSelect}
            scrollCommand={scrollCommand}
          />
          {selectedEntry && (
            <div className="log-detail">
              <div className="log-detail-head">
                <span className="log-detail-title">日志详情</span>
                <button onClick={copySelected}>复制</button>
                <button onClick={() => setSelectedId(null)}>关闭</button>
              </div>
              <pre className="log-detail-body">{selectedEntry.raw}</pre>
            </div>
          )}
        </div>
        {showCases && (
          <TestCaseSidebar
            store={testCaseStore}
            allEntries={allEntries}
            scopePkg={selectedPackage}
            pidFilter={filters.pid}
            apps={effectiveApps}
            onLocate={locateEntry}
            onManage={() => {
              setManageTab("testcases");
              setView("manage");
            }}
            onClose={() => setShowCases(false)}
          />
        )}
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}
