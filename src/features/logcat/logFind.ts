import { type LogColumnId, type LogViewRecord } from "../../core/logView";
export interface FindRange { from: number; to: number }
export interface FindRowInfo { rowIndex: number; key: string; start: number; count: number; fields: Partial<Record<LogColumnId, { start: number; count: number }>> }
export interface FindIndex { valid: boolean; total: number; rows: FindRowInfo[]; byId: Map<string, FindRowInfo> }
export const EMPTY_FIND_INDEX: FindIndex = { valid: true, total: 0, rows: [], byId: new Map() };

function compileFind(query: string, caseSensitive: boolean, useRegex: boolean): ((text: string, visit?: (from: number, to: number) => void) => number) | null {
  if (!query) return () => 0;
  if (useRegex) {
    let expression: RegExp;
    try { expression = new RegExp(query, caseSensitive ? "g" : "gi"); } catch { return null; }
    return (text, visit) => {
      expression.lastIndex = 0;
      let count = 0; let match: RegExpExecArray | null;
      while ((match = expression.exec(text)) !== null) {
        if (match[0].length) { count += 1; visit?.(match.index, match.index + match[0].length); }
        else expression.lastIndex += 1;
      }
      return count;
    };
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return (text, visit) => {
    const haystack = caseSensitive ? text : text.toLowerCase();
    let count = 0;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) { count += 1; visit?.(at, at + needle.length); }
    return count;
  };
}
export function findTextRanges(text: string, query: string, caseSensitive: boolean, useRegex: boolean): FindRange[] | null {
  const scan = compileFind(query, caseSensitive, useRegex);
  if (!scan) return null;
  const ranges: FindRange[] = [];
  scan(text, (from, to) => ranges.push({ from, to }));
  return ranges;
}
export function buildFindIndex(rows: LogViewRecord<unknown>[], query: string, caseSensitive: boolean, useRegex: boolean, fields: readonly LogColumnId[]): FindIndex {
  if (!query) return EMPTY_FIND_INDEX;
  // 每次索引只编译一次；统计不为每个匹配分配高亮范围数组。
  const scan = compileFind(query, caseSensitive, useRegex);
  if (!scan) return { valid: false, total: 0, rows: [], byId: new Map() };
  const result: FindIndex = { valid: true, total: 0, rows: [], byId: new Map() };
  rows.forEach((record, rowIndex) => {
    let row: FindRowInfo | undefined;
    for (const field of fields) {
      // 缺失字段不是可查找的“—”日志内容。
      const text = field === "level" ? record.rawLevel : record[field] ?? "";
      const count = scan(text);
      if (!count) continue;
      row ??= { rowIndex, key: record.key, start: result.total, count: 0, fields: {} };
      row.fields[field] = { start: result.total, count };
      row.count += count; result.total += count;
    }
    if (row) { result.rows.push(row); result.byId.set(record.key, row); }
  });
  return result;
}
export function rowOfOccurrence(index: FindIndex, occurrence: number): FindRowInfo | null {
  if (occurrence < 0 || occurrence >= index.total) return null;
  let low = 0; let high = index.rows.length - 1;
  while (low < high) { const mid = (low + high + 1) >> 1; if (index.rows[mid].start <= occurrence) low = mid; else high = mid - 1; }
  return index.rows[low] ?? null;
}
export function liveOccurrenceIndex(rows: LogViewRecord<unknown>[], index: FindIndex, occurrence: number): number {
  const found = rowOfOccurrence(index, occurrence);
  return found ? rows.findIndex((row) => row.key === found.key) : -1;
}
