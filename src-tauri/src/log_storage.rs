//! 原始logcat历史会话的本机保留策略；不管理自动化方案、视频或导出文件。
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DAY: u64 = 86_400;
const PREVIEW_TTL: Duration = Duration::from_secs(600);
const LEASE: &str = ".session.lock";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyInput {
    pub auto_cleanup: bool,
    pub retain_days: u32,
    pub max_bytes: u64,
}
impl Default for PolicyInput {
    fn default() -> Self {
        Self {
            auto_cleanup: true,
            retain_days: 7,
            max_bytes: 1_000_000_000,
        }
    }
}
impl PolicyInput {
    fn validate(&self) -> Result<(), String> {
        if !(1..=365).contains(&self.retain_days)
            || !(100_000_000..=100_000_000_000).contains(&self.max_bytes)
        {
            return Err("保留时间须为1–365天，容量目标须为100 MB–100 GB".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    version: u32,
    settings: PolicyInput,
    approved: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct Session {
    name: String,
    bytes: u64,
    modified: SystemTime,
    // 预览确认时精确核对文件集合/大小/修改时间，不把新增日志纳入旧确认。
    files: Vec<(String, u64, SystemTime)>,
    protected: bool,
}
#[derive(Default)]
struct Scan {
    sessions: Vec<Session>,
    unknown: usize,
    warnings: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    settings: PolicyInput,
    needs_confirmation: bool,
    total_bytes: u64,
    history_count: usize,
    protected_count: usize,
    protected_bytes: u64,
    over_target: bool,
    unknown_count: usize,
    warnings: Vec<String>,
    last_cleanup: Option<CleanupResult>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreview {
    id: String,
    mode: String,
    session_count: usize,
    bytes: u64,
    protected_count: usize,
    protected_bytes: u64,
    remaining_bytes: u64,
    settings: PolicyInput,
}
struct Pending {
    created: Instant,
    preview: CleanupPreview,
    candidates: Vec<Session>,
    original: Policy,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    deleted_count: usize,
    freed_bytes: u64,
    skipped_count: usize,
    errors: Vec<String>,
}

pub struct LogStorage {
    root: PathBuf,
    job: Mutex<()>,
    previews: Mutex<HashMap<String, Pending>>,
    last: Mutex<Option<CleanupResult>>,
    scheduled: AtomicBool,
}

fn safe_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("日志目录不是普通目录".into());
    }
    Ok(())
}
fn open_lock(path: &Path) -> Result<File, String> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("日志锁文件不是普通文件".into());
        }
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())
}
fn root_lock(root: &Path) -> Result<File, String> {
    safe_directory(root)?;
    let file = open_lock(&root.join(".log-storage.lock"))?;
    file.lock().map_err(|e| e.to_string())?;
    Ok(file)
}
pub fn is_segment(name: &str) -> bool {
    name.strip_prefix("logs-")
        .and_then(|s| s.strip_suffix(".log"))
        .is_some_and(|s| s.len() >= 4 && s.bytes().all(|b| b.is_ascii_digit()))
}
fn is_session(name: &str) -> bool {
    (16..=24).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_digit())
}

/// 创建与清理共享根锁，避免清理器在writer取得租约前删掉新目录。
/// 租约随File最后一个副本关闭而释放；不要显式unlock，否则会撤掉导出持有的保护。
pub fn create_session(root: &Path) -> Result<(PathBuf, File), String> {
    let _root = root_lock(root)?;
    let sessions = root.join("sessions");
    safe_directory(&sessions)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = sessions.join(stamp.to_string());
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let lease = open_lock(&dir.join(LEASE))?;
    lease.lock().map_err(|e| e.to_string())?;
    Ok((dir, lease))
}

fn inspect(dir: &Path, name: &str) -> Result<Session, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || (file_name != LEASE && !is_segment(&file_name))
        {
            return Err("包含未知文件/目录或软链接，已跳过".into());
        }
        if file_name != LEASE {
            files.push((
                file_name,
                meta.len(),
                meta.modified().map_err(|e| e.to_string())?,
            ));
        }
    }
    if files.is_empty() {
        return Err("没有可识别的日志分段，已跳过".into());
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(Session {
        name: name.into(),
        bytes: files.iter().map(|f| f.1).sum(),
        modified: files.iter().map(|f| f.2).max().unwrap(),
        files,
        protected: false,
    })
}

impl LogStorage {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            job: Mutex::new(()),
            previews: Mutex::new(HashMap::new()),
            last: Mutex::new(None),
            scheduled: AtomicBool::new(false),
        }
    }
    fn scan(&self) -> Result<Scan, String> {
        let sessions = self.root.join("sessions");
        safe_directory(&sessions)?;
        let mut scan = Scan::default();
        for entry in fs::read_dir(&sessions).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            if !is_session(&name) || !meta.is_dir() || meta.file_type().is_symlink() {
                scan.unknown += 1;
                continue;
            }
            match inspect(&entry.path(), &name) {
                Ok(mut s) => {
                    s.protected = open_lock(&entry.path().join(LEASE))
                        .and_then(|f| f.try_lock().map_err(|e| e.to_string()))
                        .is_err();
                    scan.sessions.push(s);
                }
                Err(e) => {
                    scan.unknown += 1;
                    if scan.warnings.len() < 20 {
                        scan.warnings.push(format!("{name}: {e}"));
                    }
                }
            }
        }
        scan.sessions
            .sort_by(|a, b| a.modified.cmp(&b.modified).then(a.name.cmp(&b.name)));
        Ok(scan)
    }
    fn policy(&self, scan: &Scan) -> Result<Policy, String> {
        let path = self.root.join("log-storage.json");
        match fs::read(&path) {
            Ok(bytes) => {
                let policy: Policy = serde_json::from_slice(&bytes)
                    .map_err(|e| format!("日志策略文件损坏，已停止自动清理：{e}"))?;
                policy.settings.validate()?;
                if policy.version != 1 {
                    return Err("不支持的日志策略版本，已停止自动清理".into());
                }
                Ok(policy)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let p = Policy {
                    version: 1,
                    settings: PolicyInput::default(),
                    approved: scan.sessions.iter().all(|s| s.protected) && scan.unknown == 0,
                };
                self.save(&p)?;
                Ok(p)
            }
            Err(e) => Err(format!("读取日志策略失败，已停止自动清理：{e}")),
        }
    }
    fn save(&self, policy: &Policy) -> Result<(), String> {
        let path = self
            .root
            .join(format!(".log-storage-{}.tmp", std::process::id()));
        let bytes = serde_json::to_vec_pretty(policy).map_err(|e| e.to_string())?;
        let result = (|| {
            use std::io::Write;
            let mut f = File::create(&path).map_err(|e| e.to_string())?;
            f.write_all(&bytes)
                .and_then(|_| f.sync_all())
                .map_err(|e| e.to_string())?;
            fs::rename(&path, self.root.join("log-storage.json")).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(path);
        }
        result
    }
    pub fn status(&self) -> Result<StorageStatus, String> {
        let _job = self.job.lock().unwrap();
        let _root = root_lock(&self.root)?;
        let scan = self.scan()?;
        let policy = self.policy(&scan)?;
        let total = scan.sessions.iter().map(|s| s.bytes).sum::<u64>();
        Ok(StorageStatus {
            settings: policy.settings.clone(),
            needs_confirmation: policy.settings.auto_cleanup && !policy.approved,
            total_bytes: total,
            history_count: scan.sessions.iter().filter(|s| !s.protected).count(),
            protected_count: scan.sessions.iter().filter(|s| s.protected).count(),
            protected_bytes: scan
                .sessions
                .iter()
                .filter(|s| s.protected)
                .map(|s| s.bytes)
                .sum(),
            over_target: total > policy.settings.max_bytes,
            unknown_count: scan.unknown,
            warnings: scan.warnings,
            last_cleanup: self.last.lock().unwrap().clone(),
        })
    }
    fn candidates(scan: &Scan, settings: &PolicyInput, all: bool, now: SystemTime) -> Vec<Session> {
        let mut remaining = scan.sessions.iter().map(|s| s.bytes).sum::<u64>();
        let mut selected = HashSet::new();
        for s in &scan.sessions {
            if !s.protected
                && (all
                    || now.duration_since(s.modified).unwrap_or_default().as_secs()
                        >= settings.retain_days as u64 * DAY)
            {
                selected.insert(s.name.clone());
                remaining = remaining.saturating_sub(s.bytes);
            }
        }
        for s in &scan.sessions {
            if remaining <= settings.max_bytes {
                break;
            }
            if !s.protected && selected.insert(s.name.clone()) {
                remaining = remaining.saturating_sub(s.bytes);
            }
        }
        scan.sessions
            .iter()
            .filter(|s| selected.contains(&s.name))
            .cloned()
            .collect()
    }
    pub fn preview(
        &self,
        mode: &str,
        settings: Option<PolicyInput>,
    ) -> Result<CleanupPreview, String> {
        if !matches!(mode, "rules" | "all" | "save") {
            return Err("未知日志清理操作".into());
        }
        let _job = self.job.lock().unwrap();
        let _root = root_lock(&self.root)?;
        let scan = self.scan()?;
        let original = self.policy(&scan)?;
        let settings = if mode == "save" {
            settings.ok_or("缺少日志策略")?
        } else {
            original.settings.clone()
        };
        settings.validate()?;
        let candidates = if mode == "save" && !settings.auto_cleanup {
            Vec::new()
        } else {
            Self::candidates(&scan, &settings, mode == "all", SystemTime::now())
        };
        let bytes = candidates.iter().map(|s| s.bytes).sum::<u64>();
        let id = format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let preview = CleanupPreview {
            id: id.clone(),
            mode: mode.into(),
            session_count: candidates.len(),
            bytes,
            protected_count: scan.sessions.iter().filter(|s| s.protected).count(),
            protected_bytes: scan
                .sessions
                .iter()
                .filter(|s| s.protected)
                .map(|s| s.bytes)
                .sum(),
            remaining_bytes: scan
                .sessions
                .iter()
                .map(|s| s.bytes)
                .sum::<u64>()
                .saturating_sub(bytes),
            settings,
        };
        let mut pending = self.previews.lock().unwrap();
        pending.retain(|_, p| p.created.elapsed() < PREVIEW_TTL);
        if pending.len() >= 20 {
            pending.clear();
        }
        pending.insert(
            id,
            Pending {
                created: Instant::now(),
                preview: preview.clone(),
                candidates,
                original,
            },
        );
        Ok(preview)
    }
    pub fn confirm(&self, id: &str) -> Result<CleanupResult, String> {
        let _job = self.job.lock().unwrap();
        let _root = root_lock(&self.root)?;
        let pending = self
            .previews
            .lock()
            .unwrap()
            .remove(id)
            .ok_or("清理预览已失效，请重新预览")?;
        if pending.created.elapsed() >= PREVIEW_TTL {
            return Err("清理预览已过期，请重新预览".into());
        }
        let scan = self.scan()?;
        if self.policy(&scan)? != pending.original {
            return Err("日志策略已被其他窗口修改，请重新预览".into());
        }
        if pending.preview.mode == "save" {
            self.save(&Policy {
                version: 1,
                settings: pending.preview.settings,
                approved: true,
            })?;
        }
        Ok(self.remove(&pending.candidates))
    }
    fn remove(&self, candidates: &[Session]) -> CleanupResult {
        let mut result = CleanupResult::default();
        for candidate in candidates {
            let dir = self.root.join("sessions").join(&candidate.name);
            let action = (|| -> Result<bool, String> {
                let meta = fs::symlink_metadata(&dir).map_err(|e| e.to_string())?;
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return Ok(false);
                }
                let lease = open_lock(&dir.join(LEASE))?;
                if lease.try_lock().is_err() {
                    return Ok(false);
                }
                let current = inspect(&dir, &candidate.name)?;
                if current.files != candidate.files {
                    return Ok(false);
                }
                // 根锁阻止其他实例创建/取得新租约；不使用递归删除，未知内容不会被误删。
                for (name, _, _) in &current.files {
                    fs::remove_file(dir.join(name)).map_err(|e| e.to_string())?;
                }
                drop(lease); // Windows需先关锁文件才能删除；根锁仍覆盖整个移除过程。
                fs::remove_file(dir.join(LEASE)).map_err(|e| e.to_string())?;
                fs::remove_dir(&dir).map_err(|e| e.to_string())?;
                Ok(true)
            })();
            match action {
                Ok(true) => {
                    result.deleted_count += 1;
                    result.freed_bytes += candidate.bytes;
                }
                Ok(false) => result.skipped_count += 1,
                Err(e) => {
                    result.skipped_count += 1;
                    result.errors.push(format!("{}: {e}", candidate.name));
                }
            }
        }
        *self.last.lock().unwrap() = Some(result.clone());
        result
    }
    fn automatic(&self) -> Result<(), String> {
        let Ok(_job) = self.job.try_lock() else {
            return Ok(());
        };
        let file = open_lock(&self.root.join(".log-storage.lock"))?;
        if file.try_lock().is_err() {
            return Ok(());
        }
        let scan = self.scan()?;
        let policy = self.policy(&scan)?;
        if policy.settings.auto_cleanup && policy.approved {
            let candidates = Self::candidates(&scan, &policy.settings, false, SystemTime::now());
            if !candidates.is_empty() {
                let result = self.remove(&candidates);
                log::info!(
                    "自动清理原始日志：{}个会话，{}字节，跳过{}个",
                    result.deleted_count,
                    result.freed_bytes,
                    result.skipped_count
                );
                for e in result.errors {
                    log::warn!("历史日志清理失败：{e}");
                }
            }
        }
        Ok(())
    }
    pub fn request(self: &Arc<Self>) {
        if self.scheduled.swap(true, Ordering::SeqCst) {
            return;
        }
        let store = self.clone();
        std::thread::spawn(move || {
            if let Err(e) = safe_directory(&store.root).and_then(|_| store.automatic()) {
                log::warn!("日志自动清理已跳过：{e}");
            }
            store.scheduled.store(false, Ordering::SeqCst);
        });
    }
    pub fn start_timer(self: &Arc<Self>) {
        self.request();
        let store = self.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(600));
            store.request();
        });
    }
}

fn store(app: &AppHandle) -> Result<Arc<LogStorage>, String> {
    app.try_state::<Arc<LogStorage>>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "本机日志目录不可用，日志存储管理已停用".into())
}
#[tauri::command]
pub async fn log_storage_status(app: AppHandle) -> Result<StorageStatus, String> {
    let store = store(&app)?;
    crate::run_blocking(move || store.status()).await
}
#[tauri::command]
pub async fn log_storage_preview(
    app: AppHandle,
    mode: String,
    settings: Option<PolicyInput>,
) -> Result<CleanupPreview, String> {
    let store = store(&app)?;
    crate::run_blocking(move || store.preview(&mode, settings)).await
}
#[tauri::command]
pub async fn log_storage_confirm(app: AppHandle, id: String) -> Result<CleanupResult, String> {
    let store = store(&app)?;
    crate::run_blocking(move || store.confirm(&id)).await
}
#[tauri::command]
pub async fn log_storage_open_directory(app: AppHandle) -> Result<(), String> {
    let store = store(&app)?;
    crate::run_blocking(move || {
        let path = store.root.join("sessions");
        safe_directory(&path)?;
        #[cfg(target_os = "macos")]
        let status = std::process::Command::new("open").arg(&path).status();
        #[cfg(target_os = "windows")]
        let status = std::process::Command::new("explorer").arg(&path).status();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let status = std::process::Command::new("xdg-open").arg(&path).status();
        match status {
            Ok(s) if s.success() => Ok(()),
            Ok(_) => Err("打开日志目录失败".into()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log_store::LogSessionWriter;
    use std::io::Write;

    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "testbench-log-retention-{}-{stamp}",
                std::process::id()
            ));
            fs::create_dir(&root).unwrap();
            Self { root }
        }
        fn store(&self) -> LogStorage {
            LogStorage::new(self.root.clone())
        }
        fn session(&self, n: u32, bytes: u64, days: u64) -> PathBuf {
            let dir = self
                .root
                .join("sessions")
                .join(format!("170000000000000{n:04}"));
            fs::create_dir_all(&dir).unwrap();
            let f = File::create(dir.join("logs-0000.log")).unwrap();
            f.set_len(bytes).unwrap();
            f.set_times(
                fs::FileTimes::new()
                    .set_modified(SystemTime::now() - Duration::from_secs(days * DAY)),
            )
            .unwrap();
            dir
        }
        fn approve(&self, settings: PolicyInput) {
            let store = self.store();
            let _guard = root_lock(&self.root).unwrap();
            store
                .save(&Policy {
                    version: 1,
                    settings,
                    approved: true,
                })
                .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn old_install_waits_for_preview_confirmation() {
        let f = Fixture::new();
        let old = f.session(1, 10, 20);
        let store = f.store();
        let status = store.status().unwrap();
        assert!(status.needs_confirmation);
        assert_eq!(status.settings.retain_days, 7);
        assert_eq!(status.settings.max_bytes, 1_000_000_000);
        store.automatic().unwrap();
        assert!(old.exists());
        let preview = store.preview("save", Some(status.settings)).unwrap();
        assert_eq!(preview.session_count, 1);
        assert!(old.exists()); // 预览/取消不删除。
        let result = store.confirm(&preview.id).unwrap();
        assert_eq!(result.deleted_count, 1);
        assert!(!old.exists());
        assert!(!f.store().status().unwrap().needs_confirmation);
    }
    #[test]
    fn fresh_install_uses_defaults_and_persists_disabled_settings() {
        let f = Fixture::new();
        let store = f.store();
        assert!(!store.status().unwrap().needs_confirmation);
        let settings = PolicyInput {
            auto_cleanup: false,
            retain_days: 14,
            max_bytes: 2_000_000_000,
        };
        let p = store.preview("save", Some(settings.clone())).unwrap();
        store.confirm(&p.id).unwrap();
        assert_eq!(f.store().status().unwrap().settings, settings);
        let old = f.session(2, 5, 20);
        f.store().automatic().unwrap();
        assert!(old.exists());
    }
    #[test]
    fn disabled_save_does_not_clean_but_manual_rules_still_work() {
        let f = Fixture::new();
        let old = f.session(1, 5, 20);
        let store = f.store();
        let settings = PolicyInput {
            auto_cleanup: false,
            ..PolicyInput::default()
        };
        let p = store.preview("save", Some(settings)).unwrap();
        assert_eq!(p.session_count, 0);
        store.confirm(&p.id).unwrap();
        assert!(old.exists());
        let p = store.preview("rules", None).unwrap();
        assert_eq!(p.session_count, 1);
        assert_eq!(store.confirm(&p.id).unwrap().deleted_count, 1);
    }
    #[test]
    fn expires_by_last_log_write_not_folder_name_or_lock_time() {
        let f = Fixture::new();
        let old = f.session(1, 5, 10);
        let recent = f.session(2, 5, 1);
        f.approve(PolicyInput::default());
        let store = f.store();
        let p = store.preview("rules", None).unwrap();
        assert_eq!(p.session_count, 1);
        store.confirm(&p.id).unwrap();
        assert!(!old.exists());
        assert!(recent.exists());
    }
    #[test]
    fn removes_expired_then_oldest_until_capacity_target() {
        let f = Fixture::new();
        let oldest = f.session(1, 60_000_000, 6);
        let middle = f.session(2, 60_000_000, 5);
        let newest = f.session(3, 40_000_000, 1);
        f.approve(PolicyInput {
            max_bytes: 100_000_000,
            ..PolicyInput::default()
        });
        let store = f.store();
        let p = store.preview("rules", None).unwrap();
        assert_eq!(p.session_count, 1);
        assert_eq!(p.remaining_bytes, 100_000_000);
        store.confirm(&p.id).unwrap();
        assert!(!oldest.exists());
        assert!(middle.exists() && newest.exists());
    }
    #[test]
    fn stopped_current_session_stays_protected_until_writer_replaced() {
        let f = Fixture::new();
        let mut writer = LogSessionWriter::start(&f.root).unwrap();
        writer.append_lines(&["first".into()]).unwrap();
        writer.flush();
        let dir = writer.dir().to_owned();
        let store = f.store();
        let p = store.preview("all", None).unwrap();
        assert_eq!(p.protected_count, 1);
        assert_eq!(p.session_count, 0);
        store.confirm(&p.id).unwrap();
        assert!(dir.exists());
        drop(writer);
        let _next = LogSessionWriter::start(&f.root).unwrap();
        let p = store.preview("all", None).unwrap();
        assert_eq!(p.session_count, 1);
        store.confirm(&p.id).unwrap();
        assert!(!dir.exists());
    }
    #[test]
    fn export_pin_survives_writer_drop_and_snapshot_does_not_grow() {
        let f = Fixture::new();
        let mut writer = LogSessionWriter::start(&f.root).unwrap();
        writer.append_lines(&["before".into()]).unwrap();
        let (pin, snapshot) = writer.export_snapshot().unwrap();
        assert_eq!(snapshot[0].1, 7);
        writer.append_lines(&["after".into()]).unwrap();
        writer.flush();
        assert_eq!(snapshot[0].1, 7);
        assert_eq!(fs::metadata(&snapshot[0].0).unwrap().len(), 13);
        drop(writer);
        let store = f.store();
        assert_eq!(store.preview("all", None).unwrap().session_count, 0);
        drop(pin);
        assert_eq!(store.preview("all", None).unwrap().session_count, 1);
    }
    #[test]
    fn preview_never_deletes_new_or_changed_sessions() {
        let f = Fixture::new();
        let changed = f.session(1, 5, 20);
        let store = f.store();
        let p = store.preview("all", None).unwrap();
        let new = f.session(2, 5, 20);
        File::options()
            .append(true)
            .open(changed.join("logs-0000.log"))
            .unwrap()
            .write_all(b"new")
            .unwrap();
        let result = store.confirm(&p.id).unwrap();
        assert_eq!(result.deleted_count, 0);
        assert_eq!(result.skipped_count, 1);
        assert!(changed.exists() && new.exists());
        assert!(store.confirm(&p.id).is_err());
    }
    #[test]
    fn preview_rechecks_lease_acquired_after_preview() {
        let f = Fixture::new();
        let dir = f.session(1, 5, 20);
        let store = f.store();
        let p = store.preview("all", None).unwrap();
        let lease = open_lock(&dir.join(LEASE)).unwrap();
        lease.lock().unwrap();
        let result = store.confirm(&p.id).unwrap();
        assert_eq!(result.skipped_count, 1);
        assert!(dir.exists());
    }
    #[test]
    fn expired_preview_and_concurrent_policy_changes_are_rejected() {
        let f = Fixture::new();
        f.session(1, 5, 20);
        let store = f.store();
        let p = store.preview("all", None).unwrap();
        store
            .previews
            .lock()
            .unwrap()
            .get_mut(&p.id)
            .unwrap()
            .created = Instant::now() - PREVIEW_TTL;
        assert!(store.confirm(&p.id).unwrap_err().contains("过期"));
        let p = store.preview("all", None).unwrap();
        f.approve(PolicyInput {
            retain_days: 30,
            ..PolicyInput::default()
        });
        assert!(store.confirm(&p.id).unwrap_err().contains("其他窗口"));
    }
    #[test]
    fn corrupt_or_invalid_policy_cannot_delete_logs() {
        let f = Fixture::new();
        let dir = f.session(1, 5, 20);
        fs::write(f.root.join("log-storage.json"), b"{broken").unwrap();
        let store = f.store();
        assert!(store.automatic().is_err());
        assert!(dir.exists());
        assert!(store
            .preview(
                "save",
                Some(PolicyInput {
                    retain_days: 0,
                    ..PolicyInput::default()
                })
            )
            .is_err());
    }
    #[test]
    fn unknown_contents_and_other_app_data_are_preserved() {
        let f = Fixture::new();
        let dir = f.session(1, 5, 20);
        fs::write(dir.join("notes.txt"), b"keep").unwrap();
        let plans = f.root.join("automation");
        fs::create_dir(&plans).unwrap();
        fs::write(plans.join("plans.json"), b"{}").unwrap();
        fs::write(f.root.join("exported.log"), b"keep").unwrap();
        let store = f.store();
        assert_eq!(store.status().unwrap().unknown_count, 1);
        let p = store.preview("all", None).unwrap();
        assert_eq!(p.session_count, 0);
        store.confirm(&p.id).unwrap();
        assert!(
            dir.exists()
                && plans.join("plans.json").exists()
                && f.root.join("exported.log").exists()
        );
    }
    #[test]
    fn protected_session_can_exceed_target_without_being_truncated() {
        let f = Fixture::new();
        let dir = f.session(1, 120_000_000, 20);
        let lease = open_lock(&dir.join(LEASE)).unwrap();
        lease.lock().unwrap();
        f.approve(PolicyInput {
            max_bytes: 100_000_000,
            ..PolicyInput::default()
        });
        let store = f.store();
        store.automatic().unwrap();
        let s = store.status().unwrap();
        assert!(s.over_target);
        assert_eq!(s.protected_bytes, 120_000_000);
        assert_eq!(
            fs::metadata(dir.join("logs-0000.log")).unwrap().len(),
            120_000_000
        );
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_sessions_and_segments_are_never_followed() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let outside = f.root.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("logs-0000.log"), b"keep").unwrap();
        fs::create_dir_all(f.root.join("sessions")).unwrap();
        symlink(&outside, f.root.join("sessions/1700000000000000001")).unwrap();
        let dir = f.session(2, 5, 20);
        symlink(outside.join("logs-0000.log"), dir.join("logs-0001.log")).unwrap();
        let store = f.store();
        let p = store.preview("all", None).unwrap();
        assert_eq!(p.session_count, 0);
        store.confirm(&p.id).unwrap();
        assert_eq!(fs::read(outside.join("logs-0000.log")).unwrap(), b"keep");
    }
    #[test]
    fn failure_in_one_candidate_does_not_stop_other_deletions() {
        let f = Fixture::new();
        let missing = f.session(1, 5, 20);
        let valid = f.session(2, 5, 20);
        let store = f.store();
        let p = store.preview("all", None).unwrap();
        fs::remove_dir_all(missing).unwrap();
        let r = store.confirm(&p.id).unwrap();
        assert_eq!(r.deleted_count, 1);
        assert_eq!(r.errors.len(), 1);
        assert!(!valid.exists());
    }
    #[test]
    fn second_process_lease_is_respected() {
        let f = Fixture::new();
        let dir = f.session(1, 5, 20);
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "log_storage::tests::lease_child", "--ignored"])
            .env("TESTBENCH_LOG_LEASE_CHILD", &dir)
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !dir.join("child-ready").exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if !dir.join("child-ready").exists() {
            let _ = child.kill();
            panic!("跨进程锁探针未启动");
        }
        fs::remove_file(dir.join("child-ready")).unwrap();
        let store = f.store();
        let p = store.preview("all", None).unwrap();
        let protected = p.protected_count;
        let selected = p.session_count;
        fs::write(dir.join("child-release"), b"release").unwrap();
        assert!(child.wait().unwrap().success());
        fs::remove_file(dir.join("child-release")).unwrap();
        assert_eq!(protected, 1);
        assert_eq!(selected, 0);
        assert_eq!(store.preview("all", None).unwrap().session_count, 1);
    }
    #[test]
    #[ignore = "由跨进程租约回归启动"]
    fn lease_child() {
        let dir =
            PathBuf::from(std::env::var_os("TESTBENCH_LOG_LEASE_CHILD").expect("缺少临时租约路径"));
        let file = open_lock(&dir.join(LEASE)).unwrap();
        file.lock().unwrap();
        fs::write(dir.join("child-ready"), b"ready").unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !dir.join("child-release").exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(dir.join("child-release").exists());
    }
}
