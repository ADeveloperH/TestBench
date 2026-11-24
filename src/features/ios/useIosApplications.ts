import { BUILTIN_IOS_APPS, type IosConfiguredApp } from "../../core/iosApps";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface IosApplication { bundleId: string; name: string; executable: string | null }
const STORAGE_KEY = "ios-app-selection-v1";
export function loadIosAppSelections(): Record<string, string> {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => entry[0].startsWith("ios:") && typeof entry[1] === "string"));
  } catch { return {}; }
}
export function resolveIosApplication(apps: IosApplication[], bundleId: string) {
  if (!bundleId) return { executable: "", error: "" };
  const app = apps.find((app) => app.bundleId === bundleId);
  if (!app) return { executable: null, error: "所选应用未在当前列表中，请刷新或重新选择" };
  if (!app.executable) return { executable: null, error: "所选应用缺少可执行文件名，暂不能自动筛选" };
  if (apps.some((other) => other.bundleId !== bundleId && other.executable?.toLowerCase() === app.executable?.toLowerCase())) {
    return { executable: null, error: "多个应用使用相同进程名，当前无法可靠区分，请使用 Probe 排查" };
  }
  return { executable: app.executable, error: "" };
}
export function useIosApplications(deviceKey: string | null, enabled: boolean, locked: boolean, catalog: readonly IosConfiguredApp[] = BUILTIN_IOS_APPS) {
  const [selections, setSelections] = useState(loadIosAppSelections);
  const [state, setState] = useState<{ key: string | null; apps: IosApplication[]; loading: boolean; error: string }>({ key: null, apps: [], loading: false, error: "" });
  const revision = useRef(0);
  const currentKey = useRef(deviceKey); currentKey.current = deviceKey;
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (!deviceKey || !enabled || locked) return;
    const op = ++revision.current;
    setState({ key: deviceKey, apps: [], loading: true, error: "" });
    try {
      const apps = await invoke<IosApplication[]>("ios_list_applications", { deviceId: deviceKey.slice(4) });
      if (mounted.current && currentKey.current === deviceKey && revision.current === op) setState({ key: deviceKey, apps, loading: false, error: "" });
    } catch (cause) {
      if (mounted.current && currentKey.current === deviceKey && revision.current === op) setState({ key: deviceKey, apps: [], loading: false, error: typeof cause === "object" && cause && "message" in cause ? String(cause.message) : String(cause) });
    }
  }, [deviceKey, enabled, locked]);
  useEffect(() => { void refresh(); return () => { revision.current += 1; }; }, [refresh]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selections)); } catch { /* 仍可在内存选择。 */ } }, [selections]);
  const inventory = state.key === deviceKey ? state.apps : [];
  const confirmed = state.key === deviceKey && !state.loading && !state.error;
  const apps = catalog.map((app) => ({ ...app, executable: inventory.find((item) => item.bundleId === app.bundleId)?.executable ?? null, installed: confirmed ? inventory.some((item) => item.bundleId === app.bundleId) : null }));
  const bundleId = deviceKey ? selections[deviceKey] ?? "" : "";
  const target = bundleId && !catalog.some((app) => app.bundleId === bundleId)
    ? { executable: null, error: "所选应用不在配置清单中，请在设置→应用中添加或重新选择" }
    : resolveIosApplication(inventory, bundleId);
  const loading = state.key === deviceKey && state.loading;
  const error = state.key === deviceKey ? state.error : "";
  return { apps, bundleId, loading, error, target,
    canStart: !!deviceKey && (!bundleId || (!loading && !error && target.executable !== null)),
    refresh,
    select: (bundleId: string) => { if (deviceKey && !locked) setSelections((current) => ({ ...current, [deviceKey]: bundleId })); },
  };
}
