import type { TestCase } from "../testcases/engine";
import { IOS_UNITY_BUSINESS_DEFINITIONS } from "./iosUnityBusinessDefinitions";
import { IOS_PLATFORM_BUSINESS_DEFINITIONS } from "./iosPlatformBusinessDefinitions";
import { IOS_CONFIG_BUSINESS_DEFINITION } from "./iosConfigBusinessDefinition";
import { IOS_SDK_BUSINESS_DEFINITIONS } from "./iosSdkBusinessDefinitions";
import { IOS_ATTRIBUTION_BUSINESS_DEFINITIONS } from "./iosAttributionBusinessDefinitions";
import { IOS_CRASH_CASE } from "./iosCrashCase";

/** 内部验收构建开启完整业务规则。 */
export const IOS_BUSINESS_CANDIDATES_ENABLED = import.meta.env?.VITE_ENABLE_IOS_BUSINESS_CANDIDATES === "true";
const definitions = [...IOS_UNITY_BUSINESS_DEFINITIONS, ...IOS_PLATFORM_BUSINESS_DEFINITIONS, IOS_CONFIG_BUSINESS_DEFINITION,
  ...IOS_ATTRIBUTION_BUSINESS_DEFINITIONS, IOS_CRASH_CASE, ...IOS_SDK_BUSINESS_DEFINITIONS];
export const IOS_BUSINESS_CASE_COUNT = definitions.length;

export const IOS_DEFAULT_BUSINESS_CASE_COUNT = definitions.filter(definition => definition.rules.some(rule => rule.ordinary)).length;

export function iosBusinessCases(bundleId: string): TestCase[] {
  return definitions.map(({ rules, ...definition }) => {
    const ordinaryRules = rules.flatMap(({ ordinary, ...rule }) => ordinary ? [ordinary === true ? rule : { ...rule, ...ordinary }] : []);
    const fullRules = rules.map(({ ordinary: _ordinary, ...rule }) => rule);
    const useOrdinaryRules = !IOS_BUSINESS_CANDIDATES_ENABLED && ordinaryRules.length > 0;
    return {
      ...definition,
      description: useOrdinaryRules ? "当前仅监测已验证分支，具体条件见下方规则。" : `待集中业务验收。${definition.description}`,
      scope: { global: false, apps: [bundleId] },
      enabled: IOS_BUSINESS_CANDIDATES_ENABLED || useOrdinaryRules,
      rules: useOrdinaryRules ? ordinaryRules : fullRules,
    };
  });
}
