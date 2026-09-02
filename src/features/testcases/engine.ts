import type { LogEntry } from "../../core/types";
import { isBuiltinTestCase as isBuiltinTestCaseDynamic } from "../../core/builtinRegistry";

export type RuleEffect = "pass" | "error" | "warn";
export type ConditionField = "message" | "tag" | "level";
export type ConditionOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "regex";
export type GroupOp = "and" | "or";

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value: string;
}

/** 条件表达式树：叶子是条件，中间节点是 AND/OR 组合。 */
export type ConditionExpr =
  | { kind: "cond"; cond: Condition }
  | { kind: "group"; op: GroupOp; children: ConditionExpr[] };

export interface Rule {
  effect: RuleEffect;
  description: string;
  expr: ConditionExpr;
  /** 累计出现至少 N 次才触发（默认 1 = 出现即触发） */
  minCount?: number;
  /** 缺失判定：锚点条件匹配后，withinSec 秒内未匹配 expr 则触发 */
  absence?: {
    anchor: ConditionExpr;
    withinSec: number;
  };
}

export interface Scope {
  global: boolean;
  apps: string[];
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  scope: Scope;
  rules: Rule[];
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 分组（管理页按组折叠显示，默认「自定义」） */
  group?: string;
  /** 是否必须观察到全部 pass 规则；未齐全时显示「疑似」而不是「监控中」 */
  requirePass?: boolean;
}

// —— 构造便捷函数 ——

export function cond(
  field: ConditionField,
  op: ConditionOp,
  value: string,
): ConditionExpr {
  return { kind: "cond", cond: { field, op, value } };
}

export function all(...children: ConditionExpr[]): ConditionExpr {
  return { kind: "group", op: "and", children };
}

export function any(...children: ConditionExpr[]): ConditionExpr {
  return { kind: "group", op: "or", children };
}

// —— 激励框架（IncentiveEngine）内置用例 ——
// 基于框架日志体系（LogUtils，格式 [TAG]: message，logcat tag 均为 Unity）。
// 前提：游戏测试包需开启 ENABLE_LOG 编译宏。
// 约定：规则文案与框架日志文案绑定，框架改文案时需同步更新这里。

const unityTag = () => cond("tag", "equals", "Unity");
const has = (v: string) => cond("message", "contains", v);
const hasAny = (...vs: string[]) => any(...vs.map(has));

/** 构建激励框架用例（全局作用域）。 */
function ieCase(
  id: string,
  name: string,
  description: string,
  rules: Rule[],
  options: Pick<TestCase, "requirePass"> = {},
): TestCase {
  return {
    id,
    name,
    description,
    scope: { global: true, apps: [] },
    rules,
    ...options,
  };
}

const IE_CASES: TestCase[] = [
  ieCase(
    "ie_sdk_init",
    "激励框架初始化完成",
    "哨兵：用户数据开始初始化后 60 秒内应出现「所有SDK初始化完成」",
    [
      {
        effect: "error",
        description: "SDK 初始化未完成（缺失判定）",
        expr: all(unityTag(), has("所有SDK初始化完成")),
        absence: {
          anchor: all(unityTag(), has("UserDataManager 初始化开始")),
          withinSec: 60,
        },
      },
      {
        effect: "pass",
        description: "SDK 初始化完成",
        expr: all(unityTag(), has("所有SDK初始化完成")),
      },
    ],
  ),
  ieCase(
    "ie_config_missing",
    "激励框架配置缺失",
    "SDK 配置项未配置或配置资产缺失（游戏集成时最常见问题）",
    [
      {
        effect: "error",
        description: "配置项未配置（必填项）",
        expr: all(
          unityTag(),
          cond("level", "equals", "E"),
          has("[Config]"),
          has("未配置"),
        ),
      },
      {
        effect: "warn",
        description: "可选配置未配置，框架已使用默认值或关闭对应功能",
        expr: all(
          unityTag(),
          cond("level", "equals", "W"),
          has("[Config]"),
          has("未配置"),
        ),
      },
      {
        effect: "error",
        description: "IncentiveEngineConfig 资产缺失",
        expr: all(unityTag(), has("IncentiveEngineConfig not found")),
      },
      {
        effect: "error",
        description: "国家配置错误（未勾选支持国家 / defaultCountry 非法）",
        expr: all(
          unityTag(),
          cond("level", "equals", "E"),
          has("[Config]"),
          has("国家"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_network_fail",
    "激励框架网络请求失败",
    "框架接口请求失败或异常（统一出口 ApiManager）",
    [
      {
        effect: "warn",
        description: "接口请求返回失败（可能由重试恢复）",
        expr: all(unityTag(), has("[NetworkManager]"), has("请求失败:")),
      },
      {
        effect: "error",
        description: "接口请求异常",
        expr: all(unityTag(), has("[NetworkManager]"), has("请求异常:")),
      },
      {
        effect: "error",
        description: "NetworkManager 未初始化",
        expr: all(
          unityTag(),
          has("[NetworkManager]"),
          has("NetworkManager未初始化"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_cheating",
    "反作弊拦截命中",
    "服务端返回 600 作弊用户（关注是否误伤正常测试账号）",
    [
      {
        effect: "warn",
        description: "作弊用户被拦截",
        expr: all(unityTag(), has("cheating user")),
      },
    ],
  ),
  ieCase(
    "ie_userinfo_fail",
    "用户信息拉取异常",
    "区分可恢复的单次失败与重试耗尽，并验证初始化成功哨兵",
    [
      {
        effect: "warn",
        description: "用户信息单次拉取失败或异常（可能由重试恢复）",
        expr: all(
          unityTag(),
          has("[UserDataManager]"),
          hasAny("用户信息拉取失败:", "用户信息拉取异常:"),
        ),
      },
      {
        effect: "error",
        description: "用户信息重试耗尽",
        expr: all(
          unityTag(),
          has("[UserDataManager]"),
          has("用户信息拉取失败，已达最大重试次数"),
        ),
      },
      {
        effect: "pass",
        description: "用户信息初始化成功",
        expr: all(
          unityTag(),
          has("[UserDataManager]"),
          has("UserDataManager 初始化成功"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_withdraw_fail",
    "提现流程异常",
    "区分档位重试过程、重试耗尽、业务拒绝和客户端请求异常",
    [
      {
        effect: "warn",
        description: "提现档位单次拉取失败或异常（可能由重试恢复）",
        expr: all(
          unityTag(),
          has("提现档位拉取"),
          hasAny("失败", "异常"),
          cond("message", "not_contains", "已达最大重试次数"),
        ),
      },
      {
        effect: "error",
        description: "提现档位重试耗尽",
        expr: all(unityTag(), has("提现档位拉取失败，已达最大重试次数")),
      },
      {
        effect: "warn",
        description: "服务端拒绝提现",
        expr: all(unityTag(), has("提现失败, errorCode:")),
      },
      {
        effect: "error",
        description: "提现请求异常",
        expr: all(unityTag(), has("提现请求异常")),
      },
    ],
  ),
  ieCase(
    "ie_prop_fail",
    "道具初始化降级或异常",
    "道具初始化异常、重试后降级，以及初始化成功哨兵",
    [
      {
        effect: "warn",
        description: "道具初始化发生异常",
        expr: all(unityTag(), has("道具数据初始化异常")),
      },
      {
        effect: "warn",
        description: "道具初始化失败并使用降级数据",
        expr: all(
          unityTag(),
          hasAny("道具初始化失败", "新用户兜底："),
        ),
      },
      {
        effect: "pass",
        description: "道具初始化完成",
        expr: all(unityTag(), has("道具数据初始化完成")),
      },
    ],
  ),
  ieCase(
    "ie_ad_fail",
    "广告插件异常",
    "Unity 广告插件和 AndroidADLibrary 的确定性集成错误；初始化时序问题仅警告",
    [
      {
        effect: "error",
        description: "广告原生桥接失败",
        expr: all(unityTag(), has("AndroidAD"), has("failed")),
      },
      {
        effect: "error",
        description: "未配置任何广告聚合",
        expr: all(unityTag(), has("no mediation configured")),
      },
      {
        effect: "error",
        description: "广告位策略无效",
        expr: all(
          unityTag(),
          cond("message", "regex", "(Reward|Splash|Inter|Banner)AdStrategy invalid"),
        ),
      },
      {
        effect: "error",
        description: "广告初始化策略或代理为空",
        expr: all(
          unityTag(),
          hasAny(
            "ADManager Init Invoke,strategy is null",
            "ADManager Init Invoke,strategy invalid",
            "InitAdStrategy invalid,_adDelegate is null",
          ),
        ),
      },
      {
        effect: "error",
        description: "广告主线程调度器异常",
        expr: all(
          unityTag(),
          cond(
            "message",
            "regex",
            "UnityDispatcherTool.*(初始化失败|任务不能为空|回调不能为空|出错)",
          ),
        ),
      },
      {
        effect: "error",
        description: "Android 广告 SDK 初始化或调用参数错误",
        expr: all(
          cond("message", "contains", "AndroidAdManager"),
          hasAny(
            "init exception:",
            "not initialized (no mediation available)",
            "mediation is required",
            "unsupported mediation",
            "is not initialized pid",
            "pid is empty",
          ),
        ),
      },
      {
        effect: "warn",
        description: "广告聚合尚未初始化即被调用",
        expr: all(
          unityTag(),
          has("ADCoreManager"),
          has("is not init"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_anticheat_fail",
    "反作弊初始化参数非法",
    "反作弊 SDK 初始化时 partner/appKey 为空",
    [
      {
        effect: "error",
        description: "反作弊初始化参数非法",
        expr: all(unityTag(), has("InitSDK params invalid")),
      },
    ],
  ),
  ieCase(
    "ie_ad_ecpm_fail",
    "广告 eCPM 获取异常",
    "监控广告 eCPM 是否正常；UpdateEcpm 的 price=-1，或接口请求参数中的 ecpm=0，任一出现即判定异常",
    [
      {
        effect: "error",
        description: "UpdateEcpm 获取到无效 eCPM（price=-1）",
        expr: all(
          cond("tag", "equals", "Android.Stats"),
          cond(
            "message",
            "regex",
            "\\bUpdateEcpm\\b[\\s\\S]*?\\bprice\\s*=\\s*-1(?:\\.0+)?(?=\\s*[,}])",
          ),
        ),
      },
      {
        effect: "error",
        description: "接口请求使用了无效 eCPM（ecpm=0）",
        expr: all(
          unityTag(),
          has("NetWorkLog:Request"),
          cond(
            "message",
            "regex",
            "JsonParams\\s*:\\s*\\{[\\s\\S]*?\"ecpm\"\\s*:\\s*0(?:\\.0+)?(?=\\s*[,}])",
          ),
        ),
      },
    ],
  ),
  ieCase(
    "ie_localization_fail",
    "本地化资源加载失败",
    "I2 本地化附加数据加载失败",
    [
      {
        effect: "error",
        description: "本地化附加数据加载失败",
        expr: all(unityTag(), has("Unable to load additional Localization data")),
      },
    ],
  ),
  ieCase(
    "ie_adjust_revenue_fail",
    "Adjust 收入回传监控",
    "MAX 和 TopOn 的收入回传都成功送达 Adjust 才判定通过；缺少任一成功日志时显示疑似",
    [
      {
        effect: "pass",
        description: "MAX 收入成功回传 Adjust",
        expr: all(
          cond("tag", "equals", "Android.revenueToMMP"),
          has("max to adjust suc"),
        ),
      },
      {
        effect: "pass",
        description: "TopOn 收入成功回传 Adjust",
        expr: all(
          cond("tag", "equals", "Android.revenueToMMP"),
          has("topon To Adjust suc"),
        ),
      },
    ],
    { requirePass: true },
  ),
  ieCase(
    "ie_ui_fail",
    "UI 资源加载失败",
    "弹窗 prefab 加载失败、组件缺失",
    [
      {
        effect: "error",
        description: "弹窗加载失败",
        expr: all(
          unityTag(),
          hasAny("Failed to load popup", "Popup prefab not found in Resources folder"),
        ),
      },
      {
        effect: "error",
        description: "奖励 Toast 组件缺失",
        expr: all(unityTag(), has("RewardToast"), has("组件为空")),
      },
      {
        effect: "error",
        description: "宝箱预制体未设置",
        expr: all(unityTag(), has("宝箱预制体未设置")),
      },
      {
        effect: "error",
        description: "ToastManager 或奖励组件缺失",
        expr: all(unityTag(), has("ToastManager instance not found")),
      },
      {
        effect: "error",
        description: "提现输入字段与 prefab 绑定不一致",
        expr: all(
          unityTag(),
          has("需要"),
          has("个输入字段"),
          has("prefab 只绑定了"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_save_fail",
    "存档与文件操作失败",
    "本地存档写入、清理和资源文件读取失败",
    [
      {
        effect: "error",
        description: "写入文件失败",
        expr: all(unityTag(), has("写入文件失败")),
      },
      {
        effect: "error",
        description: "清理全部存档或目录失败",
        expr: all(
          unityTag(),
          hasAny("Error deleting all game data", "Error deleting directory"),
        ),
      },
      {
        effect: "error",
        description: "所需文件不存在",
        expr: all(unityTag(), has("Can Not Find File")),
      },
      {
        effect: "warn",
        description: "单个存档文件删除失败",
        expr: all(unityTag(), has("Failed to delete")),
      },
    ],
  ),
  ieCase(
    "ie_runtime_fail",
    "激励框架兜底异常",
    "激励框架主流程捕获到未预期异常",
    [
      {
        effect: "error",
        description: "激励框架发生未预期异常",
        expr: all(
          unityTag(),
          has("[IncentiveEngineManager]"),
          has("意外错误:"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_task_fail",
    "任务系统配置或执行异常",
    "任务系统缺少初始化、必要参数或 UI prefab",
    [
      {
        effect: "error",
        description: "任务系统确定性配置错误",
        expr: all(
          unityTag(),
          hasAny(
            "IAAManager 未初始化",
            "互动广告任务缺少 url",
            "找不到 CheckIn prefab",
            "找不到 TaskItem prefab",
          ),
        ),
      },
    ],
  ),
  ieCase(
    "ie_task_warn",
    "任务接口或兼容性异常",
    "任务接口失败、未知任务类型或任务广告不可用",
    [
      {
        effect: "warn",
        description: "任务列表、类型或广告出现可恢复问题",
        expr: all(
          unityTag(),
          hasAny(
            "任务列表拉取失败",
            "未知任务类型:",
            "任务广告加载失败",
          ),
        ),
      },
      {
        effect: "warn",
        description: "任务行为接口返回失败",
        expr: all(
          unityTag(),
          has("[TaskActionHandler]"),
          has("失败: code="),
        ),
      },
    ],
  ),
  ieCase(
    "ie_level_fail",
    "关卡或升级流程异常",
    "服务端关卡配置异常或玩家升级流程抛出异常",
    [
      {
        effect: "error",
        description: "关卡配置或升级流程异常",
        expr: all(
          unityTag(),
          hasAny("服务端关卡配置请求异常", "升级流程异常:"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_reward_fail",
    "奖励接口失败",
    "升级、翻倍或悬浮宝箱奖励接口返回失败",
    [
      {
        effect: "error",
        description: "奖励接口返回失败",
        expr: all(
          unityTag(),
          hasAny(
            "获取升级奖励失败:",
            "获取翻倍奖励失败:",
            "获取悬浮宝箱奖励失败:",
          ),
        ),
      },
    ],
  ),
  ieCase(
    "ie_reward_fallback",
    "广告奖励降级",
    "奖励广告播放失败后执行不翻倍发放或提示不可用",
    [
      {
        effect: "warn",
        description: "奖励广告播放失败并降级",
        expr: all(
          unityTag(),
          hasAny("翻倍广告播放失败，发放当前奖励", "宝箱激励广告播放失败"),
        ),
      },
    ],
  ),
  ieCase(
    "ie_cloud_config_fail",
    "云控桥接异常",
    "Unity 云控未初始化、数据转换失败或 Android 真机仍使用默认实现",
    [
      {
        effect: "error",
        description: "云控未初始化或数据转换失败",
        expr: all(
          unityTag(),
          hasAny("CloudConfig 未初始化", "转换失败："),
        ),
      },
      {
        effect: "error",
        description: "Android 真机使用 DefaultCloudConfig",
        expr: all(unityTag(), has("DefaultCloudConfig ")),
      },
    ],
  ),
  ieCase(
    "ie_analytics_fail",
    "业务埋点异常",
    "Beyla/Firebase 埋点未初始化、参数非法或依赖初始化失败",
    [
      {
        effect: "error",
        description: "业务埋点调用或初始化失败",
        expr: all(
          unityTag(),
          hasAny(
            "Beyla 埋点未初始化",
            "Event ID cannot be null or empty",
            "Failed to log event",
            "Could not resolve all Firebase dependencies",
          ),
        ),
      },
    ],
  ),
  ieCase(
    "ie_ua_adjust_event",
    "UA 埋点监控",
    "必须观察到 AdjustCollector 的 UA 特殊事件日志；未出现时显示疑似",
    [
      {
        effect: "pass",
        description: "UA 特殊事件已发送到 Adjust",
        expr: all(
          cond("tag", "equals", "Android.AdjustCollector"),
          has("onSpecialEvent()"),
        ),
      },
    ],
    { requirePass: true },
  ),
  ieCase(
    "plugin_analytics_fail",
    "Android 埋点桥接异常",
    "Unity/Android 埋点桥接使用了废弃初始化入口、初始化前调用或发生原生异常",
    [
      {
        effect: "error",
        description: "Unity 埋点桥接调用了已移除的初始化方法",
        expr: all(unityTag(), has("Android 初始化方法已移除")),
      },
      {
        effect: "warn",
        description: "Android 埋点桥接尚未初始化即被调用",
        expr: all(has("AndroidAnalytics"), has("has not init")),
      },
      {
        effect: "error",
        description: "Android 埋点桥接发生原生异常",
        expr: all(
          cond("tag", "equals", "Android.BeylaAnalytics"),
          cond("level", "equals", "E"),
        ),
      },
    ],
  ),
  ieCase(
    "plugin_promotion_fail",
    "渠道归因异常",
    "Unity 渠道桥接未初始化，或 Android 渠道/Install Referrer 查询解析失败",
    [
      {
        effect: "warn",
        description: "Unity 渠道桥接尚未初始化",
        expr: all(
          unityTag(),
          hasAny(
            "PromotionManager GetPromotionChannel not init",
            "PromotionManager GetAdjustPromotionChannel not init",
          ),
        ),
      },
      {
        effect: "warn",
        description: "Android 渠道或 UTM 查询解析失败",
        expr: all(
          cond("tag", "equals", "Android.AndroidPromotio"),
          hasAny(
            "[channel] get priority channel failed",
            "[channel] get adjust channel failed",
            "[utm-service] query or parse failed",
            "[utm-service] startConnection failed",
            "[utm-service] close connection failed",
            "[utm-parse] failed",
          ),
        ),
      },
    ],
  ),
  ieCase(
    "sdk_beyla_data_fail",
    "Beyla 埋点数据异常",
    "Beyla 事件参数、大小或本地数据库操作异常，可能造成埋点降级或丢失",
    [
      {
        effect: "warn",
        description: "Beyla 事件参数或大小异常",
        expr: hasAny("Event out of count", "onEvent BL_ParamErr"),
      },
      {
        effect: "warn",
        description: "Beyla 本地事件数据库操作失败",
        expr: hasAny(
          "add event failed!",
          "get events failed!",
          "batch insert cached events failed!",
        ),
      },
    ],
  ),
  ieCase(
    "sdk_config_storage_fail",
    "Android 云控缓存异常",
    "SDKConfig 读取云控/AB 缓存或保存自定义参数失败",
    [
      {
        effect: "warn",
        description: "Android 云控缓存读写异常",
        expr: hasAny(
          "loadAllCache--InterruptedException",
          "loadAbInfoCache err",
          "addCustomParams err",
        ),
      },
    ],
  ),
  ieCase(
    "anticheat_runtime_fail",
    "反作弊运行异常",
    "同盾 token 获取失败并降级，或 SDK 返回明确错误码",
    [
      {
        effect: "warn",
        description: "反作弊 token 为空，已使用默认 token",
        expr: all(
          cond("tag", "equals", "Android.AntiCheatingMan"),
          has("getAcToken()  acToken is null"),
        ),
      },
      {
        effect: "error",
        description: "同盾 SDK 返回错误码",
        expr: all(
          cond("tag", "equals", "Android.AntiCheatingMan"),
          has("errorCode:"),
          has("errorMsg:"),
        ),
      },
    ],
  ),
  ieCase(
    "anticheat_init",
    "反作弊 SDK 初始化完成",
    "哨兵：同盾 SDK 加载成功后 20 秒内应完成初始化",
    [
      {
        effect: "error",
        description: "同盾 SDK 初始化未完成（缺失判定）",
        expr: all(
          cond("tag", "equals", "TD_JAVA"),
          has("TD sdk init success"),
        ),
        absence: {
          anchor: all(
            cond("tag", "equals", "TD_JAVA"),
            has("TD sdk load success"),
          ),
          withinSec: 20,
        },
      },
      {
        effect: "pass",
        description: "同盾 SDK 初始化完成",
        expr: all(
          cond("tag", "equals", "TD_JAVA"),
          has("TD sdk init success"),
        ),
      },
    ],
  ),
];

// 内置激励框架用例按模块分组
const IE_GROUPS: Record<string, string> = {
  ie_sdk_init: "初始化",
  ie_config_missing: "配置",
  ie_network_fail: "网络",
  ie_cheating: "反作弊",
  ie_userinfo_fail: "用户数据",
  ie_withdraw_fail: "提现",
  ie_prop_fail: "道具",
  ie_ad_fail: "广告",
  ie_ad_ecpm_fail: "广告",
  ie_anticheat_fail: "反作弊",
  ie_localization_fail: "本地化",
  ie_adjust_revenue_fail: "广告",
  ie_ui_fail: "UI",
  ie_save_fail: "存档",
  ie_runtime_fail: "初始化",
  ie_task_fail: "任务",
  ie_task_warn: "任务",
  ie_level_fail: "关卡",
  ie_reward_fail: "奖励",
  ie_reward_fallback: "奖励",
  ie_cloud_config_fail: "云控",
  ie_analytics_fail: "埋点",
  ie_ua_adjust_event: "埋点",
  plugin_analytics_fail: "埋点",
  plugin_promotion_fail: "归因",
  sdk_beyla_data_fail: "埋点",
  sdk_config_storage_fail: "云控",
  anticheat_runtime_fail: "反作弊",
  anticheat_init: "反作弊",
};

const IE_CASES_GROUPED: TestCase[] = IE_CASES.map((tc) => ({
  ...tc,
  group: IE_GROUPS[tc.id] ?? "自定义",
}));

// 内置示例用例（阶段一/二占位，之后可远程更新）。
export const BUILTIN_TEST_CASES: TestCase[] = [
  {
    id: "no_crash",
    name: "无崩溃",
    description: "不应出现 Java/Kotlin FATAL EXCEPTION 或 native Fatal signal",
    scope: { global: true, apps: [] },
    group: "稳定性",
    rules: [
      {
        effect: "error",
        description: "出现 Java/Kotlin 崩溃日志",
        expr: all(
          cond("tag", "equals", "AndroidRuntime"),
          cond("message", "contains", "FATAL EXCEPTION"),
        ),
      },
      {
        effect: "error",
        description: "出现 native 崩溃信号",
        expr: all(
          cond("tag", "equals", "libc"),
          cond("message", "regex", "\\bFatal signal\\s+\\d+"),
        ),
      },
    ],
  },
  {
    id: "network_error",
    name: "网络响应异常",
    description: "任一接口返回 result_code 不为 200 即视为异常",
    scope: { global: true, apps: [] },
    group: "网络",
    rules: [
      {
        effect: "error",
        description: "网络响应异常（result_code ≠ 200）",
        expr: all(
          cond("tag", "equals", "Unity"),
          cond("message", "contains", "NetWorkLog:Response"),
          cond(
            "message",
            "regex",
            `"result_code"\\s*:\\s*(?!200(?:\\D|$))-?\\d+`,
          ),
        ),
      },
    ],
  },
  ...IE_CASES_GROUPED,
];

/**
 * 是否为内置测试用例。
 * 判定走 builtinRegistry（远程配置生效后按远程用例列表判定）。
 */
export function isBuiltinTestCase(id: string): boolean {
  return isBuiltinTestCaseDynamic(id);
}

export function conditionMatches(cond: Condition, entry: LogEntry): boolean {
  const fieldValue =
    cond.field === "message"
      ? entry.message
      : cond.field === "tag"
        ? entry.tag
        : entry.level;
  switch (cond.op) {
    case "contains":
      return fieldValue.toLowerCase().includes(cond.value.toLowerCase());
    case "not_contains":
      return !fieldValue.toLowerCase().includes(cond.value.toLowerCase());
    case "equals":
      return fieldValue.toLowerCase() === cond.value.toLowerCase();
    case "not_equals":
      return fieldValue.toLowerCase() !== cond.value.toLowerCase();
    case "regex": {
      try {
        return new RegExp(cond.value, "i").test(fieldValue);
      } catch {
        return false;
      }
    }
  }
}

export function evalExpr(expr: ConditionExpr, entry: LogEntry): boolean {
  if (expr.kind === "cond") return conditionMatches(expr.cond, entry);
  return expr.op === "and"
    ? expr.children.every((c) => evalExpr(c, entry))
    : expr.children.some((c) => evalExpr(c, entry));
}

export function ruleMatches(rule: Rule, entry: LogEntry): boolean {
  return evalExpr(rule.expr, entry);
}

export function caseAppliesTo(tc: TestCase, pkg: string): boolean {
  if (tc.scope.global) return true;
  return tc.scope.apps.includes(pkg);
}

// —— 规则摘要（UI 预览用）——

export const EFFECT_LABELS: Record<RuleEffect, string> = {
  pass: "出现→通过",
  error: "出现→报错",
  warn: "出现→警告",
};

const FIELD_LABELS: Record<ConditionField, string> = {
  message: "消息",
  tag: "Tag",
  level: "级别",
};

const OP_LABELS: Record<ConditionOp, string> = {
  contains: "包含",
  not_contains: "不包含",
  equals: "等于",
  not_equals: "不等于",
  regex: "匹配正则",
};

export function condText(c: Condition): string {
  return `${FIELD_LABELS[c.field]} ${OP_LABELS[c.op]} "${c.value}"`;
}

/** 把条件树翻译成中文摘要。 */
export function exprText(expr: ConditionExpr): string {
  if (expr.kind === "cond") return condText(expr.cond);
  const op = expr.op === "and" ? "且" : "或";
  return expr.children.map(exprText).join(` ${op} `);
}

/** 规则的中文摘要（含出现次数 / 缺失判定语义）。 */
export function ruleSummary(rule: Rule): string {
  if (rule.absence) {
    return `缺失判定：锚点[${exprText(rule.absence.anchor)}] 出现后 ${rule.absence.withinSec}s 内未匹配 ${exprText(rule.expr)}`;
  }
  const prefix =
    rule.minCount && rule.minCount > 1
      ? `出现 ${rule.minCount} 次触发：`
      : "";
  return prefix + exprText(rule.expr);
}
