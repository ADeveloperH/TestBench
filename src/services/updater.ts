//! 统一更新服务：检查更新 → 下载（带进度）→ 安装 → 重启。
//! 更新源与签名校验由 tauri.conf.json 的 plugins.updater 配置；
//! 签名错误时 downloadAndInstall 会抛错并拒绝安装，这里不降级绕过。

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { info, error } from "@tauri-apps/plugin-log";

export interface UpdateProgress {
  downloaded: number;
  total?: number;
  percent?: number;
}

export interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
  update: Update;
}

/**
 * 启动自动检查和用户手动检查共用同一个原生请求。
 * Windows 上同时发起多个 updater check 时可能互相等待，因此在模块层做 single-flight。
 */
let activeCheck: Promise<AppUpdateInfo | null> | null = null;

/** 检查更新：无更新返回 null；失败抛错（由调用方决定提示方式）。 */
export function checkForUpdate(): Promise<AppUpdateInfo | null> {
  if (activeCheck) {
    info("[Updater] reusing active check");
    return activeCheck;
  }

  const request = (async (): Promise<AppUpdateInfo | null> => {
    try {
      info("[Updater] checking update");
      const update = await check({ timeout: 30_000 });
      if (!update) {
        info("[Updater] no update available");
        return null;
      }
      info(
        `[Updater] update available: current ${update.currentVersion} -> latest ${update.version}`,
      );
      return {
        version: update.version,
        currentVersion: update.currentVersion,
        notes: update.body ?? undefined,
        date: update.date ?? undefined,
        update,
      };
    } catch (e) {
      error(`[Updater] check failed: ${String(e)}`);
      throw e;
    }
  })();

  activeCheck = request;
  const clearActiveCheck = () => {
    if (activeCheck === request) activeCheck = null;
  };
  void request.then(clearActiveCheck, clearActiveCheck);
  return request;
}

/**
 * 下载并安装更新，完成后自动 relaunch。
 * 下载进度通过 onProgress 回调（percent 0~100，total 未知时为 undefined）。
 */
export async function installUpdate(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | undefined;

  info("[Updater] download started");
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? undefined;
          onProgress?.({ downloaded: 0, total, percent: total ? 0 : undefined });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onProgress?.({
            downloaded,
            total,
            percent:
              total && total > 0
                ? Math.min(100, Math.round((downloaded / total) * 100))
                : undefined,
          });
          break;
        case "Finished":
          onProgress?.({ downloaded: total ?? downloaded, total, percent: 100 });
          break;
      }
    });
  } catch (e) {
    error(`[Updater] download/install failed: ${String(e)}`);
    throw e;
  }
  info("[Updater] installed, relaunching");
  await relaunch();
}
