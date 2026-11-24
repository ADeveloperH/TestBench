/** 不让全局日志快捷键穿透输入、浮层或其他页面。 */
export function canHandleLogShortcut(event: Pick<KeyboardEvent, "target" | "defaultPrevented" | "isComposing">, options: { allowTarget?: Element | null; allowButton?: boolean } = {}): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (typeof document !== "undefined" && document.querySelector('[role="dialog"], [role="alertdialog"], .save-description-backdrop, .select-menu-floating, .history-dropdown-floating, .toolbar-more-menu')) return false;
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== "function") return true;
  if (target === options.allowTarget) return true;
  const fields = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="separator"]';
  return !target.closest(options.allowButton ? fields : `${fields}, button`);
}
