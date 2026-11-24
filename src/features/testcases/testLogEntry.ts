/** 规则评估与证据的最小输入；不把平台缺失字段伪造成 Android 值。 */
export interface TestLogEntry {
  id: number;
  date: string;
  time: string;
  pid: string | null;
  tag?: string;
  level?: string;
  module?: string | null;
  message: string;
  raw: string;
}
