//! 设备信息、当前 Activity、Alarm 与性能监控。

use std::process::Command;

use serde::Serialize;

use super::adb_path;

/// 设备信息。
#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub serial: String,
    pub brand: String,
    pub model: String,
    pub android: String,
    pub sdk: String,
    pub abi: String,
    pub resolution: String,
    pub density: String,
    pub battery: String,
    pub storage: String,
}

fn adb_shell_output(device: Option<&str>, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(adb_path());
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(args)
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn getprop(device: Option<&str>, key: &str) -> Result<String, String> {
    adb_shell_output(device, &["shell", "getprop", key])
}

pub fn device_info(device: Option<&str>) -> Result<DeviceInfo, String> {
    log::info!("获取设备信息：device={:?}", device);
    let serial = match device {
        Some(d) => d.to_string(),
        None => adb_shell_output(None, &["get-serialno"])?,
    };
    let brand = getprop(device, "ro.product.brand")?;
    let model = getprop(device, "ro.product.model")?;
    let android = getprop(device, "ro.build.version.release")?;
    let sdk = getprop(device, "ro.build.version.sdk")?;
    let abi = getprop(device, "ro.product.cpu.abi")?;
    let resolution = adb_shell_output(device, &["shell", "wm", "size"])?;
    let density = adb_shell_output(device, &["shell", "wm", "density"])?;
    let battery = adb_shell_output(device, &["shell", "dumpsys", "battery"])?
        .lines()
        .find(|l| l.contains("level:"))
        .unwrap_or("")
        .trim()
        .to_string();
    let storage = adb_shell_output(device, &["shell", "df", "/data"])?
        .lines()
        .last()
        .unwrap_or("")
        .to_string();
    Ok(DeviceInfo {
        serial,
        brand,
        model,
        android,
        sdk,
        abi,
        resolution,
        density,
        battery,
        storage,
    })
}

/// 当前 Activity（只返回包名与 Activity 名称）。
pub fn current_activity(device: Option<&str>) -> Result<String, String> {
    log::info!("查看当前 Activity：device={:?}", device);
    let out = adb_shell_output(device, &["shell", "dumpsys", "activity", "activities"])?;
    for line in out.lines() {
        if line.contains("ResumedActivity") {
            if let Some((pkg, act)) = parse_resumed_activity(line) {
                return Ok(format!("包名：{pkg}\nActivity：{act}"));
            }
        }
    }
    Ok("未找到当前 Activity".to_string())
}

/// 从 `ResumedActivity: ActivityRecord{hash u0 包名/.Activity t123}` 解析出包名与完整 Activity 名。
fn parse_resumed_activity(line: &str) -> Option<(String, String)> {
    for tok in line.split_whitespace() {
        let tok = tok.trim_matches(|c: char| c == '}' || c == '{' || c == ';');
        if let Some(slash) = tok.find('/') {
            if slash == 0 || slash >= tok.len() - 1 {
                continue;
            }
            let pkg = &tok[..slash];
            let act = &tok[slash + 1..];
            if !pkg.contains('.') {
                continue;
            }
            // `.Activity` 是相对包名的简写，转成完整 Activity 名
            let full = if act.starts_with('.') {
                format!("{pkg}{act}")
            } else {
                act.to_string()
            };
            return Some((pkg.to_string(), full));
        }
    }
    None
}

/// 应用 Alarm（`dumpsys alarm`，按包名过滤）。
pub fn app_alarm(device: Option<&str>, package: &str) -> Result<String, String> {
    log::info!("查看应用 Alarm：device={:?} package={package}", device);
    let out = adb_shell_output(device, &["shell", "dumpsys", "alarm"])?;
    let lines: Vec<&str> = out.lines().filter(|l| l.contains(package)).collect();
    if lines.is_empty() {
        Ok(format!("Alarm 中未找到：{package}"))
    } else {
        Ok(lines.join("\n"))
    }
}

/// 应用性能信息（内存 + 帧率/渲染快照）。
pub fn app_performance(device: Option<&str>, package: &str) -> Result<String, String> {
    log::info!("查看应用性能：device={:?} package={package}", device);
    let mut out = String::new();

    // 内存
    match adb_shell_output(device, &["shell", "dumpsys", "meminfo", package]) {
        Ok(mem) => {
            let lines: Vec<&str> = mem
                .lines()
                .filter(|l| {
                    let t = l.trim_start();
                    t.starts_with("TOTAL")
                        || l.contains("Native Heap")
                        || l.contains("Dalvik Heap")
                        || l.contains("Java Heap")
                })
                .collect();
            out.push_str("【内存】\n");
            if lines.is_empty() {
                out.push_str("（无数据，应用可能未运行）\n");
            } else {
                out.push_str(&lines.join("\n"));
            }
        }
        Err(e) => out.push_str(&format!("【内存】获取失败：{e}\n")),
    }

    // 帧率/渲染
    match adb_shell_output(device, &["shell", "dumpsys", "gfxinfo", package]) {
        Ok(gfx) => {
            let lines: Vec<&str> = gfx
                .lines()
                .filter(|l| {
                    l.contains("Total frames rendered")
                        || l.contains("Janky frames")
                        || l.contains("percentile")
                        || l.contains("Number Missed Vsync")
                        || l.contains("Number High input latency")
                })
                .collect();
            out.push_str("\n【帧率/渲染】\n");
            if lines.is_empty() {
                out.push_str("（无数据，应用可能未渲染过画面）\n");
            } else {
                out.push_str(&lines.join("\n"));
            }
        }
        Err(e) => out.push_str(&format!("\n【帧率/渲染】获取失败：{e}\n")),
    }

    Ok(out)
}
