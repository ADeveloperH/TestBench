import { useCallback, useEffect, useState } from "react";
import type { FilterState } from "../../core/types";
import { BUILTIN_FILTERS, BUILTIN_FILTER_IDS } from "../../core/builtins";

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
}

const KEY = "logcat-saved-filters-v1";

function load(): SavedFilter[] {
  const user: SavedFilter[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d)) {
        for (const item of d) {
          if (
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            item.filters &&
            typeof item.filters === "object"
          ) {
            user.push(item as SavedFilter);
          }
        }
      }
    }
  } catch {
    // 忽略损坏的缓存
  }
  // 内置过滤器排最前；过滤掉存储里与内置重复的旧副本。
  return [
    ...BUILTIN_FILTERS,
    ...user.filter((f) => !BUILTIN_FILTER_IDS.has(f.id)),
  ];
}

export function useSavedFilters() {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(load);

  // 持久化时过滤内置过滤器（内置以代码为准，不写入本地存储）。
  useEffect(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(savedFilters.filter((f) => !BUILTIN_FILTER_IDS.has(f.id))),
      );
    } catch {
      // 忽略写入失败
    }
  }, [savedFilters]);

  const saveFilter = useCallback((name: string, filters: FilterState): string => {
    const n = name.trim();
    if (!n) return "";
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setSavedFilters((list) => [...list, { id, name: n, filters }]);
    return id;
  }, []);

  const deleteFilter = useCallback((id: string) => {
    // 内置过滤器不可删除
    if (BUILTIN_FILTER_IDS.has(id)) return;
    setSavedFilters((list) => list.filter((f) => f.id !== id));
  }, []);

  const renameFilter = useCallback((id: string, name: string) => {
    // 内置过滤器不可重命名
    if (BUILTIN_FILTER_IDS.has(id)) return;
    const n = name.trim();
    if (!n) return;
    setSavedFilters((list) =>
      list.map((f) => (f.id === id ? { ...f, name: n } : f)),
    );
  }, []);

  const updateFilter = useCallback((id: string, filters: FilterState) => {
    // 内置过滤器不可编辑
    if (BUILTIN_FILTER_IDS.has(id)) return;
    setSavedFilters((list) =>
      list.map((f) => (f.id === id ? { ...f, filters } : f)),
    );
  }, []);

  const moveFilter = useCallback((fromIndex: number, toIndex: number) => {
    setSavedFilters((list) => {
      if (
        fromIndex < 0 ||
        fromIndex >= list.length ||
        toIndex < 0 ||
        toIndex >= list.length ||
        fromIndex === toIndex
      ) {
        return list;
      }
      // 内置过滤器顺序固定，不允许移动
      if (
        BUILTIN_FILTER_IDS.has(list[fromIndex].id) ||
        BUILTIN_FILTER_IDS.has(list[toIndex].id)
      ) {
        return list;
      }
      const next = [...list];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  }, []);

  const replaceFilters = useCallback((list: SavedFilter[]) => {
    // 导入替换时保留内置过滤器
    setSavedFilters([
      ...BUILTIN_FILTERS,
      ...list.filter((f) => !BUILTIN_FILTER_IDS.has(f.id)),
    ]);
  }, []);

  return {
    savedFilters,
    saveFilter,
    deleteFilter,
    renameFilter,
    updateFilter,
    moveFilter,
    replaceFilters,
  };
}
