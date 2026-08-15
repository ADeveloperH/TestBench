import { useCallback, useEffect, useState } from "react";
import { BUILTIN_TEST_CASES, type TestCase } from "./engine";

const KEY = "logcat-testcases-v4";

function loadCases(): TestCase[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as TestCase[];
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
    setCases((prev) => [...prev, tc]);
  }, []);

  const updateCase = useCallback((tc: TestCase) => {
    setCases((prev) => prev.map((c) => (c.id === tc.id ? tc : c)));
  }, []);

  const removeCase = useCallback((id: string) => {
    setCases((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { cases, addCase, updateCase, removeCase };
}
