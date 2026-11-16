//! Local named execution plans. Device binding and frozen run snapshots are separate.
use super::{recording::write_json, AutomationController};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

static STORE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedPlan {
    id: String,
    name: String,
    draft: Value,
    updated_at: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanList {
    version: u32,
    revision: u64,
    plans: Vec<SavedPlan>,
    deleted: Vec<SavedPlan>,
    migrated_sources: Vec<String>,
}
fn component(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || value == "."
        || value == ".."
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err("方案应用或场景标识无效".into());
    }
    Ok(())
}
fn path(root: &Path, package: &str, scenario: &str) -> Result<PathBuf, String> {
    component(package)?;
    component(scenario)?;
    Ok(root.join(package).join(scenario).join("plans.json"))
}
fn validate_draft(draft: &Value, scenario: &str) -> Result<(), String> {
    let valid = draft["scenario"] == scenario
        && draft["countries"].as_array().is_some_and(|a| {
            a.len() <= 128 && a.iter().all(|c| c.as_str().is_some_and(|s| s.len() <= 16))
        })
        && draft["plan"].is_object()
        && draft["plan"]["Version"] == 4
        && draft["plan"]["Modules"]
            .as_array()
            .is_some_and(|a| a.len() <= 100)
        && draft["recording"].is_object()
        && draft["outputDirectory"].is_string();
    if !valid || serde_json::to_vec(draft).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
        return Err("执行方案格式无效或超出大小限制".into());
    }
    Ok(())
}
fn load(file: &Path, scenario: &str) -> Result<PlanList, String> {
    if !file.exists() {
        return Ok(PlanList {
            version: 1,
            ..Default::default()
        });
    }
    if fs::metadata(file).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("方案文件过大，原文件已保留".into());
    }
    let data = fs::read(file).map_err(|e| e.to_string())?;
    let list: PlanList =
        serde_json::from_slice(&data).map_err(|e| format!("方案文件损坏，原文件已保留：{e}"))?;
    if list.version != 1 {
        return Err("方案文件版本不支持，原文件已保留".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    for item in list.plans.iter().chain(&list.deleted) {
        component(&item.id)?;
        validate_draft(&item.draft, scenario)?;
        if item.name.trim().is_empty()
            || item.name.chars().count() > 64
            || !ids.insert(item.id.clone())
        {
            return Err("方案文件内容无效，原文件已保留".into());
        }
    }
    if list
        .plans
        .iter()
        .any(|item| !names.insert(item.name.trim().to_lowercase()))
    {
        return Err("方案名称重复，原文件已保留".into());
    }
    Ok(list)
}
fn persist(file: &Path, list: &mut PlanList) -> Result<(), String> {
    if list.plans.len() > 100 {
        return Err("每个场景最多保存100个方案".into());
    }
    list.revision = list.revision.checked_add(1).ok_or("方案修订号已耗尽")?;
    let value = serde_json::to_value(list).map_err(|e| e.to_string())?;
    if serde_json::to_vec_pretty(&value)
        .map_err(|e| e.to_string())?
        .len()
        > 16 * 1024 * 1024
    {
        return Err("方案文件超出大小限制，原文件已保留".into());
    }
    write_json(file, &value)
}
fn unique_name(list: &PlanList, name: &str, except: Option<&str>) -> Result<String, String> {
    let name = name.trim();
    if name == "游戏默认" {
        return Err("“游戏默认”是测试包默认方案的保留名称，请使用其他名称".into());
    }
    if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
        return Err("方案名称须为1–64个字符".into());
    }
    if list
        .plans
        .iter()
        .any(|p| Some(p.id.as_str()) != except && p.name.to_lowercase() == name.to_lowercase())
    {
        return Err("当前场景已存在同名方案".into());
    }
    Ok(name.into())
}
fn id() -> String {
    format!(
        "plan_{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}
fn read_with_migration(
    file: &Path,
    scenario: &str,
    source: Option<&str>,
    legacy: Option<Value>,
    allow_migration: bool,
) -> Result<PlanList, String> {
    let mut list = load(file, scenario)?;
    // Reading plans must remain safe while a frozen task is running. A legacy
    // migration is a write, so defer it until idle instead of rejecting the read.
    if !allow_migration {
        return Ok(list);
    }
    if let (Some(source), Some(draft)) = (source, legacy) {
        if source.len() > 256 {
            return Err("迁移来源无效".into());
        }
        if !list.migrated_sources.iter().any(|s| s == source) {
            validate_draft(&draft, scenario)?;
            let mut name = "原设备配置".to_string();
            let mut n = 2;
            while list.plans.iter().any(|p| p.name == name) {
                name = format!("原设备配置 {n}");
                n += 1;
            }
            list.plans.push(SavedPlan {
                id: id(),
                name,
                draft,
                updated_at: chrono::Local::now().to_rfc3339(),
            });
            list.migrated_sources.push(source.into());
            persist(file, &mut list)?;
        }
    }
    Ok(list)
}
fn update(
    file: &Path,
    scenario: &str,
    revision: u64,
    operation: &str,
    plan_id: Option<&str>,
    name: Option<&str>,
    draft: Option<Value>,
) -> Result<PlanList, String> {
    let mut list = load(file, scenario)?;
    if list.revision != revision {
        return Err("方案已被其他Tab修改，请刷新方案列表后重试；当前草稿仍保留".into());
    }
    match operation {
        "create" => {
            let name = unique_name(&list, name.unwrap_or(""), None)?;
            let draft = draft.ok_or("缺少执行参数")?;
            validate_draft(&draft, scenario)?;
            if list.plans.len() >= 100 {
                return Err("每个场景最多保存100个方案".into());
            }
            list.plans.push(SavedPlan {
                id: id(),
                name,
                draft,
                updated_at: chrono::Local::now().to_rfc3339(),
            });
        }
        "save" | "rename" => {
            let target = plan_id.ok_or("未选择自定义方案")?;
            let index = list
                .plans
                .iter()
                .position(|p| p.id == target)
                .ok_or("方案已不存在，请刷新列表")?;
            if operation == "save" {
                let draft = draft.ok_or("缺少执行参数")?;
                validate_draft(&draft, scenario)?;
                list.plans[index].draft = draft;
            } else {
                list.plans[index].name = unique_name(&list, name.unwrap_or(""), Some(target))?;
            }
            list.plans[index].updated_at = chrono::Local::now().to_rfc3339();
        }
        "delete" => {
            let index = list
                .plans
                .iter()
                .position(|p| Some(p.id.as_str()) == plan_id)
                .ok_or("方案已不存在，请刷新列表")?;
            let item = list.plans.remove(index);
            list.deleted.push(item);
        }
        "restore" => {
            let item = list.deleted.last().ok_or("没有可恢复的方案")?;
            unique_name(&list, &item.name, None)?;
            let item = list.deleted.pop().unwrap();
            list.plans.push(item);
        }
        _ => return Err("未知方案操作".into()),
    }
    persist(file, &mut list)?;
    Ok(list)
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("automation/plans"))
}
#[tauri::command]
pub fn automation_plans_read(
    app: AppHandle,
    package: String,
    scenario: String,
    source: Option<String>,
    legacy: Option<Value>,
) -> Result<PlanList, String> {
    let _guard = STORE_LOCK.lock().unwrap();
    let allow_migration = app
        .state::<AutomationController>()
        .ensure_available()
        .is_ok();
    read_with_migration(
        &path(&root(&app)?, &package, &scenario)?,
        &scenario,
        source.as_deref(),
        legacy,
        allow_migration,
    )
}
#[tauri::command]
pub fn automation_plans_update(
    app: AppHandle,
    package: String,
    scenario: String,
    revision: u64,
    operation: String,
    id: Option<String>,
    name: Option<String>,
    draft: Option<Value>,
) -> Result<PlanList, String> {
    app.state::<AutomationController>().ensure_available()?;
    let _guard = STORE_LOCK.lock().unwrap();
    update(
        &path(&root(&app)?, &package, &scenario)?,
        &scenario,
        revision,
        &operation,
        id.as_deref(),
        name.as_deref(),
        draft,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn draft(s: &str) -> Value {
        json!({"scenario":s,"countries":["ID"],"plan":{"Version":4,"Modules":[],"Extensions":{"custom":true}},"recording":{"CaptureAudio":true},"outputDirectory":"/tmp/out"})
    }
    #[test]
    fn plans_are_shared_across_devices_but_isolated_by_app_and_scenario() {
        let root = std::env::temp_dir().join(id());
        let file = path(&root, "game.a", "capture").unwrap();
        let saved = update(
            &file,
            "capture",
            0,
            "create",
            None,
            Some("ID完整素材"),
            Some(draft("capture")),
        )
        .unwrap();
        assert_eq!(
            load(&file, "capture").unwrap().plans[0].draft,
            draft("capture")
        );
        assert!(load(&path(&root, "game.b", "capture").unwrap(), "capture")
            .unwrap()
            .plans
            .is_empty());
        assert!(load(&path(&root, "game.a", "other").unwrap(), "other")
            .unwrap()
            .plans
            .is_empty());
        assert!(update(
            &file,
            "capture",
            0,
            "save",
            Some(&saved.plans[0].id),
            None,
            Some(draft("capture"))
        )
        .is_err());
        assert!(path(&root, "../outside", "capture").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn busy_reads_do_not_migrate_or_rewrite_even_when_legacy_arguments_are_present() {
        let root = std::env::temp_dir().join(id());
        let file = path(&root, "game.a", "capture").unwrap();
        let deferred = read_with_migration(
            &file,
            "capture",
            Some("device1"),
            Some(draft("capture")),
            false,
        )
        .unwrap();
        assert!(deferred.plans.is_empty());
        assert!(
            !file.exists(),
            "a busy read must not create a migration file"
        );
        let migrated = read_with_migration(
            &file,
            "capture",
            Some("device1"),
            Some(draft("capture")),
            true,
        )
        .unwrap();
        let before = fs::read(&file).unwrap();
        let existing = read_with_migration(
            &file,
            "capture",
            Some("device1"),
            Some(draft("capture")),
            false,
        )
        .unwrap();
        assert_eq!(existing.revision, migrated.revision);
        assert_eq!(existing.plans.len(), 1);
        assert_eq!(fs::read(&file).unwrap(), before);
        let another = read_with_migration(
            &file,
            "capture",
            Some("device2"),
            Some(draft("capture")),
            false,
        )
        .unwrap();
        assert_eq!(another.revision, migrated.revision);
        assert_eq!(fs::read(&file).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn migration_is_idempotent_and_delete_can_be_undone_without_overwriting_a_conflict() {
        let root = std::env::temp_dir().join(id());
        let file = path(&root, "game.a", "capture").unwrap();
        let first = read_with_migration(
            &file,
            "capture",
            Some("device1"),
            Some(draft("capture")),
            true,
        )
        .unwrap();
        let same = read_with_migration(
            &file,
            "capture",
            Some("device1"),
            Some(draft("capture")),
            true,
        )
        .unwrap();
        assert_eq!(same.revision, first.revision);
        let mut list = update(
            &file,
            "capture",
            same.revision,
            "delete",
            Some(&same.plans[0].id),
            None,
            None,
        )
        .unwrap();
        assert_eq!(list.deleted.len(), 1);
        list = update(&file, "capture", list.revision, "restore", None, None, None).unwrap();
        assert_eq!(list.plans.len(), 1);
        assert!(list.deleted.is_empty());
        assert!(update(
            &file,
            "capture",
            list.revision,
            "create",
            None,
            Some("原设备配置"),
            Some(draft("capture"))
        )
        .is_err());
        fs::write(&file, b"{broken").unwrap();
        assert!(load(&file, "capture").is_err());
        assert_eq!(fs::read(file).unwrap(), b"{broken");
        fs::remove_dir_all(root).unwrap();
    }
}
