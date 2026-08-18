// import { invoke } from "@tauri-apps/api/core"; // 远程配置请求停用，暂不需要

export interface AppInfo {
  name: string;
  package: string;
}

/** 默认的应用后门 Activity（可在设置页按应用覆盖）。 */
export const DEFAULT_BACKDOOR =
  "com.foundation.unity.productdebugger.ProductSettingsActivity";

// 远程配置地址（公开仓库 raw 链接，无需 token）
// TODO: 远程配置请求暂时停用，后续需要时恢复。
// export const APPS_URL =
//   "https://raw.githubusercontent.com/ADeveloperH/TestBench/main/config/projects.json";

// const CACHE_KEY = "apps-config-cache-v1";

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

/** 内置应用包名集合（内置应用在设置页不可删除）。 */
export const BUILTIN_APP_PACKAGES = new Set(BUILTIN_APPS.map((a) => a.package));

/** 是否为内置应用。 */
export function isBuiltinApp(pkg: string): boolean {
  return BUILTIN_APP_PACKAGES.has(pkg);
}

/**
 * 加载应用清单。
 * TODO: 已停用「远程 → 本地缓存」两级来源，目前直接返回内置默认清单，
 * 不再请求远程接口；后续需要时恢复下面的三级兜底逻辑。
 */
export async function loadApps(): Promise<AppInfo[]> {
  // TODO: 以下远程配置 + 本地缓存逻辑暂时停用，后续再处理。
  // // 1. 远程
  // try {
  //   const apps = await invoke<AppInfo[]>("fetch_remote_apps", { url: APPS_URL });
  //   if (apps.length > 0) {
  //     localStorage.setItem(CACHE_KEY, JSON.stringify(apps));
  //     return apps;
  //   }
  // } catch {
  //   // 忽略，继续尝试缓存
  // }
  // // 2. 本地缓存
  // try {
  //   const cached = localStorage.getItem(CACHE_KEY);
  //   if (cached) {
  //     const apps = JSON.parse(cached) as AppInfo[];
  //     if (Array.isArray(apps) && apps.length > 0) return apps;
  //   }
  // } catch {
  //   // 忽略
  // }
  // 3. 内置默认
  return BUILTIN_APPS;
}
