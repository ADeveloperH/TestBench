export type LogLevel = "V" | "D" | "I" | "W" | "E" | "F" | "A";

/** 日志过滤条件（可保存为命名过滤器） */
export interface FilterState {
  minLevel: LogLevel;
  search: string;
  regex: boolean;
  tags: string;
  pid: string;
  /** 应用包名（保存过滤器时记录，应用时重新解析 PID） */
  app?: string;
}

/** 日志列表滚动指令（定位 / 跳转） */
export interface ScrollCommand {
  seq: number;
  kind: "id" | "top" | "bottom" | "index";
  id?: number;
  index?: number;
}

export interface LogEntry {
  id: number;
  date: string;
  time: string;
  pid: string;
  tid: string;
  level: LogLevel;
  tag: string;
  message: string;
  raw: string;
}

export interface Device {
  serial: string;
  state: string;
  model: string;
  product: string;
  transport: "usb" | "wifi";
}

export const LEVELS: LogLevel[] = ["V", "D", "I", "W", "E", "F", "A"];

export const LEVEL_LABELS: Record<LogLevel, string> = {
  V: "Verbose",
  D: "Debug",
  I: "Info",
  W: "Warn",
  E: "Error",
  F: "Fatal",
  A: "Assert",
};

export const LEVEL_SEVERITY: Record<LogLevel, number> = {
  V: 0,
  D: 1,
  I: 2,
  W: 3,
  E: 4,
  F: 5,
  A: 6,
};

export const BUFFERS = [
  { id: "main", label: "Main" },
  { id: "system", label: "System" },
  { id: "crash", label: "Crash" },
  { id: "radio", label: "Radio" },
  { id: "events", label: "Events" },
  { id: "all", label: "All" },
];

export interface PairingInfo {
  service_name: string;
  code: string;
  payload: string;
}

export interface DeviceInfo {
  serial: string;
  brand: string;
  model: string;
  android: string;
  sdk: string;
  abi: string;
  resolution: string;
  density: string;
  battery: string;
  storage: string;
}
