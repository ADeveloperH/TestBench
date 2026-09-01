//! 内置配置注册表：所有「内置」条目（应用/常用/过滤器/测试用例）的动态来源。
//!
//! 默认使用代码内置（apps.ts / builtins.ts / engine.ts 里的常量），
//! 远程配置（remoteConfig.ts）加载成功后按 section 整体覆盖。
//! 各 store 通过 subscribeBuiltins() 监听变化，重新合并本地用户数据。
//!
//! 注意：代码内置的读取放在函数体内（惰性），避免模块循环引用在初始化阶段
//! 访问到未完成的模块（apps.ts ↔ builtinRegistry.ts 存在循环引用）。

import type { AppInfo } from "./apps";
import type { Favorite } from "../features/settings/usePrefs";
import type { SavedFilter } from "../features/filters/useSavedFilters";
import type { TestCase } from "../features/testcases/engine";
import type { TagBlockRule } from "./tagBlockRules";
import { BUILTIN_APPS } from "./apps";
import {
  BUILTIN_FILTERS,
  BUILTIN_SEARCH_FAVORITES,
  BUILTIN_TAG_BLOCK_RULES,
  BUILTIN_TAG_FAVORITES,
} from "./builtins";
import { BUILTIN_TEST_CASES } from "../features/testcases/engine";

/** 完整的内置配置集合（各 section 可被远程配置整体覆盖）。 */
export interface BuiltinSet {
  apps: AppInfo[];
  searchFavorites: Favorite[];
  tagFavorites: Favorite[];
  tagBlockRules: TagBlockRule[];
  filters: SavedFilter[];
  testCases: TestCase[];
}

let state: BuiltinSet | null = null;
const listeners = new Set<() => void>();

/** 代码内置配置（远程配置不可用时的兜底，合并时的基准）。 */
export function getCodeBuiltins(): BuiltinSet {
  return {
    apps: BUILTIN_APPS,
    searchFavorites: BUILTIN_SEARCH_FAVORITES,
    tagFavorites: BUILTIN_TAG_FAVORITES,
    tagBlockRules: BUILTIN_TAG_BLOCK_RULES,
    filters: BUILTIN_FILTERS,
    testCases: BUILTIN_TEST_CASES,
  };
}

/** 当前生效的内置配置（未应用远程配置时即代码内置）。 */
export function getBuiltins(): BuiltinSet {
  if (!state) state = getCodeBuiltins();
  return state;
}

/** 整体替换生效的内置配置并通知订阅方。 */
export function applyBuiltins(next: BuiltinSet): void {
  state = next;
  notify();
}

/** 回退到代码内置。 */
export function resetBuiltinsToCode(): void {
  state = null;
  notify();
}

/** 订阅内置配置变化，返回取消订阅函数。 */
export function subscribeBuiltins(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(): void {
  for (const cb of [...listeners]) cb();
}

// —— 便捷访问器（每次调用基于当前生效配置重新计算，数据量小无性能问题） ——

export const getBuiltinApps = (): AppInfo[] => getBuiltins().apps;
export const getBuiltinSearchFavorites = (): Favorite[] =>
  getBuiltins().searchFavorites;
export const getBuiltinTagFavorites = (): Favorite[] => getBuiltins().tagFavorites;
export const getBuiltinTagBlockRules = (): TagBlockRule[] =>
  getBuiltins().tagBlockRules;
export const getBuiltinFilters = (): SavedFilter[] => getBuiltins().filters;
export const getBuiltinTestCases = (): TestCase[] => getBuiltins().testCases;

export const getBuiltinAppPackages = (): Set<string> =>
  new Set(getBuiltinApps().map((a) => a.package));
export const getBuiltinSearchValues = (): Set<string> =>
  new Set(getBuiltinSearchFavorites().map((f) => f.value));
export const getBuiltinTagValues = (): Set<string> =>
  new Set(getBuiltinTagFavorites().map((f) => f.value));
export const getBuiltinTagBlockRuleIds = (): Set<string> =>
  new Set(getBuiltinTagBlockRules().map((rule) => rule.id));
export const getBuiltinFilterIds = (): Set<string> =>
  new Set(getBuiltinFilters().map((f) => f.id));
export const getBuiltinTestCaseIds = (): Set<string> =>
  new Set(getBuiltinTestCases().map((c) => c.id));

/** 是否为当前生效的内置应用（远程配置生效后按远程列表判定）。 */
export function isBuiltinApp(pkg: string): boolean {
  return getBuiltinAppPackages().has(pkg);
}

/** 是否为当前生效的内置测试用例。 */
export function isBuiltinTestCase(id: string): boolean {
  return getBuiltinTestCaseIds().has(id);
}
