import { useCallback, useEffect, useState } from "react";
import { BUILTIN_TEST_CASES, type TestCase } from "./engine";

const KEY = "logcat-testcases-v4";

function loadCases(): TestCase[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        // 内置用例以最新定义为准（框架更新用例后老缓存自动获得新规则），
        // 用户自定义用例（id 不在内置集合内）保留在后。
        const builtinIds = new Set(BUILTIN_TEST_CASES.map((c) => c.id));
        const custom = arr.filter(
          (c) => c && typeof c.id === "string" && !builtinIds.has(c.id),
        );
        return [...BUILTIN_TEST_CASES, ...custom];
      }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return BUILTIN_TEST_CASES;
}

export interface TestCasesStore {
  cases: TestCase[];
  addCase: (tc: TestCase) => void;
  updateCase: (tc: TestCase) => void;
  removeCase: (id: string) => void;
  replaceCases: (cases: TestCase[]) => void;
}

/** 测试用例的持久化存储（localStorage，内置用例作为默认值）。 */
export function useTestCasesStore(): TestCasesStore {
  const [cases, setCases] = useState<TestCase[]>(loadCases);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cases));
    } catch {
      // 忽略写入失败
    }
  }, [cases]);

  const addCase = useCallback((tc: TestCase) => {
    // 新建的用例放最上面，便于立即看到
    setCases((prev) => [tc, ...prev]);
  }, []);

  const updateCase = useCallback((tc: TestCase) => {
    setCases((prev) => prev.map((c) => (c.id === tc.id ? tc : c)));
  }, []);

  const removeCase = useCallback((id: string) => {
    setCases((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const replaceCases = useCallback((cases: TestCase[]) => {
    setCases(cases);
  }, []);

  return { cases, addCase, updateCase, removeCase, replaceCases };
}
