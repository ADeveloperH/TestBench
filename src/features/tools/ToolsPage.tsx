import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { AppInfo } from "../../core/apps";
import type { DeviceInfo } from "../../core/types";
import { Select } from "../../components/Select";

/** 应用运行状态（与日志页一致）：running 运行中 / installed 已安装未运行 / missing 未安装 / unknown 未知。 */
export type AppRunState = "running" | "installed" | "missing" | "unknown";

export interface BugreportProgress {
  stage: "generating" | "pulling" | "analyzing" | "complete";
  percent: number | null;
  message: string;
}

export interface BugreportResult {
  reportPath: string;
  summaryPath: string | null;
  sizeBytes: number;
  anrMatches: number;
  javaCrashMatches: number;
  nativeCrashMatches: number;
  warning: string | null;
}

interface Props {
  apps: AppInfo[];
  hasDevice: boolean;
  /** 查询应用运行状态（与日志页同一套逻辑） */
  appState: (pkg: string) => AppRunState;
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
  bugreportProgress: BugreportProgress | null;
  bugreportStatus: string;
  onExportBugreport: () => Promise<void>;
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
  const [tab, setTab] = useState<"app" | "device">("device");

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

  const doBugreport = async () => {
    const ok = await ask(
      "生成故障报告可能需要几分钟，报告中可能包含设备、应用和系统日志等敏感信息。是否继续？",
      { title: "导出故障报告", kind: "warning" },
    );
    if (!ok) return;

    setBusy(true);
    try {
      await props.onExportBugreport();
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (t: "app" | "device") => {
    setTab(t);
    // 切换 tab 时清空上个 tab 的结果展示，避免串台
    setStatus("");
    setOutput(null);
  };

  const selectedApp = props.apps.find((app) => app.package === pkg);
  const selectedAppState = pkg ? props.appState(pkg) : "unknown";
  const selectedAppStateLabel: Record<AppRunState, string> = {
    running: "运行中",
    installed: "已安装，未运行",
    missing: "未安装",
    unknown: "状态未知",
  };

  return (
    <div className="manage-page tools-page">
      <div className="manage-header">
        <button onClick={props.onBack}>← 返回</button>
        <div className="manage-title-block">
          <h1>工具</h1>
          <p>面向应用和设备的常用测试操作</p>
        </div>
      </div>

      <div className="manage-workspace">
        <aside className="manage-nav tools-nav" aria-label="工具分类">
          <div className="manage-nav-group">
            <span className="manage-nav-label">工具</span>
            <button className={tab === "device" ? "active" : ""} onClick={() => switchTab("device")}>
              <span>设备工具</span>
              <small>文件、诊断与屏幕</small>
            </button>
            <button className={tab === "app" ? "active" : ""} onClick={() => switchTab("app")}>
              <span>应用工具</span>
              <small>运行、诊断与数据</small>
            </button>
          </div>
        </aside>

        <main className="manage-content tools-content">
          {tab === "app" && (
            <section className="manage-section">
              <div className="manage-section-heading">
                <h2>应用工具</h2>
                <p>先选择应用，再执行运行控制、诊断或数据操作。</p>
              </div>
              <div className="tool-context-card">
                <div className="tool-context-label">目标应用</div>
                <Select
                  className="tools-app-select"
                  title="选择应用"
                  value={pkg}
                  searchable
                  searchPlaceholder="搜索应用名或包名…"
                  options={[
                    { value: "", label: "选择应用", fullLabel: "选择应用" },
                    ...props.apps.map((app) => {
                      const state = props.appState(app.package);
                      return {
                        value: app.package,
                        label: (
                          <span className={`app-opt app-opt-${state}`}>
                            <i className="app-dot" />
                            {app.name}（{app.package}）
                          </span>
                        ),
                        fullLabel: `${app.name}（${app.package}）`,
                      };
                    }),
                  ]}
                  onChange={setPkg}
                />
              <div className={`tool-context-state app-opt app-opt-${selectedAppState}`}>
                  <i className="app-dot" />
                  {pkg ? selectedAppStateLabel[selectedAppState] : "尚未选择应用"}
                </div>
                {selectedApp && <div className="tool-context-package">{selectedApp.package}</div>}
              </div>
              {!props.hasDevice && <div className="settings-inline-status warning">请先在日志页连接设备。</div>}
              <div className="tool-card-grid">
                <article className="tool-card">
                  <div><h3>运行控制</h3><p>打开调试入口或重新启动目标应用。</p></div>
                  <div className="tool-card-actions">
                    <button disabled={!appReady || busy} onClick={() => run(() => props.onOpenBackdoor(pkg))}>打开后门</button>
                    <button disabled={!appReady || busy} onClick={() => run(() => props.onRestartApp(pkg))}>重启应用</button>
                  </div>
                </article>
                <article className="tool-card">
                  <div><h3>应用诊断</h3><p>查看定时任务和运行性能信息。</p></div>
                  <div className="tool-card-actions">
                    <button disabled={!appReady || busy} onClick={() => runOutput(() => props.onAppAlarm(pkg), "应用 Alarm")}>查看 Alarm</button>
                    <button disabled={!appReady || busy} onClick={() => runOutput(() => props.onAppPerformance(pkg), "性能信息")}>性能信息</button>
                  </div>
                </article>
                <article className="tool-card tool-card-danger">
                  <div><h3>数据与安装</h3><p>这些操作会改变设备上的应用数据或安装状态。</p></div>
                  <div className="tool-card-actions">
                    <button className="danger" disabled={!appReady || busy} onClick={doClear}>清除数据</button>
                    <button className="danger" disabled={!appReady || busy} onClick={doUninstall}>卸载应用</button>
                  </div>
                </article>
              </div>
            </section>
          )}

          {tab === "device" && (
            <section className="manage-section">
              <div className="manage-section-heading">
                <h2>设备工具</h2>
                <p>处理设备文件、系统信息、投屏和录屏。</p>
              </div>
              {!props.hasDevice && <div className="settings-inline-status warning">请先在日志页连接设备。</div>}
              <div className="tool-card-grid">
                <article className="tool-card">
                  <div><h3>文件与截图</h3><p>获取当前屏幕或向设备安装 APK。</p></div>
                  <div className="tool-card-actions">
                    <button disabled={!props.hasDevice || busy} onClick={() => run(props.onScreenshot)}>截图</button>
                    <button disabled={!props.hasDevice || busy} onClick={() => run(props.onInstallApk)}>安装 APK</button>
                  </div>
                </article>
                <article className="tool-card">
                  <div><h3>设备诊断</h3><p>读取设备参数和当前前台 Activity。</p></div>
                  <div className="tool-card-actions">
                    <button disabled={!props.hasDevice || busy} onClick={showInfo}>设备信息</button>
                    <button disabled={!props.hasDevice || busy} onClick={() => runOutput(props.onCurrentActivity, "当前 Activity")}>当前 Activity</button>
                  </div>
                </article>
                <article className="tool-card">
                  <div>
                    <h3>故障报告</h3>
                    <p>调用 Android Bugreport 导出完整系统报告，并同步生成便于定位的 ANR / Crash 摘要。</p>
                  </div>
                  {props.bugreportProgress && (
                    <div className="bugreport-progress" aria-live="polite">
                      <div className="bugreport-progress-head">
                        <span>{props.bugreportProgress.message}</span>
                        {props.bugreportProgress.percent !== null && <strong>{props.bugreportProgress.percent}%</strong>}
                      </div>
                      <div className="bugreport-progress-track">
                        <div
                          className={`bugreport-progress-fill ${
                            props.bugreportProgress.percent === null ? "indeterminate" : ""
                          }`}
                          style={
                            props.bugreportProgress.percent === null
                              ? undefined
                              : { width: `${props.bugreportProgress.percent}%` }
                          }
                        />
                      </div>
                    </div>
                  )}
                  <div className="tool-card-actions">
                    <button
                      disabled={
                        !props.hasDevice ||
                        busy ||
                        recording ||
                        (!!props.bugreportProgress && props.bugreportProgress.stage !== "complete")
                      }
                      onClick={doBugreport}
                    >
                      {props.bugreportProgress && props.bugreportProgress.stage !== "complete"
                        ? "正在导出…"
                        : "导出故障报告"}
                    </button>
                  </div>
                </article>
                <article className="tool-card">
                  <div><h3>屏幕工具</h3><p>投屏与录屏共用码率设置，范围为 1–100 Mbps。</p></div>
                  <div className="tool-card-actions screen-tool-actions">
                    <label htmlFor="screen-bitrate">码率</label>
                    <div className="tool-inline-field">
                      <input id="screen-bitrate" className="record-seconds" value={bitrate} disabled={recording} onChange={(event) => setBitrate(event.target.value)} title="投屏和录屏码率（Mbps）" />
                      <span>Mbps</span>
                    </div>
                    <button disabled={!props.hasDevice || busy} onClick={doMirror}>投屏</button>
                    {recording ? (
                      <button className="danger" disabled={busy} onClick={doStopRecord}>停止录屏</button>
                    ) : (
                      <button disabled={!props.hasDevice || busy} onClick={doStartRecord}>开始录屏</button>
                    )}
                    {recording && <span className="recording-indicator">录屏中…</span>}
                  </div>
                </article>
              </div>
            </section>
          )}

          {status && <div className="tools-status">{status}</div>}
          {tab === "device" && props.bugreportStatus && (
            <div className="tools-status">{props.bugreportStatus}</div>
          )}

          {output && (
            <section className="output-panel">
              <div className="output-header">
                <h2>{output.title}</h2>
                <button onClick={() => setOutput(null)}>清空</button>
              </div>
              {"text" in output ? (
                <pre className="tools-result">{output.text}</pre>
              ) : (
                <dl className="device-info">
                  <dt>型号</dt><dd>{output.info.brand} {output.info.model}</dd>
                  <dt>Android</dt><dd>{output.info.android}（SDK {output.info.sdk}）</dd>
                  <dt>序列号</dt><dd>{output.info.serial}</dd>
                  <dt>CPU ABI</dt><dd>{output.info.abi}</dd>
                  <dt>分辨率</dt><dd>{output.info.resolution}</dd>
                  <dt>密度</dt><dd>{output.info.density}</dd>
                  <dt>电量</dt><dd>{output.info.battery}</dd>
                  <dt>存储</dt><dd>{output.info.storage}</dd>
                </dl>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
