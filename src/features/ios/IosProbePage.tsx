import { Select } from "../../components/Select";
import { IosLogList } from "./IosLogList";
import { useIosProbe } from "./useIosProbe";
import type { DiagnosticItem, IosDevice } from "./iosTypes";

interface Props {
  onBack: () => void;
  probe: ReturnType<typeof useIosProbe>;
}

function deviceLabel(device: IosDevice): string {
  const transport =
    device.transport === "unknown"
      ? "连接方式未知"
      : device.transport.toUpperCase();
  return `${device.name ?? device.model ?? "iPhone"} · ${device.osVersion ?? "未知系统"} · ${transport}`;
}

function trustLabel(device: IosDevice): string {
  if (device.trustState === "trusted") return "已信任";
  if (device.trustState === "trust_required") return "需要信任";
  if (device.trustState === "pairing_invalid") return "配对失效";
  return "信任状态未知";
}

function Diagnostic({ label, item }: { label: string; item: DiagnosticItem }) {
  return (
    <div className={`ios-diagnostic ios-status-${item.status}`}>
      <span>{label}</span>
      <strong>{item.message}</strong>
    </div>
  );
}

export function IosProbePage({ onBack, probe }: Props) {
  const device = probe.devices.find((item) => item.id === probe.selectedDevice);
  const selectableDevices = probe.devices.filter(
    (item) =>
      item.capabilities.includes("syslog") || item.id === probe.selectedDevice,
  );
  const canStart =
    !!device &&
    device.connectionState === "online" &&
    device.capabilities.includes("syslog");

  return (
    <div className="manage-page ios-probe-page">
      <div className="manage-header">
        <button onClick={onBack}>← 返回</button>
        <div className="manage-title-block">
          <h1>iOS 日志 Probe</h1>
          <p>内部验收工具；不会改变 Android 日志工作区。</p>
        </div>
      </div>

      <section className="manage-section ios-probe-controls">
        <div className="ios-control-row">
          <Select
            className="ios-device-select"
            title="选择 iOS 设备"
            value={probe.selectedDevice}
            options={
              selectableDevices.length
                ? selectableDevices.map((item) => ({
                    value: item.id,
                    label: deviceLabel(item),
                    fullLabel: `${deviceLabel(item)} · ${item.displayId}`,
                  }))
                : [{ value: "", label: "无当前可采集的 iOS 设备" }]
            }
            onChange={(id) => {
              if (probe.status.state !== "running" && !probe.busy) {
                probe.clear();
                probe.setSelectedDevice(id);
              }
            }}
          />
          <button disabled={probe.busy} onClick={() => void probe.refresh()}>
            刷新设备
          </button>
          <input
            value={probe.processFilter}
            onChange={(event) => probe.setProcessFilter(event.target.value)}
            placeholder="进程名前缀，例如 FruitQuest"
            disabled={probe.status.state === "running"}
          />
          {probe.status.state === "running" ? (
            <button className="danger" disabled={probe.busy} onClick={() => void probe.stop()}>
              停止采集
            </button>
          ) : (
            <button
              className="primary-action"
              disabled={probe.busy || !canStart}
              onClick={() => void probe.start()}
            >
              开始采集
            </button>
          )}
          <button disabled={!probe.records.length} onClick={probe.clear}>清空显示</button>
        </div>

        {device && (
          <div className="ios-device-state">
            <span>连接：{device.connectionState === "online" ? "在线" : "不可用"}</span>
            <span>信任：{trustLabel(device)}</span>
            <span>锁定：{device.locked == null ? "未知" : device.locked ? "已锁定" : "未锁定"}</span>
            <span>Syslog：{device.capabilities.includes("syslog") ? "可用" : "不可用"}</span>
            <code>{device.displayId}</code>
          </div>
        )}
      </section>

      {probe.doctor && (
        <section className="manage-section ios-diagnostics">
          <Diagnostic label="工具" item={probe.doctor.tool} />
          <Diagnostic label="Apple 服务" item={probe.doctor.appleService} />
          <Diagnostic label="设备通信" item={probe.doctor.deviceTransport} />
        </section>
      )}

      <section className="manage-section ios-session-status">
        <div><span>状态</span><strong>{probe.status.state}</strong></div>
        <div><span>后端接收</span><strong>{probe.status.receivedCount}</strong></div>
        <div><span>已发送</span><strong>{probe.status.emittedCount}</strong></div>
        <div><span>后端丢弃</span><strong>{probe.status.backendDroppedCount}</strong></div>
        <div><span>前端丢弃</span><strong>{probe.status.frontendDroppedCount}</strong></div>
        <div><span>当前显示</span><strong>{probe.records.length}</strong></div>
      </section>

      <section className="manage-section ios-probe-placeholder">
        {probe.status.sessionDir && <code>{probe.status.sessionDir}</code>}
      </section>

      <IosLogList records={probe.records} dropped={probe.status.frontendDroppedCount} />

      {probe.error && <div className="error">{probe.error}</div>}
    </div>
  );
}
