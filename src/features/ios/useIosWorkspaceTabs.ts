import { useEffect, useState } from "react";
import type { IosLogRecord } from "./iosTypes";
import type { LogFindState } from "../../core/logView";

const STORAGE_KEY = "ios-workspace-tabs-v1";
export interface IosViewState {
  kind?: "log" | "test";
  testBundleId?: string;
  testRun?: { sessionId: string; afterSequence: number; key: string; startedAt?: number };
  showBlockedLogs?: boolean;
  find: LogFindState;
  markers: string;
  search: string;
  regex: boolean;
  activeFilterId: string;
  level: string;
  semantic: string;
  follow: boolean;
  snapshot: IosLogRecord[] | null;
  selected: IosLogRecord | null;
  clearedThrough: number;
}
export const emptyIosView = (): IosViewState => ({ find: { open: false, query: "", caseSensitive: false, useRegex: false, currentMatch: 0 }, markers: "", search: "", regex: false, activeFilterId: "", level: "", semantic: "", follow: true, snapshot: null, selected: null, clearedThrough: -1 });
export interface IosWorkspaceTab extends IosViewState { id: string; name: string }
type Tab = IosWorkspaceTab;
interface Workspace { tabs: Tab[]; activeId: string; sessionId: string | null }
const newTab = (name = "全部日志"): Tab => ({ ...emptyIosView(), kind: "log", id: `ios_${crypto.randomUUID()}`, name });
function fresh(): Workspace {
  const tab = newTab();
  return { tabs: [tab], activeId: tab.id, sessionId: null };
}

export function loadIosWorkspaces(): Record<string, Workspace> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const output: Record<string, Workspace> = {};
    for (const [key, value] of Object.entries(saved)) {
      if (!key.startsWith("ios:") || !value || typeof value !== "object") continue;
      const workspace = value as Workspace;
      if (!Array.isArray(workspace.tabs)) continue;
      const ids = new Set<string>();
      const tabs = workspace.tabs.slice(0, 10).flatMap((tab) => {
        if (!tab || typeof tab.id !== "string" || ids.has(tab.id)) return [];
        ids.add(tab.id);
        return [{ ...emptyIosView(), id: tab.id, name: typeof tab.name === "string" ? tab.name.slice(0, 32) : "日志",
          kind: tab.kind === "test" ? "test" as const : "log" as const,
          testBundleId: tab.kind === "test" && typeof tab.testBundleId === "string" ? tab.testBundleId : undefined,
          markers: typeof tab.markers === "string" ? tab.markers : "",
          search: typeof tab.search === "string" ? tab.search : "",
          regex: tab.regex === true,
          activeFilterId: typeof tab.activeFilterId === "string" ? tab.activeFilterId : "",
          find: { open: false, query: typeof tab.find?.query === "string" ? tab.find.query : "", caseSensitive: tab.find?.caseSensitive === true, useRegex: tab.find?.useRegex === true, currentMatch: 0 },
          level: typeof tab.level === "string" ? tab.level : "",
          semantic: ["info", "warning", "error", "exception", "unknown"].includes(tab.semantic) ? tab.semantic : "",
          follow: typeof tab.follow === "boolean" ? tab.follow : true }];
      });
      if (tabs.length) output[key] = { tabs, activeId: tabs.some((tab) => tab.id === workspace.activeId) ? workspace.activeId : tabs[0].id, sessionId: null };
    }
    return output;
  } catch { return {}; }
}

export function serializeIosWorkspaces(workspaces: Record<string, Workspace>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(workspaces).map(([key, value]) => [key, {
    activeId: value.activeId,
    tabs: value.tabs.map(({ id, name, kind, testBundleId, markers, search, regex, activeFilterId, level, semantic, follow, find }) => ({ id, name, kind, testBundleId, markers, search, regex, activeFilterId, level, semantic, follow, find: { query: find.query, caseSensitive: find.caseSensitive, useRegex: find.useRegex } })),
  }])));
}

export function useIosWorkspaceTabs(deviceKey: string | null, sessionId: string | null) {
  const [workspaces, setWorkspaces] = useState(loadIosWorkspaces);
  const [fallback] = useState(fresh);
  const workspace = deviceKey ? workspaces[deviceKey] ?? fallback : fallback;
  const sessionChanged = workspace.sessionId !== sessionId;
  const resetRuntime = (tab: Tab): Tab => ({ ...tab, testRun: undefined, showBlockedLogs: false, snapshot: null, selected: null, clearedThrough: -1, find: { ...tab.find, currentMatch: 0 } });
  const tabs = sessionChanged ? workspace.tabs.map(resetRuntime) : workspace.tabs;
  const active = tabs.find((tab) => tab.id === workspace.activeId) ?? tabs[0];
  const mutate = (update: (current: Workspace) => Workspace) => {
    if (!deviceKey) return;
    setWorkspaces((current) => {
      const source = current[deviceKey] ?? fresh();
      const base = source.sessionId === sessionId ? source : { ...source, sessionId, tabs: source.tabs.map(resetRuntime) };
      return { ...current, [deviceKey]: update(base) };
    });
  };
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeIosWorkspaces(workspaces));
    } catch { /* 存储不可用时保留内存操作。 */ }
  }, [workspaces]);
  // 初始化当前设备，并及时丢弃旧会话的暂停快照。
  useEffect(() => {
    if (deviceKey) mutate((current) => ({ ...current, tabs: current.tabs.map(resetRuntime) }));
    // 仅设备和会话边界触发，不随每批日志重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKey, sessionId]);
  return {
    active,
    tabs: tabs.map((tab) => ({ ...tab, kind: tab.kind ?? "log", pausedAtId: tab.snapshot ? 0 : null })),
    select: (id: string) => mutate((current) => current.tabs.some((tab) => tab.id === id) ? { ...current, activeId: id } : current),
    create: () => mutate((current) => {
      if (current.tabs.length >= 10) return current;
      const tab = newTab("新日志");
      return { ...current, tabs: [...current.tabs, tab], activeId: tab.id };
    }),
    createTest: (bundleId: string, sessionId: string, afterSequence: number, appName = "Fruit Quest") => mutate((current) => {
      if (current.tabs.length >= 10) return current;
      const tab: Tab = { ...newTab(`用例 · ${appName}`), kind: "test", testBundleId: bundleId,
        testRun: { sessionId, afterSequence, key: crypto.randomUUID(), startedAt: Date.now() } };
      return { ...current, tabs: [...current.tabs, tab], activeId: tab.id };
    }),
    restartTest: (id: string, sessionId: string, afterSequence: number) => mutate((current) => ({ ...current,
      tabs: current.tabs.map((tab) => tab.id === id && tab.kind === "test" ? { ...tab, snapshot: null, selected: null, follow: true, clearedThrough: -1,
        testRun: { sessionId, afterSequence, key: crypto.randomUUID(), startedAt: Date.now() } } : tab) })),
    close: (id: string) => mutate((current) => {
      if (current.tabs.length <= 1) return current;
      const index = current.tabs.findIndex((tab) => tab.id === id);
      const remaining = current.tabs.filter((tab) => tab.id !== id);
      return { ...current, tabs: remaining, activeId: current.activeId === id ? remaining[Math.max(0, index - 1)].id : current.activeId };
    }),
    rename: (id: string, name: string) => mutate((current) => ({ ...current, tabs: current.tabs.map((tab) => tab.id === id ? { ...tab, name: name.trim().slice(0, 32) || "未命名日志" } : tab) })),
    update: (patch: Partial<IosViewState>) => mutate((current) => ({ ...current, tabs: current.tabs.map((tab) => tab.id === current.activeId ? { ...tab, ...patch } : tab) })),
  };
}
