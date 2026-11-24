import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { selectIosRecords } from "./iosLogViewAdapter";
import type { IosViewState } from "./useIosWorkspaceTabs";
import type { IosLogRecord } from "./iosTypes";
import type { IosLogBlockingPreferences } from "./iosLogBlocking";

export function useIosWorkspaceActions(view: IosViewState, records: IosLogRecord[], update: (patch: Partial<IosViewState>) => void, running: boolean, blocking?: IosLogBlockingPreferences) {
  const selection = useMemo(() => selectIosRecords(records, view, blocking), [records, view, blocking]);
  const canPause = running || view.snapshot !== null;
  const canExport = selection.records.length > 0;
  return {
    selection, canPause, canExport,
    pause: () => { if (canPause) update({ snapshot: view.snapshot ? null : [...records] }); },
    clear: () => update({ clearedThrough: records[records.length - 1]?.sequence ?? -1, snapshot: null, selected: null, follow: true, find: { ...view.find, currentMatch: 0 } }),
    exportCurrent: async () => {
      if (!canExport) return;
      const text = selection.records.map((record) => record.raw).join("\n");
      try {
        const saved = await invoke<string | null>("export_logs", { text });
        if (saved) await message(`当前 Tab 已导出：${saved}`, { title: "导出完成", kind: "info" });
      } catch (error) { await message(String(error), { title: "导出失败", kind: "error" }); }
    },
  };
}
