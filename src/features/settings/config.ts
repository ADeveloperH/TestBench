//! 配置导入导出：把本地配置打包成 JSON，导入时按「本地优先」规则合并。

import type { AppInfo } from "../../core/apps";
import type { TestCase } from "../testcases/engine";
import type { SavedFilter } from "../filters/useSavedFilters";
import type { Favorite, Prefs } from "./usePrefs";

export interface ExportConfig {
  version: number;
  exportedAt: string;
  prefs: Prefs;
  testCases: TestCase[];
  savedFilters: SavedFilter[];
}

const CONFIG_VERSION = 1;

function defaultPrefs(): Prefs {
  return {
    searchFavorites: [],
    searchHistory: [],
    tagFavorites: [],
    tagHistory: [],
    addedApps: [],
    removedPackages: [],
    appOrder: [],
    backdoorOverrides: {},
  };
}

/** 导出：把三处本地配置打包成可分享的结构。 */
export function buildExportConfig(
  prefs: Prefs,
  testCases: TestCase[],
  savedFilters: SavedFilter[],
): ExportConfig {
  return {
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    prefs,
    testCases,
    savedFilters,
  };
}

function normalizePrefs(p: Partial<Prefs> | undefined): Prefs {
  const base = defaultPrefs();
  if (!p) return base;
  return {
    searchFavorites: Array.isArray(p.searchFavorites) ? p.searchFavorites : [],
    searchHistory: Array.isArray(p.searchHistory) ? p.searchHistory : [],
    tagFavorites: Array.isArray(p.tagFavorites) ? p.tagFavorites : [],
    tagHistory: Array.isArray(p.tagHistory) ? p.tagHistory : [],
    addedApps: Array.isArray(p.addedApps) ? p.addedApps : [],
    removedPackages: Array.isArray(p.removedPackages) ? p.removedPackages : [],
    appOrder: Array.isArray(p.appOrder) ? p.appOrder : [],
    backdoorOverrides: p.backdoorOverrides ?? {},
  };
}

/** 解析导入的 JSON；格式非法时抛错，由调用方提示。 */
export function parseImportConfig(json: string): ExportConfig {
  const data = JSON.parse(json) as Partial<ExportConfig>;
  if (!data || typeof data !== "object") {
    throw new Error("配置格式不正确");
  }
  return {
    version: typeof data.version === "number" ? data.version : CONFIG_VERSION,
    exportedAt: data.exportedAt ?? "",
    prefs: normalizePrefs(data.prefs),
    testCases: Array.isArray(data.testCases) ? data.testCases : [],
    savedFilters: Array.isArray(data.savedFilters) ? data.savedFilters : [],
  };
}

// —— 合并（重复项以本地为主） ——

function mergeFavorites(local: Favorite[], imported: Favorite[]): Favorite[] {
  const map = new Map<string, Favorite>();
  for (const f of local) map.set(f.value, f);
  for (const f of imported) {
    if (!map.has(f.value)) map.set(f.value, f);
  }
  return [...map.values()];
}

function mergeHistory(local: string[], imported: string[]): string[] {
  return [...new Set([...local, ...imported])];
}

function mergeApps(local: AppInfo[], imported: AppInfo[]): AppInfo[] {
  const map = new Map<string, AppInfo>();
  for (const a of local) map.set(a.package, a);
  for (const a of imported) {
    if (!map.has(a.package)) map.set(a.package, a);
  }
  return [...map.values()];
}

function mergeOrder(localOrder: string[], importedOrder: string[]): string[] {
  const result = [...localOrder];
  const seen = new Set(localOrder);
  for (const pkg of importedOrder) {
    if (!seen.has(pkg)) {
      result.push(pkg);
      seen.add(pkg);
    }
  }
  return result;
}

function mergePrefs(local: Prefs, imported: Prefs): Prefs {
  return {
    searchFavorites: mergeFavorites(local.searchFavorites, imported.searchFavorites),
    searchHistory: mergeHistory(local.searchHistory, imported.searchHistory),
    tagFavorites: mergeFavorites(local.tagFavorites, imported.tagFavorites),
    tagHistory: mergeHistory(local.tagHistory, imported.tagHistory),
    addedApps: mergeApps(local.addedApps, imported.addedApps),
    removedPackages: [
      ...new Set([...local.removedPackages, ...imported.removedPackages]),
    ],
    appOrder: mergeOrder(local.appOrder, imported.appOrder),
    // 本地覆盖优先
    backdoorOverrides: {
      ...imported.backdoorOverrides,
      ...local.backdoorOverrides,
    },
  };
}

/** 测试用例的「本质」指纹：scope + rules 相同即视为同一条（忽略 id/名字/描述）。 */
function testCaseFingerprint(tc: TestCase): string {
  return JSON.stringify({ scope: tc.scope, rules: tc.rules });
}

function mergeTestCases(local: TestCase[], imported: TestCase[]): TestCase[] {
  const result = [...local];
  const seen = new Set(local.map(testCaseFingerprint));
  for (const tc of imported) {
    const fp = testCaseFingerprint(tc);
    if (!seen.has(fp)) {
      result.push(tc);
      seen.add(fp);
    }
  }
  return result;
}

/** 过滤器的「本质」指纹：过滤条件相同即视为同一个（忽略 id/名字）。 */
function filterFingerprint(f: SavedFilter): string {
  return JSON.stringify(f.filters);
}

function mergeSavedFilters(
  local: SavedFilter[],
  imported: SavedFilter[],
): SavedFilter[] {
  const result = [...local];
  const seen = new Set(local.map(filterFingerprint));
  for (const f of imported) {
    const fp = filterFingerprint(f);
    if (!seen.has(fp)) {
      result.push(f);
      seen.add(fp);
    }
  }
  return result;
}

/** 合并导入配置与本地配置，重复项以本地为主。 */
export function mergeConfig(
  local: ExportConfig,
  imported: ExportConfig,
): ExportConfig {
  return {
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    prefs: mergePrefs(local.prefs, imported.prefs),
    testCases: mergeTestCases(local.testCases, imported.testCases),
    savedFilters: mergeSavedFilters(local.savedFilters, imported.savedFilters),
  };
}
