//! 应用清单（远程拉取）与应用级操作：PID 解析、打开后门、重启、清数据、卸载。


use serde::Serialize;

use super::adb_command;

/// 解析指定包名当前运行的 PID 列表（`adb shell pidof`）。
pub fn resolve_pids(device: Option<&str>, package: &str) -> Result<Vec<String>, String> {
    log::info!("解析包名 PID：device={:?} package={package}", device);
    let mut cmd = adb_command();
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["shell", "pidof", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::debug!("adb shell pidof 原始输出：{stdout}");
    if stdout.is_empty() {
        log::warn!("包 {package} 当前无运行进程");
        return Ok(Vec::new());
    }
    let pids: Vec<String> = stdout
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    log::info!("包 {package} 的 PID：{pids:?}");
    Ok(pids)
}

/// 一个配置中的应用（用于「应用过滤」下拉框）。
#[derive(Debug, Clone, Serialize)]
pub struct App {
    pub name: String,
    pub package: String,
}

/// 从远程 URL 拉取并解析应用清单（支持 `{ projects: [...] }` 或 `{ apps: [...] }`）。
pub fn fetch_remote_apps(url: &str) -> Result<Vec<App>, String> {
    log::info!("拉取远程应用清单：{url}");
    let body = ureq::get(url)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("请求失败：{e}"))?
        .into_string()
        .map_err(|e| format!("读取响应失败：{e}"))?;

    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("JSON 解析失败：{e}"))?;
    let list = value
        .get("projects")
        .or_else(|| value.get("apps"))
        .and_then(|v| v.as_array())
        .ok_or("配置中缺少 projects/apps 数组")?;

    let mut apps = Vec::new();
    for item in list {
        let Some(pkg) = item.get("package").and_then(|v| v.as_str()) else {
            continue;
        };
        if pkg.is_empty() {
            continue;
        }
        let name = item
            .get("app_name")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("project_name").and_then(|v| v.as_str()))
            .or_else(|| item.get("name").and_then(|v| v.as_str()))
            .unwrap_or(pkg);
        apps.push(App {
            name: name.to_string(),
            package: pkg.to_string(),
        });
    }
    log::info!("远程清单解析出 {} 个应用", apps.len());
    Ok(apps)
}

/// 打开应用后门（调试 Activity）。
pub fn open_backdoor(
    device: Option<&str>,
    package: &str,
    activity: &str,
) -> Result<String, String> {
    let component = format!("{package}/{activity}");
    log::info!("打开后门：device={:?} component={component}", device);
    let mut cmd = adb_command();
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["shell", "am", "start", "-n", &component])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("后门已打开：{component}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("打开后门失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 重启应用：force-stop 后通过 Launcher 启动。
pub fn restart_app(device: Option<&str>, package: &str) -> Result<(), String> {
    log::info!("重启应用：device={:?} package={package}", device);
    let mut stop = adb_command();
    if let Some(d) = device {
        stop.arg("-s").arg(d);
    }
    let out = stop
        .args(["shell", "am", "force-stop", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    let mut launch = adb_command();
    if let Some(d) = device {
        launch.arg("-s").arg(d);
    }
    let out = launch
        .args([
            "shell",
            "monkey",
            "-p",
            package,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    log::info!("应用已重启：{package}");
    Ok(())
}

/// 清除应用数据。
pub fn clear_app_data(device: Option<&str>, package: &str) -> Result<String, String> {
    log::info!("清除应用数据：device={:?} package={package}", device);
    let mut cmd = adb_command();
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["shell", "pm", "clear", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("清除数据成功：{package}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("清除数据失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 卸载应用。
pub fn uninstall_app(device: Option<&str>, package: &str) -> Result<String, String> {
    log::info!("卸载应用：device={:?} package={package}", device);
    let mut cmd = adb_command();
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["uninstall", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("卸载成功：{package}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("卸载失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}
