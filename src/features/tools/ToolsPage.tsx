import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { AppInfo } from "../../core/apps";
import type { DeviceInfo } from "../../core/types";

interface Props {
  apps: AppInfo[];
  hasDevice: boolean;
  onOpenBackdoor: (pkg: string) => Promise<string>;
  onRestartApp: (pkg: string) => Promise<string>;
  onClearData: (pkg: string) => Promise<string>;
  onUninstall: (pkg: string) => Promise<string>;
  onAppAlarm: (pkg: string) => Promise<string>;
  onAppPerformance: (pkg: string) => Promise<string>;
  onScreenshot: () => Promise<string>;
  onInstallApk: () => Promise<string>;
  onDeviceInfo: () => Promise<DeviceInfo>;
  onCurrentActivity: () => Promise<string>;
  onStartRecording: (mbps: number) => Promise<string | null>;
  onStopRecording: () => Promise<string>;
  onMirror: (mbps: number) => Promise<string>;
  onBack: () => void;
}

type Output =
  | { title: string; text: string }
  | { title: string; info: DeviceInfo };

export function ToolsPage(props: Props) {
  const [pkg, setPkg] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const [recording, setRecording] = useState(false);
  const [bitrate, setBitrate] = useState("8");

  const appReady = props.hasDevice && !!pkg;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setStatus("");
    try {
      setStatus(await fn());
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const runOutput = async (fn: () => Promise<string>, title: string) => {
    setBusy(true);
    setStatus("");
    try {
      setOutput({ title, text: await fn() });
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const showInfo = async () => {
    setBusy(true);
    setStatus("");
    try {
      setOutput({ title: "设备信息", info: await props.onDeviceInfo() });
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    if (!pkg) return;
    const ok = await ask(`确认清除「${pkg}」的全部数据？`, {
      title: "确认",
      kind: "warning",
    });
    if (!ok) return;
    await run(() => props.onClearData(pkg));
  };

  const doUninstall = async () => {
    if (!pkg) return;
    const ok = await ask(`确认卸载「${pkg}」？`, { title: "确认", kind: "warning" });
    if (!ok) return;
    await run(() => props.onUninstall(pkg));
  };

  const parseMbps = () => Math.max(1, Math.min(100, parseFloat(bitrate) || 8));

  const doStartRecord = async () => {
    const mbps = parseMbps();
    setBusy(true);
    setStatus("");
    try {
      const path = await props.onStartRecording(mbps);
      if (!path) {
        setStatus("已取消录屏");
        return;
      }
      setRecording(true);
      setStatus(`录屏中…（保存到 ${path}）`);
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const doStopRecord = async () => {
    setBusy(true);
    setStatus("");
    try {
      const path = await props.onStopRecording();
      setRecording(false);
      setStatus(`录屏已保存：${path}`);
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const doMirror = async () => {
    const mbps = parseMbps();
    setBusy(true);
    setStatus("");
    try {
      setStatus(await props.onMirror(mbps));
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="manage-page">
      <div className="manage-header">
        <button onClick={props.onBack}>← 返回</button>
        <h1>应用工具</h1>
      </div>

      <section className="manage-section">
        <h2>应用操作</h2>
        <div className="manage-add">
          <label>应用</label>
          <select value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">选择应用</option>
            {props.apps.map((a) => (
              <option key={a.package} value={a.package}>
                {a.name}（{a.package}）
              </option>
            ))}
          </select>
        </div>
        {!props.hasDevice && <p className="manage-desc">请先在日志页连接设备。</p>}
        <div className="tools-actions">
          <button
            disabled={!appReady || busy}
            onClick={() => run(() => props.onOpenBackdoor(pkg))}
          >
            打开后门
          </button>
          <button
            disabled={!appReady || busy}
            onClick={() => run(() => props.onRestartApp(pkg))}
          >
            重启应用
          </button>
          <button disabled={!appReady || busy} onClick={doClear}>
            清除数据
          </button>
          <button disabled={!appReady || busy} onClick={doUninstall}>
            卸载
          </button>
          <button
            disabled={!appReady || busy}
            onClick={() => runOutput(() => props.onAppAlarm(pkg), "应用 Alarm")}
          >
            查看 Alarm
          </button>
          <button
            disabled={!appReady || busy}
            onClick={() => runOutput(() => props.onAppPerformance(pkg), "性能信息")}
          >
            性能
          </button>
        </div>
      </section>

      <section className="manage-section">
        <h2>设备操作</h2>
        <div className="tools-actions">
          <button disabled={!props.hasDevice || busy} onClick={() => run(props.onScreenshot)}>
            截图
          </button>
          <button disabled={!props.hasDevice || busy} onClick={() => run(props.onInstallApk)}>
            安装 APK
          </button>
          <button disabled={!props.hasDevice || busy} onClick={showInfo}>
            设备信息
          </button>
          <button
            disabled={!props.hasDevice || busy}
            onClick={() => runOutput(props.onCurrentActivity, "当前 Activity")}
          >
            当前 Activity
          </button>
          <button disabled={!props.hasDevice || busy} onClick={doMirror}>
            投屏
          </button>
        </div>

        <div className="tools-actions">
          <label className="tools-label">码率</label>
          <input
            className="record-seconds"
            value={bitrate}
            disabled={recording}
            onChange={(e) => setBitrate(e.target.value)}
            title="录屏码率（Mbps）"
          />
          <span className="manage-desc">Mbps</span>
          {recording ? (
            <button className="danger" disabled={busy} onClick={doStopRecord}>
              停止录屏
            </button>
          ) : (
            <button disabled={!props.hasDevice || busy} onClick={doStartRecord}>
              开始录屏
            </button>
          )}
          {recording && <span className="manage-desc">录屏中…</span>}
        </div>
      </section>

      {status && <div className="tools-status">{status}</div>}

      {output && (
        <section className="manage-section output-panel">
          <div className="output-header">
            <h2>{output.title}</h2>
            <button onClick={() => setOutput(null)}>清空</button>
          </div>
          {"text" in output ? (
            <pre className="tools-result">{output.text}</pre>
          ) : (
            <dl className="device-info">
              <dt>型号</dt>
              <dd>
                {output.info.brand} {output.info.model}
              </dd>
              <dt>Android</dt>
              <dd>
                {output.info.android}（SDK {output.info.sdk}）
              </dd>
              <dt>序列号</dt>
              <dd>{output.info.serial}</dd>
              <dt>CPU ABI</dt>
              <dd>{output.info.abi}</dd>
              <dt>分辨率</dt>
              <dd>{output.info.resolution}</dd>
              <dt>密度</dt>
              <dd>{output.info.density}</dd>
              <dt>电量</dt>
              <dd>{output.info.battery}</dd>
              <dt>存储</dt>
              <dd>{output.info.storage}</dd>
            </dl>
          )}
        </section>
      )}
    </div>
  );
}
