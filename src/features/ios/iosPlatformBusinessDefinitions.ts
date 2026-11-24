import { all, any, cond } from "../testcases/engine";
import type { IosBusinessDefinition } from "./iosBusinessDefinition";
import { IOS_AD_PRICE_REQUEST_PATTERN, IOS_REQUEST_ECPM_CASE_ID } from "./iosRequestEcpm";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 业务标记必须在首行，调用栈中的模块/方法名不能充当错误来源。
const has = (value: string) => cond("message", "regex", `^[^\\r\\n]*${escapeRegex(value)}`);
const regex = (value: string) => cond("message", "regex", `^[^\\r\\n]*(?:${value})`);
const ad = (expr: ReturnType<typeof any>) => all(has("广告日志:"), expr);
const missingAdDelegate = has("InitAdStrategy invalid,_adDelegate is null");

/** 第二批独立iOS候选，只覆盖已核对源码的分支；原生结果缺口仍在V06～V08。 */
export const IOS_PLATFORM_BUSINESS_DEFINITIONS: IosBusinessDefinition[] = [
  { id: "ios_ie_ad_fail", name: "广告插件异常", group: "iOS · 广告",
    description: "覆盖共享广告封装5个规则组；不含Android桥接与原生参数分支，IOSAD专有诊断待补证。",
    rules: [
      { effect: "error", description: "未配置任何广告聚合", ordinary: true, expr: ad(has("no mediation configured")) },
      { effect: "error", description: "广告位策略无效", ordinary: true, expr: ad(regex("(Reward|Splash|Inter|Banner)AdStrategy invalid")) },
      { effect: "error", description: "广告初始化策略或代理为空",
        expr: ad(any(has("ADManager Init Invoke,strategy is null"), has("ADManager Init Invoke,strategy invalid"), missingAdDelegate)),
        ordinary: { description: "广告初始化代理为空", expr: ad(missingAdDelegate) } },
      { effect: "error", description: "广告主线程调度器异常", expr: regex("UnityDispatcherTool.*(初始化失败|任务不能为空|回调不能为空|出错)") },
      { effect: "warn", description: "广告聚合尚未初始化即被调用", expr: ad(all(has("ADCoreManager"), has("is not init"))) },
    ] },
  { id: IOS_REQUEST_ECPM_CASE_ID, name: "广告 eCPM 获取异常", group: "iOS · 广告",
    description: "核对完整请求参数中的顶层数值 ecpm=0，兼容 JsonParams 标签和广告价格上报请求的独立 JSON 正文。",
    rules: [{ effect: "error", description: "接口请求使用了无效 eCPM（ecpm=0）",
      expr: has("NetWorkLog:Request"),
      ordinary: {
        description: "广告价格上报请求的 ecpm 为 0",
        expr: cond("message", "regex", IOS_AD_PRICE_REQUEST_PATTERN),
      } }] },
  { id: "ios_ie_cloud_config_fail", name: "云控桥接异常", group: "iOS · 云控",
    description: "iOS独立判据：未链接、业务JSON解析及AB回调错误；未实现能力降级为疑似。正常默认值不报警，不代表拉取结果已验证。",
    rules: [
      { effect: "error", description: "iOS云控原生实现未接入", expr: all(has("[IOSCloudConfig]"), has("Init：原生实现【未接入】")) },
      { effect: "error", description: "iOS业务配置JSON解析失败", expr: all(has("[IOSCloudConfig] GetBizConfigs"), has("解析原生 JSON 失败：")) },
      { effect: "error", description: "iOS云控AB回调异常", expr: has("[IOSCloudConfig] AB callback failed:") },
      { effect: "warn", description: "调用的iOS云控能力尚未实现并降级",
        expr: all(has("[IOSCloudConfig]"), has("尚未实现，已降级返回默认值。")),
        ordinary: {
          description: "AddBizKVChangedListener 尚未实现并返回默认值",
          expr: has("[IOSCloudConfig] AddBizKVChangedListener 尚未实现，已降级返回默认值。"),
        } },
    ] },
  { id: "ios_ie_analytics_fail", name: "业务埋点异常", group: "iOS · 埋点",
    description: "覆盖4个共享Unity正文分支；依赖ENABLE_LOG，不代表原生入库/上传结果已验证。",
    rules: [
      { effect: "error", description: "业务Beyla埋点尚未初始化", ordinary: true, expr: has("Beyla 埋点未初始化，埋点无效") },
      { effect: "error", description: "Firebase事件ID为空", expr: all(has("[FirebaseAnalyticsTracker]"), has("Event ID cannot be null or empty")) },
      { effect: "error", description: "Firebase埋点调用异常", expr: all(has("[FirebaseAnalyticsTracker]"), has("Failed to log event")) },
      { effect: "error", description: "Firebase依赖初始化失败", expr: all(has("[FirebaseInit]"), has("Could not resolve all Firebase dependencies:")) },
    ] },
  { id: "ios_plugin_promotion_fail", name: "渠道归因异常", group: "iOS · 归因",
    description: "仅覆盖共享未初始化保护与iOS未链接探针；none/organic不判失败，不含Android Referrer，归因最终结果待补证。",
    rules: [
      { effect: "warn", description: "Unity渠道桥接尚未初始化", ordinary: true, expr: any(has("PromotionManager GetPromotionChannel not init"), has("PromotionManager GetAdjustPromotionChannel not init")) },
      { effect: "error", description: "iOS渠道原生实现未接入", ordinary: true, expr: any(regex("\\[Promotion\\] iOS bridge is_linked\\s*=\\s*False(?:\\s|$)"), all(has("[Promotion]"), has("未接入 iOSPromotionLibrary"))) },
    ] },
];
