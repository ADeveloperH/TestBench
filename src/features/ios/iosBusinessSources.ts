import { IOS_ADJUST_REVENUE_CASE_ID, IOS_MAX_TOPON_CASE_ID, IOS_UA_ADJUST_CASE_ID } from "./iosAttributionBusinessDefinitions";

/** 只有明确授权的 SDK 用例可以接收 Foundation 原生日志。 */
const sdkSources: Record<string, RegExp> = {
  ios_plugin_analytics_fail: /^\[(?:IOSAnalytics|Analytics)\]/,
  ios_sdk_beyla_data_fail: /^\[Analytics\]/,
  ios_anticheat_runtime_fail: /^(?:(?:🔗|⚠️)\s*)?\[AntiCheating\]/,
  ios_anticheat_init: /^(?:(?:🔗|⚠️)\s*)?\[AntiCheating\]/,
};

const probeSources: Record<string, RegExp> = {
  [IOS_MAX_TOPON_CASE_ID]: /^\[Ad\] 🔗 (?:\[track\] ad_show |TopOn 收入因 GreenGame 去重标记丢弃)/,
  [IOS_UA_ADJUST_CASE_ID]: /^\[Promotion\] 🔗 已转发 Adjust 事件 /,
};

const promotionRevenue = /^(?:🔗 (?:已上报广告收入 source |Adjust 未就绪 ⇒ 收入未上报)|⚠️ \[Promotion\] (?:Adjust 尚未就绪|ADJAdRevenue 创建失败|未知的广告收入来源))/;
const adRevenue = /^⚠️ Adjust 收入缓存超过 /;

export function acceptsIosBusinessSource(caseId: string, module: string | null, message: string): boolean {
  if (caseId === IOS_ADJUST_REVENUE_CASE_ID) {
    if (module === "Foundation") {
      return (message.startsWith("[Promotion] ") && promotionRevenue.test(message.slice("[Promotion] ".length)))
        || (message.startsWith("[Ad] ") && adRevenue.test(message.slice("[Ad] ".length)));
    }
    return module === "UnityFramework" && (promotionRevenue.test(message) || adRevenue.test(message));
  }
  const probePrefix = probeSources[caseId];
  if (probePrefix) {
    if (module === "Foundation") return probePrefix.test(message);
    if (module !== "UnityFramework") return false;
    const tag = caseId === IOS_MAX_TOPON_CASE_ID ? "[Ad]" : "[Promotion]";
    return message.startsWith("🔗 ") && probePrefix.test(`${tag} ${message}`);
  }
  const sdkPrefix = sdkSources[caseId];
  if (!sdkPrefix) return module === "UnityFramework";
  return (module === "UnityFramework" || module === "Foundation") && sdkPrefix.test(message);
}

/** 低成本预筛；最终授权仍须经过还原正文的首行前缀与具体用例检查。 */
export function mayHaveIosBusinessSource(module: string | null, message: string): boolean {
  return module === "UnityFramework" || (module === "Foundation"
    && /^(?:\[Ad\]|\[Promotion\]) |\[(?:IOSAnalytics|Analytics|AntiCheating)\]/.test(message.split("\n", 1)[0]));
}
