import { useCallback, useEffect, useRef, useState } from "react";
import type { TestCase } from "./engine";
import { getBuiltinTestCaseIds, getBuiltinTestCases, subscribeBuiltins } from "../../core/builtinRegistry";
import { IS_DEBUG } from "../../core/debug";
import {
  applyCaseConfig, CASE_CONFIG_KEY, deletableCaseIds, emptyCaseConfig,
  LEGACY_CASES_KEY, LEGACY_REMOVED_KEY, readCaseConfig, type CaseConfig,
} from "./caseConfig";
import { invalidateCaseRuntimes, syncCaseRuntimes } from "./useTestCases";

interface StoreState {
  cases: TestCase[];
  config: CaseConfig;
}

function loadState(): StoreState {
  const config = readCaseConfig(localStorage, getBuiltinTestCaseIds());
  return { config, cases: applyCaseConfig(getBuiltinTestCases(), config, IS_DEBUG) };
}

export interface TestCasesStore {
  cases: TestCase[];
  addCase: (tc: TestCase) => void;
  updateCase: (tc: TestCase) => void;
  removeCase: (id: string) => void;
  removeCases: (ids: string[]) => void;
  setCasesEnabled: (ids: string[], enabled: boolean) => void;
  restoreBuiltins: () => void;
  replaceCases: (cases: TestCase[]) => void;
  storageError: string | null;
}

/** 配置是一个持久化单元；内置定义与启停覆盖分开保存。 */
export function useTestCasesStore(): TestCasesStore {
  const [state, setState] = useState<StoreState>(loadState);
  const [storageError, setStorageError] = useState<string | null>(null);
  const previousBuiltinIdsRef = useRef(getBuiltinTestCaseIds());

  useEffect(() => subscribeBuiltins(() => {
    const previous = previousBuiltinIdsRef.current;
    const current = getBuiltinTestCaseIds();
    previousBuiltinIdsRef.current = current;
    setState((prev) => {
      const config: CaseConfig = {
        ...prev.config,
        customCases: prev.cases.filter((tc) => !previous.has(tc.id) && !current.has(tc.id)),
        enabledOverrides: Object.fromEntries(Object.entries(prev.config.enabledOverrides).filter(([id]) => current.has(id))),
      };
      return { config, cases: applyCaseConfig(getBuiltinTestCases(), config, IS_DEBUG) };
    });
  }), []);

  useEffect(() => {
    syncCaseRuntimes(state.cases);
    try {
      localStorage.setItem(CASE_CONFIG_KEY, JSON.stringify(state.config));
      // 新格式写入成功才移除旧缓存，避免恢复后的旧数据再次被迁移。
      localStorage.removeItem(LEGACY_CASES_KEY);
      localStorage.removeItem(LEGACY_REMOVED_KEY);
      setStorageError(null);
    } catch {
      setStorageError("测试用例配置保存失败，重启后可能丢失本次修改。请导出配置备份。");
    }
  }, [state]);

  const replaceCases = useCallback((cases: TestCase[]) => {
    setState((prev) => {
      const ids = getBuiltinTestCaseIds();
      const enabledOverrides = { ...prev.config.enabledOverrides };
      for (const tc of cases) {
        if (ids.has(tc.id)) enabledOverrides[tc.id] = tc.enabled !== false;
      }
      return {
        cases,
        config: { ...prev.config, customCases: cases.filter((tc) => !ids.has(tc.id)), enabledOverrides },
      };
    });
  }, []);

  const addCase = useCallback((tc: TestCase) => {
    setState((prev) => ({
      cases: [tc, ...prev.cases],
      config: { ...prev.config, customCases: [tc, ...prev.config.customCases] },
    }));
  }, []);

  const updateCase = useCallback((tc: TestCase) => {
    setState((prev) => ({
      cases: prev.cases.map((c) => c.id === tc.id ? tc : c),
      config: getBuiltinTestCaseIds().has(tc.id)
        ? { ...prev.config, enabledOverrides: { ...prev.config.enabledOverrides, [tc.id]: tc.enabled !== false } }
        : { ...prev.config, customCases: prev.config.customCases.map((c) => c.id === tc.id ? tc : c) },
    }));
  }, []);

  const setCasesEnabled = useCallback((ids: string[], enabled: boolean) => {
    const selected = new Set(ids);
    setState((prev) => {
      const enabledOverrides = { ...prev.config.enabledOverrides };
      const builtinIds = getBuiltinTestCaseIds();
      const cases = prev.cases.map((tc) => {
        if (!selected.has(tc.id)) return tc;
        if (builtinIds.has(tc.id)) enabledOverrides[tc.id] = enabled;
        return { ...tc, enabled };
      });
      return { cases, config: {
        ...prev.config, enabledOverrides,
        customCases: cases.filter((tc) => !builtinIds.has(tc.id)),
      } };
    });
  }, []);

  const removeCases = useCallback((ids: string[]) => {
    const builtinIds = getBuiltinTestCaseIds();
    const removed = deletableCaseIds(ids, builtinIds, IS_DEBUG);
    invalidateCaseRuntimes(removed);
    setState((prev) => ({
      cases: prev.cases.filter((tc) => !removed.has(tc.id)),
      config: {
        ...prev.config,
        customCases: prev.config.customCases.filter((tc) => !removed.has(tc.id)),
        removedBuiltinIds: [...new Set([...prev.config.removedBuiltinIds, ...[...removed].filter((id) => builtinIds.has(id))])],
      },
    }));
  }, []);

  const removeCase = useCallback((id: string) => removeCases([id]), [removeCases]);
  const restoreBuiltins = useCallback(() => {
    const config = emptyCaseConfig();
    invalidateCaseRuntimes();
    setState({ config, cases: applyCaseConfig(getBuiltinTestCases(), config, IS_DEBUG) });
  }, []);

  return { cases: state.cases, addCase, updateCase, removeCase, removeCases,
    setCasesEnabled, restoreBuiltins, replaceCases, storageError };
}
