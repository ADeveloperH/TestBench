import type { Rule, TestCase } from "../testcases/engine";

export type IosBusinessDefinition = Omit<TestCase, "scope" | "enabled" | "rules"> & {
  rules: (Rule & { ordinary?: true | Pick<Rule, "description" | "expr"> })[];
};
