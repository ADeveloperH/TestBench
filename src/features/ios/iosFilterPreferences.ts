import { validIosBundleId, type IosConfiguredApp } from "../../core/iosApps";
import { defaultIosLogBlocking, normalizeIosLogBlocking, type IosLogBlockingPreferences } from "./iosLogBlocking";
export interface IosFilterValues { markers: string; search: string; regex: boolean; level: string; semantic: string }
export interface IosSavedFilter { id: string; name: string; filters: IosFilterValues }
export interface IosFilterPreferences {
  blocking: IosLogBlockingPreferences;
  customApps: IosConfiguredApp[];
  removedBuiltinApps: string[];
  markerHistory: string[];
  markerFavorites: Array<{ value: string; description: string }>;
  history: string[];
  /** 旧配置迁移输入；正式正文搜索使用 Prefs.searchFavorites，迁移后此处为空。 */
  favorites: Array<{ value: string; description: string }>;
  savedFilters: IosSavedFilter[];
}
export const emptyIosFilterPreferences = (): IosFilterPreferences => ({ blocking: defaultIosLogBlocking(), customApps: [], removedBuiltinApps: [], markerHistory: [], markerFavorites: [], history: [], favorites: [], savedFilters: [] });
export function iosFilterValues(value: Partial<IosFilterValues>): IosFilterValues {
  return { markers: typeof value.markers === "string" ? value.markers : "", search: typeof value.search === "string" ? value.search : "", regex: value.regex === true,
    level: typeof value.level === "string" ? value.level : "",
    semantic: ["info", "warning", "error", "exception", "unknown"].includes(value.semantic ?? "") ? value.semantic! : "" };
}
export function normalizeIosFilterPreferences(value: unknown): IosFilterPreferences {
  const result = emptyIosFilterPreferences();
  if (!value || typeof value !== "object") return result;
  const data = value as Partial<IosFilterPreferences>;
  result.blocking = normalizeIosLogBlocking(data.blocking);
  result.removedBuiltinApps = Array.isArray(data.removedBuiltinApps) ? [...new Set(data.removedBuiltinApps.filter((v) => typeof v === "string" && validIosBundleId(v)))] : [];
  if (Array.isArray(data.customApps)) for (const app of data.customApps) {
    if (app && typeof app.bundleId === "string" && validIosBundleId(app.bundleId.trim()) && typeof app.name === "string" && app.name.trim() && !result.customApps.some((item) => item.bundleId === app.bundleId.trim())) result.customApps.push({ bundleId: app.bundleId.trim(), name: app.name.trim() });
  }
  result.history = Array.isArray(data.history) ? [...new Set(data.history.filter((v) => typeof v === "string" && v.trim()))].slice(0, 30) : [];
  if (Array.isArray(data.favorites)) for (const f of data.favorites) {
    if (f && typeof f.value === "string" && f.value.trim() && !result.favorites.some((item) => item.value === f.value)) {
      result.favorites.push({ value: f.value, description: typeof f.description === "string" ? f.description : "" });
    }
  }
  result.markerHistory = Array.isArray(data.markerHistory) ? [...new Set(data.markerHistory.filter((v) => typeof v === "string" && v.trim()))].slice(0, 30) : [];
  if (Array.isArray(data.markerFavorites)) for (const f of data.markerFavorites) {
    if (f && typeof f.value === "string" && f.value.trim() && !result.markerFavorites.some((item) => item.value === f.value)) result.markerFavorites.push({ value: f.value, description: typeof f.description === "string" ? f.description : "" });
  }
  if (Array.isArray(data.savedFilters)) for (const f of data.savedFilters) {
    if (!f || typeof f.id !== "string" || !f.id || typeof f.name !== "string" || !f.name.trim() || !f.filters || typeof f.filters !== "object") continue;
    result.savedFilters.push({ id: result.savedFilters.some((item) => item.id === f.id) ? `ios_filter_${crypto.randomUUID()}` : f.id, name: f.name, filters: iosFilterValues(f.filters) });
  }
  return result;
}
export function mergeIosFilterPreferences(local: unknown, imported: unknown): IosFilterPreferences {
  const result = normalizeIosFilterPreferences(local);
  const incoming = normalizeIosFilterPreferences(imported);
  result.history = [...new Set([...result.history, ...incoming.history])].slice(0, 30);
  result.removedBuiltinApps = [...new Set([...result.removedBuiltinApps, ...incoming.removedBuiltinApps])];
  for (const app of incoming.customApps) if (!result.customApps.some((item) => item.bundleId === app.bundleId)) result.customApps.push(app);
  for (const f of incoming.favorites) if (!result.favorites.some((item) => item.value === f.value)) result.favorites.push(f);
  result.markerHistory = [...new Set([...result.markerHistory, ...incoming.markerHistory])].slice(0, 30);
  for (const f of incoming.markerFavorites) if (!result.markerFavorites.some((item) => item.value === f.value)) result.markerFavorites.push(f);
  for (const f of incoming.savedFilters) {
    if (result.savedFilters.some((item) => JSON.stringify(item.filters) === JSON.stringify(f.filters))) continue;
    result.savedFilters.push({ ...f, id: result.savedFilters.some((item) => item.id === f.id) ? `ios_filter_${crypto.randomUUID()}` : f.id });
  }
  return result;
}
