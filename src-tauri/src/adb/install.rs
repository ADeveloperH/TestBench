//! 截图与 APK 安装。

use std::process::Command;

use super::adb_path;

/// 截图，返回 PNG 原始字节（`adb exec-out screencap -p`）。
pub fn screencap_png(device: Option<&str>) -> Result<Vec<u8>, String> {
    log::info!("截图：device={:?}", device);
    let mut cmd = Command::new(adb_path());
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["exec-out", "screencap", "-p"])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::error!("截图失败：{err}");
        return Err(if err.is_empty() { "截图失败".to_string() } else { err });
    }
    Ok(output.stdout)
}

/// 覆盖安装 APK。
pub fn install_apk(device: Option<&str>, path: &str) -> Result<String, String> {
    log::info!("安装 APK：device={:?} path={path}", device);
    let mut cmd = Command::new(adb_path());
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["install", "-r", path])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("APK 安装成功：{path}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("APK 安装失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}
