import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  package: string;
}

/** 默认的应用后门 Activity（可在设置页按应用覆盖）。 */
export const DEFAULT_BACKDOOR =
  "com.foundation.unity.productdebugger.ProductSettingsActivity";

// 远程配置地址（公开仓库 raw 链接，无需 token）
export const APPS_URL =
  "https://raw.githubusercontent.com/ADeveloperH/ADBTools/main/config/projects.json";

const CACHE_KEY = "apps-config-cache-v1";

// 内置默认清单：首次安装或离线时兜底，之后以远程配置为准。
export const BUILTIN_APPS: AppInfo[] = [
  { name: "Fortuna Block Blast", package: "com.unitegrandauto.fortunablock" },
  { name: "Fortuna Block Crush!", package: "com.fortuna.blockcrush" },
  { name: "Fortuna Bubble Shooter", package: "com.fortuna.bubble" },
  { name: "Cut Fruit", package: "com.fortuna.cutfruit" },
  { name: "Fortuna Mahjong", package: "com.fortuna.mahjong" },
  { name: "Fortuna Sheep Arrow", package: "com.unitegrandauto.fortunasheep" },
  { name: "Sheep Go", package: "com.fortuna.sheepgo" },
  { name: "Lucky Candy Tiles", package: "com.lucky.candytiles" },
  { name: "Dog Arrow Out", package: "com.lucky.dogarrowout" },
  { name: "Fruit Quest Master", package: "com.lucky.fruit.quest" },
  { name: "Lucky Mahjong Blast！", package: "com.lucky.mahjong2" },
  { name: "Lucky Mahjong Match", package: "com.lucky.mahjong.casual" },
  { name: "Pets Blast", package: "com.lucky.petsblast" },
  { name: "Save Doge", package: "com.lucky.savedog" },
  { name: "Snake Arrow", package: "com.lucky.snakearrow" },
  { name: "Lucky Tile Match", package: "com.lucky.tilematch" },
  { name: "Lucky Triple Mahjong", package: "com.lucky.tilematch.mahjong" },
  { name: "Watermelon Merge Fun", package: "com.yuhuitech.fruitgarden" },
];

/**
 * 加载应用清单：远程 → 本地缓存 → 内置默认，三级兜底。
 */
export async function loadApps(): Promise<AppInfo[]> {
  // 1. 远程
  try {
    const apps = await invoke<AppInfo[]>("fetch_remote_apps", { url: APPS_URL });
    if (apps.length > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(apps));
      return apps;
    }
  } catch {
    // 忽略，继续尝试缓存
  }
  // 2. 本地缓存
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const apps = JSON.parse(cached) as AppInfo[];
      if (Array.isArray(apps) && apps.length > 0) return apps;
    }
  } catch {
    // 忽略
  }
  // 3. 内置默认
  return BUILTIN_APPS;
}
