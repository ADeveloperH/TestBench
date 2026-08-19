//! 内置配置集中定义（代码级兜底来源）。
//! 注意：这只是「代码内置」的常量定义；运行时的内置判定统一走
//! core/builtinRegistry.ts（远程配置可按 section 覆盖这里的内容）。
//! 其他内置配置的位置：
//!   - 内置应用：src/core/apps.ts 的 BUILTIN_APPS
//!   - 内置测试用例：src/features/testcases/engine.ts 的 BUILTIN_TEST_CASES
//!
//! 修改配置优先改 config/remote-config.json（远程更新，无需发版）；
//! 这里仅在需要「出厂兜底」时修改。

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

// 说明：内置判定（不可删除/不可取消常用等）统一走 core/builtinRegistry.ts
// 的 getBuiltinSearchValues() / getBuiltinTagValues() / getBuiltinFilterIds()，
// 远程配置生效后以远程为准。这里的数组仅作为「代码内置」兜底来源。
