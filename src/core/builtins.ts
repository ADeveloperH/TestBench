//! 内置配置集中定义：内置条目在界面上显示「内置」徽标，且不支持删除/取消常用。
//! 其他内置配置的位置：
//!   - 内置应用：src/core/apps.ts 的 BUILTIN_APPS
//!   - 内置测试用例：src/features/testcases/engine.ts 的 BUILTIN_TEST_CASES
//!
//! 增加配置的方式：直接往下面的数组里加条目，重新构建即可（已存在的用户数据不受影响）。

import type { Favorite } from "../features/settings/usePrefs";
import type { SavedFilter } from "../features/filters/useSavedFilters";

/**
 * 内置搜索常用（value 为唯一键）。
 */
export const BUILTIN_SEARCH_FAVORITES: Favorite[] = [
  { value: "NetWorkLog", description: "过滤接口请求" },
];

/**
 * 内置 Tag 常用（value 为唯一键）。
 */
export const BUILTIN_TAG_FAVORITES: Favorite[] = [
  { value: "Unity", description: "游戏日志" },
];

/**
 * 内置过滤器（id 为唯一键，建议使用 builtin_ 前缀；filters 结构与保存的过滤器一致）。
 * 注意：pid 是设备相关的一次性进程号，内置过滤器不要填 pid；
 * 需要按应用过滤时填 app 包名，应用时会自动重新解析 PID。
 */
export const BUILTIN_FILTERS: SavedFilter[] = [
  {
    id: "builtin_network_request",
    name: "网络请求",
    filters: {
      minLevel: "V",
      search: "NetWorkLog",
      regex: false,
      tags: "Unity",
      pid: "",
      app: "com.lucky.tilematch",
    },
  },
];

/** 内置搜索常用的 value 集合（判定「不可取消常用」用）。 */
export const BUILTIN_SEARCH_VALUES = new Set(
  BUILTIN_SEARCH_FAVORITES.map((f) => f.value),
);

/** 内置 Tag 常用的 value 集合。 */
export const BUILTIN_TAG_VALUES = new Set(
  BUILTIN_TAG_FAVORITES.map((f) => f.value),
);

/** 内置过滤器的 id 集合（判定「不可删除/编辑」用）。 */
export const BUILTIN_FILTER_IDS = new Set(BUILTIN_FILTERS.map((f) => f.id));
