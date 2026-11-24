import type { TestLogEntry } from "./testLogEntry";
import { evalExpr, ruleMatches, type TestCase } from "./engine";

export type CaseStatus = "fail" | "suspected" | "pass" | "pending" | "disabled";

export interface RuleHit {
  hit: boolean;
  /** 本轮测试的总命中数。 */
  totalCount: number;
  /** 最近命中的日志证据，按时间正序保存。 */
  entries: TestLogEntry[];
  /** 缺失判定触发（观察窗口内未出现） */
  missing?: boolean;
  /** 评估器时钟中的触发时刻，用于「新出现的问题排最上」。 */
  triggeredAt?: number;
  /** 可选的缺失观察锚点；不是目标命中，不参与 totalCount。 */
  anchorEntry?: TestLogEntry;
}

/** 内部规则状态：在 RuleHit 基础上增加计数与缺失判定状态机。 */
interface RuleState extends RuleHit {
  absence: "idle" | "waiting" | "satisfied";
  anchorAt: number;
}

/** 每个用例的执行状态：自开始测试以来可见的日志数 + 各规则状态。 */
export interface CaseState {
  seenLogs: number;
  rules: RuleState[];
}

function initStates(tc: TestCase): RuleState[] {
  return tc.rules.map(() => ({
    hit: false,
    totalCount: 0,
    entries: [],
    missing: false,
    triggeredAt: 0,
    absence: "idle",
    anchorAt: 0,
  }));
}

export function initCaseState(tc: TestCase): CaseState {
  return { seenLogs: 0, rules: initStates(tc) };
}

export function computeStatus(tc: TestCase, cs: CaseState): CaseStatus {
  if (tc.enabled === false) return "disabled";
  let hasError = false;
  let hasWarn = false;
  let hasPassRule = false;
  let allPass = true;
  for (let i = 0; i < tc.rules.length; i++) {
    if (tc.rules[i].effect === "error" && cs.rules[i].hit) hasError = true;
    if (tc.rules[i].effect === "warn" && cs.rules[i].hit) hasWarn = true;
    if (tc.rules[i].effect === "pass") {
      hasPassRule = true;
      if (!cs.rules[i].hit) allPass = false;
    }
  }
  if (hasError) return "fail";
  if (hasWarn) return "suspected";
  // 「通过」只留给带 pass 规则（正向验证）且全部命中的用例；
  // 纯监控类用例（只有 error/warn 规则）无异常时保持「监控中」。
  if (hasPassRule && allPass) return "pass";
  // 需要成功信号闭环的用例，在信号未齐全时主动提醒关注。
  if (tc.requirePass && hasPassRule) return "suspected";
  // 还没测到任何日志 → 监控中（而不是「通过」，避免误读）
  if (cs.seenLogs === 0) return "pending";
  return "pending";
}


/** 与现有 Android 逐条评估保持相同的计数及锚点状态语义。 */
export function advanceCaseState(tc: TestCase, cs: CaseState, entry: TestLogEntry, now = Date.now()): void {
  cs.seenLogs += 1;
  for (let r = 0; r < tc.rules.length; r++) {
    const rule = tc.rules[r]; const st = cs.rules[r];
    if (rule.absence) {
      if (st.hit) continue;
      if (evalExpr(rule.absence.anchor, entry)) { st.absence = "waiting"; st.anchorAt = now; }
      else if (st.absence === "waiting" && ruleMatches(rule, entry)) st.absence = "satisfied";
    } else if (ruleMatches(rule, entry)) {
      const min = rule.minCount && rule.minCount > 1 ? rule.minCount : 1;
      st.totalCount += 1; st.entries.push(entry);
      if (st.entries.length > 50) st.entries.splice(0, st.entries.length - 50);
      if (st.totalCount >= min) { st.hit = true; st.triggeredAt = now; }
    }
  }
}
