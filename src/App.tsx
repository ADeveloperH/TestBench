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
import { info as logInfo } from "@tauri-apps/plugin-log";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { notify } from "./core/notify";
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
import { ManagePage, type ManageTab } from "./features/settings/ManagePage";
import { TestCaseSidebar } from "./features/testcases/TestCaseSidebar";
import { ToolsPage } from "./features/tools/ToolsPage";
import { WifiPanel } from "./features/devices/WifiPanel";
import { BUILTIN_APPS, DEFAULT_BACKDOOR, loadApps } from "./core/apps";
import type { AppInfo } from "./core/apps";
import { BUILTIN_SEARCH_VALUES, BUILTIN_TAG_VALUES } from "./core/builtins";
import { LEVELS, LEVEL_LABELS } from "./core/types";
import type { DeviceInfo, LogLevel, ScrollCommand } from "./core/types";
import "./App.css";

// 日志详情面板高度：可拖动调整，持久化记住上次高度。
const DETAIL_HEIGHT_KEY = "log-detail-height-v1";
const DETAIL_MIN_HEIGHT = 80;
const DETAIL_MAX_HEIGHT = 600;

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

  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    refreshDevices,
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
    waiting,
  } = useLogcat(true); // 合并堆栈固定开启

  const [view, setView] = useState<"log" | "manage" | "tools">("log");
  const [showWifi, setShowWifi] = useState(false);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailHeight, setDetailHeight] = useState<number>(loadDetailHeight);
  const [showCases, setShowCases] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showFilterSave, setShowFilterSave] = useState(false);
  const [manageTab, setManageTab] = useState<ManageTab>("apps");
  const moreMenuRef = useRef<HTMLDivElement>(null);

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
  const [activeFilterId, setActiveFilterId] = useState("");
  const [filterName, setFilterName] = useState("");
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
    const poll = async () => {
      if (!selectedDevice) {
        if (!disposed) setAppRuntime(null);
        return;
      }
      try {
        const status = await invoke<{ installed: string[]; running: string[] }>(
          "app_runtime_status",
          { device: selectedDevice },
        );
        if (!disposed) setAppRuntime(status);
      } catch {
        // 静默：瞬时失败保留上次结果，避免状态闪烁
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

  // 应用进程 PID 变化自动刷新：杀掉进程重开应用后 PID 会变，
  // 定期静默重解析，PID 变化即更新过滤，日志最多延迟几秒自动恢复。
  useEffect(() => {
    if (!selectedPackage || !selectedDevice) return;
    const timer = setInterval(async () => {
      try {
        const pids = await invoke<string[]>("resolve_pids", {
          device: selectedDevice,
          package: selectedPackage,
        });
        const newPid = pids.join(",");
        setFilters((f) => {
          if (f.pid === newPid) return f;
          // 应用被杀（无进程）时清空 PID 放行全部日志，重启后自动恢复过滤
          return { ...f, pid: newPid, app: selectedPackage };
        });
      } catch {
        // 静默失败，下个周期再试
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedPackage, selectedDevice, setFilters]);

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
    const out = await invoke<string>("install_apk", {
      device: selectedDevice,
      path,
    });
    notify("APK 安装完成", out).catch(() => {});
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
        const apk = event.payload.paths.find((p) =>
          p.toLowerCase().endsWith(".apk"),
        );
        if (!apk || !selectedDevice) return;
        invoke<string>("install_apk", { device: selectedDevice, path: apk })
          .then((out) => {
            notify("APK 安装完成", out).catch(() => {});
            setSavedTip(`安装完成：${out}`);
          })
          .catch((e) => setError(`安装失败：${String(e)}`));
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

  // 快捷键：空格 暂停/继续，Cmd/Ctrl+L 清空，Cmd/Ctrl+E 导出。
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
        if (running) setPaused(!paused);
        return;
      }
      if (!e.metaKey && !e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "l") {
        e.preventDefault();
        clear();
      } else if (k === "e") {
        e.preventDefault();
        exportLogs();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, paused, setPaused, clear, exportLogs]);

  const handleSelect = (id: number) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const locateEntry = (id: number) => {
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

  const handleExportDebugLog = async () => {
    try {
      const path = await invoke<string | null>("export_debug_log");
      return path ? `调试日志已导出：${path}` : "已取消导出";
    } catch (e) {
      return `导出失败：${String(e)}`;
    }
  };

  // 主题切换：挂在 body 上，让日志/设置/工具所有页面共享变量。
  useEffect(() => {
    document.body.classList.toggle("light", prefs.prefs.theme === "light");
  }, [prefs.prefs.theme]);

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
        onExportDebugLog={handleExportDebugLog}
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

            <button
              className={`toolbar-icon-action ${paused ? "active" : ""}`}
              onClick={() => setPaused(!paused)}
              disabled={!running}
              title="暂停/继续抓取（空格）"
            >
              <ToolbarIcon name="pause" />
              {paused ? "继续" : "暂停"}
            </button>

            <button className="toolbar-icon-action" onClick={clear} title="清空日志（⌘/Ctrl+L）">
              <ToolbarIcon name="trash" />
              清空
            </button>
          </div>

          <span className="toolbar-spacer" />

          <div className="toolbar-group toolbar-actions-group">
            <button className="toolbar-icon-action" onClick={exportLogs} title="导出日志（⌘/Ctrl+E）">
              <ToolbarIcon name="export" />
              导出
            </button>
            <button className="toolbar-icon-action" onClick={() => setShowWifi(!showWifi)}>
              <ToolbarIcon name="wifi" />
              WiFi 连接
            </button>
            <button className="toolbar-icon-action" onClick={() => setView("tools")}>
              <ToolbarIcon name="tools" />
              工具
            </button>
            <button
              className={`toolbar-icon-action ${showCases ? "active" : ""}`}
              onClick={() => setShowCases(!showCases)}
            >
              <ToolbarIcon name="tests" />
              测试用例
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
                  <button
                    className="toolbar-more-item"
                    onClick={() => {
                      setManageTab("filters");
                      setView("manage");
                      setShowMoreActions(false);
                    }}
                  >
                    <ToolbarIcon name="bookmark" />
                    管理过滤器
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

        <div className="toolbar-row toolbar-filter-row">
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
              protectedValues={BUILTIN_SEARCH_VALUES}
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
            placeholder="Tag 过滤（逗号分隔）"
            protectedValues={BUILTIN_TAG_VALUES}
          />
          <label>应用</label>
          <Select
            className="app-select"
            title="按应用过滤（自动解析 PID）"
            value={selectedPackage}
            searchable
            searchPlaceholder="搜索应用名或包名…"
            options={[
              { value: "", label: "全部应用", fullLabel: "全部应用" },
              ...logPageApps.map((a) => {
                const state = appRunState(a.package);
                return {
                  value: a.package,
                  label: (
                    <span className={`app-opt app-opt-${state}`}>
                      <i className="app-dot" />
                      {a.name}（{a.package}）
                    </span>
                  ),
                  fullLabel: `${a.name}（${a.package}）`,
                };
              }),
            ]}
            onChange={(v) => handleAppChange(v)}
          />
          <label className="toolbar-filter-label">级别</label>
          <Select
            className="level-select"
            title="最低日志级别"
            value={filters.minLevel}
            options={LEVELS.map((l) => ({
              value: l,
              label: LEVEL_LABELS[l],
            }))}
            onChange={(v) =>
              setFilters({ ...filters, minLevel: v as LogLevel })
            }
          />
          <label>过滤器</label>
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
              保存筛选
            </button>
          </div>
          {savedTip && <span className="count">{savedTip}</span>}

          <span className="count">共 {entries.length} 条</span>
          {waiting && (
            <span className="count" style={{ color: "#f5a623" }}>
              等待设备连接…
            </span>
          )}
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

      <div className="log-main">
        <div className="log-left" ref={logLeftRef}>
          <LogList
            entries={entries}
            selectedId={selectedId}
            onSelect={handleSelect}
            scrollCommand={scrollCommand}
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
