import type { IosFilterPreferences } from "./iosFilterPreferences";

export function IosLogBlockSettings({ preferences, onChange }: {
  preferences: IosFilterPreferences; onChange: (update: (current: IosFilterPreferences) => IosFilterPreferences) => void;
}) {
  const rules = [
    { key: "webkitActivities" as const, name: "WebKit JavaScript 活动开始／结束", description: "WebKit · notice · runJavaScriptInFrameInScriptWorld 前台活动状态" },
    { key: "audioCompletion" as const, name: "AudioToolbox completion 提示", description: "AudioToolbox · notice · SSClientCompletion 客户端回调完成提示" },
    { key: "uiBackgroundTasks" as const, name: "UIKitCore 后台任务常规状态", description: "UIKitCore · notice · 后台任务创建、结束及 assertion 引用管理；保留超时和故障消息" },
  ];
  return <section className="manage-section tag-block-section">
    <div className="manage-section-heading"><h2>iOS 高频日志屏蔽</h2>
      <p>仅隐藏正式 iOS 日志页中的三类常规框架状态消息；当前视图导出遵循屏蔽，原始落盘、完整会话导出和 Probe 保留全部记录。与 Android Tag 屏蔽独立。</p></div>
    <ul className="manage-list">{rules.map((rule) => <li className="manage-item" key={rule.key}>
      <label className="checkbox"><input type="checkbox" aria-label={`屏蔽 ${rule.name}`} checked={preferences.blocking[rule.key]}
        onChange={(event) => { const enabled = event.target.checked; onChange((current) => ({ ...current, blocking: { ...current.blocking, [rule.key]: enabled } })); }} /></label>
      <div className="manage-name"><strong>{rule.name}</strong><div className="manage-desc">{rule.description}</div></div>
      <span className="manage-badge">内置</span>
    </li>)}</ul>
  </section>;
}
