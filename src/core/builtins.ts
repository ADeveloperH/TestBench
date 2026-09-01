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
  { value: "NetWorkLog", description: "接口请求与响应日志" },
  { value: "[UserDataManager]", description: "用户数据日志" },
  { value: "[Withdraw]", description: "提现主流程日志" },
  { value: "[CloudConfigManager]", description: "云控日志" },
  { value: "[IAA]", description: "广告辅助日志" },
  { value: "[LevelUpReward]", description: "升级奖励日志" },
  { value: "[RewardToastManager]", description: "奖励到账日志" },
  { value: "[AccountStatusBar]", description: "顶部余额区日志" },
  { value: "[GuideWithdraw]", description: "提现引导日志" },
  { value: "[WithdrawHistory]", description: "提现记录日志" },
  { value: "[PaymentInputPanel]", description: "提现输入日志" },
  { value: "[NetworkUtils]", description: "网络状态日志" },
  { value: "[NetworkManager]", description: "网络管理日志" },
  { value: "[FloatingTreasureBoxManager]", description: "悬浮宝箱日志" },
  { value: "[CoinFlyEffect]", description: "奖励飞入动画日志" },
  { value: "[FiveStarPopup]", description: "好评弹窗日志" },
  { value: "[FiveStarReviewManager]", description: "好评弹窗策略日志" },
  { value: "[GameTrafficDiversionManager]", description: "游戏导流日志" },
  { value: "[IncentiveEngineManager]", description: "激励框架启动日志" },
  { value: "[LevelUpHandler]", description: "玩家升级流程日志" },
  { value: "[PropManager]", description: "道具管理日志" },
  { value: "[EventTracker]", description: "业务埋点日志" },
  { value: "[UIManager]", description: "UI 与弹窗管理日志" },
  { value: "[RewardToast]", description: "奖励提示组件日志" },
  { value: "[GameCloudConfig]", description: "游戏云控日志" },
  { value: "[EnvironmentCloudConfig]", description: "反作弊环境云控日志" },
  { value: "[FirebaseInit]", description: "Firebase 初始化日志" },
  { value: "[Loading]", description: "Loading 页面日志" },
  { value: "[LocalizationUtils]", description: "多语言日志" },
  { value: "[ThemeImageBinder]", description: "UI 主题图片绑定日志" },
  { value: "[BasePopup]", description: "弹窗基础框架日志" },
  { value: "[Settings]", description: "游戏设置页日志" },
  { value: "GameEntry", description: "游戏入口日志" },
  { value: "InviteManager", description: "邀请功能日志" },
  { value: "StatusCode", description: "接口状态处理日志" },
  { value: "GameLauncher", description: "游戏启动流程日志" },
];

/**
 * 内置 Tag 常用（value 为唯一键）。
 */
export const BUILTIN_TAG_FAVORITES: Favorite[] = [
  { value: "Unity", description: "游戏主日志" },
  { value: "Android.Manager", description: "广告主流程日志" },
  { value: "Android.ad_aggregation", description: "广告聚合日志" },
  { value: "Android.AndroidPromotio", description: "渠道归因日志" },
  { value: "Android.AndroidCloudCon", description: "Android 云控日志" },
  { value: "TD_JAVA", description: "反作弊日志" },
  { value: "Android.BeylaAnalytics", description: "埋点桥接日志" },
  { value: "Android.BeylaManager.Up", description: "埋点上传日志" },
  { value: "Android.Stats", description: "埋点统计日志" },
  { value: "Android.HttpAnalyzer", description: "网络诊断日志" },
  { value: "Android.TopActivityMana", description: "Activity 切换日志" },
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
