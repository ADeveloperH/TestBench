import type { IosLogRecord } from "./iosTypes";

// 固定 MacRoman 0x80–0xff 映射，避免依赖各桌面 WebView 的 legacy TextDecoder 支持。
const highBytes = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
const bytesByChar = new Map([...highBytes].map((char, index) => [char, index + 128]));
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const cache = new WeakMap<IosLogRecord, IosLogDisplay>();
export interface IosLogDisplay { message: string; recovered: boolean }

function recoverLine(line: string): string {
  if (!/[^\x00-\x7f]/.test(line)) return line;
  const bytes: number[] = [];
  for (const char of line) {
    const byte = char.codePointAt(0)! < 128 ? char.charCodeAt(0) : bytesByChar.get(char);
    if (byte == null) return line;
    bytes.push(byte);
  }
  try {
    const restored = decoder.decode(new Uint8Array(bytes));
    // 只自动还原有中文证据的、严格有效且逐字节可逆的文本；正常外文不改写。
    if (!/[\u3400-\u9fff\uf900-\ufaff]/u.test(restored) || /\ufffd/.test(restored)) return line;
    const roundTrip = encoder.encode(restored);
    if (roundTrip.length !== bytes.length || roundTrip.some((byte, index) => byte !== bytes[index])) return line;
    return restored;
  } catch { return line; }
}

/** 仅用于展示与搜索，不修改来源记录，也不产生额外日志副本。 */
export function getIosLogDisplay(record: IosLogRecord): IosLogDisplay {
  const existing = cache.get(record);
  if (existing) return existing;
  const message = record.message.split("\n").map(recoverLine).join("\n");
  const result = { message, recovered: message !== record.message };
  cache.set(record, result);
  return result;
}
