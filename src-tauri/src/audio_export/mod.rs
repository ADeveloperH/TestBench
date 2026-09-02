//! Device-side Unity audio export orchestration.
//!
//! The controller owns the ADB/filesystem lifecycle. Unity parsing stays in
//! the sidecar so the Tauri process never needs to understand Unity objects.

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use zip::ZipArchive;

use crate::adb::{adb_command, discover_installed_package_source, InstalledPackageSource};

const MAX_ENTRY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const SPACE_MULTIPLIER: u64 = 3;
const STDERR_TAIL_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioExportProgress {
    pub stage: String,
    pub message: String,
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub exported: Option<u64>,
    pub warnings: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioExportResult {
    pub status: String,
    pub candidates_scanned: u64,
    pub candidate_failures: u64,
    pub audio_found: u64,
    pub audio_exported: u64,
    #[serde(default)]
    pub audio_skipped: u64,
    pub audio_failed: u64,
    pub exported_bytes: u64,
    #[serde(default)]
    pub warnings: Vec<Value>,
    pub manifest_path: String,
}

#[derive(Clone, Default)]
pub struct AudioExportController {
    running: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

impl AudioExportController {
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn export(
        &self,
        app: &AppHandle,
        device: Option<&str>,
        package: &str,
        output_dir: &Path,
    ) -> Result<AudioExportResult, String> {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("已有 Unity 音频导出任务正在运行".to_string());
        }
        self.cancel.store(false, Ordering::SeqCst);

        let result = self.export_inner(app, device, package, output_dir);
        self.running.store(false, Ordering::SeqCst);
        self.cancel.store(false, Ordering::SeqCst);
        result
    }

    fn export_inner(
        &self,
        app: &AppHandle,
        device: Option<&str>,
        package: &str,
        output_dir: &Path,
    ) -> Result<AudioExportResult, String> {
        let source = discover_installed_package_source(device, package)?;
        emit_progress(
            app,
            AudioExportProgress {
                stage: "source".into(),
                message: format!("已发现 {} 个安装包，准备拉取资源", source.files.len()),
                completed: Some(0),
                total: Some(source.files.len() as u64),
                exported: None,
                warnings: 0,
            },
        );

        let temp_dir = create_task_dir(package)?;
        let result = self.export_from_source(app, device, &source, output_dir, &temp_dir);
        let cleanup = fs::remove_dir_all(&temp_dir);
        if let Err(error) = cleanup {
            log::warn!("清理 Unity 音频导出临时目录失败：{}：{}", temp_dir.display(), error);
        }
        result
    }

    fn export_from_source(
        &self,
        app: &AppHandle,
        device: Option<&str>,
        source: &InstalledPackageSource,
        output_dir: &Path,
        temp_dir: &Path,
    ) -> Result<AudioExportResult, String> {
        let input_dir = temp_dir.join("prepared");
        fs::create_dir_all(&input_dir).map_err(|e| format!("创建临时目录失败：{e}"))?;
        let required = estimate_required_space(source);
        ensure_free_space(output_dir, required)?;

        for (index, package_file) in source.files.iter().enumerate() {
            self.ensure_not_cancelled()?;
            let apk_path = temp_dir.join(&package_file.file_name);
            pull_apk(device, &package_file.device_path, &apk_path, &self.cancel)?;
            extract_apk(&apk_path, &input_dir.join(stem_for(&package_file.file_name)))?;
            emit_progress(
                app,
                AudioExportProgress {
                    stage: "pulling".into(),
                    message: format!("已处理 {}", package_file.file_name),
                    completed: Some((index + 1) as u64),
                    total: Some(source.files.len() as u64),
                    exported: None,
                    warnings: 0,
                },
            );
        }

        self.ensure_not_cancelled()?;
        let extractor = resolve_extractor(app)?;
        run_extractor(
            &extractor,
            &input_dir,
            output_dir,
            &self.cancel,
            |event| emit_json_event(app, event),
        )
    }

    fn ensure_not_cancelled(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            Err("Unity 音频导出已取消".to_string())
        } else {
            Ok(())
        }
    }
}

pub fn is_available(app: &AppHandle) -> bool {
    resolve_extractor(app).is_ok()
}

pub fn pick_output_dir(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let selected = app.dialog().file().blocking_pick_folder();
    match selected {
        Some(path) => Ok(Some(path.into_path().map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

fn emit_progress(app: &AppHandle, progress: AudioExportProgress) {
    let _ = app.emit("audio-export-progress", progress);
}

fn emit_json_event(app: &AppHandle, event: &Value) {
    let _ = app.emit("audio-export-event", event);
    if event.get("event").and_then(Value::as_str) == Some("progress") {
        let progress = AudioExportProgress {
            stage: event
                .get("stage")
                .and_then(Value::as_str)
                .unwrap_or("scanning")
                .to_string(),
            message: event
                .get("current")
                .and_then(Value::as_str)
                .unwrap_or("正在扫描资源")
                .to_string(),
            completed: event.get("completed").and_then(Value::as_u64),
            total: event.get("total").and_then(Value::as_u64),
            exported: event.get("exported").and_then(Value::as_u64),
            warnings: 0,
        };
        emit_progress(app, progress);
    }
}

fn create_task_dir(package: &str) -> Result<PathBuf, String> {
    let safe = package
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '.' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = std::env::temp_dir().join(format!("testbench-audio-{safe}-{nonce}"));
    fs::create_dir_all(&path).map_err(|e| format!("创建导出临时目录失败：{e}"))?;
    Ok(path)
}

fn estimate_required_space(source: &InstalledPackageSource) -> u64 {
    // The device API does not expose a portable size field. A conservative
    // preflight based on package count keeps the check useful without a second
    // remote shell round-trip; the actual write path still reports ENOSPC.
    (source.files.len().max(1) as u64) * 256 * 1024 * 1024 * SPACE_MULTIPLIER
}

fn ensure_free_space(path: &Path, required: u64) -> Result<(), String> {
    let target = if path.exists() { path } else { Path::new(".") };
    let stat = fs::metadata(target).map_err(|e| format!("无法检查输出目录：{e}"))?;
    let _ = stat;
    #[cfg(unix)]
    {
        let c_path = std::ffi::CString::new(target.as_os_str().as_encoded_bytes())
            .map_err(|_| "输出目录路径包含无法检查的字符".to_string())?;
        let mut value = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        let result = unsafe { libc::statvfs(c_path.as_ptr(), value.as_mut_ptr()) };
        if result != 0 {
            return Err("无法检查输出目录剩余空间".to_string());
        }
        let value = unsafe { value.assume_init() };
        let available = value.f_bavail as u64 * value.f_frsize as u64;
        if available < required {
            return Err(format!(
                "磁盘空间不足：至少需要约 {} MB，当前可用约 {} MB",
                required / 1024 / 1024,
                available / 1024 / 1024
            ));
        }
    }
    Ok(())
}

fn pull_apk(
    device: Option<&str>,
    remote: &str,
    target: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let part = target.with_extension("apk.part");
    let mut command = adb_command();
    if let Some(serial) = device.filter(|value| !value.is_empty()) {
        command.args(["-s", serial]);
    }
    command.args(["pull", remote]).arg(&part);
    let mut child = command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法执行 adb pull：{e}"))?;
    let status = loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&part);
            return Err("Unity 音频导出已取消".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&part);
                return Err(format!("等待 adb pull 失败：{error}"));
            }
        }
    };
    if !status.success() {
        let _ = fs::remove_file(&part);
        return Err(format!("拉取 {remote} 失败（退出码 {:?}）", status.code()));
    }
    fs::rename(&part, target).map_err(|e| format!("保存 APK 临时文件失败：{e}"))
}

fn extract_apk(apk: &Path, destination: &Path) -> Result<(), String> {
    let input = File::open(apk).map_err(|e| format!("打开 APK 失败：{e}"))?;
    let mut archive = ZipArchive::new(input).map_err(|e| format!("读取 APK 压缩结构失败：{e}"))?;
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取 APK 条目失败：{e}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(relative) = entry.enclosed_name().map(PathBuf::from) else {
            return Err(format!("APK 包含不安全路径：{}", entry.name()));
        };
        if !is_resource_entry(&relative) {
            continue;
        }
        let size = entry.size();
        if size > MAX_ENTRY_BYTES || total.saturating_add(size) > MAX_EXTRACTED_BYTES {
            return Err("APK 资源解压大小超过安全限制".to_string());
        }
        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建资源目录失败：{e}"))?;
        }
        let mut output = File::create(&target).map_err(|e| format!("创建资源文件失败：{e}"))?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|e| format!("解压资源失败：{e}"))?;
        if copied != size {
            return Err(format!("资源写入不完整：{}", entry.name()));
        }
        output.flush().map_err(|e| format!("刷新资源文件失败：{e}"))?;
        total = total.saturating_add(size);
    }
    Ok(())
}

fn is_resource_entry(path: &Path) -> bool {
    let Some(first) = path.components().next() else {
        return false;
    };
    matches!(first.as_os_str().to_string_lossy().as_ref(), "assets" | "res" | "obb")
}

fn stem_for(file_name: &str) -> String {
    file_name
        .strip_suffix(".apk")
        .unwrap_or(file_name)
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn resolve_extractor(app: &AppHandle) -> Result<PathBuf, String> {
    for key in ["TESTBENCH_UNITY_AUDIO_EXTRACTOR", "UNITY_AUDIO_EXTRACTOR"] {
        if let Ok(value) = std::env::var(key) {
            let path = PathBuf::from(value);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法定位应用资源目录：{e}"))?;
    let platform = if cfg!(target_os = "windows") { "windows" } else { "macos" };
    let name = if cfg!(target_os = "windows") {
        "unity-audio-extractor.exe"
    } else {
        "unity-audio-extractor"
    };
    let path = resource_dir.join("bin").join(platform).join(name);
    if path.is_file() {
        Ok(path)
    } else {
        #[cfg(debug_assertions)]
        {
            let dev_path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("bin")
                .join(platform)
                .join(name);
            if dev_path.is_file() {
                return Ok(dev_path);
            }
        }
        Err("当前版本未安装 Unity 音频解析器，请先安装包含音频导出组件的版本".to_string())
    }
}

fn run_extractor(
    executable: &Path,
    input_dir: &Path,
    output_dir: &Path,
    cancel: &AtomicBool,
    mut on_event: impl FnMut(&Value),
) -> Result<AudioExportResult, String> {
    fs::create_dir_all(output_dir).map_err(|e| format!("创建输出目录失败：{e}"))?;
    let mut command = Command::new(executable);
    command
        .args(["scan", "--input"])
        .arg(input_dir)
        .args(["--output"])
        .arg(output_dir)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 Unity 音频解析器：{e}"))?;

    let stdout = child.stdout.take().ok_or("无法读取 Unity 解析器输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 Unity 解析器错误输出")?;
    let stderr_task = thread::spawn(move || read_stream_tail(stderr, STDERR_TAIL_BYTES));
    let mut completed: Option<AudioExportResult> = None;
    let mut fatal_error: Option<String> = None;
    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_task.join();
            return Err("Unity 音频导出已取消".to_string());
        }
        line.clear();
        let count = match reader.read_until(b'\n', &mut line) {
            Ok(count) => count,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stderr_task.join();
                return Err(format!("读取 Unity 解析器输出失败：{error}"));
            }
        };
        if count == 0 {
            break;
        }
        while matches!(line.last(), Some(b'\n') | Some(b'\r')) {
            line.pop();
        }
        let Some(event) = parse_sidecar_event(&line) else {
            continue;
        };
        if event.get("event").and_then(Value::as_str) == Some("completed") {
            completed = serde_json::from_value(event.clone()).ok();
        } else if event.get("event").and_then(Value::as_str) == Some("fatal") {
            fatal_error = event
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        on_event(&event);
    }
    let status_result = child.wait();
    let stderr_tail = stderr_task.join().unwrap_or_default();
    let stderr_text = String::from_utf8_lossy(&stderr_tail).trim().to_string();
    let status = status_result.map_err(|e| format!("等待 Unity 解析器结束失败：{e}"))?;
    if !status.success() {
        let detail = fatal_error.filter(|value| !value.is_empty()).unwrap_or(stderr_text);
        return Err(if detail.is_empty() {
            "Unity 音频解析器执行失败".to_string()
        } else {
            format!("Unity 音频解析器执行失败：{detail}")
        });
    }
    completed.ok_or_else(|| "Unity 音频解析器未返回完成结果".to_string())
}

fn parse_sidecar_event(line: &[u8]) -> Option<Value> {
    serde_json::from_str(&String::from_utf8_lossy(line)).ok()
}

fn read_stream_tail(mut stream: impl Read, limit: usize) -> Vec<u8> {
    if limit == 0 {
        return Vec::new();
    }
    let mut tail = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let count = match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        tail.extend_from_slice(&buffer[..count]);
        if tail.len() > limit {
            let remove = tail.len() - limit;
            tail.drain(..remove);
        }
    }
    tail
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe_and_stable() {
        assert_eq!(stem_for("split_config.arm64_v8a.apk"), "split_config_arm64_v8a");
        assert_eq!(stem_for("base.apk"), "base");
    }

    #[test]
    fn only_resource_trees_are_extracted() {
        assert!(is_resource_entry(Path::new("assets/bin/Data/globalgamemanagers")));
        assert!(is_resource_entry(Path::new("res/raw/sound.wav")));
        assert!(!is_resource_entry(Path::new("lib/arm64-v8a/libmain.so")));
        assert!(!is_resource_entry(Path::new("META-INF/MANIFEST.MF")));
    }

    #[test]
    fn stderr_capture_keeps_only_the_configured_tail() {
        let input = b"0123456789";
        assert_eq!(read_stream_tail(&input[..], 4), b"6789");
        assert!(read_stream_tail(&input[..], 0).is_empty());
    }

    #[test]
    fn sidecar_event_reader_tolerates_non_utf8_bytes() {
        let event = parse_sidecar_event(b"{\"event\":\"progress\",\"current\":\"\xff\"}")
            .expect("lossy UTF-8 conversion should preserve valid JSON framing");
        assert_eq!(event["event"], "progress");
        assert_eq!(event["current"], "\u{fffd}");
    }
}
