import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { error as logError, info } from "@tauri-apps/plugin-log";
import { parseLogLine, stripAnsi } from "../../core/logcat";
import type { Device, FilterState, LogEntry } from "../../core/types";
import { LEVEL_SEVERITY } from "../../core/types";

// 前端日志统一走 tauri-plugin-log（写入文件与终端），失败时静默忽略。
const log = {
  info: (m: string) => {
    info(m).catch(() => {});
  },
  error: (m: string) => {
    logError(m).catch(() => {});
  },
};

const MAX_ENTRIES = 200_000;

export type { FilterState };

export interface UseLogcatResult {
  devices: Device[];
  selectedDevice: string | null;
  setSelectedDevice: (s: string) => void;
  refreshDevices: () => Promise<void>;
  buffer: string;
  setBuffer: (b: string) => void;
  running: boolean;
  paused: boolean;
  setPaused: (p: boolean) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => Promise<void>;
  exportLogs: () => Promise<void>;
  entries: LogEntry[];
  /** 原始缓冲（未经过滤），供测试用例引擎使用 */
  allEntries: LogEntry[];
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  error: string | null;
  setError: (e: string | null) => void;
}

export function useLogcat(mergeStack = true): UseLogcatResult {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [buffer, setBuffer] = useState("main");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    minLevel: "V",
    search: "",
    regex: false,
    tags: "",
    pid: "",
    app: "",
  });
  const [error, setError] = useState<string | null>(null);

  const bufferRef = useRef<LogEntry[]>([]);
  const pendingRef = useRef<string[]>([]);
  const idRef = useRef(0);
  const pausedRef = useRef(false);
  const runningRef = useRef(false);
  const manualStopRef = useRef(false);
  const selectedDeviceRef = useRef<string | null>(null);
  const bufferForResumeRef = useRef(buffer);
  const mergeStackRef = useRef(mergeStack);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    bufferForResumeRef.current = buffer;
  }, [buffer]);

  useEffect(() => {
    mergeStackRef.current = mergeStack;
  }, [mergeStack]);

  const refreshDevices = useCallback(async () => {
    log.info("刷新设备列表");
    try {
      const list = await invoke<Device[]>("list_devices");
      log.info(`设备列表返回 ${list.length} 台`);
      setDevices(list);
      setSelectedDevice((prev) => {
        if (prev && list.some((d) => d.serial === prev)) return prev;
        const online = list.find((d) => d.state === "device");
        return online ? online.serial : (list[0]?.serial ?? null);
      });
    } catch (e) {
      log.error(`刷新设备列表失败：${String(e)}`);
      setError(String(e));
    }
  }, []);

  const start = useCallback(async () => {
    if (!selectedDevice) return;
    manualStopRef.current = false;
    log.info(`开始抓取日志：device=${selectedDevice} buffer=${buffer}`);
    setError(null);
    bufferRef.current = [];
    pendingRef.current = [];
    idRef.current = 0;
    setEntries([]);
    try {
      await invoke("start_logcat", {
        device: selectedDevice,
        buffer: buffer === "all" ? null : buffer,
      });
      log.info("start_logcat 调用成功");
      setRunning(true);
    } catch (e) {
      log.error(`start_logcat 失败：${String(e)}`);
      setError(String(e));
    }
  }, [selectedDevice, buffer]);

  const stop = useCallback(async () => {
    manualStopRef.current = true;
    log.info("停止抓取日志");
    try {
      await invoke("stop_logcat");
    } catch (e) {
      log.error(`stop_logcat 失败：${String(e)}`);
      setError(String(e));
    }
    setRunning(false);
  }, []);

  const clear = useCallback(async () => {
    log.info("清空日志");
    bufferRef.current = [];
    pendingRef.current = [];
    idRef.current = 0;
    setEntries([]);
    if (selectedDevice) {
      try {
        await invoke("clear_log", { device: selectedDevice });
      } catch (e) {
        log.error(`clear_log 失败：${String(e)}`);
        setError(String(e));
      }
    }
  }, [selectedDevice]);

  // 订阅日志事件
  useEffect(() => {
    let disposed = false;
    const cleanups: UnlistenFn[] = [];

    listen<string>("logcat-line", (e) => {
      pendingRef.current.push(e.payload);
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    listen("logcat-started", () => setRunning(true)).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    listen("logcat-stopped", () => {
      setRunning(false);
      // 非手动停止时自动重连（如 WiFi adb 掉线）
      if (manualStopRef.current) return;
      const device = selectedDeviceRef.current;
      if (!device) return;
      const buf = bufferForResumeRef.current;
      setTimeout(() => {
        if (manualStopRef.current || disposed) return;
        invoke("start_logcat", {
          device,
          buffer: buf === "all" ? null : buf,
        })
          .then(() => setRunning(true))
          .catch((e) => log.error(`自动重连失败：${String(e)}`));
      }, 2000);
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    listen<string>("logcat-error", (e) => {
      log.error(`logcat 错误：${e.payload}`);
      setError(e.payload);
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  // 批量刷新循环：把积压的行合并进缓冲，限制重渲染频率。
  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      const batch = pendingRef.current;
      if (batch.length === 0) return;
      pendingRef.current = [];
      for (const line of batch) {
        const clean = stripAnsi(line);
        const entry = parseLogLine(clean, idRef.current++);
        if (entry) {
          const last = bufferRef.current[bufferRef.current.length - 1];
          if (
            mergeStackRef.current &&
            last &&
            isStackFrame(entry.message) &&
            sameContext(last, entry)
          ) {
            // Unity 等引擎逐行输出的堆栈帧，合并回上一条（带缩进）
            last.message += "\n  " + entry.message;
            last.raw += "\n" + clean;
          } else {
            bufferRef.current.push(entry);
          }
        } else if (bufferRef.current.length > 0) {
          const last = bufferRef.current[bufferRef.current.length - 1];
          last.message += "\n" + clean;
          last.raw += "\n" + clean;
        }
      }
      if (bufferRef.current.length > MAX_ENTRIES) {
        bufferRef.current = bufferRef.current.slice(
          bufferRef.current.length - MAX_ENTRIES,
        );
      }
      setEntries(bufferRef.current.slice());
    }, 80);
    return () => clearInterval(timer);
  }, []);

  // 首次加载设备。
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // 设备变化 → 自动开始抓取。
  useEffect(() => {
    if (selectedDevice) start();
    // 仅依赖设备选择，避免 buffer 变化时重复触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  // buffer 变化 → 运行中则重启抓取。
  const prevBufferRef = useRef(buffer);
  useEffect(() => {
    if (prevBufferRef.current !== buffer) {
      prevBufferRef.current = buffer;
      if (runningRef.current) start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  const filtered = useMemo(() => {
    const minSev = LEVEL_SEVERITY[filters.minLevel];
    const tags = filters.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const pids = filters.pid
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    let searchRe: RegExp | null = null;
    if (filters.search) {
      try {
        searchRe = filters.regex
          ? new RegExp(filters.search, "i")
          : new RegExp(escapeRegExp(filters.search), "i");
      } catch {
        searchRe = null;
      }
    }
    return entries.filter((e) => {
      if (LEVEL_SEVERITY[e.level] < minSev) return false;
      if (pids.length && !pids.includes(e.pid)) return false;
      if (
        tags.length &&
        !tags.some((t) => e.tag.toLowerCase().includes(t.toLowerCase()))
      ) {
        return false;
      }
      if (searchRe && !searchRe.test(e.message) && !searchRe.test(e.tag)) {
        return false;
      }
      return true;
    });
  }, [entries, filters]);

  const exportLogs = useCallback(async () => {
    log.info(`导出日志，共 ${filtered.length} 条`);
    try {
      const text = filtered.map((e) => e.raw).join("\n");
      const saved = await invoke<string | null>("export_logs", { text });
      if (saved) {
        log.info(`日志已导出到：${saved}`);
        setError(null);
      }
    } catch (e) {
      log.error(`导出失败：${String(e)}`);
      setError(String(e));
    }
  }, [filtered]);

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    refreshDevices,
    buffer,
    setBuffer,
    running,
    paused,
    setPaused,
    start,
    stop,
    clear,
    exportLogs,
    entries: filtered,
    allEntries: entries,
    filters,
    setFilters,
    error,
    setError,
  };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判断 message 是否为 C# 堆栈帧格式：类名:方法名(参数)
 * 例：Network.HttpClient:Send(HttpRequest, Boolean)
 * 普通日志（如 NetWorkLog:Response Url:...）不匹配，不会被误合并。
 */
const STACK_FRAME_RE = /^[A-Za-z_][\w.<>`]*:[A-Za-z_][\w<>`]*\(.*\)$/;

function isStackFrame(message: string): boolean {
  return STACK_FRAME_RE.test(message);
}

/** 同一条堆栈被逐行拆开的特征：tag/pid/tid/level 与时间戳（精确到毫秒）完全相同。 */
function sameContext(a: LogEntry, b: LogEntry): boolean {
  return (
    a.tag === b.tag &&
    a.pid === b.pid &&
    a.tid === b.tid &&
    a.level === b.level &&
    a.date === b.date &&
    a.time === b.time
  );
}
