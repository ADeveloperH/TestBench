// import { invoke } from "@tauri-apps/api/core"; // 远程配置请求停用，暂不需要

import { getBuiltinAppPackages, getBuiltinApps } from "./builtinRegistry";

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
  { name: "Block Pop!", package: "com.block.blast.pop" },
  { name: "Fortuna Block Blast", package: "com.unitegrandauto.fortunablock" },
  { name: "Fortuna Block Crush!", package: "com.fortuna.blockcrush" },
  { name: "Fortuna Bubble Shooter", package: "com.fortuna.bubble" },
  { name: "Cut Fruit", package: "com.fortuna.cutfruit" },
  { name: "Fortuna Knit Out", package: "com.fortuna.knit" },
  { name: "Fortuna Mahjong", package: "com.fortuna.mahjong" },
  { name: "Fortuna Sheep Arrow", package: "com.unitegrandauto.fortunasheep" },
  { name: "Sheep Go", package: "com.fortuna.sheepgo" },
  { name: "Joy Kitchen Tile Match", package: "com.injoy.tilematch.kitchen" },
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
  { name: "Lucky Watermelon", package: "com.lucky.watermelon" },
  { name: "Mahjong Pop!", package: "com.sinoauto.mahjong.match" },
  { name: "Sheep Arrow PoP!", package: "com.sinoauto.sheeparrow" },
  { name: "Sweet Fruit Slice", package: "com.sweet.fruitslice" },
  { name: "Watermelon Merge Fun", package: "com.yuhuitech.fruitgarden" },
  { name: "Yarn Pop!", package: "com.sinoauto.yarn.knitout" },
];

/**
 * 是否为内置应用。
 * 注意：判定走 builtinRegistry（远程配置生效后按远程列表判定），
 * 与上面静态的 BUILTIN_APPS 解耦。
 */
export function isBuiltinApp(pkg: string): boolean {
  return getBuiltinAppPackages().has(pkg);
}

/**
 * 加载应用清单：返回当前生效的内置应用（远程配置已加载则为远程清单）。
 * 远程配置的拉取/缓存/兜底统一由 core/remoteConfig.ts 管理。
 */
export async function loadApps(): Promise<AppInfo[]> {
  return [...getBuiltinApps()];
}
