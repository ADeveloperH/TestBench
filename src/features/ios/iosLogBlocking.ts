import type { IosLogRecord } from "./iosTypes";

export interface IosLogBlockingPreferences { webkitActivities: boolean; audioCompletion: boolean; uiBackgroundTasks: boolean }
export const defaultIosLogBlocking = (): IosLogBlockingPreferences => ({ webkitActivities: true, audioCompletion: true, uiBackgroundTasks: true });
export function normalizeIosLogBlocking(value: unknown): IosLogBlockingPreferences {
  const input = value && typeof value === "object" ? value as Partial<IosLogBlockingPreferences> : {};
  return { webkitActivities: typeof input.webkitActivities === "boolean" ? input.webkitActivities : true,
    audioCompletion: typeof input.audioCompletion === "boolean" ? input.audioCompletion : true,
    uiBackgroundTasks: typeof input.uiBackgroundTasks === "boolean" ? input.uiBackgroundTasks : true };
}

// 仅屏蔽已核对的常规状态消息；地址/PID 可变，其余形状锚定，防止吞掉带故障说明的日志。
const webkitActivity = /^0x[\da-f]+ - \[PID=\d+, throttler=0x[\da-f]+\] ProcessThrottler::Activity::(?:Activity: Starting|invalidate: Ending) foreground activity \/ 'WebPageProxy::runJavaScriptInFrameInScriptWorld'\s*$/i;
const audioCompletion = /^\s*SSClientCompletion\.cpp:\d+\s+Calling client's completion block now:\s*clientPID\s*=\s*\d+,\s*actionID\s*=\s*\d+\s*$/;
const uiBackgroundTasks = [
  /^Will add backgroundTask with taskName: <private>, expirationHandler: <__NSMallocBlock__: 0x[\da-f]+>\s*$/i,
  /^Incrementing reference count for background assertion <private>\s*$/,
  /^Created background task <private>\.\s*$/,
  /^Ending background task with UIBackgroundTaskIdentifier: \d+\s*$/,
  /^Ending task with identifier \d+ and description: <private>, _expireHandler: <__NSMallocBlock__: 0x[\da-f]+>\s*$/i,
  /^Decrementing reference count for assertion <private> \(used by background task with identifier \d+: <private>\)\s*$/,
  /^Creating new assertion because there is no existing background assertion\.\s*$/,
  /^Creating new background assertion\s*$/,
  /^Created new background assertion <BKSProcessAssertion: 0x[\da-f]+>\s*$/i,
  /^Will invalidate assertion: <BKSProcessAssertion: 0x[\da-f]+> for task identifier: \d+\s*$/i,
  /^Reusing background assertion <BKSProcessAssertion: 0x[\da-f]+>\s*$/i,
];

export function isIosLogBlocked(record: IosLogRecord, preferences?: IosLogBlockingPreferences): boolean {
  if (!preferences || record.level !== "notice") return false;
  return (preferences.webkitActivities && record.module === "WebKit" && webkitActivity.test(record.message))
    || (preferences.audioCompletion && record.module === "AudioToolbox" && audioCompletion.test(record.message))
    || (preferences.uiBackgroundTasks && record.module === "UIKitCore" && uiBackgroundTasks.some((pattern) => pattern.test(record.message)));
}
