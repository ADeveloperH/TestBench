import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../../core/types";
import {
  caseAppliesTo,
  evalExpr,
  ruleMatches,
  type TestCase,
} from "./engine";

export type CaseStatus = "fail" | "suspected" | "pass" | "pending" | "disabled";

export interface RuleHit {
  hit: boolean;
  /** 本轮测试的总命中数。 */
  totalCount: number;
  /** 最近命中的日志证据，按时间正序保存。 */
  entries: LogEntry[];
  /** 缺失判定触发（观察窗口内未出现） */
  missing?: boolean;
  /** 触发时刻（Date.now 毫秒），用于「新出现的问题排最上」 */
  triggeredAt?: number;
}

/** 内部规则状态：在 RuleHit 基础上增加计数与缺失判定状态机。 */
interface RuleState extends RuleHit {
  absence: "idle" | "waiting" | "satisfied";
  anchorAt: number;
}

/** 每个用例的执行状态：自开始测试以来可见的日志数 + 各规则状态。 */
interface CaseState {
  seenLogs: number;
  rules: RuleState[];
}

interface TestSessionRuntime {
  key: string;
  context: string;
  lastProcessedId: number;
  hits: Record<string, CaseState>;
  fingerprints: Record<string, string>;
}

export interface TestCaseResult {
  testCase: TestCase;
  status: CaseStatus;
  ruleHits: RuleHit[];
}

/** 每条规则只保留最近的日志引用，命中总数仍完整累计。 */
const MAX_RULE_HIT_ENTRIES = 50;
const MAX_CACHED_SESSIONS = 24;
const sessionRuntimes = new Map<string, TestSessionRuntime>();

function createRuntime(key: string): TestSessionRuntime {
  return {
    key,
    context: "",
    lastProcessedId: -1,
    hits: {},
    fingerprints: {},
  };
}

function runtimeFor(key: string): TestSessionRuntime {
  const cached = sessionRuntimes.get(key);
  if (cached) return cached;
  const runtime = createRuntime(key);
  sessionRuntimes.set(key, runtime);
  if (sessionRuntimes.size > MAX_CACHED_SESSIONS) {
    const oldest = sessionRuntimes.keys().next().value;
    if (typeof oldest === "string") sessionRuntimes.delete(oldest);
  }
  return runtime;
}

function firstEntryAfter(entries: LogEntry[], id: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entries[middle].id <= id) low = middle + 1;
    else high = middle;
  }
  return low;
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

function initCaseState(tc: TestCase): CaseState {
  return { seenLogs: 0, rules: initStates(tc) };
}

function computeStatus(tc: TestCase, cs: CaseState): CaseStatus {
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

export function useTestCases(
  allEntries: LogEntry[],
  scopePkg: string,
  pidFilter: string,
  cases: TestCase[],
  sessionKey = "",
) {
  const [version, setVersion] = useState(0);
  const runtimeKey = sessionKey || `default:${scopePkg}`;
  const runtimeRef = useRef(runtimeFor(runtimeKey));
  if (runtimeRef.current.key !== runtimeKey) {
    runtimeRef.current = runtimeFor(runtimeKey);
  }

  const visibleCases = useMemo(
    () => cases.filter((tc) => caseAppliesTo(tc, scopePkg)),
    [cases, scopePkg],
  );

  const recompute = useCallback(() => setVersion((v) => v + 1), []);

  // 开始新测试：清空状态，从当前时刻重新计（不回放历史）。
  const resetAll = useCallback(() => {
    const runtime = runtimeRef.current;
    runtime.hits = {};
    runtime.fingerprints = {};
    runtime.lastProcessedId = allEntries[allEntries.length - 1]?.id ?? -1;
    recompute();
  }, [allEntries, recompute]);

  const resetCase = useCallback(
    (id: string) => {
      delete runtimeRef.current.hits[id];
      delete runtimeRef.current.fingerprints[id];
      recompute();
    },
    [recompute],
  );

  // 缺失判定超时检查：观察窗口到期仍未匹配则触发。
  useEffect(() => {
    const timer = setInterval(() => {
      let changed = false;
      const now = Date.now();
      for (const tc of visibleCases) {
        const cs = runtimeRef.current.hits[tc.id];
        if (!cs) continue;
        for (let r = 0; r < tc.rules.length; r++) {
          const rule = tc.rules[r];
          const st = cs.rules[r];
          if (
            rule.absence &&
            st.absence === "waiting" &&
            !st.hit &&
            now - st.anchorAt >= rule.absence.withinSec * 1000
          ) {
            st.hit = true;
            st.missing = true;
            st.triggeredAt = Date.now();
            changed = true;
          }
        }
      }
      if (changed) recompute();
    }, 500);
    return () => clearInterval(timer);
  }, [visibleCases, recompute]);

  // 增量评估：只处理新到的日志条目。
  useEffect(() => {
    const runtime = runtimeRef.current;
    const pidSet = new Set(
      pidFilter
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const context = `${scopePkg}|${pidFilter}|${sessionKey}`;
    let changed = false;
    if (runtime.context !== context) {
      // 切换应用：重置并按新应用重新评估整个缓冲
      runtime.context = context;
      runtime.hits = {};
      runtime.fingerprints = {};
      runtime.lastProcessedId = -1;
      changed = true;
    }

    // 规则指纹只计算一次，不能放在“日志 × 用例”内层循环中。
    const preparedCases = visibleCases.map((tc) => ({
      tc,
      fingerprint: JSON.stringify(tc.rules),
    }));
    for (const { tc, fingerprint } of preparedCases) {
      if (runtime.fingerprints[tc.id] !== fingerprint) {
        runtime.fingerprints[tc.id] = fingerprint;
        runtime.hits[tc.id] = initCaseState(tc);
        changed = true;
      }
    }

    const latestId = allEntries[allEntries.length - 1]?.id ?? -1;
    if (runtime.lastProcessedId > latestId) {
      // 新的 logcat 会话从 0 重新编号，旧会话状态不能复用。
      runtime.hits = {};
      runtime.fingerprints = Object.fromEntries(
        preparedCases.map(({ tc, fingerprint }) => [tc.id, fingerprint]),
      );
      for (const { tc } of preparedCases) runtime.hits[tc.id] = initCaseState(tc);
      runtime.lastProcessedId = -1;
      changed = true;
    }

    const start = firstEntryAfter(allEntries, runtime.lastProcessedId);
    for (let i = start; i < allEntries.length; i++) {
      const entry = allEntries[i];
      if (pidSet.size > 0 && !pidSet.has(entry.pid)) continue;
      for (const { tc } of preparedCases) {
        let cs = runtime.hits[tc.id];
        if (!cs) {
          cs = initCaseState(tc);
          runtime.hits[tc.id] = cs;
        }
        cs.seenLogs += 1;
        for (let r = 0; r < tc.rules.length; r++) {
          const rule = tc.rules[r];
          const st = cs.rules[r];
          if (rule.absence) {
            if (st.hit) continue;
            // 缺失判定：锚点出现即开始新的观察窗口；窗口内匹配 expr 则满足
            if (evalExpr(rule.absence.anchor, entry)) {
              st.absence = "waiting";
              st.anchorAt = Date.now();
            } else if (st.absence === "waiting" && ruleMatches(rule, entry)) {
              st.absence = "satisfied";
            }
          } else if (ruleMatches(rule, entry)) {
            const min = rule.minCount && rule.minCount > 1 ? rule.minCount : 1;
            st.totalCount += 1;
            st.entries.push(entry);
            if (st.entries.length > MAX_RULE_HIT_ENTRIES) {
              st.entries.splice(0, st.entries.length - MAX_RULE_HIT_ENTRIES);
            }
            if (st.totalCount >= min) {
              st.hit = true;
              st.triggeredAt = Date.now();
            }
          }
        }
      }
      changed = true;
    }
    runtime.lastProcessedId = latestId;
    if (changed) recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries, scopePkg, pidFilter, visibleCases, sessionKey]);

  const results = useMemo(() => {
    return visibleCases.map((tc) => {
      const cs = runtimeRef.current.hits[tc.id] ?? initCaseState(tc);
      return {
        testCase: tc,
        status: computeStatus(tc, cs),
        ruleHits: cs.rules.map((s) => ({
          hit: s.hit,
          totalCount: s.totalCount,
          entries: [...s.entries],
          missing: s.missing,
          triggeredAt: s.triggeredAt,
        })),
      };
    });
  }, [visibleCases, version, runtimeKey]);

  return { results, resetAll, resetCase };
}
