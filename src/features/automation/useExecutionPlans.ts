import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clone, readSavedDraft, sameDraft, type Catalog, type Draft } from "./model";

export interface SavedPlan { id: string; name: string; draft: Draft; updatedAt: string }
interface PlanList { version: number; revision: number; plans: SavedPlan[]; deleted: SavedPlan[]; migratedSources: string[] }
interface ViewDraft { draft: Draft; baseline: Draft; planId: string; revision: number }
const empty: PlanList = { version: 1, revision: 0, plans: [], deleted: [], migratedSources: [] };
export const legacyPlanKey = (device: string, pkg: string) => `automation-task-v1:${device}:${pkg}`;
export function defaultDraft(catalog: Catalog, scenarioId: string, outputDirectory: string): Draft {
  const scene = catalog.Scenarios.find((s) => s.Id === scenarioId);
  if (!scene) throw new Error("测试包未提供这个场景");
  return { scenario: scene.Id, countries: [...catalog.Countries], plan: clone(scene.Plan), recording: clone(scene.Recording), outputDirectory };
}
export function storedView(text: string | null): ViewDraft | null {
  try {
    const value = JSON.parse(text ?? "null");
    if (typeof value?.planId !== "string" || !Number.isSafeInteger(value.revision)) return null;
    const draft = readSavedDraft(JSON.stringify(value.draft), value.draft?.scenario);
    const baseline = readSavedDraft(JSON.stringify(value.baseline), value.draft?.scenario);
    return draft && baseline ? { draft, baseline, planId: value.planId, revision: value.revision } : null;
  } catch { return null; }
}
export function validatePlanList(value: PlanList, scenario: string): PlanList {
  if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.plans) || !Array.isArray(value.deleted)) throw new Error("本机方案文件格式不支持");
  const ids = new Set<string>();
  for (const item of [...value.plans, ...value.deleted]) {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim() || ids.has(item.id) || !readSavedDraft(JSON.stringify(item.draft), scenario)) throw new Error("本机方案包含无效数据，原文件已保留");
    ids.add(item.id);
  }
  return value;
}
function cached(key: string) { try { return localStorage.getItem(key); } catch { return null; } }

export function useExecutionPlans(tabId: string, device: string, packageName: string, catalog: Catalog | null, busy = false) {
  const viewKey = `automation-view-v2:${tabId}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [list, setList] = useState<PlanList>(empty);
  const [planId, setPlanId] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [scenarioId, setScenarioId] = useState(() => storedView(cached(viewKey))?.draft.scenario ?? "");
  const [reload, setReload] = useState(0);
  const selection = useRef("");
  const draftRef = useRef<Draft | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  draftRef.current = draft;
  const dirty = !!draft && !sameDraft(draft, baseline);
  useEffect(() => {
    if (!catalog) { setDraft(null); setBaseline(null); return; }
    const id = catalog.Scenarios.some((s) => s.Id === scenarioId) ? scenarioId : catalog.Scenarios[0]?.Id;
    if (!id) { setLoadError("当前测试包没有提供可执行场景"); return; }
    if (id !== scenarioId) { setScenarioId(id); return; }
    let active = true;
    setLoading(true); setLoadError(""); setDraft(null);
    const oldKey = legacyPlanKey(device, packageName);
    const legacy = readSavedDraft(cached(oldKey), id);
    Promise.all([
      invoke<PlanList>("automation_plans_read", { package: packageName, scenario: id, source: legacy && !busyRef.current ? oldKey : null, legacy: busyRef.current ? null : legacy }),
      invoke<string>("automation_default_output"),
    ]).then(([raw, output]) => {
      if (!active) return;
      const next = validatePlanList(raw, id);
      const view = reload === 0 ? storedView(cached(viewKey)) : null;
      const selected = next.plans.find((p) => p.id === (reload ? selection.current : view?.planId))
        ?? (!view && !reload && legacy ? next.plans.find((p) => sameDraft(p.draft, legacy)) : undefined);
      const base = selected ? clone(selected.draft) : defaultDraft(catalog, id, output);
      const restore = view?.draft.scenario === id && !sameDraft(view.draft, view.baseline);
      const current = restore ? clone(view.draft) : clone(base);
      // An old unsupported country remains visible as a validation error until the user edits it.
      // Do not silently replace an existing plan when the APK's supported countries change.
      if (!current.outputDirectory) current.outputDirectory = output;
      if (!base.outputDirectory) base.outputDirectory = output;
      setList(next); setPlanId(restore ? view.planId : selected?.id ?? "");
      setRevision(restore ? view.revision : next.revision);
      setBaseline(restore ? view.baseline : base); setDraft(current);
    }).catch((e) => { if (active) setLoadError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [catalog, device, packageName, scenarioId, reload, viewKey]);
  useEffect(() => {
    if (!draft || !baseline || loading) return;
    try { localStorage.setItem(viewKey, JSON.stringify({ draft, baseline, planId, revision })); } catch { /* Named plans are still saved on disk. */ }
  }, [draft, baseline, planId, revision, loading, viewKey]);
  const selectPlan = (id: string) => {
    if (!catalog || !draft) return;
    const selected = list.plans.find((p) => p.id === id);
    const next = selected ? clone(selected.draft) : defaultDraft(catalog, draft.scenario, draft.outputDirectory);
    if (!next.outputDirectory) next.outputDirectory = draft.outputDirectory;
    setPlanId(selected?.id ?? ""); setRevision(list.revision); setBaseline(clone(next)); setDraft(next);
  };
  const update = async (operation: "create" | "save" | "rename" | "delete" | "restore", name?: string) => {
    const current = draftRef.current;
    if (!current) return;
    setSaving(true);
    try {
      const next = validatePlanList(await invoke<PlanList>("automation_plans_update", { package: packageName, scenario: current.scenario, revision, operation, id: planId || null, name: name ?? null, draft: operation === "create" || operation === "save" ? current : null }), current.scenario);
      setList(next); setRevision(next.revision);
      if (operation === "create" || operation === "save") {
        const saved = operation === "create" ? next.plans[next.plans.length - 1] : next.plans.find((p) => p.id === planId)!;
        setPlanId(saved.id); setBaseline(clone(current));
      } else if (operation === "delete") {
        setPlanId(""); setBaseline(clone(current));
        // Keep the deleted plan's parameters as an unsaved draft.
        if (catalog) setBaseline(defaultDraft(catalog, current.scenario, current.outputDirectory));
      } else if (operation === "restore") {
        const saved = next.plans[next.plans.length - 1];
        setPlanId(saved.id); setDraft(clone(saved.draft)); setBaseline(clone(saved.draft));
      }
    } finally { setSaving(false); }
  };
  return { draft, setDraft, list, planId, loading, saving, loadError, dirty, update, selectPlan,
    changeScenario: (id: string) => { selection.current = ""; setScenarioId(id); },
    refresh: () => { selection.current = planId; setReload((n) => n + 1); } };
}
