import { useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { Select } from "../../components/Select";
import { Icon } from "../../components/Icon";
import type { AppInfo } from "../../core/apps";
import type { Device } from "../../core/types";
import { clone, exportProject, importProject, newClip, phaseLabel, readPath, validateDraft, writePath, type ConfigurationField, type Draft } from "./model";
import type { AutomationController } from "./useAutomation";
import { useExecutionPlans } from "./useExecutionPlans";
import { ExecutionSteps } from "./ExecutionSteps";
interface Props {
  tabId: string; device: string; packageName: string; devices: Device[]; apps: AppInfo[];
  controller: AutomationController; onRun: (draft: Draft) => Promise<void>;
}
function Field({ spec, value, onChange }: { spec: ConfigurationField; value: unknown; onChange: (v: unknown) => void }) {
  return <label className={spec.Type === "bool" ? "automation-check" : "automation-field"}>
    {spec.Type === "bool" ? <><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />{spec.Label}</> : <>{spec.Label}<input type={spec.Type === "number" ? "number" : "text"} min={spec.Min} max={spec.Max} step="any" value={value == null ? "" : String(value)} onChange={(e) => onChange(spec.Type === "number" ? Number(e.target.value) : e.target.value)} /></>}
  </label>;
}
export function AutomationTab(props: Props) {
  const { state, pending, error } = props.controller;
  const own = state.ownerTab === props.tabId;
  const connected = own && state.connected && state.device === props.device && state.package === props.packageName;
  const catalog = own && state.device === props.device && state.package === props.packageName ? state.catalog : null;
  const plans = useExecutionPlans(props.tabId, props.device, props.packageName, catalog, state.busy);
  const { draft, setDraft } = plans;
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [showStop, setShowStop] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "create" | "rename" | "delete" | "discard"; next?: () => void } | null>(null);
  const [planName, setPlanName] = useState("");
  const [dialogError, setDialogError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = pending || state.busy || plans.loading || plans.saving;
  const selectedPlan = plans.list.plans.find((p) => p.id === plans.planId);
  const appLabel = props.apps.find((a) => a.package === props.packageName)?.name ?? props.packageName;
  const deviceLabel = props.devices.find((d) => d.serial === props.device)?.model ?? props.device;
  const guardChanges = (next: () => void) => {
    const proceed = () => { setMessage(""); setNotice(""); next(); };
    if (plans.dirty) { setDialogError(""); setDialog({ kind: "discard", next: proceed }); } else proceed();
  };
  const openName = (kind: "create" | "rename") => {
    const base = selectedPlan?.name ?? "我的执行方案";
    let name = kind === "rename" ? base : selectedPlan ? `${base} 副本` : base;
    let n = 2;
    while (kind === "create" && plans.list.plans.some((p) => p.name === name)) { name = `${base} 副本 ${n++}`; }
    setPlanName(name); setDialogError(""); setDialog({ kind });
  };
  const confirmDialog = async () => {
    if (!dialog || locked) return;
    try {
      if (dialog.kind === "discard") dialog.next?.();
      else { await plans.update(dialog.kind, planName); setNotice(dialog.kind === "delete" ? "方案已删除，可撤销；当前参数仍保留为草稿。" : "方案已保存到本机，可在其他手机复用。"); }
      setDialog(null); setDialogError("");
    } catch (e) { setDialogError(String(e)); }
  };
  const scenario = catalog?.Scenarios.find((s) => s.Id === draft?.scenario);
  const check = draft && catalog ? validateDraft(draft, catalog) : "请先连接自动化测试包";
  const patch = (action: (current: Draft) => Draft) => { setNotice(""); setDraft((current) => current ? action(current) : current); };
  const runAction = async (action: () => Promise<unknown>) => { setMessage(""); setNotice(""); try { await action(); } catch (e) { setMessage(String(e)); } };
  const fields = scenario?.Fields ?? [];
  const renderFields = (scope: "plan" | "module", value: unknown, change: (path: string, next: unknown) => void, flow?: string, group?: "text" | "other"): ReactNode => fields.filter((f) => f.Scope === scope && (!group || (group === "text" ? f.Type === "text" : f.Type !== "text")) && (!f.Flows?.length || (flow && f.Flows.includes(flow)))).map((spec) => <Field key={spec.Path} spec={spec} value={readPath(value, spec.Path)} onChange={(next) => change(spec.Path, next)} />);
  return <div className="automation-page">
    <div className="automation-heading">
      <div className="automation-title"><h2>自动化测试</h2><div className="automation-binding"><span title={props.device}>{deviceLabel || "未绑定设备"}</span><span title={props.packageName}>{appLabel || "未绑定应用"}</span></div></div>
      <div className="automation-session"><span className={`automation-status ${own ? state.phase : "idle"}`}><i />{own ? phaseLabel[state.phase] ?? state.phase : "未连接"}{own && state.country ? ` · ${state.country}` : ""}</span>
        <button disabled={locked || !props.device || !props.packageName} onClick={() => props.controller.connect(props.tabId, props.device, props.packageName)}>{pending ? "正在连接…" : connected ? "重新连接" : "连接测试包"}</button>
        {connected && <button disabled={locked} onClick={props.controller.disconnect}>断开</button>}
      </div>
    </div>
    {!catalog ? <div className="automation-empty">
      <div className="automation-empty-icon"><Icon name="automation" /></div><h3>连接手机，读取游戏的自动化场景</h3>
      <p>此Tab已绑定上方设备和应用。点击“连接测试包”会重新启动该应用。</p>
      <div className="automation-prerequisites"><span>1</span><div><strong>准备支持自动化的 Android 测试包</strong><p>使用专用自动化测试包（TEST + ENABLE_AUTOMATION），无需开启 Development Build。</p></div><span>2</span><div><strong>手机已授权 USB 调试</strong><p>保持手机解锁，游戏在手机前台运行；电脑可以继续处理其他工作。</p></div><span>3</span><div><strong>场景和默认片段从游戏读取</strong><p>接通后选择场景和执行方案，再调整参数并运行。</p></div></div>
    </div> : <div className="automation-workspace">
      <div className="automation-config">
        <section><div className="automation-section-head"><h3>执行配置</h3><span>{plans.loading ? "正在加载方案…" : plans.dirty ? "有未保存的修改" : selectedPlan ? "本机已保存" : "来自游戏测试包"}</span></div>
          <fieldset disabled={locked}>
            <label className="automation-field">场景<Select value={draft?.scenario ?? ""} options={catalog.Scenarios.map((s) => ({ value: s.Id, label: s.Name }))} onChange={(id) => guardChanges(() => plans.changeScenario(id))} title="自动化场景" disabled={locked} /></label>
            <label className="automation-field">执行方案<Select value={plans.planId} options={[{ value: "", label: "游戏默认" }, ...plans.list.plans.map((p) => ({ value: p.id, label: p.name }))]} onChange={(id) => guardChanges(() => plans.selectPlan(id))} title="执行方案" disabled={locked || !draft} /></label>
            <div className="automation-plan-actions">
              <button disabled={locked || !draft || (!!plans.planId && !plans.dirty)} onClick={() => plans.planId ? runAction(async () => { await plans.update("save"); setNotice("方案已保存。"); }) : openName("create")}>保存</button>
              <button disabled={locked || !draft} onClick={() => openName("create")}>另存为</button>
              <button disabled={locked || !selectedPlan} onClick={() => openName("rename")}>重命名</button>
              <button disabled={locked || !selectedPlan} onClick={() => { setDialogError(""); setDialog({ kind: "delete" }); }}>删除</button>
              <button disabled={locked} onClick={() => guardChanges(plans.refresh)}>刷新方案</button>
              {plans.list.deleted.length > 0 && <button disabled={locked} onClick={() => guardChanges(() => { void runAction(() => plans.update("restore")); })}>撤销删除</button>}
            </div>
            <p className="automation-note">{plans.planId ? "自定义方案保存在本机，当前应用可跨设备复用。" : "游戏默认来自测试包；修改后可保存为自定义方案。"}</p>
            <div className="automation-countries"><div className="automation-inline-head"><strong>执行国家</strong><button onClick={() => patch((d) => ({ ...d, countries: d.countries.length === catalog.Countries.length ? [] : [...catalog.Countries] }))}>{draft?.countries.length === catalog.Countries.length ? "取消全选" : "全选"}</button></div><div>{catalog.Countries.map((country) => <label className="automation-check" key={country}><input type="checkbox" checked={draft?.countries.includes(country) ?? false} onChange={(e) => patch((d) => ({ ...d, countries: e.target.checked ? catalog.Countries.filter((c) => c === country || d.countries.includes(c)) : d.countries.filter((c) => c !== country) }))} />{country}</label>)}</div></div>
            <div className="automation-inline-head"><strong>片段</strong><button onClick={() => patch((d) => ({ ...d, plan: { ...d.plan, Modules: [...d.plan.Modules, newClip("level_success")] } }))} disabled={(draft?.plan.Modules.length ?? 0) >= 100}>＋ 添加片段</button></div>
            <p className="automation-note">按关卡自动安排顺序；准备与跳关不录制。0 表示届时当前关卡。</p>
            <div className="automation-clips">{draft?.plan.Modules.map((clip, index) => <div className={`automation-clip ${!clip.Enabled ? "disabled" : ""}`} key={clip.Id}>
              <div className="automation-clip-head"><label className="automation-check"><input type="checkbox" checked={clip.Enabled} onChange={(e) => patch((d) => ({ ...d, plan: { ...d.plan, Modules: d.plan.Modules.map((m) => m.Id === clip.Id ? { ...m, Enabled: e.target.checked } : m) } }))} />片段 {index + 1}</label><button title={`删除片段${index + 1}`} aria-label={`删除片段${index + 1}`} onClick={() => patch((d) => ({ ...d, plan: { ...d.plan, Modules: d.plan.Modules.filter((m) => m.Id !== clip.Id) } }))}><Icon name="trash" /></button></div>
              <div className="automation-clip-fields"><Select value={clip.Flow} title={`片段${index + 1}类型`} options={[{ value: "level_success", label: "游戏成功" }, { value: "level_failure", label: "游戏失败" }]} disabled={locked} onChange={(flow) => patch((d) => ({ ...d, plan: { ...d.plan, Modules: d.plan.Modules.map((m) => m.Id === clip.Id ? { ...m, ...fields.filter((f) => f.Scope === "module" && f.Type === "bool" && f.Flows?.length && !f.Flows.includes(flow)).reduce((next, field) => writePath(next, field.Path, false), m), Flow: flow as typeof m.Flow } : m) } }))} /><label className="automation-level">关卡<input type="number" min="0" max="10000" value={clip.Args.level ?? ""} onChange={(e) => patch((d) => ({ ...d, plan: { ...d.plan, Modules: d.plan.Modules.map((m) => m.Id === clip.Id ? { ...m, Args: { ...m.Args, level: e.target.value } } : m) } }))} /></label></div>
              <div className="automation-module-options">{renderFields("module", clip, (path, next) => patch((d) => ({ ...d, plan: { ...d.plan, Modules: d.plan.Modules.map((m) => m.Id === clip.Id ? writePath(m, path, next) : m) } })), clip.Flow, "other")}
                {fields.some((f) => f.Scope === "module" && f.Type === "text" && (!f.Flows?.length || f.Flows.includes(clip.Flow))) && <details><summary>可选资料（留空按地区规则生成）</summary>{renderFields("module", clip, (path, next) => patch((d) => ({ ...d, plan: { ...d.plan, Modules: d.plan.Modules.map((m) => m.Id === clip.Id ? writePath(m, path, next) : m) } })), clip.Flow, "text")}</details>}
              </div>
            </div>)}</div>
            <details><summary>环境与操作节奏</summary><div className="automation-advanced">{draft && renderFields("plan", draft.plan, (path, next) => patch((d) => ({ ...d, plan: writePath(d.plan, path, next) })))}{([ ["PagePauseMs", "页面停留（ms）", 300, 10000], ["RequestPauseMs", "请求间隔（ms）", 300, 10000], ["FailureHoldMs", "失败画面停留（ms）", 300, 10000], ["TypingIntervalMs", "逐字输入间隔（ms）", 80, 1000] ] as const).map(([key, label, min, max]) => <label className="automation-field" key={key}>{label}<input type="number" min={min} max={max} value={draft?.plan[key] ?? ""} onChange={(e) => patch((d) => ({ ...d, plan: { ...d.plan, [key]: Number(e.target.value) } }))} /></label>)}</div></details>
            <details><summary>录屏与输出</summary><div className="automation-advanced">{([ ["Width", "目标宽度", 240, 4096], ["Height", "目标高度", 240, 4096], ["FrameRate", "最高帧率", 1, 60], ["BitRateMbps", "码率（Mbps）", 1, 100] ] as const).map(([key, label, min, max]) => <label className="automation-field" key={key}>{label}<input type="number" min={min} max={max} value={draft?.recording[key] ?? ""} onChange={(e) => patch((d) => ({ ...d, recording: { ...d.recording, [key]: Number(e.target.value) } }))} /></label>)}<label className="automation-check"><input type="checkbox" checked={draft?.recording.CaptureAudio ?? false} onChange={(e) => patch((d) => ({ ...d, recording: { ...d.recording, CaptureAudio: e.target.checked } }))} />录制手机声音</label><p className="automation-note">手机按原始比例采集，目标尺寸限制最大边；实际尺寸、时长记录在报告中。</p><label className="automation-field">输出目录<input value={draft?.outputDirectory ?? ""} readOnly /></label><button onClick={() => runAction(async () => { const path = await open({ directory: true, multiple: false, title: "选择AutomationOutput输出目录" }); if (typeof path === "string") patch((d) => ({ ...d, outputDirectory: path })); })}>选择目录</button></div></details>
          </fieldset>
          <div className="automation-config-actions"><button disabled={locked || !draft} onClick={() => fileRef.current?.click()}>导入参数</button><button disabled={locked || !draft} onClick={() => draft && runAction(async () => {
            const path = await invoke<string | null>("automation_export_config", { text: exportProject(draft) });
            if (path) setNotice(`参数已导出：${path}`);
          })}>导出参数</button><button disabled={locked || !scenario} onClick={() => { if (scenario) patch((d) => ({ ...d, plan: clone(scenario.Plan), recording: clone(scenario.Recording), countries: [...catalog.Countries] })); }}>恢复游戏默认</button></div>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file && draft) runAction(async () => { const value = importProject(await file.text(), draft.scenario); patch((d) => ({ ...d, plan: value.plan, recording: value.recording ?? d.recording })); }); }} />
        </section>
      </div>
      <div className="automation-execution"><ExecutionSteps steps={own ? state.steps : []} sessionKey={`${props.tabId}:${own ? state.runDir : ""}`} />
      <section><div className="automation-section-head"><h3>交付结果</h3><button disabled={!state.runDir || !own} onClick={() => runAction(() => invoke("automation_open_output"))}>打开输出目录</button></div>{own && state.clips.length ? <div className="automation-results">{state.clips.map((clip) => <div key={clip.file}><Icon name="video" /><div><strong>{clip.country} · {clip.clip.type === "level_success" ? "游戏成功" : "游戏失败"} · 第{clip.clip.level}关</strong><small>{clip.file}</small></div><span>{clip.media.durationSeconds.toFixed(1)}s</span></div>)}</div> : <p className="automation-note">完成的片段独立交付；后续失败不会移除已经录好的视频。</p>}</section></div>
    </div>}
    {(message || plans.loadError || (own && error) || (own && state.error)) && <div className="automation-error" role="alert"><strong>{!message && !plans.loadError && own && state.errorCode ? state.errorCode : "操作未完成"}</strong><span>{message || plans.loadError || error || state.error}</span></div>}
    {notice && <div className="automation-notice" role="status">{notice}</div>}
    <div className="automation-footer"><span>{own && state.busy ? `正在执行 ${state.country}，可以切换Tab查看日志和用例。` : check ?? `已选择 ${draft?.countries.length} 个国家、${draft?.plan.Modules.filter((m) => m.Enabled).length} 个片段。`}</span>{own && state.busy ? <button className="danger" onClick={() => setShowStop(true)}><Icon name="stop" />停止运行</button> : <button className="primary-action" disabled={!connected || locked || !!check} onClick={() => draft && runAction(() => props.onRun(draft))}><Icon name="play" />运行</button>}</div>
    {dialog && createPortal(<div className="save-description-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !plans.saving) setDialog(null); }}><form className="save-description-dialog automation-plan-dialog" role={dialog.kind === "delete" || dialog.kind === "discard" ? "alertdialog" : "dialog"} aria-modal="true" aria-label={dialog.kind === "delete" ? "删除执行方案" : dialog.kind === "discard" ? "未保存的修改" : dialog.kind === "rename" ? "重命名执行方案" : "保存执行方案"} onSubmit={(e) => { e.preventDefault(); void confirmDialog(); }} onKeyDown={(e) => { if (e.key === "Escape" && !plans.saving) setDialog(null); }}>
      <h3>{dialog.kind === "delete" ? "删除执行方案？" : dialog.kind === "discard" ? "放弃未保存的修改？" : dialog.kind === "rename" ? "重命名执行方案" : "保存执行方案"}</h3>
      {dialog.kind === "delete" ? <p>将删除1个方案“{selectedPlan?.name}”。可通过“撤销删除”恢复，已有运行结果会保留。</p> : dialog.kind === "discard" ? <p>当前参数有未保存的修改，继续切换会放弃这些修改。</p> : <label>方案名称<input autoFocus value={planName} maxLength={64} onChange={(e) => setPlanName(e.target.value)} disabled={plans.saving} /></label>}
      {dialogError && <p className="automation-dialog-error" role="alert">{dialogError}</p>}
      <div className="save-description-actions"><button type="button" autoFocus={dialog.kind === "delete" || dialog.kind === "discard"} disabled={plans.saving} onClick={() => setDialog(null)}>取消</button><button type="submit" className={dialog.kind === "delete" ? "danger" : "primary-action"} disabled={locked}>{plans.saving ? "保存中…" : dialog.kind === "delete" ? "删除1个方案" : dialog.kind === "discard" ? "放弃并继续" : "保存"}</button></div>
    </form></div>, document.body)}
    {showStop && <div className="save-description-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowStop(false); }}><div className="save-description-dialog" role="alertdialog" aria-modal="true" aria-label="停止自动化" onKeyDown={(e) => { if (e.key === "Escape") setShowStop(false); }}><h3>停止本次运行？</h3><p>已完成的视频会保留。当前片段停止后留在诊断目录。</p><div className="save-description-actions"><button autoFocus onClick={() => setShowStop(false)}>继续运行</button><button className="danger" onClick={() => { setShowStop(false); props.controller.stop(); }}>停止并保留结果</button></div></div></div>}
  </div>;
}
