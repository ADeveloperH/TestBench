import { all, cond, type TestCase } from "../testcases/engine";
import { iosBusinessCases } from "./iosBusinessCases";
import { IOS_PILOT_BUNDLE } from "./iosPilotTarget";
export { IOS_PILOT_BUNDLE, IOS_PILOT_PROCESS } from "./iosPilotTarget";

/** 只读试点及默认停用的异常候选，不加入 Android 内置身份/远程规则集合。 */
export const IOS_PILOT_CASES: TestCase[] = [
  { id: "ios_pilot_fruit_level_complete", name: "Fruit 关卡完成信号", group: "iOS Fruit 试点",
    description: "观察到 on_game_win_invoked 即通过；不代表服务器结算、广告闭环或多事件顺序已验证。",
    scope: { global: false, apps: [IOS_PILOT_BUNDLE] }, rules: [{ effect: "pass", description: "出现关卡完成回调标记",
      expr: all(cond("message", "contains", "[LevelFlow]"), cond("message", "regex", "\\bstep=on_game_win_invoked(?:,|\\s|$)")) }] },
  { id: "ios_pilot_fruit_progress", name: "Fruit 进度输出", group: "iOS Fruit 试点",
    description: "观察到合法的进度百分数即通过；不固定关卡、次数，也不把原始 notice 当作 Unity Info。",
    scope: { global: false, apps: [IOS_PILOT_BUNDLE] }, rules: [{ effect: "pass", description: "出现 0～100% 的业务进度输出",
      expr: all(cond("message", "contains", "[InLevelAdReward]"), cond("message", "regex", "进度更新[：:]\\s*(?:(?:[0-9]|[1-9][0-9])(?:\\.[0-9]+)?|100(?:\\.0+)?)%(?:\\s|$)")) }] },
  ...iosBusinessCases(IOS_PILOT_BUNDLE),
];
