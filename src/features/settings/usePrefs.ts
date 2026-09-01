import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppInfo } from "../../core/apps";
import { isBuiltinApp } from "../../core/apps";
import {
  getBuiltinSearchFavorites,
  getBuiltinSearchValues,
  getBuiltinTagFavorites,
  getBuiltinTagBlockRules,
  getBuiltinTagValues,
  subscribeBuiltins,
} from "../../core/builtinRegistry";
import { IS_DEBUG } from "../../core/debug";
import type {
  EffectiveTagBlockRule,
  TagBlockMatch,
  TagBlockRule,
} from "../../core/tagBlockRules";

export type ListKind = "search" | "tags";

export interface Favorite {
  value: string;
  description: string;
}

export interface Prefs {
  searchFavorites: Favorite[];
  searchHistory: string[];
  tagFavorites: Favorite[];
  tagHistory: string[];
  /** 普通日志页是否启用全局 Tag 屏蔽。 */
  tagBlockingEnabled: boolean;
  /** 用户本地添加的 Tag 屏蔽规则。 */
  customTagBlockRules: TagBlockRule[];
  /** 用户对内置/自定义规则启用状态的明确覆盖。 */
  tagBlockEnabledOverrides: Record<string, boolean>;
  /** 用户手动添加的应用 */
  addedApps: AppInfo[];
  /** 用户手动删除（隐藏）的内置应用包名 */
  removedPackages: string[];
  /** 应用清单的显示顺序（包名列表） */
  appOrder: string[];
  /** 按包名覆盖的后门 Activity（未覆盖则用默认值） */
  backdoorOverrides: Record<string, string>;
  /** 是否把 Unity 等引擎逐行输出的堆栈帧合并回上一条日志 */
  mergeStack: boolean;
  /** 主题：dark 深色 / light 浅色 */
  theme: "dark" | "light";
  /** 日志字号（px，9~20，默认 12） */
  logFontSize: number;
  /** 调试模式删除的内置搜索常用 value（正式包忽略，内置不可删） */
  removedBuiltinSearch: string[];
  /** 调试模式删除的内置 Tag 常用 value（正式包忽略，内置不可删） */
  removedBuiltinTags: string[];
}

const KEY = "logcat-prefs-v1";
const MAX_HISTORY = 30;
export const LOG_FONT_MIN = 9;
export const LOG_FONT_MAX = 20;
export const LOG_FONT_DEFAULT = 12;

function clampFontSize(v: unknown): number {
  return typeof v === "number" && v >= LOG_FONT_MIN && v <= LOG_FONT_MAX
    ? Math.round(v)
    : LOG_FONT_DEFAULT;
}

const DEFAULTS: Prefs = {
  searchFavorites: [],
  searchHistory: [],
  tagFavorites: [],
  tagHistory: [],
  tagBlockingEnabled: true,
  customTagBlockRules: [],
  tagBlockEnabledOverrides: {},
  addedApps: [],
  removedPackages: [],
  appOrder: [],
  backdoorOverrides: {},
  mergeStack: true,
  theme: "dark",
  logFontSize: LOG_FONT_DEFAULT,
  removedBuiltinSearch: [],
  removedBuiltinTags: [],
};

/** 兼容旧版：历史版本的常用是纯字符串，迁移成 { value, description }。 */
function normalizeFavorites(x: unknown): Favorite[] {
  if (!Array.isArray(x)) return [];
  const out: Favorite[] = [];
  for (const item of x) {
    if (typeof item === "string") {
      if (item) out.push({ value: item, description: "" });
    } else if (item && typeof item === "object") {
      const o = item as { value?: unknown; description?: unknown };
      const value = typeof o.value === "string" ? o.value : "";
      const description =
        typeof o.description === "string" ? o.description : "";
      if (value) out.push({ value, description });
    }
  }
  return out;
}

function normalizeTagBlockRules(x: unknown): TagBlockRule[] {
  if (!Array.isArray(x)) return [];
  const out: TagBlockRule[] = [];
  const seen = new Set<string>();
  for (const item of x) {
    if (!item || typeof item !== "object") continue;
    const rule = item as Partial<TagBlockRule>;
    if (
      typeof rule.id !== "string" ||
      !rule.id ||
      seen.has(rule.id) ||
      typeof rule.value !== "string" ||
      !rule.value.trim() ||
      (rule.match !== "exact" && rule.match !== "prefix")
    ) {
      continue;
    }
    seen.add(rule.id);
    out.push({
      id: rule.id,
      value: rule.value.trim(),
      description:
        typeof rule.description === "string" ? rule.description.trim() : "",
      match: rule.match,
      group:
        typeof rule.group === "string" && rule.group.trim()
          ? rule.group.trim()
          : "自定义",
      enabledByDefault: rule.enabledByDefault !== false,
    });
  }
  return out;
}

function normalizeBooleanRecord(x: unknown): Record<string, boolean> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(x)) {
    if (key && typeof value === "boolean") out[key] = value;
  }
  return out;
}

function mergeTagBlockRules(base: Prefs): EffectiveTagBlockRule[] {
  const builtins = getBuiltinTagBlockRules();
  const builtinIds = new Set(builtins.map((rule) => rule.id));
  const definitions = [
    ...builtins.map((rule) => ({ ...rule, builtin: true })),
    ...base.customTagBlockRules
      .filter((rule) => !builtinIds.has(rule.id))
      .map((rule) => ({ ...rule, builtin: false })),
  ];
  return definitions
    .map((rule) => ({
      ...rule,
      enabled:
        base.tagBlockEnabledOverrides[rule.id] ?? rule.enabledByDefault,
    }))
    .sort(
      (a, b) =>
        a.value.localeCompare(b.value, "en", {
          sensitivity: "base",
          numeric: true,
        }) || a.id.localeCompare(b.id),
    );
}

function mergeFavoritesWithBuiltins(
  current: Favorite[],
  builtins: Favorite[],
  builtinValues: Set<string>,
  removed: Set<string>,
): Favorite[] {
  const visibleBuiltins = builtins.filter((f) => !removed.has(f.value));
  const hasBuiltinInCurrent = current.some((f) => builtinValues.has(f.value));
  const seen = new Set<string>();

  // 兼容旧数据：如果本地还没保存过内置项，就先沿用“内置在前”的旧布局。
  if (!hasBuiltinInCurrent) {
    const custom = current.filter(
      (f) => !builtinValues.has(f.value) || removed.has(f.value),
    );
    return [...visibleBuiltins, ...custom];
  }

  // 新数据：保留本地当前顺序，远程新增项再按远程顺序补到末尾。
  const merged: Favorite[] = [];
  for (const item of current) {
    if (removed.has(item.value) || seen.has(item.value)) continue;
    merged.push(item);
    seen.add(item.value);
  }
  for (const item of visibleBuiltins) {
    if (seen.has(item.value)) continue;
    merged.push(item);
    seen.add(item.value);
  }
  return merged;
}

/**
 * 内置常用与本地常用合并：
 * - 旧数据继续兼容“内置在前”
 * - 新数据保留当前本地顺序
 * - 远程新增内置项按远程顺序补到末尾
 * 调试模式下应用「已删除内置」名单：被删的内置不再显示。
 */
function applyBuiltinLayer(base: Prefs): Prefs {
  const searchValues = getBuiltinSearchValues();
  const tagValues = getBuiltinTagValues();
  const removedSearch = IS_DEBUG ? new Set(base.removedBuiltinSearch) : new Set<string>();
  const removedTags = IS_DEBUG ? new Set(base.removedBuiltinTags) : new Set<string>();
  return {
    ...base,
    searchFavorites: mergeFavoritesWithBuiltins(
      base.searchFavorites,
      getBuiltinSearchFavorites(),
      searchValues,
      removedSearch,
    ),
    tagFavorites: mergeFavoritesWithBuiltins(
      base.tagFavorites,
      getBuiltinTagFavorites(),
      tagValues,
      removedTags,
    ),
    // 兼容旧数据：正式包里内置应用不可删除，清理历史版本记录的隐藏项；
    // 调试模式下保留（维护者删除内置应用后需要记住删除状态）。
    removedPackages: IS_DEBUG
      ? base.removedPackages
      : base.removedPackages.filter((pkg) => !isBuiltinApp(pkg)),
  };
}

function load(): Prefs {
  const base = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Prefs>;
      Object.assign(base, d);
      delete (base as Prefs & { tagBlockOrder?: unknown }).tagBlockOrder;
      base.searchFavorites = normalizeFavorites(d.searchFavorites);
      base.tagFavorites = normalizeFavorites(d.tagFavorites);
      base.tagBlockingEnabled =
        typeof d.tagBlockingEnabled === "boolean" ? d.tagBlockingEnabled : true;
      base.customTagBlockRules = normalizeTagBlockRules(d.customTagBlockRules);
      base.tagBlockEnabledOverrides = normalizeBooleanRecord(
        d.tagBlockEnabledOverrides,
      );
    }
  } catch {
    // 忽略损坏的缓存
  }
  const merged = applyBuiltinLayer(base);
  // 旧数据可能没有日志字号字段或值非法，统一兜底
  merged.logFontSize = clampFontSize(merged.logFontSize);
  return merged;
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);
  const tagBlockRules = useMemo(() => mergeTagBlockRules(prefs), [prefs]);

  // 远程配置变化（内置层替换）时重算：内置置顶，用户数据保留。
  useEffect(() => {
    return subscribeBuiltins(() => {
      setPrefs((p) => applyBuiltinLayer(p));
    });
  }, []);

  // 持久化当前完整顺序，方便保留用户对内置/自定义常用项的排序。
  useEffect(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...prefs,
        }),
      );
    } catch {
      // 忽略写入失败
    }
  }, [prefs]);

  const addHistory = useCallback((kind: ListKind, value: string) => {
    const v = value.trim();
    if (!v) return;
    setPrefs((p) => {
      const next = (list: string[]) =>
        [v, ...list.filter((x) => x !== v)].slice(0, MAX_HISTORY);
      return kind === "search"
        ? { ...p, searchHistory: next(p.searchHistory) }
        : { ...p, tagHistory: next(p.tagHistory) };
    });
  }, []);

  const removeHistory = useCallback((kind: ListKind, value: string) => {
    setPrefs((p) =>
      kind === "search"
        ? { ...p, searchHistory: p.searchHistory.filter((x) => x !== value) }
        : { ...p, tagHistory: p.tagHistory.filter((x) => x !== value) },
    );
  }, []);

  const clearHistory = useCallback((kind: ListKind) => {
    setPrefs((p) =>
      kind === "search" ? { ...p, searchHistory: [] } : { ...p, tagHistory: [] },
    );
  }, []);

  const addFavorite = useCallback(
    (kind: ListKind, value: string, description = "") => {
      const v = value.trim();
      if (!v) return;
      // 内置常用已存在，忽略重复添加（调试模式除外：允许用同名 value 重建自己的常用）
      const builtin =
        kind === "search" ? getBuiltinSearchValues() : getBuiltinTagValues();
      if (builtin.has(v) && !IS_DEBUG) return;
      const desc = description.trim();
      setPrefs((p) => {
        const upd = (list: Favorite[]) => {
          const idx = list.findIndex((x) => x.value === v);
          if (idx >= 0) {
            const next = [...list];
            next[idx] = { value: v, description: desc || next[idx].description };
            return next;
          }
          return [...list, { value: v, description: desc }];
        };
        return kind === "search"
          ? { ...p, searchFavorites: upd(p.searchFavorites) }
          : { ...p, tagFavorites: upd(p.tagFavorites) };
      });
    },
    [],
  );

  const removeFavorite = useCallback((kind: ListKind, value: string) => {
    // 内置常用不可删除；调试模式下删除内置 = 记入「已删除内置」名单
    const builtin =
      kind === "search" ? getBuiltinSearchValues() : getBuiltinTagValues();
    if (builtin.has(value)) {
      if (!IS_DEBUG) return;
      setPrefs((p) =>
        kind === "search"
          ? {
              ...p,
              removedBuiltinSearch: [...p.removedBuiltinSearch, value],
              searchFavorites: p.searchFavorites.filter((x) => x.value !== value),
            }
          : {
              ...p,
              removedBuiltinTags: [...p.removedBuiltinTags, value],
              tagFavorites: p.tagFavorites.filter((x) => x.value !== value),
            },
      );
      return;
    }
    setPrefs((p) =>
      kind === "search"
        ? {
            ...p,
            searchFavorites: p.searchFavorites.filter((x) => x.value !== value),
          }
        : {
            ...p,
            tagFavorites: p.tagFavorites.filter((x) => x.value !== value),
          },
    );
  }, []);

  const updateFavoriteDescription = useCallback(
    (kind: ListKind, value: string, description: string) => {
      setPrefs((p) => {
        const upd = (list: Favorite[]) =>
          list.map((x) =>
            x.value === value ? { ...x, description: description.trim() } : x,
          );
        return kind === "search"
          ? { ...p, searchFavorites: upd(p.searchFavorites) }
          : { ...p, tagFavorites: upd(p.tagFavorites) };
      });
    },
    [],
  );

  const moveFavorite = useCallback(
    (kind: ListKind, fromIndex: number, toIndex: number) => {
      setPrefs((p) => {
        const list = kind === "search" ? p.searchFavorites : p.tagFavorites;
        if (
          fromIndex < 0 ||
          fromIndex >= list.length ||
          toIndex < 0 ||
          toIndex >= list.length ||
          fromIndex === toIndex
        ) {
          return p;
        }
        const next = [...list];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        return kind === "search"
          ? { ...p, searchFavorites: next }
          : { ...p, tagFavorites: next };
      });
    },
    [],
  );

  const addApp = useCallback((app: AppInfo) => {
    setPrefs((p) => ({
      ...p,
      addedApps: [...p.addedApps.filter((a) => a.package !== app.package), app],
      removedPackages: p.removedPackages.filter((x) => x !== app.package),
    }));
  }, []);

  const removeApp = useCallback((pkg: string) => {
    // 内置应用不可删除（调试模式除外：删除内置 = 记入 removedPackages）
    if (isBuiltinApp(pkg) && !IS_DEBUG) return;
    setPrefs((p) => {
      if (p.addedApps.some((a) => a.package === pkg)) {
        return { ...p, addedApps: p.addedApps.filter((a) => a.package !== pkg) };
      }
      if (!p.removedPackages.includes(pkg)) {
        return { ...p, removedPackages: [...p.removedPackages, pkg] };
      }
      return p;
    });
  }, []);

  const setAppOrder = useCallback((order: string[]) => {
    setPrefs((p) => ({ ...p, appOrder: order }));
  }, []);

  const setBackdoorOverride = useCallback((pkg: string, activity: string) => {
    const a = activity.trim();
    setPrefs((p) => {
      const overrides = { ...p.backdoorOverrides };
      if (a) overrides[pkg] = a;
      else delete overrides[pkg];
      return { ...p, backdoorOverrides: overrides };
    });
  }, []);

  const setTagBlockingEnabled = useCallback((enabled: boolean) => {
    setPrefs((p) => ({ ...p, tagBlockingEnabled: enabled }));
  }, []);

  const addTagBlockRule = useCallback(
    (
      value: string,
      description: string,
      match: TagBlockMatch,
      group: string,
    ): string => {
      const tag = value.trim();
      if (!tag) return "";
      const id = `custom_tag_block_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setPrefs((p) => {
        const duplicate = [
          ...getBuiltinTagBlockRules(),
          ...p.customTagBlockRules,
        ].some(
          (rule) =>
            rule.match === match &&
            rule.value.trim().toLowerCase() === tag.toLowerCase(),
        );
        if (duplicate) return p;
        const rule: TagBlockRule = {
          id,
          value: tag,
          description: description.trim(),
          match,
          group: group.trim() || "自定义",
          enabledByDefault: true,
        };
        return {
          ...p,
          customTagBlockRules: [...p.customTagBlockRules, rule],
        };
      });
      return id;
    },
    [],
  );

  const removeTagBlockRule = useCallback((id: string) => {
    setPrefs((p) => {
      if (!p.customTagBlockRules.some((rule) => rule.id === id)) return p;
      const overrides = { ...p.tagBlockEnabledOverrides };
      delete overrides[id];
      return {
        ...p,
        customTagBlockRules: p.customTagBlockRules.filter(
          (rule) => rule.id !== id,
        ),
        tagBlockEnabledOverrides: overrides,
      };
    });
  }, []);

  const setTagBlockRuleEnabled = useCallback(
    (id: string, enabled: boolean) => {
      setPrefs((p) => ({
        ...p,
        tagBlockEnabledOverrides: {
          ...p.tagBlockEnabledOverrides,
          [id]: enabled,
        },
      }));
    },
    [],
  );

  const setTagBlockGroupEnabled = useCallback(
    (group: string, enabled: boolean) => {
      const ids = tagBlockRules
        .filter((rule) => rule.group === group)
        .map((rule) => rule.id);
      setPrefs((p) => {
        const overrides = { ...p.tagBlockEnabledOverrides };
        for (const id of ids) overrides[id] = enabled;
        return { ...p, tagBlockEnabledOverrides: overrides };
      });
    },
    [tagBlockRules],
  );

  const replacePrefs = useCallback((p: Prefs) => {
    setPrefs(p);
  }, []);

  const setMergeStack = useCallback((v: boolean) => {
    setPrefs((p) => ({ ...p, mergeStack: v }));
  }, []);

  const setTheme = useCallback((theme: "dark" | "light") => {
    setPrefs((p) => ({ ...p, theme }));
  }, []);

  const setLogFontSize = useCallback((v: number) => {
    setPrefs((p) => ({ ...p, logFontSize: clampFontSize(v) }));
  }, []);

  return {
    prefs,
    tagBlockRules,
    addHistory,
    removeHistory,
    clearHistory,
    addFavorite,
    removeFavorite,
    updateFavoriteDescription,
    moveFavorite,
    addApp,
    removeApp,
    setAppOrder,
    setBackdoorOverride,
    setTagBlockingEnabled,
    addTagBlockRule,
    removeTagBlockRule,
    setTagBlockRuleEnabled,
    setTagBlockGroupEnabled,
    replacePrefs,
    setMergeStack,
    setTheme,
    setLogFontSize,
  };
}
