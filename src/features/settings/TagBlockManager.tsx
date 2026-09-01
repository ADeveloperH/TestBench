import { useState } from "react";
import { Select } from "../../components/Select";
import type {
  EffectiveTagBlockRule,
  TagBlockMatch,
} from "../../core/tagBlockRules";

interface Props {
  enabled: boolean;
  rules: EffectiveTagBlockRule[];
  onSetEnabled: (enabled: boolean) => void;
  onAdd: (
    value: string,
    description: string,
    match: TagBlockMatch,
    group: string,
  ) => string;
  onRemove: (id: string) => void;
  onSetRuleEnabled: (id: string, enabled: boolean) => void;
  onSetGroupEnabled: (group: string, enabled: boolean) => void;
}

const IMPORTANT_TAGS = new Set([
  "unity",
  "td_java",
  "android.manager",
  "android.ad_aggregation",
]);

export function TagBlockManager(props: Props) {
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [match, setMatch] = useState<TagBlockMatch>("exact");
  const [group, setGroup] = useState("自定义");
  const [message, setMessage] = useState("");

  const groups = [...new Set(props.rules.map((rule) => rule.group))];
  const enabledCount = props.rules.filter((rule) => rule.enabled).length;

  const addRule = () => {
    const tag = value.trim();
    if (!tag) return;
    const duplicate = props.rules.some(
      (rule) =>
        rule.match === match &&
        rule.value.trim().toLowerCase() === tag.toLowerCase(),
    );
    if (duplicate) {
      setMessage("相同 Tag 和匹配方式的规则已经存在");
      return;
    }
    props.onAdd(tag, description, match, group);
    setValue("");
    setDescription("");
    setMessage(
      IMPORTANT_TAGS.has(tag.toLowerCase())
        ? `已添加「${tag}」。这是关键业务 Tag，启用后可能隐藏重要日志。`
        : `已添加「${tag}」`,
    );
  };

  return (
    <section className="manage-section tag-block-section">
      <div className="manage-section-heading">
        <h2>Tag 全局屏蔽</h2>
        <p>
          只影响普通日志页面的显示与当前视图导出；测试用例页面、规则检测和原始调试日志不受影响。
          规则按 Tag 名称自动排序。
        </p>
      </div>

      <div className="tag-block-master">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.enabled}
            onChange={(event) => props.onSetEnabled(event.target.checked)}
          />
          普通日志页启用全局 Tag 屏蔽
        </label>
        <span className="count">
          已启用 {enabledCount} / {props.rules.length} 条规则
        </span>
      </div>

      <div className="manage-add tag-block-add">
        <input
          placeholder="Logcat Tag"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Select
          className="tag-block-match-select"
          value={match}
          title="匹配方式"
          options={[
            { value: "exact", label: "精确匹配" },
            { value: "prefix", label: "前缀匹配" },
          ]}
          onChange={(next) => setMatch(next as TagBlockMatch)}
        />
        <input
          placeholder="分组，例如：埋点 SDK"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        />
        <input
          placeholder="描述（可选）"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") addRule();
          }}
        />
        <button onClick={addRule} disabled={!value.trim()}>
          添加
        </button>
      </div>
      {message && <div className="settings-inline-status">{message}</div>}

      {groups.length > 0 && (
        <div className="tag-block-groups">
          <span className="count">分组：</span>
          {groups.map((name) => {
            const groupRules = props.rules.filter((rule) => rule.group === name);
            const allEnabled = groupRules.every((rule) => rule.enabled);
            return (
              <button
                key={name}
                className={allEnabled ? "active" : ""}
                onClick={() => props.onSetGroupEnabled(name, !allEnabled)}
                title={allEnabled ? `关闭「${name}」组` : `启用「${name}」组`}
              >
                {name} {groupRules.filter((rule) => rule.enabled).length}/
                {groupRules.length}
              </button>
            );
          })}
        </div>
      )}

      <ul className="manage-list tag-block-list">
        {props.rules.map((rule) => {
          return (
            <li key={rule.id} className="manage-item tag-block-item">
              <label className="tag-block-rule-toggle" title="启用或关闭该规则">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) =>
                    props.onSetRuleEnabled(rule.id, event.target.checked)
                  }
                />
              </label>
              <span className="manage-name" title={rule.value}>
                {rule.value}
              </span>
              <span className="manage-badge">
                {rule.match === "exact" ? "精确" : "前缀"}
              </span>
              <span className="manage-badge">{rule.group}</span>
              <span className="manage-badge">
                {rule.builtin ? "内置" : "本地"}
              </span>
              <span className="manage-desc" title={rule.description}>
                {rule.description || "暂无描述"}
              </span>
              <div className="tag-block-actions">
                <button
                  className="manage-del"
                  disabled={rule.builtin}
                  title={rule.builtin ? "内置规则不能删除，可以关闭" : "删除"}
                  onClick={() => props.onRemove(rule.id)}
                >
                  删除
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
