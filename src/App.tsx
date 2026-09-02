import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { info as logInfo } from "@tauri-apps/plugin-log";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { message } from "@tauri-apps/plugin-dialog";
import { notify } from "./core/notify";
import { appendDisplayEntry, filterLogEntries } from "./core/logcat";
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
import { Select } from "./components/Select";
import { LogList } from "./features/logcat/LogList";
import { LogTabs } from "./features/logcat/LogTabs";
import { useLogTabs } from "./features/logcat/useLogTabs";
import { ManagePage, type ManageTab } from "./features/settings/ManagePage";
import { TestCaseSidebar } from "./features/testcases/TestCaseSidebar";
import {
  ToolsPage,
  type AudioExportProgress,
  type AudioExportResult,
  type BugreportProgress,
  type BugreportResult,
} from "./features/tools/ToolsPage";
import { WifiPanel } from "./features/devices/WifiPanel";
import { DEFAULT_BACKDOOR } from "./core/apps";
import type { AppInfo } from "./core/apps";
import {
  getBuiltinApps,
  getBuiltinSearchValues,
  getBuiltinTagValues,
  subscribeBuiltins,
} from "./core/builtinRegistry";
import { refreshRemoteConfig } from "./core/remoteConfig";
import {
  isTagBlocked,
  type TagBlockMatch,
} from "./core/tagBlockRules";
import { IS_DEBUG } from "./core/debug";
import { getVersion } from "@tauri-apps/api/app";
import {
  checkForUpdate,
  installUpdate,
  type AppUpdateInfo,
  type UpdateProgress,
} from "./services/updater";

/** 调试模式下允许在日志页取消常用内置项（正式包受保护）。 */
const NO_PROTECTED_VALUES = new Set<string>();
import { LEVELS, LEVEL_LABELS } from "./core/types";
import type {
  DeviceInfo,
  LogEntry,
  LogLevel,
  ScrollCommand,
} from "./core/types";
import "./App.css";

// 日志详情面板高度：可拖动调整，持久化记住上次高度。
const DETAIL_HEIGHT_KEY = "log-detail-height-v1";
const DETAIL_MIN_HEIGHT = 80;
const DETAIL_MAX_HEIGHT = 600;
/** 普通日志 Tab 选择了未运行应用时，用一个不可能命中的 PID 保持空结果。 */
const NO_RUNNING_APP_PID = "__testbench_no_running_app__";

interface TagBlockDialogState {
  value: string;
  description: string;
  match: TagBlockMatch;
  group: string;
  enableGlobal: boolean;
}

function parseAppPackages(value?: string): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function appNotRunningMessage(packages: string[]): string {
  const target =
    packages.length === 1 ? packages[0] : `所选 ${packages.length} 个应用`;
  return `应用「${target}」当前未运行`;
}

function loadDetailHeight(): number {
  try {
    const v = Number(localStorage.getItem(DETAIL_HEIGHT_KEY));
    if (v >= DETAIL_MIN_HEIGHT && v <= DETAIL_MAX_HEIGHT) return v;
  } catch {
    // 忽略损坏的缓存
  }
  return 220;
}

type ToolbarIconName =
  | "play"
  | "stop"
  | "pause"
  | "trash"
  | "export"
  | "wifi"
  | "tools"
  | "tests"
  | "more"
  | "settings"
  | "bookmark"
  | "font"
  | "theme";

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  const paths: Record<ToolbarIconName, ReactNode> = {
    play: <path d="m9 7 7 5-7 5V7Z" />,
    stop: <rect x="8" y="8" width="8" height="8" rx="1" />,
    pause: <><path d="M9 7v10M15 7v10" /></>,
    trash: <><path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" /></>,
    export: <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
    wifi: <><path d="M3.5 9.5a12 12 0 0 1 17 0M6.8 12.8a7.4 7.4 0 0 1 10.4 0M10.1 16.1a2.7 2.7 0 0 1 3.8 0" /><circle cx="12" cy="19" r=".8" fill="currentColor" stroke="none" /></>,
    tools: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17a2 2 0 1 0 3 3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.2-2.2 2.6-2.6Z" /></>,
    tests: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m9 11 2 2 4-4M9 16h6" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.1 2.1-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.1h-3v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-2.1-2.1.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1h-.1v-3h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.1-2.1.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.1h3v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 2.1 2.1-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1v3h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
    bookmark: <><path d="M7 4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V21l-5-3-5 3V4.5Z" /><path d="M12 7v6M9 10h6" /></>,
    font: <><path d="M5 19 10 5h4l5 14M7 14h10" /></>,
    theme: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  };
  return <svg className="toolbar-icon" viewBox="0 0 24 24" {...common}>{paths[name]}</svg>;
}

export default function App() {
  const prefs = usePrefs();
  const logTabs = useLogTabs();
  const activeTabIdRef = useRef(logTabs.activeTabId);
  activeTabIdRef.current = logTabs.activeTabId;

  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    refreshDevices,
    running,
    start,
    stop,
    exportLogs,
    entries,
    allEntries,
    filters,
    setFilters,
    error,
    setError,
    waiting,
  } = useLogcat(logTabs.activeTab.filters);

  const [view, setView] = useState<"log" | "manage" | "tools">("log");
  const [bugreportProgress, setBugreportProgress] = useState<BugreportProgress | null>(null);
  const [bugreportStatus, setBugreportStatus] = useState("");
  const [audioExportProgress, setAudioExportProgress] = useState<AudioExportProgress | null>(null);
  const [audioExportStatus, setAudioExportStatus] = useState("");
  const [audioExportAvailable, setAudioExportAvailable] = useState(false);
  const [showWifi, setShowWifi] = useState(false);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [selectedPackage, setSelectedPackage] = useState(
    logTabs.activeTab.filters.app ?? "",
  );
  const [selectedId, setSelectedId] = useState<number | null>(
    logTabs.activeTab.selectedLogId,
  );
  const [detailHeight, setDetailHeight] = useState<number>(loadDetailHeight);
  const [showCases, setShowCases] = useState(logTabs.activeTab.showTestCases);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showFilterSave, setShowFilterSave] = useState(false);
  const [showBlockedTags, setShowBlockedTags] = useState(false);
  const [tagBlockDialog, setTagBlockDialog] =
    useState<TagBlockDialogState | null>(null);
  const [showTestTabCreate, setShowTestTabCreate] = useState(false);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [testTabPackage, setTestTabPackage] = useState("");
  const [testTabName, setTestTabName] = useState("");
  const [manageTab, setManageTab] = useState<ManageTab>("apps");
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowBlockedTags(false);
  }, [logTabs.activeTabId, prefs.prefs.tagBlockingEnabled]);

  // Bugreport 属于设备级后台任务，状态必须跨页面保留；否则返回日志页后
  // 再进入工具页会丢失进度，看起来像任务已经停止。
  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    listen<BugreportProgress>("bugreport-progress", (event) => {
      setBugreportProgress(event.payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    invoke<boolean>("audio_export_available")
      .then((available) => {
        if (!disposed) setAudioExportAvailable(available);
      })
      .catch(() => {
        if (!disposed) setAudioExportAvailable(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    listen<AudioExportProgress>("audio-export-progress", (event) => {
      if (!disposed) setAudioExportProgress(event.payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  // 「更多」菜单：点击外部或按 Esc 关闭（与 Select/HistoryInput 行为一致）。
  useEffect(() => {
    if (!showMoreActions) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreActions(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMoreActions(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [showMoreActions]);
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
  const [activeFilterId, setActiveFilterId] = useState(
    logTabs.activeTab.activeFilterId,
  );
  const [filterName, setFilterName] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [toastBusy, setToastBusy] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  // —— 应用更新（Tauri updater） ——
  type UpdateStatus =
    | "idle"
    | "checking"
    | "uptodate"
    | "available"
    | "downloading"
    | "installing"
    | "error";
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(
    null,
  );
  const [updateError, setUpdateError] = useState<string>("");
  const [currentVersion, setCurrentVersion] = useState("");

  const closeUpdateDialog = () => {
    // 下载/安装中不允许关闭（避免中断更新流程）
    if (updateStatus === "downloading" || updateStatus === "installing") return;
    setUpdateStatus("idle");
  };

  const runUpdateCheck = async (silent: boolean) => {
    if (updateStatus === "checking") {
      logInfo("[Updater] 已有检查在进行中，忽略本次").catch(() => {});
      return;
    }
    logInfo(`[Updater] 开始检查（${silent ? "自动" : "手动"}）`).catch(() => {});
    if (silent) {
      // 后台自动检查：失败只记日志，不打扰用户
      try {
        const info = await checkForUpdate();
        if (info) {
          setUpdateInfo(info);
          setUpdateStatus("available");
        }
      } catch (e) {
        logInfo(`[Updater] auto check failed: ${String(e)}`).catch(() => {});
      }
      return;
    }
    // 手动检查：全程有明确反馈
    setUpdateError("");
    setUpdateStatus("checking");
    try {
      const info = await checkForUpdate();
      setUpdateInfo(info);
      if (info) {
        setUpdateStatus("available");
      } else {
        try {
          setCurrentVersion(await getVersion());
        } catch {
          // 拿不到版本号也照常显示「已是最新」
        }
        setUpdateStatus("uptodate");
      }
    } catch (e) {
      setUpdateError("无法连接更新服务器，请稍后重试。");
      setUpdateStatus("error");
      logInfo(`[Updater] manual check failed: ${String(e)}`).catch(() => {});
    }
  };

  const runUpdateInstall = async () => {
    if (!updateInfo) return;
    setUpdateStatus("downloading");
    setUpdateProgress({ downloaded: 0, percent: 0 });
    try {
      // 先手动停止 logcat：置 manualStopRef，避免 cleanup_for_update 杀掉 adb 后
      // 又被 useLogcat 的「非手动停止自动重连」逻辑把 adb 拉起来锁住 AdbWinApi.dll。
      await stop();
      await installUpdate(updateInfo.update, (p) => setUpdateProgress(p));
      setUpdateStatus("installing");
      // relaunch 成功后进程会退出，这里的状态不会再被用户看到
    } catch (e) {
      setUpdateError("更新未完成，请稍后重试。");
      setUpdateStatus("error");
      logInfo(`[Updater] install failed: ${String(e)}`).catch(() => {});
    }
  };

  // 启动后延迟 4 秒自动检查更新（开发模式不检查；失败静默，不阻断主程序）
  useEffect(() => {
    if (IS_DEBUG) return;
    const timer = window.setTimeout(() => {
      runUpdateCheck(true);
    }, 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 底部绿色 toast 提示（4 秒自动消失；sticky=true 时持续显示直到下一次提示）。 */
  const showToast = (msg: string, sticky = false) => {
    logInfo(`显示提示：${msg}${sticky ? "（持续）" : ""}`).catch(() => {});
    setToast(msg);
    setToastBusy(sticky);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    if (!sticky) {
      toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
    }
  };

  // 当前 Tab 只保存视图状态；所有 Tab 共享同一份原始日志缓冲，避免重复占用内存。
  const activeTabPausedAtId = logTabs.activeTab.pausedAtId;
  const activeTabClearedBeforeId = logTabs.activeTab.clearedBeforeId;
  const activeTestStartedAtId = logTabs.activeTab.testStartedAtId;
  const activeTestPidHistory = logTabs.activeTab.pidHistory;
  const isTestTab = logTabs.activeTab.kind === "test";

  const testSessionEntries = useMemo(() => {
    if (!isTestTab) return [];
    const pidSet = new Set(activeTestPidHistory);
    const floor = Math.max(activeTabClearedBeforeId, activeTestStartedAtId);
    if (pidSet.size === 0) return [];
    return allEntries.filter(
      (entry) => entry.id > floor && pidSet.has(entry.pid),
    );
  }, [
    allEntries,
    isTestTab,
    activeTestPidHistory,
    activeTabClearedBeforeId,
    activeTestStartedAtId,
  ]);

  // 先应用当前 Tab 的清空/暂停边界，再做展示合并。这样在用户清空日志或
  // 启动测试监控的边界上，新的堆栈续行不会被合并进已经隐藏的旧记录。
  const tabProjection = useMemo(() => {
    const source = isTestTab ? testSessionEntries : entries;
    const display: LogEntry[] = [];
    for (const entry of source) {
      if (
        entry.id <= activeTabClearedBeforeId ||
        (activeTabPausedAtId != null && entry.id > activeTabPausedAtId)
      ) {
        continue;
      }
      appendDisplayEntry(display, entry, prefs.prefs.mergeStack);
    }
    if (isTestTab) return { entries: display, blockedCount: 0 };

    const filtered = filterLogEntries(display, filters);
    if (!prefs.prefs.tagBlockingEnabled) {
      return { entries: filtered, blockedCount: 0 };
    }
    const blockedCount = filtered.reduce(
      (count, entry) =>
        count + (isTagBlocked(entry.tag, prefs.tagBlockRules) ? 1 : 0),
      0,
    );
    return {
      entries: showBlockedTags
        ? filtered
        : filtered.filter(
            (entry) => !isTagBlocked(entry.tag, prefs.tagBlockRules),
          ),
      blockedCount,
    };
  }, [
    entries,
    testSessionEntries,
    isTestTab,
    activeTabClearedBeforeId,
    activeTabPausedAtId,
    prefs.prefs.mergeStack,
    prefs.prefs.tagBlockingEnabled,
    prefs.tagBlockRules,
    showBlockedTags,
    filters,
  ]);
  const tabEntries = tabProjection.entries;
  const blockedTagCount = tabProjection.blockedCount;

  const tabAllEntries = useMemo(() => {
    if (isTestTab) return testSessionEntries;
    return allEntries.filter(
      (entry) =>
        entry.id > activeTabClearedBeforeId &&
        (activeTabPausedAtId == null || entry.id <= activeTabPausedAtId),
    );
  }, [
    allEntries,
    testSessionEntries,
    isTestTab,
    activeTabClearedBeforeId,
    activeTabPausedAtId,
  ]);

  const selectedEntry = tabEntries.find((e) => e.id === selectedId) ?? null;
  const duplicateTagBlockRule = tagBlockDialog
    ? prefs.tagBlockRules.find(
        (rule) =>
          rule.match === tagBlockDialog.match &&
          rule.value.trim().toLowerCase() ===
            tagBlockDialog.value.trim().toLowerCase(),
      )
    : undefined;
  const [scrollCommand, setScrollCommand] = useState<ScrollCommand | null>(null);
  const prevFiltersRef = useRef(filters);

  // 持续把当前日志处理条件和界面状态写回当前 Tab。
  useEffect(() => {
    logTabs.updateActiveTab({ filters: { ...filters, pid: "" } });
  }, [filters, logTabs.updateActiveTab]);

  useEffect(() => {
    logTabs.updateActiveTab({
      activeFilterId,
      selectedLogId: selectedId,
      showTestCases: showCases,
    });
  }, [activeFilterId, selectedId, showCases, logTabs.updateActiveTab]);

  // 过滤条件变化时，定位到选中的日志，方便查看上下文。
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.tags !== filters.tags ||
      prev.search !== filters.search ||
      prev.pid !== filters.pid ||
      prev.minLevel !== filters.minLevel;
    prevFiltersRef.current = filters;
    if (changed && selectedId != null && tabEntries.some((e) => e.id === selectedId)) {
      setScrollCommand({ seq: Date.now(), kind: "id", id: selectedId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, selectedId, tabEntries]);

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

  const loadAppsList = () => {
    setApps(getBuiltinApps());
  };

  // —— 应用运行状态（运行中 / 已安装未运行 / 未安装），每 3 秒轮询 ——
  const [appRuntime, setAppRuntime] = useState<{
    installed: string[];
    running: string[];
  } | null>(null);

  const installedSet = useMemo(
    () => new Set(appRuntime?.installed ?? []),
    [appRuntime],
  );
  const runningSet = useMemo(() => {
    // 进程名可能带 :xxx 服务后缀，归一化成主包名
    const s = new Set<string>();
    for (const p of appRuntime?.running ?? []) {
      const i = p.indexOf(":");
      s.add(i > 0 ? p.slice(0, i) : p);
    }
    return s;
  }, [appRuntime]);

  const appRunState = (
    pkg: string,
  ): "running" | "installed" | "missing" | "unknown" => {
    // 尚未取到设备状态时返回 unknown（不显示状态点，避免首次闪烁误导）
    if (!appRuntime) return "unknown";
    if (runningSet.has(pkg)) return "running";
    if (installedSet.has(pkg)) return "installed";
    return "missing";
  };

  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (disposed || polling) return;
      if (!selectedDevice) {
        if (!disposed) setAppRuntime(null);
        return;
      }
      polling = true;
      try {
        const status = await invoke<{ installed: string[]; running: string[] }>(
          "app_runtime_status",
          { device: selectedDevice },
        );
        if (!disposed) setAppRuntime(status);
      } catch {
        // 静默：瞬时失败保留上次结果，避免状态闪烁
      } finally {
        polling = false;
      }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [selectedDevice]);

  // 日志页应用下拉排序：运行中 → 已安装未运行 → 未安装，
  // 组内保持设置页排序（effectiveApps 已按 appOrder 排好）。
  const logPageApps = useMemo(() => {
    if (!appRuntime) return effectiveApps;
    const running: AppInfo[] = [];
    const installed: AppInfo[] = [];
    const missing: AppInfo[] = [];
    for (const a of effectiveApps) {
      if (runningSet.has(a.package)) running.push(a);
      else if (installedSet.has(a.package)) installed.push(a);
      else missing.push(a);
    }
    return [...running, ...installed, ...missing];
  }, [effectiveApps, appRuntime, runningSet, installedSet]);

  const clearAppNotRunningError = () => {
    setError((previous) =>
      previous?.startsWith("应用「") && previous.endsWith("当前未运行")
        ? null
        : previous,
    );
  };

  const applyAppFilter = async (
    appValue: string,
    targetTab = logTabs.activeTab,
  ) => {
    const targetIsActive = () => activeTabIdRef.current === targetTab.id;
    const packages = parseAppPackages(appValue);
    const normalizedValue = packages.join(",");
    if (packages.length === 0) {
      logTabs.updateTab(targetTab.id, {
        filters: { ...targetTab.filters, pid: "", app: "" },
      });
      if (targetIsActive()) {
        setFilters((f) => ({ ...f, pid: "", app: "" }));
      }
      // 切换到「全部应用」：清除残留的「应用未运行」提示
      clearAppNotRunningError();
      return;
    }
    try {
      const pidGroups = await Promise.all(
        packages.map((packageName) =>
          invoke<string[]>("resolve_pids", {
            device: selectedDevice,
            package: packageName,
          }),
        ),
      );
      const pids = [...new Set(pidGroups.flat())];
      const isTestTarget = targetTab.kind === "test";
      if (pids.length === 0) {
        if (targetIsActive()) setError(appNotRunningMessage(packages));
        const next = {
          ...targetTab.filters,
          pid: isTestTarget ? "" : NO_RUNNING_APP_PID,
          app: normalizedValue,
        };
        logTabs.updateTab(targetTab.id, { filters: { ...next, pid: "" } });
        if (targetIsActive()) setFilters(next);
      } else {
        if (isTestTarget) logTabs.addTabPids(targetTab.id, pids);
        if (targetIsActive()) {
          setError(null);
          setFilters((f) => ({
            ...f,
            pid: pids.join(","),
            app: normalizedValue,
          }));
        }
      }
    } catch (e) {
      if (targetIsActive()) setError(String(e));
    }
  };

  // 应用进程 PID 变化自动刷新：杀掉进程重开应用后 PID 会变，
  // 定期静默重解析，PID 变化即更新过滤，日志最多延迟几秒自动恢复。
  useEffect(() => {
    if (!selectedPackage || !selectedDevice) return;
    const packages = parseAppPackages(selectedPackage);
    const normalizedValue = packages.join(",");
    const tabId = logTabs.activeTabId;
    const isTestMonitor = logTabs.activeTab.kind === "test";
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const pidGroups = await Promise.all(
          packages.map((packageName) =>
            invoke<string[]>("resolve_pids", {
              device: selectedDevice,
              package: packageName,
            }),
          ),
        );
        const pids = [...new Set(pidGroups.flat())];
        const newPid = pids.join(",");
        if (isTestMonitor && pids.length > 0) {
          logTabs.addTabPids(tabId, pids);
        }
        // 轮询返回时 Tab 可能已经切换，旧 Tab 只能维护自己的 PID 历史，
        // 不能再覆盖当前页面的筛选和底部提示。
        if (activeTabIdRef.current !== tabId) return;
        if (newPid) {
          // 应用已运行 → 自动清除「应用未运行」提示（每 3 秒检测一次）
          clearAppNotRunningError();
        } else {
          setError(appNotRunningMessage(packages));
        }
        setFilters((f) => {
          const effectivePid = newPid || (isTestMonitor ? "" : NO_RUNNING_APP_PID);
          if (f.pid === effectivePid && f.app === normalizedValue) return f;
          // 测试 Tab 的完整应用日志由 pidHistory 计算；这里的 pid 只表达
          // 当前运行状态。应用停止时保持包名并等待新的 PID。
          return { ...f, pid: effectivePid, app: normalizedValue };
        });
      } catch {
        // 静默失败，下个周期再试
      } finally {
        polling = false;
      }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [
    selectedPackage,
    selectedDevice,
    logTabs.activeTabId,
    logTabs.activeTab.kind,
    logTabs.addTabPids,
    setFilters,
    setError,
  ]);

  // 错误横幅自动消失：除「应用未运行」外，其余错误最多显示 4 秒
  // （「应用未运行」由上面的 PID 轮询 / 切换应用时自然更新）。
  useEffect(() => {
    if (!error) return;
    if (error.startsWith("应用「") && error.endsWith("当前未运行")) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  const handleAppChange = (pkg: string) => {
    setSelectedPackage(pkg);
    applyAppFilter(pkg);
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
    showToast(`正在安装 APK：${path}`, true);
    try {
      const out = await invoke<string>("install_apk", {
        device: selectedDevice,
        path,
      });
      notify("APK 安装完成", out).catch(() => {});
      showToast("APK 安装完成");
      return `安装结果：${out}`;
    } catch (e) {
      setToast(null);
      throw e;
    }
  };

  const handleDeviceInfo = async () => {
    return await invoke<DeviceInfo>("device_info", { device: selectedDevice });
  };

  const handleCurrentActivity = async () => {
    return await invoke<string>("current_activity", { device: selectedDevice });
  };

  const handleExportUnityAudio = async (pkg: string) => {
    setAudioExportStatus("");
    setAudioExportProgress({
      stage: "source",
      message: "正在检查应用安装资源…",
      completed: 0,
      total: null,
      exported: null,
      warnings: 0,
    });
    try {
      const result = await invoke<AudioExportResult | null>("export_unity_audio", {
        device: selectedDevice,
        package: pkg,
      });
      if (!result) {
        setAudioExportStatus("已取消 Unity 音频导出");
        return null;
      }
      const summary = `Unity 音频导出完成：${result.audioExported} 个文件，${(
        result.exportedBytes / 1024 / 1024
      ).toFixed(1)} MB。清单：${result.manifestPath}`;
      setAudioExportStatus(summary);
      return result;
    } catch (error) {
      setAudioExportStatus("失败：" + String(error));
      throw error;
    } finally {
      setAudioExportProgress(null);
    }
  };

  const handleCancelUnityAudio = async () => {
    await invoke("cancel_unity_audio_export");
  };

  const handleExportBugreport = async () => {
    setBugreportStatus("");
    setBugreportProgress({
      stage: "generating",
      percent: null,
      message: "设备正在生成故障报告，可能需要几分钟…",
    });
    try {
      const result = await invoke<BugreportResult | null>("export_bugreport", {
        device: selectedDevice,
      });
      if (!result) {
        setBugreportStatus("已取消导出故障报告");
        setBugreportProgress(null);
        return;
      }
      const size = (result.sizeBytes / 1024 / 1024).toFixed(1);
      const summary = result.summaryPath
        ? `\n快速摘要：${result.summaryPath}\n识别到 ANR ${result.anrMatches} 条、Java Crash ${result.javaCrashMatches} 条、Native Crash ${result.nativeCrashMatches} 条线索。`
        : "";
      const warning = result.warning ? `\n提示：${result.warning}` : "";
      setBugreportStatus(
        `故障报告已保存（${size} MB）：${result.reportPath}${summary}${warning}`,
      );
      const summaryNotice = result.summaryPath
        ? `\n\n快速摘要：${result.summaryPath}\nANR ${result.anrMatches} 条，Java Crash ${result.javaCrashMatches} 条，Native Crash ${result.nativeCrashMatches} 条线索。`
        : "";
      void message(
        `故障报告已导出完成。\n\n完整报告：${result.reportPath}${summaryNotice}${warning}`,
        { title: "故障报告导出完成", kind: "info" },
      ).catch((error) => {
        logInfo(`显示故障报告完成提醒失败：${String(error)}`).catch(() => {});
      });
    } catch (error) {
      setBugreportProgress(null);
      setBugreportStatus("失败：" + String(error));
    }
  };

  const handleStartRecording = async (mbps: number) => {
    return await invoke<string | null>("start_recording", {
      device: selectedDevice,
      mbps,
    });
  };

  const handleStopRecording = async () => {
    const path = await invoke<string>("stop_recording");
    notify("录屏完成", `视频已保存：${path}`).catch(() => {});
    return path;
  };

  const handleMirror = async (mbps: number) => {
    // 记录投屏时的主机环境（分辨率/DPI），排查“点击坐标错位”类问题用
    logInfo(
      `启动投屏：device=${selectedDevice} mbps=${mbps} screen=${screen.width}x${screen.height} devicePixelRatio=${window.devicePixelRatio}`,
    ).catch(() => {});
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

  // 挂载时加载应用清单，并监听远程配置变化即时刷新；同时后台拉取远程配置。
  useEffect(() => {
    loadAppsList();
    const unsub = subscribeBuiltins(() => setApps(getBuiltinApps()));
    refreshRemoteConfig().then((status) => {
      logInfo(`远程内置配置：${status.detail}`).catch(() => {});
    });
    return unsub;
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

  // 每次开启一轮新的采集时日志 ID 会从头开始，清除各 Tab 基于旧 ID 的
  // 暂停/清空边界，避免新日志被旧边界永久隐藏。
  const previousRunningRef = useRef(running);
  useEffect(() => {
    if (running && !previousRunningRef.current) {
      logTabs.resetRuntimeState();
      setSelectedId(null);
    }
    previousRunningRef.current = running;
  }, [running, logTabs.resetRuntimeState]);

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

  // 关闭窗口 → 隐藏到托盘：由 Rust 侧 on_window_event 同步处理
  // （JS 异步回调在 Windows 上会死锁，见 src-tauri/src/lib.rs）。

  // 拖拽 APK 到窗口 → 直接安装到当前设备。
  useEffect(() => {
    const wv = getCurrentWebview();
    let disposed = false;
    let unlisten: (() => void) | null = null;
    wv
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        logInfo(`收到文件拖放：paths=${JSON.stringify(event.payload.paths)} device=${selectedDevice ?? "无"}`).catch(
          () => {},
        );
        const apk = event.payload.paths.find((p) =>
          p.toLowerCase().endsWith(".apk"),
        );
        if (!apk) {
          setError("拖放的文件不是 APK 安装包");
          return;
        }
        if (!selectedDevice) {
          setError("未连接设备，无法安装 APK（请先连接设备）");
          return;
        }
        showToast(`正在安装 APK：${apk}`, true);
        invoke<string>("install_apk", { device: selectedDevice, path: apk })
          .then((out) => {
            notify("APK 安装完成", out).catch((e) => {
              logInfo(`系统通知发送失败：${String(e)}`).catch(() => {});
            });
            showToast("APK 安装完成");
            setError(null);
          })
          .catch((e) => {
            setToast(null);
            setError(`安装失败：${String(e)}`);
          });
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [selectedDevice, setError]);

  const toggleCurrentTabPause = () => {
    if (logTabs.activeTab.pausedAtId != null) {
      logTabs.updateActiveTab({ pausedAtId: null });
      return;
    }
    const lastId = allEntries[allEntries.length - 1]?.id ?? -1;
    logTabs.updateActiveTab({ pausedAtId: lastId });
  };

  const clearCurrentTab = () => {
    const lastId = allEntries[allEntries.length - 1]?.id ?? -1;
    logTabs.updateActiveTab({
      clearedBeforeId: lastId,
      selectedLogId: null,
      followLatest: true,
    });
    setSelectedId(null);
  };

  const exportCurrentTab = () => exportLogs(tabEntries);

  // 快捷键：空格暂停当前 Tab，Cmd/Ctrl+L 清空当前 Tab，Cmd/Ctrl+E 导出当前 Tab。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.tagName === "BUTTON")
      ) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        if (running) toggleCurrentTabPause();
        return;
      }
      if (!e.metaKey && !e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "l") {
        e.preventDefault();
        clearCurrentTab();
      } else if (k === "e") {
        e.preventDefault();
        exportCurrentTab();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, logTabs.activeTab, allEntries, tabEntries, exportLogs]);

  const handleSelect = (id: number) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const locateEntry = (id: number) => {
    // 测试用例监控在后台持续运行；如果界面暂停后命中了更新的日志，
    // 点击证据时自动恢复当前测试 Tab，保证目标日志一定在列表中。
    if (
      logTabs.activeTab.kind === "test" &&
      logTabs.activeTab.pausedAtId != null &&
      id > logTabs.activeTab.pausedAtId
    ) {
      logTabs.updateActiveTab({ pausedAtId: null });
    }
    setSelectedId(id);
    setScrollCommand({ seq: Date.now(), kind: "id", id });
  };

  // 拖拽调整日志详情面板高度（顶部边缘手柄，向上拖 = 加高）。
  // 详情最多占日志区 50%，保证日志列表始终可见（不遮挡）。
  const logLeftRef = useRef<HTMLDivElement>(null);
  const detailDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onDetailResizeStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    detailDragRef.current = { startY: e.clientY, startH: detailHeight };
    let finalH = detailHeight;
    const maxByArea = Math.max(
      DETAIL_MIN_HEIGHT,
      Math.floor((logLeftRef.current?.clientHeight ?? 0) * 0.5),
    );
    const maxH = Math.min(DETAIL_MAX_HEIGHT, maxByArea);
    const onMove = (ev: MouseEvent) => {
      if (!detailDragRef.current) return;
      finalH = Math.min(
        maxH,
        Math.max(
          DETAIL_MIN_HEIGHT,
          detailDragRef.current.startH + (detailDragRef.current.startY - ev.clientY),
        ),
      );
      setDetailHeight(finalH);
    };
    const onUp = () => {
      detailDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("detail-resizing");
      try {
        localStorage.setItem(DETAIL_HEIGHT_KEY, String(finalH));
      } catch {
        // 忽略写入失败
      }
    };
    document.body.classList.add("detail-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleSaveFilter = () => {
    const name = filterName.trim();
    if (!name) return;
    const id = saveFilter(name, filters);
    setActiveFilterId(id);
    setFilterName("");
    showToast(`已保存筛选「${name}」`);
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
    showToast(`已应用筛选「${f.name}」`);
  };

  const showLogTab = (tab: (typeof logTabs.tabs)[number]) => {
    // 先同步切换异步结果归属并清掉上一个 Tab 的应用状态，避免旧的
    // 「应用未运行」提示在新 Tab（尤其是「全部应用」）中短暂或持续残留。
    activeTabIdRef.current = tab.id;
    clearAppNotRunningError();
    logTabs.selectTab(tab.id);
    setFilters({ ...tab.filters, pid: "" });
    setSelectedPackage(
      tab.kind === "test" ? tab.testPackage : (tab.filters.app ?? ""),
    );
    setSelectedId(tab.selectedLogId);
    setShowCases(tab.kind === "test" ? true : tab.showTestCases);
    setActiveFilterId(tab.activeFilterId);
    setShowFilterSave(false);
    const packageName = tab.kind === "test" ? tab.testPackage : tab.filters.app;
    if (packageName && selectedDevice) {
      applyAppFilter(packageName, tab);
    }
  };

  const handleSelectLogTab = (id: string) => {
    const tab = logTabs.tabs.find((item) => item.id === id);
    if (!tab || tab.id === logTabs.activeTabId) return;
    showLogTab(tab);
  };

  const handleCreateLogTab = () => {
    const tab = logTabs.createTab();
    showLogTab(tab);
  };

  const handleOpenTestTabCreate = () => {
    const firstPackage =
      parseAppPackages(selectedPackage)[0] || logPageApps[0]?.package || "";
    const appName = logPageApps.find((app) => app.package === firstPackage)?.name;
    setTestTabPackage(firstPackage);
    setTestTabName(appName ? `用例 · ${appName}` : "测试用例监控");
    setShowTestTabCreate(true);
  };

  const handleCreateTestTab = () => {
    if (!testTabPackage) return;
    const lastId = allEntries[allEntries.length - 1]?.id ?? -1;
    const appName = effectiveApps.find((app) => app.package === testTabPackage)?.name;
    const tab = logTabs.createTestTab(
      testTabPackage,
      testTabName.trim() || `用例 · ${appName ?? testTabPackage}`,
      lastId,
    );
    setShowTestTabCreate(false);
    showLogTab(tab);
  };

  const handleCloseLogTab = (id: string) => {
    if (logTabs.tabs.length <= 1) {
      setPendingCloseTabId(null);
      return;
    }
    const closingIndex = logTabs.tabs.findIndex((tab) => tab.id === id);
    const remaining = logTabs.tabs.filter((tab) => tab.id !== id);
    const next = id === logTabs.activeTabId
      ? remaining[Math.min(Math.max(0, closingIndex - 1), remaining.length - 1)]
      : null;
    logTabs.closeTab(id);
    if (next) showLogTab(next);
    setPendingCloseTabId(null);
  };

  const pendingCloseTab = pendingCloseTabId
    ? logTabs.tabs.find((tab) => tab.id === pendingCloseTabId) ?? null
    : null;

  const handleExportConfig = async () => {
    logInfo("[Export] export_config 调用前").catch(() => {});
    try {
      const config = buildExportConfig(
        prefs.prefs,
        testCaseStore.cases,
        savedFilters,
      );
      const json = JSON.stringify(config, null, 2);
      const path = await invoke<string | null>("export_config", { text: json });
      logInfo(`[Export] export_config 返回：${path ?? "已取消"}`).catch(() => {});
      return path ? `配置已导出：${path}` : "已取消导出";
    } catch (e) {
      logInfo(`[Export] export_config 失败：${String(e)}`).catch(() => {});
      return `导出失败：${String(e)}`;
    }
  };

  const handleImportConfig = async () => {
    logInfo("[Import] import_config 调用前").catch(() => {});
    try {
      const json = await invoke<string | null>("import_config");
      logInfo(`[Import] import_config 返回：${json == null ? "已取消" : "已选择文件"}`).catch(() => {});
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

  const handleExportDebugLog = async () => {
    logInfo("[Export] export_debug_log 调用前").catch(() => {});
    try {
      const path = await invoke<string | null>("export_debug_log");
      logInfo(`[Export] export_debug_log 返回：${path ?? "已取消"}`).catch(() => {});
      return path ? `调试日志已导出：${path}` : "已取消导出";
    } catch (e) {
      logInfo(`[Export] export_debug_log 失败：${String(e)}`).catch(() => {});
      return `导出失败：${String(e)}`;
    }
  };

  // 主题切换：挂在 body 上，让日志/设置/工具所有页面共享变量。
  useEffect(() => {
    document.body.classList.toggle("light", prefs.prefs.theme === "light");
  }, [prefs.prefs.theme]);

  const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const updateDialogPortal =
    updateStatus !== "idle"
      ? createPortal(
          <div
            className="save-description-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeUpdateDialog();
            }}
          >
            <div
              className="save-description-dialog update-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="应用更新"
            >
              {updateStatus === "checking" && (
                <>
                  <h3>正在检查更新…</h3>
                  <p className="count">正在连接更新服务器</p>
                  <div className="save-description-actions">
                    <button onClick={closeUpdateDialog}>取消</button>
                  </div>
                </>
              )}

              {updateStatus === "uptodate" && (
                <>
                  <h3>已经是最新版本</h3>
                  <p className="count">当前版本 v{currentVersion || "?"}</p>
                  <div className="save-description-actions">
                    <button onClick={closeUpdateDialog}>关闭</button>
                  </div>
                </>
              )}

              {updateStatus === "available" && updateInfo && (
                <>
                  <h3>发现新版本</h3>
                  <p className="count">
                    当前版本：v{updateInfo.currentVersion}
                    <br />
                    最新版本：v{updateInfo.version}
                  </p>
                  {updateInfo.notes && (
                    <div className="update-notes">{updateInfo.notes}</div>
                  )}
                  <div className="save-description-actions">
                    <button onClick={closeUpdateDialog}>稍后更新</button>
                    <button className="primary-action" onClick={runUpdateInstall}>
                      立即更新
                    </button>
                  </div>
                </>
              )}

              {updateStatus === "downloading" && (
                <>
                  <h3>正在下载更新</h3>
                  <div className="update-progress-track">
                    <div
                      className="update-progress-fill"
                      style={{
                        width: `${updateProgress?.percent ?? 0}%`,
                      }}
                    />
                  </div>
                  <p className="count">
                    {updateProgress?.percent ?? 0}%
                    {updateProgress?.total
                      ? `（${formatMB(updateProgress.downloaded)} / ${formatMB(updateProgress.total)}）`
                      : `（${formatMB(updateProgress?.downloaded ?? 0)} 已下载）`}
                  </p>
                </>
              )}

              {updateStatus === "installing" && (
                <>
                  <h3>正在安装更新…</h3>
                  <p className="count">安装完成后应用将自动重启</p>
                </>
              )}

              {updateStatus === "error" && (
                <>
                  <h3>更新失败</h3>
                  <p className="count">自动更新没有完成，请稍后重试。</p>
                  <p className="count">{updateError}</p>
                  <div className="save-description-actions">
                    <button onClick={closeUpdateDialog}>关闭</button>
                    <button
                      className="primary-action"
                      onClick={() => runUpdateCheck(false)}
                    >
                      重新检查
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  if (view === "manage") {
    return (
      <>
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
          tagBlockRules={prefs.tagBlockRules}
          onSetTagBlockingEnabled={prefs.setTagBlockingEnabled}
          onAddTagBlockRule={prefs.addTagBlockRule}
          onRemoveTagBlockRule={prefs.removeTagBlockRule}
          onSetTagBlockRuleEnabled={prefs.setTagBlockRuleEnabled}
          onSetTagBlockGroupEnabled={prefs.setTagBlockGroupEnabled}
          onSetAppOrder={(order) => prefs.setAppOrder(order)}
          onSetBackdoorOverride={(pkg, a) => prefs.setBackdoorOverride(pkg, a)}
          onMoveFavorite={(kind, from, to) =>
            prefs.moveFavorite(kind, from, to)
          }
          savedFilters={savedFilters}
          onSaveFilter={saveFilter}
          onRenameFilter={renameFilter}
          onUpdateFilter={updateFilter}
          onDeleteFilter={deleteFilter}
          onMoveFilter={moveFilter}
          onExportConfig={handleExportConfig}
          onImportConfig={handleImportConfig}
          onExportDebugLog={handleExportDebugLog}
          onCheckUpdate={() => runUpdateCheck(false)}
          onBack={() => setView("log")}
        />
        {updateDialogPortal}
      </>
    );
  }

  if (view === "tools") {
    return (
      <>
        <ToolsPage
          apps={logPageApps}
          installedPackages={appRuntime?.installed ?? []}
          hasDevice={!!selectedDevice}
          appState={appRunState}
          onOpenBackdoor={handleOpenBackdoor}
          onRestartApp={handleRestartApp}
          onClearData={handleClearData}
          onUninstall={handleUninstall}
          onScreenshot={handleScreenshot}
          onInstallApk={handleInstallApk}
          onDeviceInfo={handleDeviceInfo}
          onCurrentActivity={handleCurrentActivity}
          bugreportProgress={bugreportProgress}
          bugreportStatus={bugreportStatus}
          onExportBugreport={handleExportBugreport}
          audioExportProgress={audioExportProgress}
          audioExportAvailable={audioExportAvailable}
          audioExportStatus={audioExportStatus}
          onExportUnityAudio={handleExportUnityAudio}
          onCancelUnityAudio={handleCancelUnityAudio}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onMirror={handleMirror}
          onAppAlarm={handleAppAlarm}
          onAppPerformance={handleAppPerformance}
          onBack={() => setView("log")}
        />
        {updateDialogPortal}
      </>
    );
  }

  return (
    <div
      className="app"
      style={
        {
          "--log-font-size": `${prefs.prefs.logFontSize}px`,
        } as CSSProperties
      }
    >
      <div className="toolbar">
        <div className="workspace-title">测试工作台</div>
        <div className="toolbar-row toolbar-primary">
          <div className="toolbar-group toolbar-device-group">
            <Select
            className="device-select"
            title="选择设备"
            value={selectedDevice ?? ""}
            options={[
              ...(devices.length === 0
                ? [{ value: "", label: "无设备", fullLabel: "无设备" }]
                : []),
              ...devices.map((d) => ({
                value: d.serial,
                label: `${d.model || d.serial}（${d.transport === "wifi" ? "WiFi" : "USB"}）`,
                fullLabel: `${d.model || d.serial}（${d.transport === "wifi" ? "WiFi" : "USB"}）`,
              })),
            ]}
            onChange={(v) => setSelectedDevice(v)}
          />
            {waiting && (
              <span className="device-waiting-status" role="status">
                <i />
                等待设备连接…
              </span>
            )}
            <button onClick={() => refreshDevices()} title="刷新设备列表">
              刷新
            </button>
          </div>

          <div className="toolbar-group toolbar-capture-group">
            {running ? (
              <button className="toolbar-icon-action active" onClick={stop}>
                <ToolbarIcon name="stop" />
                停止采集
              </button>
            ) : (
              <button
                className="toolbar-icon-action primary-action"
                onClick={start}
                disabled={!selectedDevice}
              >
                <ToolbarIcon name="play" />
                开始采集
              </button>
            )}

          </div>

          <span className="toolbar-spacer" />

          <div className="toolbar-group toolbar-actions-group">
            <button className="toolbar-icon-action" onClick={() => setShowWifi(!showWifi)}>
              <ToolbarIcon name="wifi" />
              WiFi 连接
            </button>
            <button className="toolbar-icon-action" onClick={() => setView("tools")}>
              <ToolbarIcon name="tools" />
              工具
            </button>
            <div className="toolbar-more" ref={moreMenuRef}>
              <button
                className={`toolbar-icon-action ${showMoreActions ? "active" : ""}`}
                onClick={() => setShowMoreActions((shown) => !shown)}
                aria-expanded={showMoreActions}
              >
                <ToolbarIcon name="more" />
                更多
              </button>
              {showMoreActions && (
                <div className="toolbar-more-menu">
                  <button
                    className="toolbar-more-item"
                    onClick={() => {
                      setManageTab("apps");
                      setView("manage");
                      setShowMoreActions(false);
                    }}
                  >
                    <ToolbarIcon name="settings" />
                    设置与配置
                  </button>
                  <div className="toolbar-more-item toolbar-more-font">
                    <ToolbarIcon name="font" />
                    <span>日志字号</span>
                    <span className="font-size-group" title="调整日志字号">
                      <button
                        className="font-size-btn"
                        onClick={() => prefs.setLogFontSize(prefs.prefs.logFontSize - 1)}
                        disabled={prefs.prefs.logFontSize <= 9}
                        title="缩小日志字号"
                      >
                        A−
                      </button>
                      <button className="font-size-btn font-size-value" onClick={() => prefs.setLogFontSize(12)} title="重置为默认 12px">
                        {prefs.prefs.logFontSize}px
                      </button>
                      <button
                        className="font-size-btn"
                        onClick={() => prefs.setLogFontSize(prefs.prefs.logFontSize + 1)}
                        disabled={prefs.prefs.logFontSize >= 20}
                        title="放大日志字号"
                      >
                        A+
                      </button>
                    </span>
                  </div>
                  <button
                    className="toolbar-more-item"
                    onClick={() => prefs.setTheme(prefs.prefs.theme === "light" ? "dark" : "light")}
                  >
                    <ToolbarIcon name="theme" />
                    切换到{prefs.prefs.theme === "light" ? "深色" : "浅色"}主题
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <LogTabs
          tabs={logTabs.tabs}
          activeTabId={logTabs.activeTabId}
          onSelect={handleSelectLogTab}
          onCreateLog={handleCreateLogTab}
          onCreateTest={handleOpenTestTabCreate}
          onClose={setPendingCloseTabId}
          onRename={logTabs.renameTab}
        />

        <div className="toolbar-row toolbar-filter-row">
          <div className="toolbar-group tab-processing-actions">
            <button
              className={`toolbar-icon-action ${logTabs.activeTab.pausedAtId != null ? "active" : ""}`}
              onClick={toggleCurrentTabPause}
              disabled={!running}
              title="只暂停/继续当前 Tab（空格）"
            >
              <ToolbarIcon name="pause" />
              <span className="toolbar-action-label">
                {logTabs.activeTab.pausedAtId != null ? "继续" : "暂停"}
              </span>
            </button>
            <button
              className="toolbar-icon-action"
              onClick={clearCurrentTab}
              title="只清空当前 Tab（⌘/Ctrl+L）"
            >
              <ToolbarIcon name="trash" />
              <span className="toolbar-action-label">清空</span>
            </button>
            <button
              className="toolbar-icon-action"
              onClick={exportCurrentTab}
              title="导出当前 Tab（⌘/Ctrl+E）"
            >
              <ToolbarIcon name="export" />
              <span className="toolbar-action-label">导出</span>
            </button>
          </div>
          {!isTestTab && (
            <>
              <label className="toolbar-field-label">应用</label>
              <Select
                className="app-select"
                title="按应用过滤（自动解析 PID）"
                value={selectedPackage}
                triggerLabel={(() => {
                  const selectedCount = parseAppPackages(selectedPackage).length;
                  if (selectedCount <= 1) return undefined;
                  if (selectedCount === logPageApps.length) return "全部应用";
                  return `已选择 ${selectedCount} 个应用`;
                })()}
                searchable
                searchPlaceholder="搜索应用名或包名…"
                options={[
                  { value: "", label: "全部应用", fullLabel: "全部应用" },
                  ...logPageApps.map((app) => {
                    const state = appRunState(app.package);
                    return {
                      value: app.package,
                      label: (
                        <span className={`app-opt app-opt-${state}`}>
                          <i className="app-dot" />
                          {app.name}（{app.package}）
                        </span>
                      ),
                      fullLabel: `${app.name}（${app.package}）`,
                    };
                  }),
                ]}
                onChange={handleAppChange}
              />
              <label className="toolbar-field-label">级别</label>
              <Select
                className="level-select"
                title="最低日志级别"
                value={filters.minLevel}
                options={LEVELS.map((level) => ({
                  value: level,
                  label: LEVEL_LABELS[level],
                }))}
                onChange={(value) =>
                  setFilters({ ...filters, minLevel: value as LogLevel })
                }
              />
            </>
          )}
          <span className="tab-processing-separator" />
          {isTestTab ? (
            <div className="test-monitor-context">
              <span className="test-monitor-badge">
                <ToolbarIcon name="tests" />
                测试用例监控
              </span>
              <span className="test-monitor-app">
                <strong>
                  {effectiveApps.find((app) => app.package === logTabs.activeTab.testPackage)?.name
                    ?? logTabs.activeTab.testPackage}
                </strong>
                <small>{logTabs.activeTab.testPackage}</small>
              </span>
              <span className={`test-monitor-state ${filters.pid ? "running" : "waiting"}`}>
                <i />
                {filters.pid ? `监控中 · ${filters.pid.split(",").length} 个当前 PID` : "等待应用启动"}
              </span>
              <span className="test-monitor-scope">
                完整应用日志 · 已记录 {activeTestPidHistory.length} 个 PID · 筛选已锁定
              </span>
            </div>
          ) : (
            <>
              <HistoryInput
                value={filters.tags}
                onChange={(v) => setFilters({ ...filters, tags: v })}
                favorites={prefs.prefs.tagFavorites}
                history={prefs.prefs.tagHistory}
                onAddHistory={(v) => prefs.addHistory("tags", v)}
                onPin={(v, description) =>
                  prefs.addFavorite("tags", v, description)
                }
                onUnpin={(v) => prefs.removeFavorite("tags", v)}
                onRemoveHistory={(v) => prefs.removeHistory("tags", v)}
                placeholder="Tag（逗号分隔，!排除）"
                protectedValues={IS_DEBUG ? NO_PROTECTED_VALUES : getBuiltinTagValues()}
              />
              <div className="toolbar-search-with-regex">
                <HistoryInput
                  value={filters.search}
                  onChange={(v) => setFilters({ ...filters, search: v })}
                  favorites={prefs.prefs.searchFavorites}
                  history={prefs.prefs.searchHistory}
                  onAddHistory={(v) => prefs.addHistory("search", v)}
                  onPin={(v, description) =>
                    prefs.addFavorite("search", v, description)
                  }
                  onUnpin={(v) => prefs.removeFavorite("search", v)}
                  onRemoveHistory={(v) => prefs.removeHistory("search", v)}
                  placeholder="搜索（消息或 Tag）"
                  protectedValues={IS_DEBUG ? NO_PROTECTED_VALUES : getBuiltinSearchValues()}
                />
                <button
                  type="button"
                  className={`toolbar-regex-toggle ${filters.regex ? "on" : ""}`}
                  aria-pressed={filters.regex}
                  title="正则表达式"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setFilters({ ...filters, regex: !filters.regex })}
                >
                  .*
                </button>
              </div>
              <label className="toolbar-field-label">过滤器</label>
              <Select
                className="filter-select"
                title="已保存的过滤器"
                value={activeFilterId}
                options={[
                  { value: "", label: "（当前过滤）", fullLabel: "（当前过滤）" },
                  ...savedFilters.map((f) => ({
                    value: f.id,
                    label: f.name,
                  })),
                ]}
                onChange={(v) => handleApplyFilter(v)}
              />
              <div className="toolbar-filter-save">
                <button
                  className={`toolbar-icon-action ${showFilterSave ? "active" : ""}`}
                  onClick={() => setShowFilterSave((shown) => !shown)}
                  title="保存当前筛选"
                  aria-expanded={showFilterSave}
                >
                  <ToolbarIcon name="bookmark" />
                  <span className="toolbar-action-label">保存筛选</span>
                </button>
              </div>
            </>
          )}
          {!isTestTab &&
            prefs.prefs.tagBlockingEnabled &&
            blockedTagCount > 0 && (
              <button
                className={`toolbar-icon-action tag-block-visibility ${showBlockedTags ? "active" : ""}`}
                onClick={() => setShowBlockedTags((visible) => !visible)}
                title={
                  showBlockedTags
                    ? "恢复隐藏全局屏蔽规则命中的日志"
                    : "临时显示本页面被全局屏蔽的日志"
                }
              >
                {showBlockedTags
                  ? `屏蔽日志已显示 ${blockedTagCount}`
                  : `已隐藏 ${blockedTagCount}`}
              </button>
            )}
          <span className="count toolbar-log-count">共 {tabEntries.length} 条</span>
        </div>

        {showWifi && <WifiPanel onChanged={refreshDevices} />}
      </div>

      {showFilterSave &&
        createPortal(
          <div
            className="save-description-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowFilterSave(false);
            }}
          >
            <div className="save-description-dialog" role="dialog" aria-modal="true" aria-label="保存筛选">
              <h3>保存当前筛选</h3>
              <p>为这组搜索、Tag、应用与级别条件添加一个描述。</p>
              <input
                value={filterName}
                autoFocus
                placeholder="筛选描述，例如：激励框架错误"
                onChange={(e) => setFilterName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filterName.trim()) {
                    handleSaveFilter();
                    setShowFilterSave(false);
                  }
                  if (e.key === "Escape") setShowFilterSave(false);
                }}
              />
              <div className="save-description-actions">
                <button onClick={() => setShowFilterSave(false)}>取消</button>
                <button
                  className="primary-action"
                  onClick={() => {
                    handleSaveFilter();
                    setShowFilterSave(false);
                  }}
                  disabled={!filterName.trim()}
                >
                  保存
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {showTestTabCreate &&
        createPortal(
          <div
            className="save-description-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowTestTabCreate(false);
            }}
          >
            <div
              className="save-description-dialog test-tab-create-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="新建测试用例监控"
              onKeyDown={(event) => {
                if (event.key === "Escape") setShowTestTabCreate(false);
              }}
            >
              <h3>新建测试用例监控</h3>
              <p>选择用例需要监控的应用。此 Tab 会保留完整应用日志并锁定筛选条件，保证用例判定和问题定位使用同一份日志。</p>
              <label>
                监控应用
                <Select
                  className="test-tab-app-select"
                  value={testTabPackage}
                  searchable
                  searchPlaceholder="搜索应用名或包名…"
                  menuClassName="select-menu-modal"
                  options={logPageApps.map((app) => {
                    const state = appRunState(app.package);
                    return {
                      value: app.package,
                      label: (
                        <span className={`app-opt app-opt-${state}`}>
                          <i className="app-dot" />
                          {app.name}（{app.package}）
                        </span>
                      ),
                      fullLabel: `${app.name}（${app.package}）`,
                    };
                  })}
                  onChange={(packageName) => {
                    const previousDefault = effectiveApps.find(
                      (app) => app.package === testTabPackage,
                    );
                    const nextApp = effectiveApps.find(
                      (app) => app.package === packageName,
                    );
                    setTestTabPackage(packageName);
                    if (
                      !testTabName.trim()
                      || testTabName === "测试用例监控"
                      || testTabName === `用例 · ${previousDefault?.name ?? ""}`
                    ) {
                      setTestTabName(nextApp ? `用例 · ${nextApp.name}` : "测试用例监控");
                    }
                  }}
                />
              </label>
              <label>
                Tab 名称
                <input
                  value={testTabName}
                  autoFocus
                  maxLength={32}
                  placeholder="例如：登录流程用例监控"
                  onChange={(event) => setTestTabName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && testTabPackage) handleCreateTestTab();
                  }}
                />
              </label>
              <div className="test-tab-create-note">
                应用重启后会自动跟踪新 PID，并保留本次测试中旧 PID 的日志。清空 Tab 即开始一轮新的用例会话。
              </div>
              <div className="save-description-actions">
                <button onClick={() => setShowTestTabCreate(false)}>取消</button>
                <button
                  className="primary-action"
                  onClick={handleCreateTestTab}
                  disabled={!testTabPackage}
                >
                  创建并开始用例监控
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {pendingCloseTab &&
        createPortal(
          <div
            className="save-description-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPendingCloseTabId(null);
            }}
          >
            <div
              className="save-description-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label="确认关闭 Tab"
              onKeyDown={(event) => {
                if (event.key === "Escape") setPendingCloseTabId(null);
              }}
            >
              <h3>关闭 Tab？</h3>
              <p>
                确定关闭「{pendingCloseTab.name}」吗？
                {pendingCloseTab.kind === "test"
                  ? "本次测试用例监控状态将被移除。"
                  : "该 Tab 的筛选和查看状态将被移除。"}
                原始日志采集不会停止。
              </p>
              <div className="save-description-actions">
                <button autoFocus onClick={() => setPendingCloseTabId(null)}>
                  取消
                </button>
                <button
                  className="danger"
                  onClick={() => handleCloseLogTab(pendingCloseTab.id)}
                >
                  确认关闭
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {tagBlockDialog &&
        createPortal(
          <div
            className="save-description-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setTagBlockDialog(null);
            }}
          >
            <form
              className="save-description-dialog tag-block-quick-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="添加 Tag 全局屏蔽"
              onKeyDown={(event) => {
                if (event.key === "Escape") setTagBlockDialog(null);
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const value = tagBlockDialog.value.trim();
                if (!value) return;
                if (duplicateTagBlockRule) {
                  if (!duplicateTagBlockRule.enabled) {
                    prefs.setTagBlockRuleEnabled(duplicateTagBlockRule.id, true);
                  }
                } else {
                  prefs.addTagBlockRule(
                    value,
                    tagBlockDialog.description,
                    tagBlockDialog.match,
                    tagBlockDialog.group,
                  );
                }
                if (tagBlockDialog.enableGlobal) {
                  prefs.setTagBlockingEnabled(true);
                }
                setShowBlockedTags(false);
                setSelectedId(null);
                setTagBlockDialog(null);
              }}
            >
              <h3>添加 Tag 全局屏蔽</h3>
              <p>
                保存后，该规则只会隐藏普通日志页面中的匹配日志，测试用例页面和规则检测不受影响。
              </p>
              <label>
                Logcat Tag
                <input
                  value={tagBlockDialog.value}
                  autoFocus
                  placeholder="例如：chatty"
                  onChange={(event) =>
                    setTagBlockDialog((current) =>
                      current
                        ? { ...current, value: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                匹配方式
                <Select
                  className="tag-block-dialog-select"
                  value={tagBlockDialog.match}
                  menuClassName="select-menu-modal"
                  options={[
                    { value: "exact", label: "精确匹配" },
                    { value: "prefix", label: "前缀匹配" },
                  ]}
                  onChange={(match) =>
                    setTagBlockDialog((current) =>
                      current
                        ? { ...current, match: match as TagBlockMatch }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                分组
                <input
                  value={tagBlockDialog.group}
                  placeholder="例如：系统噪音"
                  onChange={(event) =>
                    setTagBlockDialog((current) =>
                      current
                        ? { ...current, group: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                描述（可选）
                <input
                  value={tagBlockDialog.description}
                  placeholder="说明这个 Tag 为什么需要屏蔽"
                  onChange={(event) =>
                    setTagBlockDialog((current) =>
                      current
                        ? { ...current, description: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              {!prefs.prefs.tagBlockingEnabled && (
                <label className="checkbox tag-block-dialog-enable">
                  <input
                    type="checkbox"
                    checked={tagBlockDialog.enableGlobal}
                    onChange={(event) =>
                      setTagBlockDialog((current) =>
                        current
                          ? { ...current, enableGlobal: event.target.checked }
                          : current,
                      )
                    }
                  />
                  同时启用普通日志页的全局 Tag 屏蔽
                </label>
              )}
              {duplicateTagBlockRule && (
                <div className="settings-inline-status">
                  {duplicateTagBlockRule.enabled
                    ? "相同 Tag 和匹配方式的规则已经存在并启用。"
                    : "相同规则已经存在，确认后将重新启用。"}
                </div>
              )}
              <div className="save-description-actions">
                <button type="button" onClick={() => setTagBlockDialog(null)}>
                  取消
                </button>
                <button
                  type="submit"
                  className="primary-action"
                  disabled={
                    !tagBlockDialog.value.trim() ||
                    (duplicateTagBlockRule?.enabled &&
                      (prefs.prefs.tagBlockingEnabled ||
                        !tagBlockDialog.enableGlobal))
                  }
                >
                  {duplicateTagBlockRule
                    ? duplicateTagBlockRule.enabled
                      ? "启用全局屏蔽"
                      : "启用已有规则"
                    : "添加并屏蔽"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}

      <div className="log-main">
        <div className="log-left" ref={logLeftRef}>
          <LogList
            entries={tabEntries}
            selectedId={selectedId}
            onSelect={handleSelect}
            onClearSelection={() => setSelectedId(null)}
            scrollCommand={scrollCommand}
            tabId={logTabs.activeTabId}
            followLatest={logTabs.activeTab.followLatest}
            onFollowLatestChange={(followLatest) =>
              logTabs.updateTab(logTabs.activeTabId, { followLatest })
            }
            findState={logTabs.activeTab.find}
            onFindStateChange={(find) =>
              logTabs.updateTab(logTabs.activeTabId, { find })
            }
            layoutKey={`${logTabs.activeTabId}|${filters.search}|${filters.regex}|${filters.tags}|${filters.app}|${filters.minLevel}|${prefs.prefs.tagBlockingEnabled}|${showBlockedTags}|${prefs.tagBlockRules.filter((rule) => rule.enabled).map((rule) => rule.id).join(",")}|${logTabs.activeTab.clearedBeforeId}|${logTabs.activeTab.pausedAtId ?? "live"}`}
          />
          {selectedEntry && (
            <div className="log-detail" style={{ height: detailHeight }}>
              <div
                className="log-detail-resizer"
                onMouseDown={onDetailResizeStart}
                title="拖动调整详情高度"
              />
              <div className="log-detail-head">
                <span className="log-detail-title">日志详情</span>
                {!isTestTab && (
                  <>
                    <button
                      title={`只显示 Tag 为「${selectedEntry.tag}」的日志`}
                      onClick={() =>
                        setFilters((f) => ({ ...f, tags: selectedEntry.tag }))
                      }
                    >
                      只看此 Tag
                    </button>
                    <button
                      title={`排除 Tag 为「${selectedEntry.tag}」的日志（在 Tag 过滤中追加 !${selectedEntry.tag}）`}
                      onClick={() =>
                        setFilters((f) => {
                          const parts = f.tags
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean);
                          if (parts.includes(`!${selectedEntry.tag}`)) return f;
                          return {
                            ...f,
                            tags: [...parts, `!${selectedEntry.tag}`].join(", "),
                          };
                        })
                      }
                    >
                      排除此 Tag
                    </button>
                    <button
                      title={`将 Tag「${selectedEntry.tag}」添加到全局屏蔽`}
                      onClick={() =>
                        setTagBlockDialog({
                          value: selectedEntry.tag,
                          description: "",
                          match: "exact",
                          group: "自定义",
                          enableGlobal: true,
                        })
                      }
                    >
                      全局屏蔽此 Tag
                    </button>
                  </>
                )}
                <button
                  onClick={() =>
                    writeText(selectedEntry.raw).catch((e) =>
                      setError(`复制失败：${String(e)}`),
                    )
                  }
                >
                  复制
                </button>
                <button onClick={() => setSelectedId(null)}>关闭</button>
              </div>
              <pre className="log-detail-body">{selectedEntry.raw}</pre>
            </div>
          )}
        </div>
        {isTestTab && (
          <TestCaseSidebar
            store={testCaseStore}
            allEntries={tabAllEntries}
            scopePkg={logTabs.activeTab.testPackage}
            pidFilter={activeTestPidHistory.join(",")}
            sessionKey={`${logTabs.activeTabId}:${activeTestStartedAtId}:${activeTabClearedBeforeId}`}
            onLocate={locateEntry}
            onManage={() => {
              setManageTab("testcases");
              setView("manage");
            }}
            onClose={() => setShowCases(false)}
            closable={false}
          />
        )}
      </div>

      {toast && (
        <div
          className={toastBusy ? "banner banner-busy" : "banner banner-ok"}
          role="status"
          title={toast}
        >
          {toast}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {updateDialogPortal}
    </div>
  );
}
