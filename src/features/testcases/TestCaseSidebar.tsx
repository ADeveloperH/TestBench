import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { AppInfo } from "../../core/apps";
import { useTestCases, type CaseStatus } from "./useTestCases";
import { ruleSummary, type TestCase } from "./engine";
import type { TestCasesStore } from "./useTestCasesStore";
import type { LogEntry } from "../../core/types";

interface Props {
  store: TestCasesStore;
  allEntries: LogEntry[];
  scopePkg: string;
  pidFilter: string;
  apps: AppInfo[];
  onLocate: (id: number) => void;
  onManage: () => void;
  onClose: () => void;
}

// 侧栏宽度：可拖拽调整，持久化。
const SIDEBAR_WIDTH_KEY = "tc-sidebar-width-v2";
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 640;

function loadSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (v >= SIDEBAR_MIN_WIDTH && v <= SIDEBAR_MAX_WIDTH) return v;
  } catch {
    // 忽略损坏的缓存
  }
  return 340;
}

const STATUS_META: Record<
  CaseStatus,
  { icon: string; label: string; className: string }
> = {
  fail: { icon: "❌", label: "有问题", className: "status-fail" },
  suspected: { icon: "⚠️", label: "疑似", className: "status-warn" },
  pass: { icon: "✅", label: "通过", className: "status-pass" },
  pending: { icon: "⏳", label: "监控中", className: "status-pending" },
  disabled: { icon: "○", label: "未启用", className: "status-disabled" },
};

function effectLabel(effect: string) {
  switch (effect) {
    case "pass":
      return "出现→通过";
    case "error":
      return "出现→报错";
    case "warn":
      return "出现→警告";
    default:
      return effect;
  }
}

export function TestCaseSidebar({
  store,
  allEntries,
  scopePkg,
  pidFilter,
  apps,
  onLocate,
  onManage,
  onClose,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(loadSidebarWidth);
  const { results, resetAll, resetCase } = useTestCases(
    allEntries,
    scopePkg,
    pidFilter,
    store.cases,
  );
  const appName = apps.find((a) => a.package === scopePkg)?.name;

  // 拖拽调整侧栏宽度（左边缘手柄，向左拖 = 加宽）。
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const onResizeStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    let finalW = width;
    // 不超过父容器（日志区）的 70%，保证日志列表始终可见
    const maxByArea = Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.floor((sidebarRef.current?.parentElement?.clientWidth ?? 0) * 0.7),
    );
    const maxW = Math.min(SIDEBAR_MAX_WIDTH, maxByArea);
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      finalW = Math.min(
        maxW,
        Math.max(
          SIDEBAR_MIN_WIDTH,
          dragRef.current.startW + (dragRef.current.startX - ev.clientX),
        ),
      );
      setWidth(finalW);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("tc-resizing");
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalW));
      } catch {
        // 忽略写入失败
      }
    };
    document.body.classList.add("tc-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const groupOf = (tc: TestCase) => tc.group?.trim() || "自定义";

  // 问题优先级：fail > suspected > pass > pending > disabled
  const statusRank: Record<CaseStatus, number> = {
    fail: 0,
    suspected: 1,
    pass: 2,
    pending: 3,
    disabled: 4,
  };

  // 用例排序：问题优先；同状态按最近触发时间倒序（新出现的问题最上）
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      const ra = statusRank[a.status];
      const rb = statusRank[b.status];
      if (ra !== rb) return ra - rb;
      let ta = 0;
      let tb = 0;
      for (const h of a.ruleHits) {
        if (h.hit && (h.triggeredAt ?? 0) > ta) ta = h.triggeredAt ?? 0;
      }
      for (const h of b.ruleHits) {
        if (h.hit && (h.triggeredAt ?? 0) > tb) tb = h.triggeredAt ?? 0;
      }
      return tb - ta;
    });
  }, [results]);

  // 组顺序：有问题的组（fail/suspected）排前，其余保持原顺序
  const groups = useMemo(() => {
    const map = new Map<string, number>();
    const order: string[] = [];
    for (const r of sortedResults) {
      const g = groupOf(r.testCase);
      const rank = statusRank[r.status];
      if (!map.has(g)) {
        map.set(g, rank);
        order.push(g);
      } else if (rank < map.get(g)!) {
        map.set(g, rank);
      }
    }
    return order.sort((a, b) => {
      const ra = map.get(a)!;
      const rb = map.get(b)!;
      const aProblem = ra <= 1;
      const bProblem = rb <= 1;
      if (aProblem && !bProblem) return -1;
      if (!aProblem && bProblem) return 1;
      if (aProblem && bProblem) return ra - rb;
      return 0;
    });
  }, [sortedResults]);

  return (
    <div className="tc-sidebar" style={{ width }} ref={sidebarRef}>
      <div
        className="tc-resizer"
        onMouseDown={onResizeStart}
        title="拖动调整测试用例面板宽度"
      />
      <div className="tc-sidebar-head">
        <span className="tc-sidebar-title">测试用例</span>
        <button className="tc-sidebar-close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="tc-sidebar-toolbar">
        <button onClick={resetAll}>新测试</button>
        <button onClick={onManage}>管理</button>
      </div>

      <div className="tc-sidebar-app">
        当前应用：{scopePkg ? `${appName ?? scopePkg}` : "未选择"}
      </div>

      {!scopePkg && <p className="manage-desc">请先在日志页选择应用。</p>}

      <ul className="tc-sidebar-list">
        {groups.map((g) => (
          <li key={g} className="tc-sidebar-group">
            <div className="tc-sidebar-group-name">{g}</div>
            {sortedResults
              .filter((r) => groupOf(r.testCase) === g)
              .map((r) => {
          const meta = STATUS_META[r.status];
          const expanded = expandedId === r.testCase.id;
          return (
            <li key={r.testCase.id} className="tc-sidebar-item">
              <div
                className="tc-sidebar-row"
                onClick={() => setExpandedId(expanded ? null : r.testCase.id)}
              >
                <span className={`tc-status ${meta.className}`}>
                  {meta.icon} {meta.label}
                </span>
                <span className="tc-name">{r.testCase.name}</span>
                <button
                  className="manage-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetCase(r.testCase.id);
                  }}
                  title="重置该用例"
                >
                  重置
                </button>
              </div>

              {expanded && (
                <div className="tc-sidebar-detail">
                  <div className="tc-desc">{r.testCase.description}</div>
                  {r.testCase.rules.map((rule, i) => {
                    const rh = r.ruleHits[i];
                    return (
                      <div key={i} className="tc-sidebar-rule">
                        <div className={rh.hit ? "tc-rule hit" : "tc-rule"}>
                          <span className="tc-rule-dot">
                            {rh.hit ? "●" : "○"}
                          </span>
                          <span className="tc-rule-effect">
                            [{effectLabel(rule.effect)}]
                          </span>
                          <span>{rule.description}</span>
                          <span className="count">{ruleSummary(rule)}</span>
                        </div>
                        {rh.hit && rh.entry && (
                          <div
                            className="tc-match"
                            onClick={() => onLocate(rh.entry!.id)}
                            title="点击定位到该日志"
                          >
                            <span className="tc-match-time">
                              {rh.entry.date} {rh.entry.time}
                            </span>
                            <span className="tc-match-tag">{rh.entry.tag}:</span>
                            <span>{rh.entry.message.slice(0, 120)}</span>
                          </div>
                        )}
                        {rh.hit && rh.missing && (
                          <div className="tc-match missing">
                            （观察窗口内未出现，判定缺失）
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
