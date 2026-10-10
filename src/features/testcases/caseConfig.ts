import type { TestCase } from "./engine";

export const CASE_CONFIG_KEY = "logcat-testcases-v5";
export const LEGACY_CASES_KEY = "logcat-testcases-v4";
export const LEGACY_REMOVED_KEY = "logcat-removed-builtin-cases-v1";
const RETIRED_IDS = new Set([
  "no_anr", "any_error_log", "case_1787052700403", "case_1787280745048",
]);

export interface CaseConfig {
  version: 5;
  customCases: TestCase[];
  enabledOverrides: Record<string, boolean>;
  removedBuiltinIds: string[];
}

export function emptyCaseConfig(): CaseConfig {
  return { version: 5, customCases: [], enabledOverrides: {}, removedBuiltinIds: [] };
}

function uniqueCases(cases: TestCase[], builtinIds: ReadonlySet<string>): TestCase[] {
  const used = new Set(builtinIds);
  return cases.filter((tc) => tc && typeof tc.id === "string" && tc.id && !RETIRED_IDS.has(tc.id))
    .map((tc) => {
      let id = tc.id;
      while (used.has(id)) id = `case_${crypto.randomUUID()}`;
      used.add(id);
      return id === tc.id ? tc : { ...tc, id };
    });
}

/** 兼容旧完整缓存：同 ID 的内置定义丢弃，非内置重复 ID 重新分配。 */
export function readCaseConfig(storage: Pick<Storage, "getItem">, builtinIds: ReadonlySet<string>): CaseConfig {
  const config = emptyCaseConfig();
  try {
    const raw = storage.getItem(CASE_CONFIG_KEY);
    if (raw !== null) {
      const data = JSON.parse(raw);
      if (data?.version === 5 && Array.isArray(data.customCases)) {
        config.customCases = uniqueCases(data.customCases.filter((tc: TestCase) => tc && !builtinIds.has(tc.id)), builtinIds);
        if (data.enabledOverrides && typeof data.enabledOverrides === "object" && !Array.isArray(data.enabledOverrides)) {
          config.enabledOverrides = Object.fromEntries(Object.entries(data.enabledOverrides)
            .filter(([id, enabled]) => id && typeof enabled === "boolean")) as Record<string, boolean>;
        }
        if (Array.isArray(data.removedBuiltinIds)) {
          config.removedBuiltinIds = data.removedBuiltinIds.filter((id: unknown) => typeof id === "string");
        }
        return config;
      }
    }
  } catch { /* 损坏的新缓存尝试旧格式兜底。 */ }
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_CASES_KEY) ?? "[]");
    if (Array.isArray(legacy)) config.customCases = uniqueCases(legacy.filter((tc) => tc && !builtinIds.has(tc.id)), builtinIds);
    const removed = JSON.parse(storage.getItem(LEGACY_REMOVED_KEY) ?? "[]");
    if (Array.isArray(removed)) config.removedBuiltinIds = removed.filter((id: unknown) => typeof id === "string");
  } catch { /* 忽略损坏的旧缓存。 */ }
  return config;
}

export function applyCaseConfig(builtins: TestCase[], config: CaseConfig, debug: boolean): TestCase[] {
  const removed = new Set(debug ? config.removedBuiltinIds : []);
  return [
    ...builtins.filter((tc) => !removed.has(tc.id)).map((tc) =>
      Object.prototype.hasOwnProperty.call(config.enabledOverrides, tc.id)
        ? { ...tc, enabled: config.enabledOverrides[tc.id] }
        : tc),
    ...config.customCases,
  ];
}

/** 批量操作仍在数据层执行内置保护，不能只依靠按钮禁用。 */
export function deletableCaseIds(ids: string[], builtinIds: ReadonlySet<string>, debug: boolean): Set<string> {
  return new Set(ids.filter((id) => debug || !builtinIds.has(id)));
}

export function caseRuntimeFingerprint(tc: TestCase): string {
  return JSON.stringify({ scope: tc.scope, rules: tc.rules });
}
