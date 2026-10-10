import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getBuiltinTestCases } from "../../core/builtinRegistry";
import type { AppInfo } from "../../core/apps";
import { Select } from "../../components/Select";
import { IS_DEBUG } from "../../core/debug";
import type { TestCasesStore } from "./useTestCasesStore";
import {
  cond,
  EFFECT_LABELS,
  isBuiltinTestCase,
  ruleSummary,
  type ConditionExpr,
  type ConditionField,
  type ConditionOp,
  type GroupOp,
  type Rule,
  type RuleEffect,
  type Scope,
  type TestCase,
} from "./engine";

interface Props {
  store: TestCasesStore;
  apps: AppInfo[];
}

function scopeSummary(scope: Scope): string {
  if (scope.global) {
    const excludedCount = scope.excludedApps?.length ?? 0;
    return excludedCount > 0 ? `全局（排除 ${excludedCount} 个）` : "全局";
  }
  return `${scope.apps.length} 个应用`;
}



export function TestCaseManager({ store, apps }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [newGroup, setNewGroup] = useState("自定义");
  const [source, setSource] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<{ kind: "delete"; ids: string[] } | { kind: "restore" } | null>(null);
  const [notice, setNotice] = useState("");
  const builtinCount = store.cases.filter((tc) => isBuiltinTestCase(tc.id)).length;
  const customCount = store.cases.length - builtinCount;
  const visibleCases = store.cases.filter((tc) => source === "all" ||
    (source === "builtin" ? isBuiltinTestCase(tc.id) : !isBuiltinTestCase(tc.id)));
  const selectedCases = visibleCases.filter((tc) => selectedIds.has(tc.id));
  const deleteIds = confirmation?.kind === "delete"
    ? confirmation.ids.filter((id) => store.cases.some((tc) => tc.id === id) && (IS_DEBUG || !isBuiltinTestCase(id)))
    : [];
  const skippedCount = confirmation?.kind === "delete"
    ? confirmation.ids.filter((id) => store.cases.some((tc) => tc.id === id) && !IS_DEBUG && isBuiltinTestCase(id)).length
    : 0;

  useEffect(() => {
    const alive = new Set(store.cases.map((tc) => tc.id));
    setSelectedIds((prev) => [...prev].every((id) => alive.has(id)) ? prev : new Set([...prev].filter((id) => alive.has(id))));
    setEditingId((id) => id && !alive.has(id) ? null : id);
    setExpandedId((id) => id && !alive.has(id) ? null : id);
  }, [store.cases]);

  const selectCases = (cases: TestCase[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const tc of cases) {
        if (selected) next.add(tc.id);
        else next.delete(tc.id);
      }
      return next;
    });
  };

  const setSelectedEnabled = (enabled: boolean) => {
    store.setCasesEnabled(selectedCases.map((tc) => tc.id), enabled);
    setEditingId(null);
    setNotice(`已${enabled ? "启用" : "停用"} ${selectedCases.length} 条用例`);
  };

  const groupOf = (tc: TestCase) => tc.group?.trim() || "自定义";

  // 组顺序：按用例出现顺序收集（内置模块组在前，新组追加在后）
  const groups = useMemo(() => {
    const list: string[] = [];
    for (const tc of store.cases) {
      const g = groupOf(tc);
      if (!list.includes(g)) list.push(g);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.cases]);

  const toggleGroup = (g: string) =>
    setCollapsedGroups((m) => ({ ...m, [g]: !m[g] }));

  const newCase = () => {
    const tc: TestCase = {
      id: `case_${crypto.randomUUID()}`,
      name: "新用例",
      description: "",
      scope: { global: true, apps: [] },
      enabled: true,
      rules: [],
      group: newGroup.trim() || "自定义",
    };
    store.addCase(tc);
    setSource("all");
    setSelectedIds(new Set());
    setCollapsedGroups((prev) => ({ ...prev, [tc.group!]: false }));
    setExpandedId(tc.id);
    setEditingId(tc.id);
  };

  return (
    <div className="tc-manager">
      <div className="manage-add">
        <button onClick={newCase}>新建用例</button>
        <Select
          className="tc-group-select"
          title="新用例的分组"
          value={newGroup}
          options={groups.map((g) => ({ value: g, label: g }))}
          onChange={(v) => setNewGroup(v)}
        />
      </div>
      <div className="manage-add tc-batch-toolbar">
        <Select
          title="用例来源"
          value={source}
          options={[
            { value: "all", label: `全部 (${store.cases.length})` },
            { value: "builtin", label: `内置 (${builtinCount})` },
            { value: "custom", label: `非内置 (${customCount})` },
          ]}
          onChange={(value) => {
            setSource(value);
            setSelectedIds(new Set());
            setEditingId(null);
            setNotice("");
          }}
        />
        <CaseSelection
          label="全选当前筛选结果"
          cases={visibleCases}
          selectedIds={selectedIds}
          onChange={(selected) => selectCases(visibleCases, selected)}
          showLabel
        />
        <button disabled={!selectedCases.length} onClick={() => setSelectedIds(new Set())}>取消选择</button>
        <span className="count" aria-live="polite">已选 {selectedCases.length} 条</span>
        <button disabled={!selectedCases.length} onClick={() => setSelectedEnabled(true)}>启用选中</button>
        <button disabled={!selectedCases.length} onClick={() => setSelectedEnabled(false)}>停用选中</button>
        <button className="danger" disabled={!selectedCases.length}
          onClick={() => setConfirmation({ kind: "delete", ids: selectedCases.map((tc) => tc.id) })}>删除选中</button>
        <button className="danger" onClick={() => setConfirmation({ kind: "restore" })}>恢复为仅内置用例</button>
      </div>
      <p className="manage-desc">选择框用于批量操作，“启用”开关控制监测；全选包含折叠分组中的用例。</p>
      {store.storageError && <p className="tc-storage-error" role="alert">{store.storageError}</p>}
      {notice && <p className="manage-desc" role="status">{notice}</p>}
      {!visibleCases.length && <p className="manage-desc">当前来源没有用例。</p>}
      {groups.filter((g) => visibleCases.some((tc) => groupOf(tc) === g)).map((g) => {
        const groupCases = visibleCases.filter((tc) => groupOf(tc) === g);
        const collapsed = !!collapsedGroups[g];
        return (
          <div key={g} className="tc-group">
            <div className="tc-group-head" onClick={() => toggleGroup(g)}>
              <CaseSelection label={`选择分组 ${g}`} cases={groupCases} selectedIds={selectedIds}
                onChange={(selected) => selectCases(groupCases, selected)} />
              <button className="tc-group-toggle" aria-expanded={!collapsed} aria-label={`${collapsed ? "展开" : "收起"}分组 ${g}`}
                onClick={(e) => { e.stopPropagation(); toggleGroup(g); }}>
              <span
                className={`tc-group-arrow ${collapsed ? "collapsed" : ""}`}
                aria-hidden="true"
              />
              <span className="tc-group-name">{g}</span>
              </button>
              <span className="count">{groupCases.length} 个用例</span>
            </div>
            {!collapsed && (
              <ul className="tc-list">
                {groupCases.map((tc) => {
          const expanded = expandedId === tc.id;
          return (
          <li key={tc.id} className="tc-item">
            <div
              className="tc-item-head"
              onClick={() => setExpandedId(expanded ? null : tc.id)}
              title={expanded ? "点击收起" : "点击展开查看"}
            >
              <CaseSelection label={`选择用例 ${tc.name}`} cases={[tc]} selectedIds={selectedIds}
                onChange={(selected) => selectCases([tc], selected)} />
              <button
                className={`manage-move tc-item-toggle ${expanded ? "expanded" : ""}`}
                title={expanded ? "收起" : "展开查看"}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedId(expanded ? null : tc.id);
                }}
              >
                <span aria-hidden="true" />
              </button>
              <label
                className="checkbox"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  aria-label={`启用用例 ${tc.name}`}
                  checked={tc.enabled !== false}
                  onChange={() =>
                    store.updateCase({ ...tc, enabled: tc.enabled === false })
                  }
                />
                启用
              </label>
              <span className="tc-name">{tc.name}</span>
              {isBuiltinTestCase(tc.id) && (
                <span className="manage-badge">内置</span>
              )}
              <span className="manage-badge">{scopeSummary(tc.scope)}</span>
              <span className="count">{tc.rules.length} 条规则</span>
              <button
                className={editingId === tc.id ? "active" : ""}
                onClick={(e) => {
                  e.stopPropagation();
                  if (editingId === tc.id) {
                    setEditingId(null);
                  } else {
                    setEditingId(tc.id);
                    setExpandedId(tc.id);
                  }
                }}
              >
                {editingId === tc.id ? "收起" : "编辑"}
              </button>
              <button
                className="manage-del"
                disabled={isBuiltinTestCase(tc.id) && !IS_DEBUG}
                title={
                  isBuiltinTestCase(tc.id)
                    ? IS_DEBUG
                      ? "调试模式：内置用例可删除（发布后对用户生效）"
                      : "内置用例不可删除"
                    : "删除"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmation({ kind: "delete", ids: [tc.id] });
                }}
              >
                删除
              </button>
            </div>
            {expanded && (
              <div className="tc-preview">
                {tc.description && <div className="tc-desc">{tc.description}</div>}
                {tc.rules.length === 0 ? (
                  <div className="tc-desc">（还没有规则）</div>
                ) : (
                  <ul className="tc-rules">
                    {tc.rules.map((rule, i) => (
                      <li key={i} className="tc-rule">
                        <span className="tc-rule-dot">•</span>
                        <span className="tc-rule-effect">
                          {EFFECT_LABELS[rule.effect]}
                        </span>
                        <span>{rule.description}</span>
                        <span className="count">{ruleSummary(rule)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {editingId === tc.id && (
              <TestCaseEditor
                key={JSON.stringify(tc)}
                tc={tc}
                apps={apps}
                onSave={(updated) => {
                  store.updateCase(updated);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            )}
          </li>
          );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {confirmation && <CaseConfirmation
        title={confirmation.kind === "restore" ? "恢复为仅内置用例" : "删除选中用例"}
        description={confirmation.kind === "restore"
          ? `将删除全部 ${customCount} 条非内置用例，恢复 ${getBuiltinTestCases().length} 条当前内置用例及其默认启用状态，并清空本地启停覆盖与调试删除名单。建议先导出需要保留的配置。`
          : `将删除 ${deleteIds.length} 条用例，跳过 ${skippedCount} 条受保护的内置用例。删除后无法撤销。`}
        confirmLabel={confirmation.kind === "restore" ? "确认恢复" : "确认删除"}
        disabled={confirmation.kind === "delete" && !deleteIds.length}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation.kind === "restore") {
            store.restoreBuiltins();
            setSource("all");
            setCollapsedGroups({});
            setNotice("已恢复当前内置用例及默认启用状态，全部非内置用例已移除。");
          } else {
            store.removeCases(deleteIds);
            setNotice(`已删除 ${deleteIds.length} 条用例，跳过 ${skippedCount} 条内置用例。`);
          }
          setSelectedIds(new Set());
          setEditingId(null);
          setExpandedId(null);
          setConfirmation(null);
        }}
      />}
    </div>
  );
}

function CaseSelection({ label, cases, selectedIds, onChange, showLabel = false }: {
  label: string;
  cases: TestCase[];
  selectedIds: ReadonlySet<string>;
  onChange: (selected: boolean) => void;
  showLabel?: boolean;
}) {
  const count = cases.filter((tc) => selectedIds.has(tc.id)).length;
  return <label className="checkbox tc-selection" onClick={(e) => e.stopPropagation()}>
    <input type="checkbox" aria-label={label} disabled={!cases.length}
      checked={cases.length > 0 && count === cases.length}
      ref={(input) => { if (input) input.indeterminate = count > 0 && count < cases.length; }}
      onChange={(e) => onChange(e.target.checked)} />
    {showLabel && label}
  </label>;
}

function CaseConfirmation({ title, description, confirmLabel, disabled, onCancel, onConfirm }: {
  title: string; description: string; confirmLabel: string; disabled: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Tab") {
        const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
    // 回调使用本次挂载的取消动作；不要因父组件重新渲染抢夺焦点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="save-description-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={dialogRef} className="save-description-dialog tc-confirm-dialog" role="dialog" aria-modal="true"
        aria-labelledby="tc-confirm-title" aria-describedby="tc-confirm-description">
        <h3 id="tc-confirm-title">{title}</h3>
        <p id="tc-confirm-description">{description}</p>
        <div className="save-description-actions">
          <button onClick={onCancel}>取消</button>
          <button className="danger" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>, document.body,
  );
}

interface EditorProps {
  tc: TestCase;
  apps: AppInfo[];
  onSave: (tc: TestCase) => void;
  onCancel: () => void;
}

function TestCaseEditor({ tc, apps, onSave, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<TestCase>(() =>
    JSON.parse(JSON.stringify(tc)),
  );
  const [addPkg, setAddPkg] = useState("");
  const [addExcludedPkg, setAddExcludedPkg] = useState("");

  const update = (patch: Partial<TestCase>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const availableApps = apps.filter(
    (a) => !draft.scope.apps.includes(a.package),
  );
  const availableExcludedApps = apps.filter(
    (a) => !(draft.scope.excludedApps ?? []).includes(a.package),
  );

  const addApp = () => {
    if (!addPkg) return;
    update({ scope: { ...draft.scope, apps: [...draft.scope.apps, addPkg] } });
    setAddPkg("");
  };

  const removeApp = (pkg: string) => {
    update({
      scope: { ...draft.scope, apps: draft.scope.apps.filter((p) => p !== pkg) },
    });
  };

  const addExcludedApp = () => {
    if (!addExcludedPkg) return;
    update({
      scope: {
        ...draft.scope,
        excludedApps: [
          ...(draft.scope.excludedApps ?? []),
          addExcludedPkg,
        ],
      },
    });
    setAddExcludedPkg("");
  };

  const removeExcludedApp = (pkg: string) => {
    update({
      scope: {
        ...draft.scope,
        excludedApps: (draft.scope.excludedApps ?? []).filter(
          (p) => p !== pkg,
        ),
      },
    });
  };

  const updateRule = (i: number, rule: Rule) => {
    const rules = [...draft.rules];
    rules[i] = rule;
    update({ rules });
  };

  const addRule = () => {
    const rule: Rule = {
      effect: "pass",
      description: "",
      expr: { kind: "group", op: "and", children: [] },
    };
    update({ rules: [...draft.rules, rule] });
  };

  const removeRule = (i: number) => {
    update({ rules: draft.rules.filter((_, j) => j !== i) });
  };

  return (
    <div className="tc-editor">
      <div className="manage-add">
        <input
          placeholder="用例名称（必填）"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        <input
          placeholder="分组（如：提现 / 网络 / 自定义）"
          value={draft.group ?? ""}
          onChange={(e) => update({ group: e.target.value })}
        />
        <input
          placeholder="用例描述（自然语言，必填）"
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </div>

      <div className="manage-add">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.scope.global}
            onChange={(e) =>
              update({ scope: { ...draft.scope, global: e.target.checked } })
            }
          />
          全局（所有应用生效）
        </label>
      </div>

      {draft.scope.global && (
        <div className="scope-apps">
          <div className="manage-add">
            <Select
              className="tc-scope-select"
              title="选择要排除的应用"
              value={addExcludedPkg}
              options={[
                { value: "", label: "选择排除应用", fullLabel: "选择排除应用" },
                ...availableExcludedApps.map((a) => ({
                  value: a.package,
                  label: a.name,
                  fullLabel: `${a.name}（${a.package}）`,
                })),
              ]}
              onChange={(v) => setAddExcludedPkg(v)}
            />
            <button onClick={addExcludedApp} disabled={!addExcludedPkg}>
              排除
            </button>
          </div>
          {(draft.scope.excludedApps?.length ?? 0) > 0 && (
            <div className="scope-chips">
              {draft.scope.excludedApps?.map((pkg) => {
                const name = apps.find((a) => a.package === pkg)?.name ?? pkg;
                return (
                  <span key={pkg} className="scope-chip">
                    排除：{name}
                    <button
                      className="scope-chip-x"
                      onClick={() => removeExcludedApp(pkg)}
                      title="取消排除"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!draft.scope.global && (
        <div className="scope-apps">
          <div className="manage-add">
            <Select
              className="tc-scope-select"
              title="选择应用"
              value={addPkg}
              options={[
                { value: "", label: "选择应用", fullLabel: "选择应用" },
                ...availableApps.map((a) => ({
                  value: a.package,
                  label: a.name,
                  fullLabel: `${a.name}（${a.package}）`,
                })),
              ]}
              onChange={(v) => setAddPkg(v)}
            />
            <button onClick={addApp} disabled={!addPkg}>
              添加
            </button>
          </div>
          {draft.scope.apps.length > 0 && (
            <div className="scope-chips">
              {draft.scope.apps.map((pkg) => {
                const name = apps.find((a) => a.package === pkg)?.name ?? pkg;
                return (
                  <span key={pkg} className="scope-chip">
                    {name}
                    <button
                      className="scope-chip-x"
                      onClick={() => removeApp(pkg)}
                      title="移除"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <h4>规则</h4>
      {draft.rules.map((rule, i) => (
        <RuleEditor
          key={i}
          rule={rule}
          onChange={(r) => updateRule(i, r)}
          onRemove={() => removeRule(i)}
        />
      ))}
      <button onClick={addRule}>添加规则</button>

      <div className="manage-add" style={{ marginTop: 10 }}>
        <button onClick={() => onSave(draft)}>保存</button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

interface RuleEditorProps {
  rule: Rule;
  onChange: (r: Rule) => void;
  onRemove: () => void;
}

function RuleEditor({ rule, onChange, onRemove }: RuleEditorProps) {
  const update = (patch: Partial<Rule>) => onChange({ ...rule, ...patch });

  const setAbsence = (on: boolean) => {
    if (on) {
      update({
        absence: { anchor: cond("message", "contains", ""), withinSec: 30 },
      });
    } else {
      const next = { ...rule };
      delete next.absence;
      onChange(next);
    }
  };

  return (
    <div className="tc-rule-editor">
      <div className="manage-add">
        <Select
          className="tc-effect-select"
          title="规则效果"
          value={rule.effect}
          options={[
            { value: "pass", label: "出现→通过" },
            { value: "error", label: "出现→报错" },
            { value: "warn", label: "出现→警告" },
          ]}
          onChange={(v) => update({ effect: v as RuleEffect })}
        />
        <input
          placeholder="规则描述（必填）"
          value={rule.description}
          onChange={(e) => update({ description: e.target.value })}
        />
        <button className="manage-del" onClick={onRemove}>
          删除规则
        </button>
      </div>
      <ExprEditor
        expr={rule.expr}
        onChange={(e) => update({ expr: e })}
        depth={0}
      />
      <div className="manage-add" style={{ marginTop: 6 }}>
        <label className="checkbox">
          出现
          <input
            type="number"
            min={1}
            style={{ width: 56, minWidth: 0 }}
            value={rule.minCount ?? 1}
            disabled={!!rule.absence}
            onChange={(e) =>
              update({ minCount: Math.max(1, parseInt(e.target.value) || 1) })
            }
          />
          次才触发
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!rule.absence}
            onChange={(e) => setAbsence(e.target.checked)}
          />
          缺失判定
        </label>
      </div>
      {rule.absence && (
        <div className="tc-absence">
          <div className="manage-add">
            <span>锚点出现后</span>
            <input
              type="number"
              min={1}
              style={{ width: 64, minWidth: 0 }}
              value={rule.absence.withinSec}
              onChange={(e) =>
                update({
                  absence: {
                    ...rule.absence!,
                    withinSec: Math.max(1, parseInt(e.target.value) || 30),
                  },
                })
              }
            />
            <span>秒内未匹配则触发。锚点条件：</span>
          </div>
          <ExprEditor
            expr={rule.absence.anchor}
            onChange={(e) =>
              update({ absence: { ...rule.absence!, anchor: e } })
            }
            depth={0}
          />
        </div>
      )}
    </div>
  );
}

interface ExprEditorProps {
  expr: ConditionExpr;
  onChange: (e: ConditionExpr) => void;
  onRemove?: () => void;
  depth: number;
}

function ExprEditor({ expr, onChange, onRemove, depth }: ExprEditorProps) {
  if (expr.kind === "cond") {
    const c = expr.cond;
    return (
      <div
        className="manage-add tc-condition"
        style={{ paddingLeft: depth * 16 }}
      >
        <Select
          className="tc-field-select"
          title="匹配字段"
          value={c.field}
          options={[
            { value: "message", label: "日志内容" },
            { value: "tag", label: "Tag" },
            { value: "level", label: "级别" },
          ]}
          onChange={(v) =>
            onChange(cond(v as ConditionField, c.op, c.value))
          }
        />
        <Select
          className="tc-op-select"
          title="匹配方式"
          value={c.op}
          options={[
            { value: "contains", label: "包含" },
            { value: "not_contains", label: "不包含" },
            { value: "equals", label: "等于" },
            { value: "not_equals", label: "不等于" },
            { value: "regex", label: "正则" },
          ]}
          onChange={(v) =>
            onChange(cond(c.field, v as ConditionOp, c.value))
          }
        />
        <input
          placeholder="值"
          value={c.value}
          onChange={(e) => onChange(cond(c.field, c.op, e.target.value))}
        />
        {onRemove && (
          <button className="manage-del" onClick={onRemove}>
            ×
          </button>
        )}
      </div>
    );
  }

  // group
  const updateChild = (i: number, child: ConditionExpr) => {
    const children = [...expr.children];
    children[i] = child;
    onChange({ kind: "group", op: expr.op, children });
  };
  const addCond = () =>
    onChange({
      kind: "group",
      op: expr.op,
      children: [...expr.children, cond("message", "contains", "")],
    });
  const addGroup = () =>
    onChange({
      kind: "group",
      op: expr.op,
      children: [...expr.children, { kind: "group", op: "and", children: [] }],
    });
  const removeChild = (i: number) =>
    onChange({
      kind: "group",
      op: expr.op,
      children: expr.children.filter((_, j) => j !== i),
    });

  return (
    <div className="expr-group" style={{ paddingLeft: depth * 16 }}>
      <div className="manage-add">
        <Select
          className="tc-groupop-select"
          title="条件组合方式"
          value={expr.op}
          options={[
            { value: "and", label: "全部满足(AND)" },
            { value: "or", label: "任一满足(OR)" },
          ]}
          onChange={(v) =>
            onChange({
              kind: "group",
              op: v as GroupOp,
              children: expr.children,
            })
          }
        />
        {onRemove && (
          <button className="manage-del" onClick={onRemove}>
            删除此组
          </button>
        )}
      </div>
      {expr.children.map((child, i) => (
        <ExprEditor
          key={i}
          expr={child}
          onChange={(c) => updateChild(i, c)}
          onRemove={() => removeChild(i)}
          depth={depth + 1}
        />
      ))}
      <div className="manage-add">
        <button onClick={addCond}>+ 条件</button>
        <button onClick={addGroup}>+ 条件组</button>
      </div>
    </div>
  );
}
