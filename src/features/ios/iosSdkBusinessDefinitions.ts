import { any, cond } from "../testcases/engine";
import type { IosBusinessDefinition } from "./iosBusinessDefinition";

const line = (body: string) => cond("message", "regex", `^[^\\r\\n]*${body}`);
const analytics = (body: string) => line(`\\[Analytics\\][^\\r\\n]*${body}`);
const anti = (body: string) => line(`\\[AntiCheating\\][^\\r\\n]*${body}`);
const antiFailure = () => anti("token 通路判为\\*\\*失败\\*\\*");
const iosAnalyticsLibraryMissing = line("\\[IOSAnalytics\\][^\\r\\n]*未接入 iOSAnalyticsLibrary");
const antiDegraded = () => anti("本次取到的设备指纹长度为 [0-9]+[^\\r\\n]*疑似降级值");

/** W02/W03独立规则。来源授权由iosBusinessSources按用例ID约束，不放宽旧规则。 */
export const IOS_SDK_BUSINESS_DEFINITIONS: IosBusinessDefinition[] = [
  { id: "ios_plugin_analytics_fail", name: "iOS 埋点桥接异常", group: "iOS · 埋点",
    description: "部分覆盖：iOS库未接入或明确丢弃事件；不匹配Android初始化/Tag级别，不证明上传成功。",
    rules: [
      { effect: "error", description: "iOS埋点库未接入",
        ordinary: { description: "Unity 桥报告 iOS 埋点库未接入", expr: iosAnalyticsLibraryMissing },
        expr: any(
          iosAnalyticsLibraryMissing,
          line("\\[Analytics\\]\\[bridge\\][^\\r\\n]*未接入 iOSAnalyticsLibrary"),
        ) },
      { effect: "error", description: "原生埋点初始化前调用并丢弃事件", ordinary: true, expr:
        analytics('TrackEvent\\("[^\\r\\n]*"\\) 在未初始化时被调用，事件已丢弃') },
      { effect: "error", description: "原生埋点收到空事件名并丢弃", ordinary: true, expr: analytics("TrackEvent 收到空事件名，已丢弃") },
    ] },
  { id: "ios_sdk_beyla_data_fail", name: "Beyla 埋点数据异常", group: "iOS · 埋点",
    description: "部分覆盖：iOS事件库、上传前处理与上传未完成诊断为疑似；不复制Android参数数量/数据库文案，未报警不证明数据完整。",
    rules: [
      { effect: "warn", description: "iOS事件数据库操作失败", ordinary: true, expr: analytics("📤 ❌ (?:事件库打开/建表失败：|事件落库失败：|事件库查询失败：)") },
      { effect: "warn", description: "iOS上传前处理或事件批次异常", ordinary: true, expr: analytics("📤 ❌ (?:上传前压缩失败|上传前加密失败|上传流程取到 0 条事件)") },
      { effect: "warn", description: "iOS上传未获确认或网络不可达，需核对重试", ordinary: true, expr: analytics("📤 ❌ (?:上传失败：服务端未确认|上传未完成：网络不可达)") },
    ] },
  { id: "ios_anticheat_runtime_fail", name: "反作弊运行异常", group: "iOS · 反作弊",
    description: "iOS独立诊断：原生token通路/同步取值错误与降级；历史告警不代表当前健康状态，不依据token长度自行推断成功。",
    rules: [
      { effect: "error", description: "原生反作弊token通路报告失败", ordinary: true, expr: antiFailure() },
      { effect: "error", description: "就绪后同步取值返回明确非零错误码", ordinary: true, expr: anti("同步取值返回非 0 code=-?[1-9][0-9]*(?:（|\\s|$)") },
      { effect: "warn", description: "原生库明确报告疑似降级值", ordinary: true, expr: antiDegraded() },
      { effect: "warn", description: "同步取值无blackBox，需核对后续恢复", ordinary: true, expr: anti("同步取值的 code=0 但 blackBox 指针为空 ⇒ 无值") },
    ] },
  { id: "ios_anticheat_init", name: "反作弊 SDK 初始化完成", group: "iOS · 反作弊",
    description: "仅以原生设备指纹就绪信号确认；不复制Android20秒缺失。曾失败后恢复仍保留历史错误，需重新开始核对当前状态。",
    rules: [
      { effect: "pass", description: "原生异步初始化已报告设备指纹就绪", ordinary: true, expr: anti("设备指纹就绪（长度 [1-9][0-9]*）") },
      { effect: "error", description: "iOS反作弊库未链接或拒绝初始化", expr: any(
        anti("未接入 iOSAntiCheatingLibrary"),
        line("\\[AntiCheating\\]\\[probe\\] iOS bridge is_linked\\s*=\\s*False(?:\\s|$)"),
        anti("partner / appKey 为空 ⇒ \\*\\*拒绝初始化同盾 SDK\\*\\*"),
        anti('dataCenter = "[^\\r\\n]*" \\*\\*不在官方枚举内\\*\\* ⇒ 拒绝初始化。'),
      ) },
      { effect: "error", description: "原生库报告初始化token通路失败（可迟到恢复，保留历史）", expr: antiFailure() },
      { effect: "warn", description: "就绪后原生库报告疑似降级值", expr: antiDegraded() },
    ] },
];
