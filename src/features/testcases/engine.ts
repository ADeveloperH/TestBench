import type { LogEntry } from "../../core/types";

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
): TestCase {
  return { id, name, description, scope: { global: true, apps: [] }, rules };
}

const IE_CASES: TestCase[] = [
  ieCase(
    "ie_config_missing",
    "激励框架配置缺失",
    "SDK 配置项未配置或配置资产缺失（游戏集成时最常见问题）",
    [
      {
        effect: "error",
        description: "配置项未配置（必填项）",
        expr: all(unityTag(), has("[Config]"), has("未配置")),
      },
      {
        effect: "error",
        description: "IncentiveEngineConfig 资产缺失",
        expr: all(unityTag(), has("IncentiveEngineConfig not found")),
      },
      {
        effect: "error",
        description: "国家配置错误（未勾选支持国家 / defaultCountry 非法）",
        expr: all(unityTag(), has("[Config]"), has("国家")),
      },
    ],
  ),
  ieCase(
    "ie_network_fail",
    "激励框架网络请求失败",
    "框架接口请求失败或异常（统一出口 ApiManager）",
    [
      {
        effect: "error",
        description: "接口请求失败",
        expr: all(unityTag(), has("请求失败:")),
      },
      {
        effect: "error",
        description: "接口请求异常",
        expr: all(unityTag(), has("请求异常:")),
      },
      {
        effect: "error",
        description: "NetworkManager 未初始化",
        expr: all(unityTag(), has("NetworkManager未初始化")),
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
    "用户信息拉取失败",
    "用户信息接口失败或异常（含重试耗尽）",
    [
      {
        effect: "error",
        description: "用户信息拉取失败",
        expr: all(unityTag(), has("用户信息拉取失败")),
      },
      {
        effect: "error",
        description: "用户信息拉取异常",
        expr: all(unityTag(), has("用户信息拉取异常")),
      },
    ],
  ),
  ieCase(
    "ie_withdraw_fail",
    "提现流程失败",
    "提现档位拉取失败、提现提交失败/异常",
    [
      {
        effect: "error",
        description: "提现档位拉取失败或异常",
        expr: all(unityTag(), has("提现档位拉取"), hasAny("失败", "异常")),
      },
      {
        effect: "error",
        description: "提现提交失败",
        expr: all(unityTag(), has("提现失败")),
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
    "道具初始化失败",
    "道具数据初始化失败或异常（含重试）",
    [
      {
        effect: "error",
        description: "道具初始化失败或异常",
        expr: all(unityTag(), has("道具初始化"), hasAny("失败", "异常")),
      },
    ],
  ),
  ieCase(
    "ie_ad_fail",
    "广告插件异常",
    "广告原生桥接失败、聚合未配置、广告位策略无效（不依赖 ENABLE_LOG 的校验日志）",
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
    "ie_ui_fail",
    "UI 资源加载失败",
    "弹窗 prefab 加载失败、组件缺失",
    [
      {
        effect: "error",
        description: "弹窗加载失败",
        expr: all(unityTag(), has("Failed to load popup")),
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
    ],
  ),
  ieCase(
    "ie_save_fail",
    "存档写入失败",
    "本地存档/文件写入失败",
    [
      {
        effect: "error",
        description: "写入文件失败",
        expr: all(unityTag(), has("写入文件失败")),
      },
    ],
  ),
];

// 内置示例用例（阶段一/二占位，之后可远程更新）。
export const BUILTIN_TEST_CASES: TestCase[] = [
  {
    id: "no_crash",
    name: "无崩溃",
    description: "不应出现 Android 崩溃（FATAL EXCEPTION）",
    scope: { global: true, apps: [] },
    rules: [
      {
        effect: "error",
        description: "出现崩溃日志",
        expr: all(
          cond("tag", "equals", "AndroidRuntime"),
          cond("message", "contains", "FATAL EXCEPTION"),
        ),
      },
    ],
  },
  {
    id: "no_anr",
    name: "无 ANR",
    description: "不应出现应用无响应（ANR）",
    scope: { global: true, apps: [] },
    rules: [
      {
        effect: "error",
        description: "出现 ANR",
        expr: all(
          cond("tag", "equals", "ActivityManager"),
          cond("message", "contains", "ANR in"),
        ),
      },
    ],
  },
  {
    id: "network_error",
    name: "网络响应异常",
    description: "任一接口返回 result_code 不为 200 即视为异常",
    scope: { global: true, apps: [] },
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
            `"result_code"\\s*:\\s*(?!200(?:\\D|$))\\d+`,
          ),
        ),
      },
    ],
  },
  ...IE_CASES,
];

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
