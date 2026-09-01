export type TagBlockMatch = "exact" | "prefix";

/** 可由代码兜底或远程配置提供的 Tag 屏蔽规则。 */
export interface TagBlockRule {
  id: string;
  value: string;
  description: string;
  match: TagBlockMatch;
  group: string;
  enabledByDefault: boolean;
}

/** 合并远程内置、本地自定义和用户开关后的可用规则。 */
export interface EffectiveTagBlockRule extends TagBlockRule {
  builtin: boolean;
  enabled: boolean;
}

export function tagMatchesBlockRule(
  tag: string,
  rule: Pick<TagBlockRule, "value" | "match">,
): boolean {
  const actual = tag.trim().toLowerCase();
  const expected = rule.value.trim().toLowerCase();
  if (!actual || !expected) return false;
  return rule.match === "prefix"
    ? actual.startsWith(expected)
    : actual === expected;
}

export function isTagBlocked(
  tag: string,
  rules: EffectiveTagBlockRule[],
): boolean {
  return rules.some(
    (rule) => rule.enabled && tagMatchesBlockRule(tag, rule),
  );
}
