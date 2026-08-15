//! 设备枚举与 WiFi 配对 / 连接。

use std::process::Command;

use serde::Serialize;

use super::{adb_path, run_adb_capture};

/// 一台连接的设备（USB 或 WiFi）。
#[derive(Debug, Clone, Serialize)]
pub struct Device {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    /// "usb" 或 "wifi"
    pub transport: String,
}

/// 执行 `adb devices -l` 并解析结果。
pub fn list_devices() -> Result<Vec<Device>, String> {
    log::debug!("执行 adb devices -l");
    let output = Command::new(adb_path())
        .args(["devices", "-l"])
        .output()
        .map_err(|e| format!("无法执行 adb，请确认已安装 Android Platform-Tools：{e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    log::debug!("adb devices -l 原始输出：\n{stdout}");

    if !output.status.success() {
        log::error!("adb devices 执行失败：{stderr}");
        return Err(if stderr.trim().is_empty() {
            "adb devices 执行失败".to_string()
        } else {
            stderr.trim().to_string()
        });
    }

    let mut devices = Vec::new();
    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split_whitespace();
        let serial = fields.next().unwrap_or("").to_string();
        let state = fields.next().unwrap_or("").to_string();
        let mut model = String::new();
        let mut product = String::new();
        let mut is_usb = false;
        for f in fields {
            if let Some(v) = f.strip_prefix("model:") {
                model = v.to_string();
            } else if let Some(v) = f.strip_prefix("product:") {
                product = v.to_string();
            } else if f.starts_with("usb:") {
                is_usb = true;
            }
        }
        let transport = if is_usb { "usb" } else { "wifi" };
        log::debug!("设备行：serial={serial} state={state} transport={transport}");
        devices.push(Device {
            serial,
            state,
            model,
            product,
            transport: transport.to_string(),
        });
    }
    log::info!("枚举到 {} 台设备", devices.len());
    Ok(devices)
}

/// WiFi 配对（Android 11+ 无线调试）。
pub fn pair(ip: &str, port: &str, code: &str) -> Result<String, String> {
    let target = format!("{ip}:{port}");
    log::info!("开始 WiFi 配对：{target}");
    run_adb_capture(&["pair", target.as_str(), code])
}

/// WiFi 连接。
pub fn connect(ip: &str, port: &str) -> Result<String, String> {
    let target = format!("{ip}:{port}");
    log::info!("开始 WiFi 连接：{target}");
    run_adb_capture(&["connect", target.as_str()])
}

/// 断开网络设备。
pub fn disconnect(target: &str) -> Result<String, String> {
    log::info!("断开设备：{target}");
    run_adb_capture(&["disconnect", target])
}

/// WiFi 二维码配对所需信息。
#[derive(Debug, Clone, Serialize)]
pub struct PairingInfo {
    pub service_name: String,
    pub code: String,
    /// 二维码内容：WIFI:T:ADB;S:<service_name>;P:<code>;;
    pub payload: String,
}

/// 生成一次二维码配对的随机服务名与 6 位配对码。
pub fn generate_pairing() -> PairingInfo {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let seed = (now.as_nanos() as u64) ^ ((std::process::id() as u64) << 32);
    let code = format!("{}", 100000 + (seed % 900000));
    let service_name = format!("adbqr-{:08x}", (seed >> 16) as u32);
    let payload = format!("WIFI:T:ADB;S:{service_name};P:{code};;");
    log::debug!("生成二维码配对信息：service_name={service_name} code={code}");
    PairingInfo {
        service_name,
        code,
        payload,
    }
}

/// 通过 mDNS 查找正在等待配对的设备地址（ip:port），找不到返回 None。
pub fn mdns_pairing_address() -> Result<Option<String>, String> {
    let output = Command::new(adb_path())
        .args(["mdns", "services"])
        .output()
        .map_err(|e| format!("无法执行 adb mdns services：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    log::debug!("adb mdns services 输出：\n{stdout}");
    for line in stdout.lines() {
        if line.contains("_adb-tls-pairing._tcp") {
            // 格式：<实例名>  _adb-tls-pairing._tcp  <ip:port>
            let addr = line.split_whitespace().nth(2).map(|s| s.to_string());
            log::info!("mDNS 发现待配对设备：{:?}", addr);
            return Ok(addr);
        }
    }
    log::debug!("mDNS 尚未发现待配对设备");
    Ok(None)
}

/// 通过 mDNS 查找已配对设备的连接地址（ip:port），找不到返回 None。
pub fn mdns_connect_address() -> Result<Option<String>, String> {
    let output = Command::new(adb_path())
        .args(["mdns", "services"])
        .output()
        .map_err(|e| format!("无法执行 adb mdns services：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    log::debug!("adb mdns services 输出：\n{stdout}");
    for line in stdout.lines() {
        if line.contains("_adb-tls-connect._tcp") {
            let addr = line.split_whitespace().nth(2).map(|s| s.to_string());
            log::info!("mDNS 发现可连接设备：{:?}", addr);
            return Ok(addr);
        }
    }
    log::debug!("mDNS 尚未发现可连接设备");
    Ok(None)
}
