import { cond } from "../testcases/engine";
import type { IosBusinessDefinition } from "./iosBusinessDefinition";

export const IOS_MAX_TOPON_CASE_ID = "ios_ie_max_topon_validation";
export const IOS_UA_ADJUST_CASE_ID = "ios_ie_ua_adjust_event";
export const IOS_ADJUST_REVENUE_CASE_ID = "ios_ie_adjust_revenue_fail";

const adShow = /^(?:\[Ad\] )?🔗 \[track\] ad_show /;
const promotionProbe = "^(?:\\[Promotion\\] )?🔗 ";
const promotionAlert = "^(?:\\[Promotion\\] )?⚠️ \\[Promotion\\] ";
const revenueSource = "(?:applovin_max_sdk|topon_sdk)";
const revenueAmount = "-?[0-9]+(?:\\.[0-9]+)?(?:e[+-]?[0-9]+)?";
const revenueCall = (source: string) => cond("message", "regex",
  `${promotionProbe}已上报广告收入 source ${source} ${revenueAmount} [^\\s<>]*（network [^\\r\\n]*，unit [^\\r\\n]*）(?:（本 key[^\\r\\n]*）)?(?:\\r?\\n|$)`);

/** SDK 在达到日志配额时会在完整 JSON 后附加提示。 */
export function hasValidIosMaxToponEvidence(message: string): boolean {
  const prefix = adShow.exec(message);
  if (!prefix) return true;
  const payload = message.split(/\r?\n/, 1)[0].slice(prefix[0].length)
    .replace(/（本 key「[^\r\n]*」报满 [0-9]+ 次，后续静默）$/, "");
  try {
    const fields = JSON.parse(payload);
    return fields?.mediation === "max" && fields.source === "DirectSDK";
  } catch {
    return false;
  }
}

export const IOS_ATTRIBUTION_BUSINESS_DEFINITIONS: IosBusinessDefinition[] = [
  {
    id: IOS_MAX_TOPON_CASE_ID, name: "MAX 包 TopOn 验证", group: "iOS · 广告",
    description: "同一轮需观察到 MAX 的 DirectSDK 实际展示和 TopOn 预期收入去重。",
    rules: [
      { effect: "pass", ordinary: true, description: "MAX 实际展示的来源为 DirectSDK",
        expr: cond("message", "regex", adShow.source) },
      { effect: "pass", ordinary: true, description: "TopOn 收入命中 GreenGame 去重，由 MAX 回传",
        expr: cond("message", "regex", "^(?:\\[Ad\\] )?🔗 TopOn 收入因 GreenGame 去重标记丢弃（placement=[^）<>\\s]+） —— 该位由 MAX 层回传收入，属预期行为(?:（本 key[^\\r\\n]*）)?(?:\\r?\\n|$)") },
    ],
  },
  {
    id: IOS_UA_ADJUST_CASE_ID, name: "UA 埋点监控", group: "iOS · 埋点", requirePass: true,
    description: "观察到白名单事件已调用 Adjust SDK 后通过。",
    rules: [
      { effect: "pass", ordinary: true, description: "白名单事件已调用 Adjust.trackEvent",
        expr: cond("message", "regex", "^(?:\\[Promotion\\] )?🔗 已转发 Adjust 事件 [A-Za-z0-9]+（callback params [0-9]+ 个）(?:（本 key[^\\r\\n]*）)?(?:\\r?\\n|$)") },
    ],
  },
  {
    id: IOS_ADJUST_REVENUE_CASE_ID, name: "MAX/TopOn 广告收入调用 Adjust", group: "iOS · 广告",
    description: "同一轮观察两路 Adjust 收入调用，并监测明确丢弃。",
    rules: [
      { effect: "pass", ordinary: true, description: "MAX 已调用 Adjust.trackAdRevenue", expr: revenueCall("applovin_max_sdk") },
      { effect: "pass", ordinary: true, description: "TopOn 已调用 Adjust.trackAdRevenue", expr: revenueCall("topon_sdk") },
      { effect: "error", ordinary: true, description: "归因库尚未就绪，本次收入明确丢弃",
        expr: cond("message", "regex", `${promotionProbe}Adjust 未就绪 ⇒ 收入未上报（source ${revenueSource}，${revenueAmount} [^\\s<>]*）|${promotionAlert}Adjust 尚未就绪 ⇒ 本次广告收入\\*\\*已丢弃\\*\\*（source ${revenueSource}，`) },
      { effect: "error", ordinary: true, description: "广告收入对象创建失败或收入来源无法识别",
        expr: cond("message", "regex", `${promotionAlert}(?:ADJAdRevenue 创建失败（source ${revenueSource}）⇒ 本次广告收入未上报|未知的广告收入来源 rawValue=-?[0-9]+ ⇒ 本次收入未上报)`) },
      { effect: "error", ordinary: true, description: "广告收入缓存溢出，最旧一条已丢弃",
        expr: cond("message", "regex", "^(?:\\[Ad\\] )?⚠️ Adjust 收入缓存超过 5000 条，已丢弃最旧一条(?:\\r?\\n|$)") },
    ],
  },
];
