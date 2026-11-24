/** 主动布局校准不走 measureElement 的滚动期跳过策略。只测挂载行，不扫描全量日志。 */
export function measureLogRows(parent: Pick<HTMLElement, "querySelectorAll"> | null, virtualizer: { resizeItem: (index: number, size: number) => void }) {
  parent?.querySelectorAll<HTMLElement>(".log-row[data-index]").forEach((row) => {
    const index = Number(row.dataset.index);
    const height = row.getBoundingClientRect().height;
    if (row.isConnected && Number.isInteger(index) && index >= 0 && height > 0) {
      virtualizer.resizeItem(index, height);
    }
  });
}
