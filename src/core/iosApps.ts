export interface IosConfiguredApp { bundleId: string; name: string }
/** 仅加入已核实的 iOS 标识，不能从 Android 包名推测。 */
export const BUILTIN_IOS_APPS: readonly IosConfiguredApp[] = [
  { bundleId: "com.lucky.fruit.quest.master", name: "Fruit Quest" },
];
export const validIosBundleId = (value: string) => /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
export function configuredIosApps(custom: IosConfiguredApp[], removed: string[], debug: boolean): IosConfiguredApp[] {
  const builtins = BUILTIN_IOS_APPS.filter((app) => !debug || !removed.includes(app.bundleId));
  const seen = new Set(builtins.map((app) => app.bundleId));
  return [...builtins, ...custom.filter((app) => {
    if (seen.has(app.bundleId) || !validIosBundleId(app.bundleId)) return false;
    seen.add(app.bundleId); return true;
  })];
}
