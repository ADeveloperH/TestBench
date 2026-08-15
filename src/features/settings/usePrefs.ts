import { useCallback, useEffect, useState } from "react";
import type { AppInfo } from "../../core/apps";

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
  /** 用户手动添加的应用 */
  addedApps: AppInfo[];
  /** 用户手动删除（隐藏）的内置应用包名 */
  removedPackages: string[];
  /** 应用清单的显示顺序（包名列表） */
  appOrder: string[];
  /** 按包名覆盖的后门 Activity（未覆盖则用默认值） */
  backdoorOverrides: Record<string, string>;
}

const KEY = "logcat-prefs-v1";
const MAX_HISTORY = 30;

const DEFAULTS: Prefs = {
  searchFavorites: [],
  searchHistory: [],
  tagFavorites: [],
  tagHistory: [],
  addedApps: [],
  removedPackages: [],
  appOrder: [],
  backdoorOverrides: {},
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

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Prefs>;
      return {
        ...DEFAULTS,
        ...d,
        searchFavorites: normalizeFavorites(d.searchFavorites),
        tagFavorites: normalizeFavorites(d.tagFavorites),
      };
    }
  } catch {
    // 忽略损坏的缓存
  }
  return { ...DEFAULTS };
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
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

  const replacePrefs = useCallback((p: Prefs) => {
    setPrefs(p);
  }, []);

  return {
    prefs,
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
    replacePrefs,
  };
}
