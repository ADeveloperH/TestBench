export type DiagnosticStatus =
  | "available"
  | "unavailable"
  | "error"
  | "not_applicable"
  | "unknown";

export type ProbeErrorKind =
  | "InvalidArguments"
  | "ToolNotFound"
  | "InstallationDamaged"
  | "ToolVersionUnsupported"
  | "AppleServiceMissing"
  | "NoDevice"
  | "TrustRequired"
  | "DeviceLocked"
  | "PairingInvalid"
  | "DeviceDisconnected"
  | "ToolExited"
  | "OutputParseFailed"
  | "Io";

export interface ProbeError {
  kind: ProbeErrorKind;
  message: string;
}

export interface IosSessionEvent {
  sessionId: string;
  deviceKey: string;
  error: ProbeError | null;
}

export interface DiagnosticItem {
  status: DiagnosticStatus;
  message: string;
  errorKind: ProbeErrorKind | null;
}

export interface IosDevice {
  id: string;
  displayId: string;
  name: string | null;
  model: string | null;
  osVersion: string | null;
  transport: string;
  state: "online" | "trustRequired" | "locked" | "unavailable";
  connectionState: "online" | "unavailable";
  trustState: "trusted" | "trust_required" | "pairing_invalid" | "unknown";
  locked: boolean | null;
  capabilities: Array<"syslog">;
}

export interface IosDoctorReport {
  platform: string;
  architecture: string;
  tool: DiagnosticItem;
  appleService: DiagnosticItem;
  deviceTransport: DiagnosticItem;
  devices: IosDevice[];
}

export interface IosLogRecord {
  /** 工作区事件身份；原始落盘记录不要求此字段。 */
  sessionId?: string;
  sequence?: number;
  timestamp: string;
  device: string;
  process: string;
  module: string | null;
  pid: number | null;
  level: string;
  semanticLevel: "info" | "warning" | "error" | "exception" | null;
  semanticLevelSource: "unity_heuristic" | null;
  encodingStatus: "valid" | "suspected_mojibake";
  truncated: boolean;
  message: string;
  raw: string;
}

export interface IosLogBatch {
  firstSequence: number;
  sessionId: string;
  deviceKey: string;
  records: IosLogRecord[];
  receivedCount: number;
  emittedCount: number;
  backendDroppedCount: number;
  frontendDroppedCount: number;
}

export interface IosProbeStatus {
  sessionId: string | null;
  deviceKey: string | null;
  state: "idle" | "running" | "error";
  error: ProbeError | null;
  sessionDir: string | null;
  storageError: string | null;
  receivedCount: number;
  emittedCount: number;
  backendDroppedCount: number;
  frontendDroppedCount: number;
}
