import { useCallback, useEffect, useRef, useState } from "react";
import {
  isBuiltinTestCase,
  type TestCase,
} from "./engine";
import {
  getBuiltinTestCaseIds,
  getBuiltinTestCases,
  subscribeBuiltins,
} from "../../core/builtinRegistry";
import { IS_DEBUG } from "../../core/debug";

const KEY = "logcat-testcases-v4";
/** 调试模式删除的内置用例 id 名单（正式包忽略，内置不可删）。 */
const REMOVED_KEY = "logcat-removed-builtin-cases-v1";
/** 已从内置配置移除的历史 id，用于清理旧版本写入的完整用例缓存。 */
const RETIRED_BUILTIN_IDS = new Set([
  "no_anr",
  "any_error_log",
  "case_1787052700403",
  "case_1787280745048",
]);

function loadRemovedIds(): string[] {
  try {
    const raw = localStorage.getItem(REMOVED_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d)) return d.filter((x) => typeof x === "string");
    }
  } catch {
    // 忽略损坏的缓存
  }
  return [];
}

function saveRemovedIds(ids: string[]): void {
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify(ids));
  } catch {
    // 忽略写入失败
  }
}

/** 内置用例以最新生效定义为准，用户自定义用例保留在后；调试模式下应用删除名单。 */
function applyBuiltinLayer(
  cached: TestCase[],
  previouslyBuiltinIds: ReadonlySet<string> = new Set(),
): TestCase[] {
  const builtinIds = getBuiltinTestCaseIds();
  const removed = IS_DEBUG ? new Set(loadRemovedIds()) : new Set<string>();
  const builtins = getBuiltinTestCases().filter(
    (c) => !removed.has(c.id) && !RETIRED_BUILTIN_IDS.has(c.id),
  );
  const kept = cached.filter(
    (c) =>
      c &&
      typeof c.id === "string" &&
      !builtinIds.has(c.id) &&
      !previouslyBuiltinIds.has(c.id) &&
      !RETIRED_BUILTIN_IDS.has(c.id),
  );
  return [...builtins, ...kept];
}

/** 本地只保存用户自定义用例，内置定义始终由代码或远程配置提供。 */
function customCasesOnly(cases: TestCase[]): TestCase[] {
  const builtinIds = getBuiltinTestCaseIds();
  return cases.filter(
    (c) =>
      c &&
      typeof c.id === "string" &&
      !builtinIds.has(c.id) &&
      !RETIRED_BUILTIN_IDS.has(c.id),
  );
}

function loadCases(): TestCase[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        // 内置用例以最新定义为准（框架更新用例后老缓存自动获得新规则），
        // 用户自定义用例（id 不在内置集合内）保留在后。
        return applyBuiltinLayer(arr);
      }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return [...getBuiltinTestCases()];
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
  const previousBuiltinIdsRef = useRef(getBuiltinTestCaseIds());

  // 远程配置变化（内置层替换）时重算：内置用例以最新定义为准，用户用例保留。
  useEffect(() => {
    return subscribeBuiltins(() => {
      const previousBuiltinIds = previousBuiltinIdsRef.current;
      previousBuiltinIdsRef.current = getBuiltinTestCaseIds();
      setCases((prev) => applyBuiltinLayer(prev, previousBuiltinIds));
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(customCasesOnly(cases)));
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
    // 内置用例不可删除（调试模式除外：删除 = 记入删除名单）
    if (isBuiltinTestCase(id)) {
      if (!IS_DEBUG) return;
      saveRemovedIds([...new Set([...loadRemovedIds(), id])]);
    }
    setCases((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const replaceCases = useCallback((cases: TestCase[]) => {
    setCases(cases);
  }, []);

  return { cases, addCase, updateCase, removeCase, replaceCases };
}
