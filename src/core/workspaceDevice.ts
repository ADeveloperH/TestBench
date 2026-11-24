import type { Device } from "./types";
import type { IosDevice } from "../features/ios/iosTypes";

export type DeviceCapability = "logs" | "apps" | "pid" | "clear-device-logs" | "mirror" | "record";
export interface WorkspaceDevice {
  key: string;
  platform: "android" | "ios";
  nativeId: string;
  name: string;
  transport: string;
  connection: "online" | "unavailable";
  trust: string;
  locked: boolean | null;
  capabilities: DeviceCapability[];
}

export function androidDevice(device: Device): WorkspaceDevice {
  const online = device.state === "device";
  return {
    key: `android:${device.serial}`, platform: "android", nativeId: device.serial,
    name: device.model || device.serial, transport: device.transport,
    connection: online ? "online" : "unavailable", trust: device.state,
    locked: null,
    capabilities: online ? ["logs", "apps", "pid", "clear-device-logs", "mirror", "record"] : [],
  };
}

export function iosDevice(device: IosDevice): WorkspaceDevice {
  return {
    key: `ios:${device.id}`, platform: "ios", nativeId: device.id,
    name: device.name || device.model || device.displayId, transport: device.transport,
    connection: device.connectionState, trust: device.trustState, locked: device.locked,
    capabilities: device.capabilities.includes("syslog") ? ["logs"] : [],
  };
}
