import type { Favorite } from "./usePrefs";
import { normalizeIosFilterPreferences } from "../ios/iosFilterPreferences";

/** 唯一正文搜索收藏源。清空迁移源，避免已取消收藏的旧 iOS 项重启后复活。 */
export function migrateSharedSearchFavorites<T extends { searchFavorites?: unknown; iosLog?: unknown }>(prefs: T) {
  const iosLog = normalizeIosFilterPreferences(prefs.iosLog);
  const favorites = new Map<string, Favorite>();
  const add = (item: unknown) => {
    const value = typeof item === "string" ? item : item && typeof item === "object" && "value" in item ? item.value : null;
    if (typeof value !== "string" || !value.trim()) return;
    const description = item && typeof item === "object" && "description" in item && typeof item.description === "string" ? item.description : "";
    const current = favorites.get(value);
    if (!current) favorites.set(value, { value, description });
    else if (!current.description && description) favorites.set(value, { ...current, description });
  };
  if (Array.isArray(prefs.searchFavorites)) prefs.searchFavorites.forEach(add);
  iosLog.favorites.forEach(add);
  return { ...prefs, searchFavorites: [...favorites.values()], iosLog: { ...iosLog, favorites: [] } };
}
