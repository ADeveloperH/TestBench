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
