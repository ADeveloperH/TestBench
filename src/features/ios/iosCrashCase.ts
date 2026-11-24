import { cond } from "../testcases/engine";
import type { IosBusinessDefinition } from "./iosBusinessDefinition";

export const IOS_CRASH_CASE_ID = "ios_no_crash";
export const IOS_CRASH_EVIDENCE = "Apple .ips · EXC_CRASH / SIGABRT";

export interface IosCrashReport {
  incidentId: string;
  capturedAt: number;
  pid: number;
  process: string;
  bundleId: string;
}

export const IOS_CRASH_CASE: IosBusinessDefinition = {
  id: IOS_CRASH_CASE_ID, name: "无崩溃", group: "iOS · 稳定性",
  description: "监测当前测试轮次中 Apple .ips 确认的 SIGABRT 应用崩溃。",
  rules: [{ effect: "error", ordinary: true, description: "Apple 崩溃报告确认应用异常退出（SIGABRT）",
    expr: cond("message", "equals", IOS_CRASH_EVIDENCE) }],
};
