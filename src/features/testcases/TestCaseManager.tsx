import { useState } from "react";
import type { AppInfo } from "../../core/apps";
import type { TestCasesStore } from "./useTestCasesStore";
import {
  cond,
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
  if (scope.global) return "全局";
  return `${scope.apps.length} 个应用`;
}

export function TestCaseManager({ store, apps }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const newCase = () => {
    const tc: TestCase = {
      id: `case_${Date.now()}`,
      name: "新用例",
      description: "",
      scope: { global: true, apps: [] },
      enabled: true,
      rules: [],
    };
    store.addCase(tc);
    setEditingId(tc.id);
  };

  return (
    <div>
      <div className="manage-add">
        <button onClick={newCase}>新建用例</button>
      </div>
      <ul className="tc-list">
        {store.cases.map((tc) => (
          <li key={tc.id} className="tc-item">
            <div className="tc-item-head">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={tc.enabled !== false}
                  onChange={() =>
                    store.updateCase({ ...tc, enabled: tc.enabled === false })
                  }
                />
              </label>
              <span className="tc-name">{tc.name}</span>
              <span className="manage-badge">{scopeSummary(tc.scope)}</span>
              <span className="count">{tc.rules.length} 条规则</span>
              <button onClick={() => setEditingId(tc.id)}>编辑</button>
              <button
                className="manage-del"
                onClick={() => store.removeCase(tc.id)}
              >
                删除
              </button>
            </div>
            {tc.description && <div className="tc-desc">{tc.description}</div>}
            {editingId === tc.id && (
              <TestCaseEditor
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
        ))}
      </ul>
    </div>
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

  const update = (patch: Partial<TestCase>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const availableApps = apps.filter(
    (a) => !draft.scope.apps.includes(a.package),
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

      {!draft.scope.global && (
        <div className="scope-apps">
          <div className="manage-add">
            <select value={addPkg} onChange={(e) => setAddPkg(e.target.value)}>
              <option value="">选择应用</option>
              {availableApps.map((a) => (
                <option key={a.package} value={a.package}>
                  {a.name}
                </option>
              ))}
            </select>
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

  return (
    <div className="tc-rule-editor">
      <div className="manage-add">
        <select
          value={rule.effect}
          onChange={(e) => update({ effect: e.target.value as RuleEffect })}
        >
          <option value="pass">出现→通过</option>
          <option value="error">出现→报错</option>
          <option value="warn">出现→警告</option>
        </select>
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
        <select
          value={c.field}
          onChange={(e) =>
            onChange(
              cond(e.target.value as ConditionField, c.op, c.value),
            )
          }
        >
          <option value="message">日志内容</option>
          <option value="tag">Tag</option>
          <option value="level">级别</option>
        </select>
        <select
          value={c.op}
          onChange={(e) =>
            onChange(cond(c.field, e.target.value as ConditionOp, c.value))
          }
        >
          <option value="contains">包含</option>
          <option value="not_contains">不包含</option>
          <option value="equals">等于</option>
          <option value="not_equals">不等于</option>
          <option value="regex">正则</option>
        </select>
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
        <select
          value={expr.op}
          onChange={(e) =>
            onChange({
              kind: "group",
              op: e.target.value as GroupOp,
              children: expr.children,
            })
          }
        >
          <option value="and">全部满足(AND)</option>
          <option value="or">任一满足(OR)</option>
        </select>
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
