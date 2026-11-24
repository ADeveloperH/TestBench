import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { IosDevice } from "../ios/iosTypes";
import { iosDevice } from "../../core/workspaceDevice";
import { markIosDeviceUnavailable } from "../ios/iosSessionEvents";

/** 设备发现与采集解耦：本批只负责 iOS 枚举，不创建日志订阅或会话。 */
export function useWorkspaceDevices() {
  const [iosDevices, setIosDevices] = useState<IosDevice[]>([]);
  const [selectedIosKey, setSelectedIosKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const markIosUnavailable = useCallback((deviceKey: string) => {
    revision.current += 1;
    setIosDevices((current) => markIosDeviceUnavailable(current, deviceKey));
  }, []);
  const refreshIos = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    const startedRevision = revision.current;
    try {
      const devices = await invoke<IosDevice[]>("ios_probe_list_devices");
      if (mounted.current && startedRevision === revision.current) { setIosDevices(devices); setError(""); }
    } catch (cause) {
      if (mounted.current && startedRevision === revision.current) {
        setIosDevices([]);
        setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : String(cause));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refreshIos();
    return () => { mounted.current = false; };
  }, [refreshIos]);
  return { devices: iosDevices.map(iosDevice), selectedIosKey, setSelectedIosKey, error, refreshing, refreshIos, markIosUnavailable };
}
