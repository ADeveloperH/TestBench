//! ADB / scrcpy 操作封装：二进制路径初始化、共享 helper 与子模块重导出。

mod apps;
mod devices;
mod info;
mod install;
mod logcat;
mod scrcpy;

use std::process::Command;
use std::sync::OnceLock;

static ADB_BIN: OnceLock<String> = OnceLock::new();
static SCRCPY_BIN: OnceLock<String> = OnceLock::new();
static SCRCPY_SERVER_BIN: OnceLock<String> = OnceLock::new();

/// 初始化内置 adb / scrcpy 的路径（应用启动时调用）。
/// 优先级：环境变量 > 内置二进制 > PATH 回退。
pub fn init_binary_paths(resource_dir: Option<std::path::PathBuf>) {
    let os = std::env::consts::OS;
    let platform = if os == "windows" { "windows" } else { "macos" };
    let adb_name = if os == "windows" { "adb.exe" } else { "adb" };
    let scrcpy_name = if os == "windows" { "scrcpy.exe" } else { "scrcpy" };

    let adb = std::env::var("ADB_PATH")
        .ok()
        .filter(|p| !p.is_empty())
        .or_else(|| {
            resource_dir
                .as_ref()
                .map(|d| d.join("bin").join(platform).join(adb_name))
                .filter(|p| p.exists())
                .map(|p| p.display().to_string())
        })
        .unwrap_or_else(|| "adb".to_string());
    let _ = ADB_BIN.set(adb);

    let scrcpy = std::env::var("SCRCPY_PATH")
        .ok()
        .filter(|p| !p.is_empty())
        .or_else(|| {
            resource_dir
                .as_ref()
                .map(|d| d.join("bin").join(platform).join(scrcpy_name))
                .filter(|p| p.exists())
                .map(|p| p.display().to_string())
        })
        .unwrap_or_else(|| "scrcpy".to_string());
    let _ = SCRCPY_BIN.set(scrcpy);

    let server = std::path::Path::new(SCRCPY_BIN.get().unwrap())
        .parent()
        .map(|d| d.join("scrcpy-server"))
        .filter(|p| p.exists())
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let _ = SCRCPY_SERVER_BIN.set(server);
}

pub(crate) fn adb_path() -> String {
    ADB_BIN.get().cloned().unwrap_or_else(|| "adb".to_string())
}

pub(crate) fn scrcpy_path() -> String {
    SCRCPY_BIN.get().cloned().unwrap_or_else(|| "scrcpy".to_string())
}

pub(crate) fn scrcpy_server_path() -> String {
    SCRCPY_SERVER_BIN.get().cloned().unwrap_or_default()
}

/// 构造 scrcpy 命令（带内置 adb / server 的环境变量）。
pub(crate) fn scrcpy_command() -> Command {
    let mut cmd = Command::new(scrcpy_path());
    cmd.env("ADB", adb_path());
    let server = scrcpy_server_path();
    if !server.is_empty() {
        cmd.env("SCRCPY_SERVER_PATH", &server);
    }
    cmd
}

/// 执行一个 adb 命令并捕获输出（用于 pair / connect / disconnect 等短命令）。
pub(crate) fn run_adb_capture(args: &[&str]) -> Result<String, String> {
    log::debug!("执行 adb {}", args.join(" "));
    let output = Command::new(adb_path())
        .args(args)
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        let out = if stdout.is_empty() { &stderr } else { &stdout };
        log::debug!("adb 命令成功，输出：{out}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!(
            "adb 命令失败（exit {:?}）：stdout={stdout} stderr={stderr}",
            output.status.code()
        );
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

pub use apps::{
    clear_app_data, fetch_remote_apps, open_backdoor, resolve_pids, restart_app, uninstall_app,
    App,
};
pub use devices::{
    connect, disconnect, generate_pairing, list_devices, mdns_connect_address,
    mdns_pairing_address, pair, Device, PairingInfo,
};
pub use info::{app_alarm, app_performance, current_activity, device_info, DeviceInfo};
pub use install::{install_apk, screencap_png};
pub use logcat::{clear_log, LogcatProcess};
pub use scrcpy::{mirror, ScrcpyRecord};
