import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../../core/types";
import { caseAppliesTo, ruleMatches, type TestCase } from "./engine";

export type CaseStatus = "fail" | "suspected" | "pass" | "pending" | "disabled";

export interface RuleHit {
  hit: boolean;
  entry: LogEntry | null;
}

export interface TestCaseResult {
  testCase: TestCase;
  status: CaseStatus;
  ruleHits: RuleHit[];
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
  const hitsRef = useRef<Record<string, RuleHit[]>>({});
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
    processedRef.current = allEntries.length;
    recompute();
  }, [allEntries.length, recompute]);

  const resetCase = useCallback(
    (id: string) => {
      delete hitsRef.current[id];
      recompute();
    },
    [recompute],
  );

  // 增量评估：只处理新到的日志条目，命中即锁存并记录命中日志。
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
      processedRef.current = 0;
    }

    for (let i = processedRef.current; i < allEntries.length; i++) {
      const entry = allEntries[i];
      if (pidSet.size > 0 && !pidSet.has(entry.pid)) continue;
      for (const tc of visibleCases) {
        let hits = hitsRef.current[tc.id];
        if (!hits) {
          hits = tc.rules.map(() => ({ hit: false, entry: null }));
          hitsRef.current[tc.id] = hits;
        }
        for (let r = 0; r < tc.rules.length; r++) {
          if (!hits[r].hit && ruleMatches(tc.rules[r], entry)) {
            hits[r] = { hit: true, entry };
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
      const hits =
        hitsRef.current[tc.id] ??
        tc.rules.map(() => ({ hit: false, entry: null }));
      return {
        testCase: tc,
        status: computeStatus(tc, hits),
        ruleHits: hits,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCases, version]);

  return { results, resetAll, resetCase };
}
