import { useCallback, useEffect, useState } from "react";
import type { FilterState } from "../../core/types";
import {
  getBuiltinFilterIds,
  getBuiltinFilters,
  subscribeBuiltins,
} from "../../core/builtinRegistry";

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
}

const KEY = "logcat-saved-filters-v1";

/** 内置过滤器排最前；过滤掉存储里与当前内置重复的旧副本。 */
function applyBuiltinLayer(list: SavedFilter[]): SavedFilter[] {
  const builtinIds = getBuiltinFilterIds();
  return [...getBuiltinFilters(), ...list.filter((f) => !builtinIds.has(f.id))];
}

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
  return applyBuiltinLayer(user);
}

export function useSavedFilters() {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(load);

  // 远程配置变化（内置层替换）时重算：内置置顶，用户数据保留。
  useEffect(() => {
    return subscribeBuiltins(() => {
      setSavedFilters((list) => applyBuiltinLayer(list));
    });
  }, []);

  // 持久化时过滤内置过滤器（内置以当前生效配置为准，不写入本地存储）。
  useEffect(() => {
    try {
      const builtinIds = getBuiltinFilterIds();
      localStorage.setItem(
        KEY,
        JSON.stringify(savedFilters.filter((f) => !builtinIds.has(f.id))),
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
    if (getBuiltinFilterIds().has(id)) return;
    setSavedFilters((list) => list.filter((f) => f.id !== id));
  }, []);

  const renameFilter = useCallback((id: string, name: string) => {
    // 内置过滤器不可重命名
    if (getBuiltinFilterIds().has(id)) return;
    const n = name.trim();
    if (!n) return;
    setSavedFilters((list) =>
      list.map((f) => (f.id === id ? { ...f, name: n } : f)),
    );
  }, []);

  const updateFilter = useCallback((id: string, filters: FilterState) => {
    // 内置过滤器不可编辑
    if (getBuiltinFilterIds().has(id)) return;
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
        getBuiltinFilterIds().has(list[fromIndex].id) ||
        getBuiltinFilterIds().has(list[toIndex].id)
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
    setSavedFilters(applyBuiltinLayer(list));
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
