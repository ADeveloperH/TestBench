export interface Clip {
  Id: string; Flow: "level_success" | "level_failure"; Enabled: boolean;
  Args: Record<string, string>; Extensions: Record<string, unknown>;
}
export interface Plan {
  Version: number; PagePauseMs: number; RequestPauseMs: number; FailureHoldMs: number; TypingIntervalMs: number;
  Environment: { Country: string; Language: string; Extensions: Record<string, unknown> };
  Modules: Clip[];
}
export interface RecordingSettings { Width: number; Height: number; FrameRate: number; BitRateMbps: number; CaptureAudio: boolean }
export interface ConfigurationField { Scope: "plan" | "module"; Path: string; Label: string; Type: "number" | "bool" | "text"; Min?: number; Max?: number; Flows?: string[] }
export interface Scenario { Id: string; Name: string; Plan: Plan; Recording: RecordingSettings; Fields?: ConfigurationField[] }
export interface Catalog { ProtocolVersion: number; Game: string; Adapter: string; Countries: string[]; Scenarios: Scenario[] }
export interface Step { Graph: string; Node: string; Title: string; Status: string; Kind: string; Duration: number; Started?: number; Detail?: string; ErrorCode?: string }
export interface AutomationState {
  ownerTab: string; device: string; package: string; connected: boolean; busy: boolean;
  catalog: Catalog | null; phase: string; country: string; graph: string; node: string;
  errorCode: string; error: string; runDir: string; steps: Step[];
  clips: { country: string; file: string; clip: Record<string, string>; media: { durationSeconds: number; width: number; height: number } }[];
}
export interface Draft { scenario: string; countries: string[]; plan: Plan; recording: RecordingSettings; outputDirectory: string }
export const EMPTY_STATE: AutomationState = { ownerTab: "", device: "", package: "", connected: false, busy: false, catalog: null, phase: "idle", country: "", graph: "", node: "", errorCode: "", error: "", runDir: "", steps: [], clips: [] };
/** Every snapshot source must preserve an unchanged catalog, not just status events. */
export function reconcileAutomationState(previous: AutomationState, next: AutomationState): AutomationState {
  return { ...next, catalog: previous.catalog === next.catalog || JSON.stringify(previous.catalog) === JSON.stringify(next.catalog) ? previous.catalog : next.catalog };
}
export const phaseLabel: Record<string, string> = { idle: "未连接", connecting: "连接中", ready: "已连接", preparing: "准备中", prepared: "已准备", running: "执行中", passed: "国家执行完成", completed: "全部完成", partial: "部分完成", failed: "执行失败", cancelled: "已停止", disconnected: "连接断开" };
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
/** Rust and browser serializers may order JSON object keys differently. */
export function sameDraft(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined, value);
}
export function writePath<T>(value: T, path: string, next: unknown): T {
  const keys = path.split(".");
  if (!keys.every((key) => /^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !["constructor", "prototype", "__proto__"].includes(key))) throw new Error("配置字段路径无效");
  const copy = clone(value); let target = copy as Record<string, unknown>;
  keys.slice(0, -1).forEach((key) => { const child = target[key]; target[key] = child && typeof child === "object" ? child : {}; target = target[key] as Record<string, unknown>; });
  if (next === "") delete target[keys[keys.length - 1]]; else target[keys[keys.length - 1]] = next; return copy;
}
export function newClip(flow: Clip["Flow"]): Clip {
  return { Id: `clip_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, Flow: flow, Enabled: true, Args: { level: flow === "level_success" ? "5" : "6", on_ahead: "stop" }, Extensions: {} };
}
/** 仅做表单检查；业务合法性与片段排序始终由 Unity 共用编译器决定。 */
export function validateDraft(draft: Draft, catalog: Catalog): string | null {
  if (!catalog.Scenarios.some((s) => s.Id === draft.scenario)) return "当前测试包不支持此场景";
  if (!draft.countries.length) return "请至少选择一个游戏支持的国家";
  const unsupported = draft.countries.filter((c) => !catalog.Countries.includes(c));
  if (unsupported.length) return `当前测试包不支持方案中的国家：${unsupported.join("、")}，请重新选择`;
  if (!isPlan(draft.plan) || !isRecording(draft.recording)) return "配置格式不完整，请恢复游戏默认值或重新导入";
  if (draft.plan.Version !== 4 || !Array.isArray(draft.plan.Modules) || !draft.plan.Modules.some((c) => c.Enabled)) return "请至少启用一个片段";
  if (draft.plan.Modules.length > 100 || new Set(draft.plan.Modules.map((c) => c.Id)).size !== draft.plan.Modules.length) return "片段过多或ID重复";
  if (draft.plan.Modules.some((c) => !["level_success", "level_failure"].includes(c.Flow) || !/^(0|[1-9]\d*)$/.test(c.Args.level ?? "") || Number(c.Args.level) > 10000)) return "关卡须为0–10000的整数，0表示届时当前关卡";
  if (new Set(draft.countries).size !== draft.countries.length) return "录制国家不能重复";
  if (draft.plan.PagePauseMs < 300 || draft.plan.PagePauseMs > 10000 || draft.plan.RequestPauseMs < 300 || draft.plan.RequestPauseMs > 10000 || draft.plan.FailureHoldMs < 300 || draft.plan.FailureHoldMs > 10000 || draft.plan.TypingIntervalMs < 80 || draft.plan.TypingIntervalMs > 1000) return "请检查页面停留、请求间隔和输入节奏";
  if (!draft.outputDirectory.trim()) return "请选择素材输出目录";
  const r = draft.recording;
  if (![r.Width, r.Height, r.FrameRate].every(Number.isInteger) || r.Width < 240 || r.Width > 4096 || r.Height < 240 || r.Height > 4096 || r.FrameRate < 1 || r.FrameRate > 60 || !Number.isFinite(r.BitRateMbps) || r.BitRateMbps < 1 || r.BitRateMbps > 100) return "请检查录屏尺寸、帧率和码率";
  return null;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is Record<string, string> => object(value) && Object.values(value).every((v) => typeof v === "string");
export function isPlan(value: unknown): value is Plan {
  if (!object(value) || value.Version !== 4 || !object(value.Environment) || !object(value.Environment.Extensions) || typeof value.Environment.Country !== "string" || typeof value.Environment.Language !== "string") return false;
  if (!["PagePauseMs", "RequestPauseMs", "FailureHoldMs", "TypingIntervalMs"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))) return false;
  return Array.isArray(value.Modules) && value.Modules.length <= 100 && value.Modules.every((clip) => object(clip) && typeof clip.Id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(clip.Id) && ["level_success", "level_failure"].includes(String(clip.Flow)) && typeof clip.Enabled === "boolean" && strings(clip.Args) && object(clip.Extensions));
}
export function isRecording(value: unknown): value is RecordingSettings {
  return object(value) && ["Width", "Height", "FrameRate", "BitRateMbps"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) && typeof value.CaptureAudio === "boolean";
}
export function readSavedDraft(text: string | null, scenario: string): Draft | null {
  try {
    const value: unknown = JSON.parse(text ?? "null");
    return object(value) && value.scenario === scenario && isPlan(value.plan) && isRecording(value.recording) && Array.isArray(value.countries) && value.countries.every((c) => typeof c === "string") && typeof value.outputDirectory === "string" ? value as unknown as Draft : null;
  } catch { return null; }
}
export function importProject(text: string, scenario: string): { plan: Plan; recording?: RecordingSettings } {
  const value: unknown = JSON.parse(text);
  if (!object(value) || value.Version !== 1 || !object(value.Plans) || !isPlan(value.Plans[scenario])) throw new Error("请选择包含本场景的ProjectSettings/Automation.json格式配置，片段及环境字段须完整");
  const recording = object(value.Recording) ? value.Recording[scenario] : undefined;
  if (recording !== undefined && !isRecording(recording)) throw new Error("录屏配置格式无效");
  return { plan: value.Plans[scenario], recording };
}
export function exportProject(draft: Draft): string { return JSON.stringify({ Version: 1, Recording: { [draft.scenario]: draft.recording }, Plans: { [draft.scenario]: draft.plan } }, null, 2); }
