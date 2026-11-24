import { advanceCaseState, initCaseState, computeStatus, type CaseState, type RuleHit, type CaseStatus } from "./testCaseEvaluation";
export type { CaseStatus, RuleHit } from "./testCaseEvaluation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../../core/types";
import { caseRuntimeFingerprint } from "./caseConfig";
import {
  caseAppliesTo,
  type TestCase,
} from "./engine";

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

/** 会话缓存有界；每条规则的证据上限由共享评估器维护。 */
const MAX_CACHED_SESSIONS = 24;
const sessionRuntimes = new Map<string, TestSessionRuntime>();

export function invalidateCaseRuntimes(ids?: ReadonlySet<string>): void {
  for (const runtime of sessionRuntimes.values()) {
    for (const id of Object.keys(runtime.hits)) {
      if (!ids || ids.has(id)) {
        delete runtime.hits[id];
        delete runtime.fingerprints[id];
      }
    }
  }
}

/** 清理所有缓存会话，不仅是当前显示的测试 Tab。 */
export function syncCaseRuntimes(cases: TestCase[]): void {
  const fingerprints = new Map(cases.map((tc) => [tc.id, caseRuntimeFingerprint(tc)]));
  for (const runtime of sessionRuntimes.values()) {
    for (const id of Object.keys(runtime.hits)) {
      if (runtime.fingerprints[id] !== fingerprints.get(id)) {
        delete runtime.hits[id];
        delete runtime.fingerprints[id];
      }
    }
  }
}

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
      fingerprint: caseRuntimeFingerprint(tc),
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
        advanceCaseState(tc, cs, entry);
      }
      changed = true;
    }
    runtime.lastProcessedId = latestId;
    if (changed) recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries, scopePkg, pidFilter, visibleCases, sessionKey]);

  const results = useMemo(() => {
    return visibleCases.map((tc) => {
      const runtime = runtimeRef.current;
      const cs = runtime.fingerprints[tc.id] === caseRuntimeFingerprint(tc)
        ? runtime.hits[tc.id] ?? initCaseState(tc)
        : initCaseState(tc);
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
