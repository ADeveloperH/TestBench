import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EMPTY_STATE, reconcileAutomationState, type AutomationState, type Draft } from "./model";

/** App级持有：切换Tab/工具页不取消任务；运行状态由Rust持有。 */
export function useAutomation() {
  const [state, setState] = useState<AutomationState>(EMPTY_STATE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const starting = useRef(false);
  const receiveSnapshot = useCallback((value: AutomationState) => setState((previous) => reconcileAutomationState(previous, value)), []);
  useEffect(() => {
    let disposed = false; let unlisten: (() => void) | undefined;
    invoke<AutomationState>("automation_snapshot").then((value) => { if (!disposed) receiveSnapshot(value); }).catch(() => {});
    listen<AutomationState>("automation-state", (event) => { if (!disposed) receiveSnapshot(event.payload); }).then((value) => { if (disposed) value(); else unlisten = value; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [receiveSnapshot]);
  const connect = useCallback(async (tabId: string, device: string, packageName: string) => {
    setPending(true); setError("");
    try { receiveSnapshot(await invoke<AutomationState>("automation_connect", { tabId, device, package: packageName })); }
    catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }, [receiveSnapshot]);
  const start = useCallback(async (tabId: string, draft: Draft, beforeStart?: () => Promise<void>) => {
    if (starting.current) return;
    starting.current = true;
    setPending(true); setError("");
    try {
      await beforeStart?.();
      receiveSnapshot(await invoke<AutomationState>("automation_start", { task: { tabId, ...draft } }));
    }
    catch (e) { setError(String(e)); }
    finally { starting.current = false; setPending(false); }
  }, [receiveSnapshot]);
  const stop = useCallback(async () => { try { await invoke("automation_stop"); } catch (e) { setError(String(e)); } }, []);
  const disconnect = useCallback(async () => {
    setPending(true); try { await invoke("automation_disconnect"); setState(EMPTY_STATE); } catch (e) { setError(String(e)); } finally { setPending(false); }
  }, []);
  return { state, pending, error, connect, start, stop, disconnect };
}
export type AutomationController = ReturnType<typeof useAutomation>;
