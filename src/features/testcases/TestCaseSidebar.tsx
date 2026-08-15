import { useState } from "react";
import type { AppInfo } from "../../core/apps";
import { useTestCases, type CaseStatus } from "./useTestCases";
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

const STATUS_META: Record<
  CaseStatus,
  { icon: string; label: string; className: string }
> = {
  fail: { icon: "❌", label: "有问题", className: "status-fail" },
  suspected: { icon: "⚠️", label: "疑似", className: "status-warn" },
  pass: { icon: "✅", label: "通过", className: "status-pass" },
  pending: { icon: "⏳", label: "没测到", className: "status-pending" },
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
  const { results, resetAll, resetCase } = useTestCases(
    allEntries,
    scopePkg,
    pidFilter,
    store.cases,
  );
  const appName = apps.find((a) => a.package === scopePkg)?.name;

  return (
    <div className="tc-sidebar">
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
        {results.map((r) => {
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
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
