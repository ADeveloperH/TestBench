import { useCallback, useEffect, useMemo, useState } from "react";
import type { FilterState } from "../../core/types";

const STORAGE_KEY = "logcat-workspace-tabs-v1";

export const EMPTY_LOG_FILTERS: FilterState = {
  minLevel: "V",
  search: "",
  regex: false,
  tags: "",
  pid: "",
  app: "",
};

export interface LogFindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  currentMatch: number;
}

export const EMPTY_LOG_FIND: LogFindState = {
  open: false,
  query: "",
  caseSensitive: false,
  useRegex: false,
  currentMatch: 0,
};

export interface LogTabState {
  id: string;
  name: string;
  kind: "log" | "test";
  filters: FilterState;
  /** Ctrl/Cmd+F 查找条状态，每个 Tab 独立。 */
  find: LogFindState;
  activeFilterId: string;
  pausedAtId: number | null;
  clearedBeforeId: number;
  selectedLogId: number | null;
  showTestCases: boolean;
  /** 测试用例监控 Tab 固定的应用包名。 */
  testPackage: string;
  /** 测试会话只处理此日志 ID 之后的内容。 */
  testStartedAtId: number;
  /** 应用在本次测试会话中出现过的 PID，应用重启后继续保留旧日志。 */
  pidHistory: string[];
}

interface PersistedWorkspace {
  activeTabId?: string;
  tabs?: Array<Partial<LogTabState>>;
}

function makeId() {
  return `logtab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeTab(
  name = "全部日志",
  filters: FilterState = EMPTY_LOG_FILTERS,
  kind: LogTabState["kind"] = "log",
): LogTabState {
  return {
    id: makeId(),
    name,
    kind,
    filters: { ...filters, pid: "" },
    find: { ...EMPTY_LOG_FIND },
    activeFilterId: "",
    pausedAtId: null,
    clearedBeforeId: -1,
    selectedLogId: null,
    showTestCases: kind === "test",
    testPackage: kind === "test" ? (filters.app ?? "") : "",
    testStartedAtId: -1,
    pidHistory: [],
  };
}

function loadWorkspace(): { tabs: LogTabState[]; activeTabId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as PersistedWorkspace;
      const tabs = (saved.tabs ?? [])
        .filter((tab) => typeof tab.id === "string" && typeof tab.name === "string")
        .map((tab): LogTabState => ({
          ...makeTab(),
          ...tab,
          id: tab.id as string,
          name: (tab.name as string).trim() || "未命名日志",
          kind: tab.kind === "test" ? "test" : "log",
          filters: { ...EMPTY_LOG_FILTERS, ...tab.filters, pid: "" },
          find: {
            ...EMPTY_LOG_FIND,
            ...tab.find,
            currentMatch: 0,
          },
          // 日志 ID 每次启动都会重置，运行态不跨进程恢复。
          pausedAtId: null,
          clearedBeforeId: -1,
          selectedLogId: null,
          testStartedAtId: -1,
          pidHistory: [],
        }));
      if (tabs.length > 0) {
        const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
          ? (saved.activeTabId as string)
          : tabs[0].id;
        return { tabs, activeTabId };
      }
    }
  } catch {
    // 忽略损坏的工作区缓存。
  }
  const first = makeTab();
  return { tabs: [first], activeTabId: first.id };
}

export function useLogTabs() {
  const [workspace, setWorkspace] = useState(loadWorkspace);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          activeTabId: workspace.activeTabId,
          tabs: workspace.tabs.map((tab) => ({
            ...tab,
            filters: { ...tab.filters, pid: "" },
            pausedAtId: null,
            clearedBeforeId: -1,
            selectedLogId: null,
            testStartedAtId: -1,
            pidHistory: [],
          })),
        }),
      );
    } catch {
      // 忽略写入失败。
    }
  }, [workspace]);

  const activeTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0],
    [workspace],
  );

  const selectTab = useCallback((id: string) => {
    setWorkspace((current) =>
      current.tabs.some((tab) => tab.id === id)
        ? { ...current, activeTabId: id }
        : current,
    );
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<LogTabState>) => {
    setWorkspace((current) => {
      let changed = false;
      const tabs = current.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        const next = { ...tab, ...patch };
        if (JSON.stringify(next) === JSON.stringify(tab)) return tab;
        changed = true;
        return next;
      });
      return changed ? { ...current, tabs } : current;
    });
  }, []);

  const updateActiveTab = useCallback(
    (patch: Partial<LogTabState>) => updateTab(workspace.activeTabId, patch),
    [updateTab, workspace.activeTabId],
  );

  const createTab = useCallback(() => {
    const tab = makeTab("新日志");
    setWorkspace((current) => ({
      tabs: [...current.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab;
  }, []);

  const createTestTab = useCallback(
    (packageName: string, name: string, startedAtId: number) => {
      const filters = { ...EMPTY_LOG_FILTERS, app: packageName };
      const tab = makeTab(name.trim() || "测试用例监控", filters, "test");
      tab.testPackage = packageName;
      tab.testStartedAtId = startedAtId;
      setWorkspace((current) => ({
        tabs: [...current.tabs, tab],
        activeTabId: tab.id,
      }));
      return tab;
    },
    [],
  );

  const duplicateTab = useCallback((source: LogTabState, startedAtId = -1) => {
    const tab = makeTab(`${source.name} 副本`, source.filters, source.kind);
    tab.showTestCases = source.showTestCases;
    tab.activeFilterId = source.activeFilterId;
    tab.testPackage = source.testPackage;
    tab.testStartedAtId = source.kind === "test" ? startedAtId : -1;
    setWorkspace((current) => {
      const index = current.tabs.findIndex((item) => item.id === source.id);
      const tabs = [...current.tabs];
      tabs.splice(index < 0 ? tabs.length : index + 1, 0, tab);
      return { tabs, activeTabId: tab.id };
    });
    return tab;
  }, []);

  const closeTab = useCallback((id: string) => {
    setWorkspace((current) => {
      if (current.tabs.length <= 1) return current;
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return current;
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      const activeTabId =
        current.activeTabId === id
          ? tabs[Math.max(0, index - 1)]?.id ?? tabs[0].id
          : current.activeTabId;
      return { tabs, activeTabId };
    });
  }, []);

  const renameTab = useCallback(
    (id: string, name: string) => updateTab(id, { name: name.trim() || "未命名日志" }),
    [updateTab],
  );

  const resetRuntimeState = useCallback(() => {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => ({
        ...tab,
        pausedAtId: null,
        clearedBeforeId: -1,
        selectedLogId: null,
        testStartedAtId: -1,
        pidHistory: [],
      })),
    }));
  }, []);

  const addTabPids = useCallback((id: string, pids: string[]) => {
    if (pids.length === 0) return;
    setWorkspace((current) => {
      let changed = false;
      const tabs = current.tabs.map((tab) => {
        if (tab.id !== id || tab.kind !== "test") return tab;
        const next = [...new Set([...tab.pidHistory, ...pids])];
        if (next.length === tab.pidHistory.length) return tab;
        changed = true;
        return { ...tab, pidHistory: next };
      });
      return changed ? { ...current, tabs } : current;
    });
  }, []);

  return {
    tabs: workspace.tabs,
    activeTabId: workspace.activeTabId,
    activeTab,
    selectTab,
    updateTab,
    updateActiveTab,
    createTab,
    createTestTab,
    duplicateTab,
    closeTab,
    renameTab,
    resetRuntimeState,
    addTabPids,
  };
}
