import type { IosDevice } from "./iosTypes";

export interface IosSessionIdentity { sessionId: string; deviceKey: string }

export function matchesIosSession(event: IosSessionIdentity, selectedDevice: string, sessionId: string | null): boolean {
  return !!sessionId && event.sessionId === sessionId && event.deviceKey === `ios:${selectedDevice}`;
}

export function markIosDeviceUnavailable(devices: IosDevice[], deviceKey: string): IosDevice[] {
  return devices.map((device) => `ios:${device.id}` === deviceKey
    ? { ...device, state: "unavailable", connectionState: "unavailable", capabilities: [] }
    : device);
}
