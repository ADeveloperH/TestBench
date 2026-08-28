//! 统一更新服务：检查更新 → 下载（带进度）→ 安装 → 重启。
//! 更新源与签名校验由 tauri.conf.json 的 plugins.updater 配置；
//! 签名错误时 downloadAndInstall 会抛错并拒绝安装，这里不降级绕过。

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { info, error } from "@tauri-apps/plugin-log";
import { invoke } from "@tauri-apps/api/core";

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

/** 检查更新的硬超时：即便原生请求挂死在 DNS/TLS 层，也能强制结束并报错。 */
const CHECK_HARD_TIMEOUT_MS = 40_000;

/** 给 Promise 加一个硬超时，超时后 reject。 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(msg)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) window.clearTimeout(timer);
  }) as Promise<T>;
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
      const update = await withTimeout(
        check({ timeout: 30_000 }),
        CHECK_HARD_TIMEOUT_MS,
        "检查更新超时",
      );
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
 *
 * 拆成 download → cleanup → install 三步：
 *  - download 阶段 App 后台轮询仍会拉起短生命周期 adb，没关系；
 *  - 下载完成后立刻清理 adb/scrcpy 子进程，再立刻 install，把「清理后到
 *    安装器写文件」的窗口缩到最短，避免 Windows 上 adb 锁住 AdbWinApi.dll。
 */
export async function installUpdate(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | undefined;

  info("[Updater] download started");
  try {
    await update.download((event) => {
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
    error(`[Updater] download failed: ${String(e)}`);
    throw e;
  }

  // 下载完成后、安装前清理子进程，避免 Windows 上 adb 锁文件。
  info("[Updater] cleaning up child processes before install");
  try {
    await invoke("cleanup_for_update");
  } catch (e) {
    info(`[Updater] cleanup_for_update failed (non-fatal): ${String(e)}`);
  }

  info("[Updater] installing");
  try {
    await update.install();
  } catch (e) {
    error(`[Updater] install failed: ${String(e)}`);
    throw e;
  }

  info("[Updater] installed, relaunching");
  await relaunch();
}
