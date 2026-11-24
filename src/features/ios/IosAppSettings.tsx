import { useState } from "react";
import { BUILTIN_IOS_APPS, configuredIosApps, validIosBundleId } from "../../core/iosApps";
import { IS_DEBUG } from "../../core/debug";
import type { IosFilterPreferences } from "./iosFilterPreferences";

export function IosAppSettings({ preferences, onChange }: { preferences: IosFilterPreferences; onChange: (update: (p: IosFilterPreferences) => IosFilterPreferences) => void }) {
  const [name, setName] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const apps = configuredIosApps(preferences.customApps, preferences.removedBuiltinApps, IS_DEBUG);
  const builtinIds = new Set(BUILTIN_IOS_APPS.map((app) => app.bundleId));
  const reset = () => { setName(""); setBundleId(""); setEditing(null); setError(""); };
  return <section className="manage-section">
    <h2>iOS 应用</h2><p>日志页仅显示这里的清单；设备枚举只补充安装状态和进程映射。Bundle ID 与 Android 包名独立。</p>
    <form className="manage-add" onSubmit={(event) => {
      event.preventDefault(); const id = bundleId.trim(); const title = name.trim();
      if (!title || !validIosBundleId(id)) { setError("请填写应用名称与有效的 Bundle ID，例如 com.example.game"); return; }
      if (apps.some((app) => app.bundleId === id && app.bundleId !== editing)) { setError("该 Bundle ID 已存在"); return; }
      if (editing && builtinIds.has(editing)) { setError("内置应用不可编辑"); return; }
      onChange((current) => ({ ...current, customApps: [...current.customApps.filter((app) => app.bundleId !== editing && app.bundleId !== id), { bundleId: id, name: title }] })); reset();
    }}>
      <input aria-label="iOS 应用名称" placeholder="iOS 应用名称" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="iOS Bundle ID" placeholder="Bundle ID，例如 com.example.game" value={bundleId} onChange={(e) => setBundleId(e.target.value)} />
      <button type="submit">{editing ? "保存应用" : "添加 iOS 应用"}</button>{editing && <button type="button" onClick={reset}>取消</button>}
    </form>
    {error && <p role="alert">{error}</p>}
    <ul className="manage-list">{apps.map((app) => <li className="manage-item" key={app.bundleId}>
      <div className="manage-name"><strong>{app.name}</strong><div className="manage-desc">{app.bundleId}</div></div>
      {builtinIds.has(app.bundleId) && <span className="manage-badge">内置</span>}
      <button disabled={builtinIds.has(app.bundleId)} onClick={() => { setEditing(app.bundleId); setName(app.name); setBundleId(app.bundleId); setError(""); }}>编辑</button>
      <button className="danger" disabled={builtinIds.has(app.bundleId) && !IS_DEBUG} onClick={() => {
        onChange((current) => ({ ...current, customApps: current.customApps.filter((item) => item.bundleId !== app.bundleId), removedBuiltinApps: builtinIds.has(app.bundleId) ? [...new Set([...current.removedBuiltinApps, app.bundleId])] : current.removedBuiltinApps }));
        if (editing === app.bundleId) reset();
      }}>删除</button>
    </li>)}</ul>
  </section>;
}
