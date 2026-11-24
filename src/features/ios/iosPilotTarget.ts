import { IOS_BUSINESS_CANDIDATES_ENABLED } from "./iosBusinessCases";

/** 双重显式开关，仅独立验收包使用固定测试身份，不能任意改进程绕过应用绑定。 */
export const IOS_PILOT_IS_FIXTURE = IOS_BUSINESS_CANDIDATES_ENABLED
  && import.meta.env?.VITE_IOS_PILOT_TARGET === "fixture";
export const IOS_PILOT_BUNDLE = IOS_PILOT_IS_FIXTURE ? "com.testbench.iosbusinessfixture" : "com.lucky.fruit.quest.master";
export const IOS_PILOT_PROCESS = IOS_PILOT_IS_FIXTURE ? "TestBenchIOSBusinessFixture" : "FruitQuest";
export const IOS_PILOT_APP_NAME = IOS_PILOT_IS_FIXTURE ? "可控日志验证包" : "Fruit Quest";
