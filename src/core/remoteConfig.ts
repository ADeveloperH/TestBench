//! 远程内置配置：从 GitHub 仓库 config/remote-config.json 拉取内置配置，
//! 按 section 覆盖代码内置；三级兜底：远程 → 本地缓存 → 代码内置。
//!
//! 更新方式（无需重新打包/安装）：
//!   1. 维护者修改仓库 config/remote-config.json（GitHub 网页编辑或 PR）
//!   2. 用户下次启动（或设置页点「刷新配置」）自动拉取新配置

import type { AppInfo } from "./apps";
import type { Favorite } from "../features/settings/usePrefs";
import type { SavedFilter } from "../features/filters/useSavedFilters";
import type { TestCase } from "../features/testcases/engine";
import {
  applyBuiltins,
  getCodeBuiltins,
  resetBuiltinsToCode,
  type BuiltinSet,
} from "./builtinRegistry";

export interface RemoteConfig {
  schemaVersion: number;
  updatedAt?: string;
  apps?: AppInfo[];
  searchFavorites?: Favorite[];
  tagFavorites?: Favorite[];
  filters?: SavedFilter[];
  testCases?: TestCase[];
}

export interface RemoteStatus {
  source: "remote" | "cache" | "code" | "error";
  updatedAt?: string;
  /** 用户可读的状态说明。 */
  detail: string;
}

const SCHEMA_VERSION = 1;
const CACHE_KEY = "remote-config-cache-v1";
const TTL_MS = 12 * 60 * 60 * 1000; // 缓存有效期 12 小时
const FETCH_TIMEOUT_MS = 8000;

/** 远程配置地址（按顺序尝试：raw 失败后走 jsDelivr 镜像）。 */
export const REMOTE_CONFIG_ENDPOINTS = [
  "https://raw.githubusercontent.com/ADeveloperH/TestBench/main/config/remote-config.json",
  "https://cdn.jsdelivr.net/gh/ADeveloperH/TestBench@main/config/remote-config.json",
];

/** 配置文件的 GitHub 网页编辑地址（调试模式发布页使用）。 */
export const REMOTE_CONFIG_EDIT_URL =
  "https://github.com/ADeveloperH/TestBench/edit/main/config/remote-config.json";

let lastStatus: RemoteStatus = {
  source: "code",
  detail: "使用代码内置配置",
};

/** 最近一次远程配置加载状态。 */
export function getRemoteConfigStatus(): RemoteStatus {
  return lastStatus;
}

// —— 校验 ——

function isAppInfo(x: unknown): x is AppInfo {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as AppInfo).name === "string" &&
    (x as AppInfo).name.length > 0 &&
    typeof (x as AppInfo).package === "string" &&
    (x as AppInfo).package.length > 0
  );
}

function isFavorite(x: unknown): x is Favorite {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as Favorite).value === "string" &&
    (x as Favorite).value.length > 0
  );
}

function isSavedFilter(x: unknown): x is SavedFilter {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as SavedFilter).id === "string" &&
    typeof (x as SavedFilter).name === "string" &&
    !!((x as SavedFilter).filters) &&
    typeof (x as SavedFilter).filters === "object"
  );
}

function isTestCase(x: unknown): x is TestCase {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as TestCase).id === "string" &&
    typeof (x as TestCase).name === "string" &&
    Array.isArray((x as TestCase).rules)
  );
}

function checkArray(
  section: unknown,
  name: string,
  isItem: (x: unknown) => boolean,
): unknown[] | undefined {
  if (section === undefined) return undefined;
  if (!Array.isArray(section)) {
    throw new Error(`「${name}」必须是数组`);
  }
  const bad = section.findIndex((x) => !isItem(x));
  if (bad >= 0) {
    throw new Error(`「${name}」第 ${bad + 1} 项格式不正确`);
  }
  return section as unknown[];
}

/** 校验远程配置；格式非法时抛错（由调用方决定回退策略）。 */
export function validateRemoteConfig(data: unknown): RemoteConfig {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("配置必须是 JSON 对象");
  }
  const d = data as Partial<RemoteConfig>;
  if (typeof d.schemaVersion !== "number") {
    throw new Error("缺少 schemaVersion 字段");
  }
  return {
    schemaVersion: d.schemaVersion,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : undefined,
    apps: checkArray(d.apps, "apps", isAppInfo) as AppInfo[] | undefined,
    searchFavorites: checkArray(
      d.searchFavorites,
      "searchFavorites",
      isFavorite,
    ) as Favorite[] | undefined,
    tagFavorites: checkArray(
      d.tagFavorites,
      "tagFavorites",
      isFavorite,
    ) as Favorite[] | undefined,
    filters: checkArray(d.filters, "filters", isSavedFilter) as
      | SavedFilter[]
      | undefined,
    testCases: checkArray(d.testCases, "testCases", isTestCase) as
      | TestCase[]
      | undefined,
  };
}

// —— 缓存 ——

interface CacheEntry {
  data: RemoteConfig;
  fetchedAt: number;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<CacheEntry>;
    if (d && typeof d.fetchedAt === "number") {
      return { data: validateRemoteConfig(d.data), fetchedAt: d.fetchedAt };
    }
  } catch {
    // 忽略损坏的缓存
  }
  return null;
}

function writeCache(cfg: RemoteConfig): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: cfg, fetchedAt: Date.now() }),
    );
  } catch {
    // 忽略写入失败
  }
}

// —— 拉取 ——

async function fetchUrl(url: string): Promise<RemoteConfig> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    return validateRemoteConfig(json);
  } finally {
    clearTimeout(timer);
  }
}

/** 远程配置与代码内置合并：远程存在的 section 整体覆盖，未写的 section 用代码内置。 */
function mergeRemote(code: BuiltinSet, remote: RemoteConfig): BuiltinSet {
  return {
    apps: remote.apps ?? code.apps,
    searchFavorites: remote.searchFavorites ?? code.searchFavorites,
    tagFavorites: remote.tagFavorites ?? code.tagFavorites,
    filters: remote.filters ?? code.filters,
    testCases: remote.testCases ?? code.testCases,
  };
}

/**
 * 刷新远程配置并应用。force=true 时跳过缓存直接拉远程。
 * 兜底顺序：远程 → 本地缓存 → 代码内置。
 */
export async function refreshRemoteConfig(force = false): Promise<RemoteStatus> {
  if (!force) {
    const cache = readCache();
    if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
      applyBuiltins(mergeRemote(getCodeBuiltins(), cache.data));
      lastStatus = {
        source: "cache",
        updatedAt: cache.data.updatedAt,
        detail: "使用缓存的内置配置",
      };
      return lastStatus;
    }
  }

  let lastError = "";
  for (const url of REMOTE_CONFIG_ENDPOINTS) {
    try {
      const cfg = await fetchUrl(url);
      if (cfg.schemaVersion > SCHEMA_VERSION) {
        // 未来版本的配置本版本无法理解，跳过（仍可写缓存，但不应用）
        throw new Error(`schemaVersion ${cfg.schemaVersion} 高于本版本支持的 ${SCHEMA_VERSION}`);
      }
      writeCache(cfg);
      applyBuiltins(mergeRemote(getCodeBuiltins(), cfg));
      lastStatus = {
        source: "remote",
        updatedAt: cfg.updatedAt,
        detail: `已从远程更新内置配置（${cfg.updatedAt ?? "时间未知"}）`,
      };
      return lastStatus;
    } catch (e) {
      lastError = String(e);
    }
  }

  // 远程失败 → 本地缓存兜底
  const cache = readCache();
  if (cache) {
    applyBuiltins(mergeRemote(getCodeBuiltins(), cache.data));
    lastStatus = {
      source: "cache",
      updatedAt: cache.data.updatedAt,
      detail: `远程配置不可用，使用本地缓存（${lastError}）`,
    };
    return lastStatus;
  }

  resetBuiltinsToCode();
  lastStatus = {
    source: "error",
    detail: `远程配置获取失败，使用代码内置（${lastError}）`,
  };
  return lastStatus;
}

/**
 * 直接应用一份远程配置（调试版发布成功后本地立即生效，无需等 raw 缓存刷新）。
 */
export function applyRemoteConfigDirect(cfg: RemoteConfig): RemoteStatus {
  writeCache(cfg);
  applyBuiltins(mergeRemote(getCodeBuiltins(), cfg));
  lastStatus = {
    source: "remote",
    updatedAt: cfg.updatedAt,
    detail: "已应用刚发布的内置配置",
  };
  return lastStatus;
}

/**
 * 从「当前生效的用户可见状态」生成远程配置文件内容（调试模式发布页用）：
 * 维护者先在界面上把配置整理好（内置 + 本地），再一键生成 remote-config.json 发布。
 */
export function buildRemoteConfigFromState(opts: {
  apps: AppInfo[];
  searchFavorites: Favorite[];
  tagFavorites: Favorite[];
  filters: SavedFilter[];
  testCases: TestCase[];
}): RemoteConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    apps: opts.apps,
    searchFavorites: opts.searchFavorites,
    tagFavorites: opts.tagFavorites,
    filters: opts.filters,
    testCases: opts.testCases,
  };
}
