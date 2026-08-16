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
  entry: LogEntry | null;
  /** 缺失判定触发（观察窗口内未出现） */
  missing?: boolean;
  /** 触发时刻（Date.now 毫秒），用于「新出现的问题排最上」 */
  triggeredAt?: number;
}

/** 内部规则状态：在 RuleHit 基础上增加计数与缺失判定状态机。 */
interface RuleState extends RuleHit {
  count: number;
  absence: "idle" | "waiting" | "satisfied";
  anchorAt: number;
}

export interface TestCaseResult {
  testCase: TestCase;
  status: CaseStatus;
  ruleHits: RuleHit[];
}

function initStates(tc: TestCase): RuleState[] {
  return tc.rules.map(() => ({
    hit: false,
    entry: null,
    missing: false,
    triggeredAt: 0,
    count: 0,
    absence: "idle",
    anchorAt: 0,
  }));
}

function computeStatus(tc: TestCase, hits: RuleHit[]): CaseStatus {
  if (tc.enabled === false) return "disabled";
  let hasError = false;
  let hasWarn = false;
  let allPass = true;
  for (let i = 0; i < tc.rules.length; i++) {
    if (tc.rules[i].effect === "error" && hits[i].hit) hasError = true;
    if (tc.rules[i].effect === "warn" && hits[i].hit) hasWarn = true;
    if (tc.rules[i].effect === "pass" && !hits[i].hit) allPass = false;
  }
  if (hasError) return "fail";
  if (hasWarn) return "suspected";
  if (allPass) return "pass";
  return "pending";
}

export function useTestCases(
  allEntries: LogEntry[],
  scopePkg: string,
  pidFilter: string,
  cases: TestCase[],
) {
  const [version, setVersion] = useState(0);
  const hitsRef = useRef<Record<string, RuleState[]>>({});
  const fingerprintRef = useRef<Record<string, string>>({});
  const processedRef = useRef(0);
  const contextRef = useRef("");

  const visibleCases = useMemo(
    () => cases.filter((tc) => caseAppliesTo(tc, scopePkg)),
    [cases, scopePkg],
  );

  const recompute = useCallback(() => setVersion((v) => v + 1), []);

  // 开始新测试：清空状态，从当前时刻重新计（不回放历史）。
  const resetAll = useCallback(() => {
    hitsRef.current = {};
    fingerprintRef.current = {};
    processedRef.current = allEntries.length;
    recompute();
  }, [allEntries.length, recompute]);

  const resetCase = useCallback(
    (id: string) => {
      delete hitsRef.current[id];
      delete fingerprintRef.current[id];
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
        const states = hitsRef.current[tc.id];
        if (!states) continue;
        for (let r = 0; r < tc.rules.length; r++) {
          const rule = tc.rules[r];
          const st = states[r];
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
    const pidSet = new Set(
      pidFilter
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const context = `${scopePkg}|${pidFilter}`;
    if (contextRef.current !== context) {
      // 切换应用：重置并按新应用重新评估整个缓冲
      contextRef.current = context;
      hitsRef.current = {};
      fingerprintRef.current = {};
      processedRef.current = 0;
    }

    for (let i = processedRef.current; i < allEntries.length; i++) {
      const entry = allEntries[i];
      if (pidSet.size > 0 && !pidSet.has(entry.pid)) continue;
      for (const tc of visibleCases) {
        // 规则内容变化时重置该用例的状态（避免计数/状态机错位）
        const fp = JSON.stringify(tc.rules);
        if (fingerprintRef.current[tc.id] !== fp) {
          fingerprintRef.current[tc.id] = fp;
          hitsRef.current[tc.id] = initStates(tc);
        }
        const states = hitsRef.current[tc.id];
        for (let r = 0; r < tc.rules.length; r++) {
          const rule = tc.rules[r];
          const st = states[r];
          if (st.hit) continue;
          if (rule.absence) {
            // 缺失判定：锚点出现即开始新的观察窗口；窗口内匹配 expr 则满足
            if (evalExpr(rule.absence.anchor, entry)) {
              st.absence = "waiting";
              st.anchorAt = Date.now();
            } else if (st.absence === "waiting" && ruleMatches(rule, entry)) {
              st.absence = "satisfied";
            }
          } else if (ruleMatches(rule, entry)) {
            const min = rule.minCount && rule.minCount > 1 ? rule.minCount : 1;
            st.count += 1;
            if (st.count >= min) {
              st.hit = true;
              st.entry = entry;
              st.triggeredAt = Date.now();
            }
          }
        }
      }
    }
    processedRef.current = allEntries.length;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries, scopePkg, pidFilter, visibleCases]);

  const results = useMemo(() => {
    return visibleCases.map((tc) => {
      const states = hitsRef.current[tc.id] ?? initStates(tc);
      return {
        testCase: tc,
        status: computeStatus(tc, states),
        ruleHits: states.map((s) => ({
          hit: s.hit,
          entry: s.entry,
          missing: s.missing,
          triggeredAt: s.triggeredAt,
        })),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCases, version]);

  return { results, resetAll, resetCase };
}
