import { LOG_VIEW_COLUMNS, type LogColumnId } from "../../core/logView";
type Platform = "android" | "ios";
const SIZES: Record<LogColumnId, readonly [number, number, number]> = {
  timestamp: [150, 70, 320], pid: [72, 44, 140], tid: [72, 44, 140], level: [40, 40, 160], tag: [200, 70, 420],
  process: [180, 70, 420], module: [160, 70, 420], semanticLevel: [110, 70, 220], message: [200, 100, 2000],
};
export const logColumnStorageKey = (platform: Platform) => platform === "android" ? "log-col-widths-v1" : "ios-log-col-widths-v1";
export const logColumnSize = (id: LogColumnId, platform: Platform): readonly [number, number, number] =>
  id === "level" ? platform === "ios" ? [90, 65, 180] : [40, 40, 80] : SIZES[id];
export function loadLogColumnWidths(platform: Platform, storage: Pick<Storage, "getItem"> = localStorage): Record<LogColumnId, number> {
  const widths = Object.fromEntries(Object.keys(SIZES).map((id) => [id, logColumnSize(id as LogColumnId, platform)[0]])) as Record<LogColumnId, number>;
  try {
    const saved = JSON.parse(storage.getItem(logColumnStorageKey(platform)) ?? "{}");
    if (!saved || typeof saved !== "object") return widths;
    for (const { id } of LOG_VIEW_COLUMNS[platform]) {
      const value = saved[platform === "android" && id === "timestamp" ? "time" : id];
      const [, min, max] = logColumnSize(id, platform);
      if (typeof value === "number" && Number.isFinite(value)) widths[id] = Math.min(max, Math.max(min, value));
    }
    if (platform === "android" && widths.timestamp === 132) widths.timestamp = 150;
  } catch { /* 缓存不可用时保留默认值。 */ }
  return widths;
}
export function saveLogColumnWidths(platform: Platform, widths: Record<LogColumnId, number>, storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(logColumnStorageKey(platform), JSON.stringify(Object.fromEntries(LOG_VIEW_COLUMNS[platform].filter((col) => col.id !== "message").map(({ id }) => [platform === "android" && id === "timestamp" ? "time" : id, widths[id]]))));
  } catch { /* 无存储权限时保留本次拖动。 */ }
}
