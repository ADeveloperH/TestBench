//! 设备枚举与 WiFi 配对 / 连接。


use serde::Serialize;

use super::{adb_command, run_adb_capture};

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
    let output = adb_command()
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

    let devices = parse_devices_output(&stdout);
    log::info!("枚举到 {} 台设备（去重后）", devices.len());
    Ok(devices)
}

/// 解析 `adb devices -l` 的标准输出（首行为表头，直接跳过）。
fn parse_devices_output(stdout: &str) -> Vec<Device> {
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
        let mut has_usb_field = false;
        for f in fields {
            if let Some(v) = f.strip_prefix("model:") {
                model = v.to_string();
            } else if let Some(v) = f.strip_prefix("product:") {
                product = v.to_string();
            } else if f.starts_with("usb:") {
                has_usb_field = true;
            }
        }
        // Windows 的 `adb devices -l` 不输出 usb: 字段（macOS/Linux 才有），
        // 用 serial 形态兜底推断：ip:port 或 mDNS 实例名 → WiFi，其余 → USB。
        let transport = if has_usb_field || !is_network_serial(&serial) {
            "usb"
        } else {
            "wifi"
        };
        log::debug!("设备行：serial={serial} state={state} transport={transport}");
        devices.push(Device {
            serial,
            state,
            model,
            product,
            transport: transport.to_string(),
        });
    }

    // 过滤 mDNS 别名行：同一台设备在 adb devices 里会同时列出 ip:port 和
    // adb-<serial>-<随机串>._adb-tls-connect._tcp 两个 WiFi 传输，避免重复显示。
    let mut filtered: Vec<Device> = devices
        .iter()
        .filter(|d| {
            if !d.serial.contains("._tcp") {
                return true;
            }
            // 只要存在另一个在线条目能对上同一台设备（serial 是子串，或型号/产品一致），
            // 该 mDNS 别名就是冗余的。
            let redundant = devices.iter().any(|o| {
                o.state == "device"
                    && o.serial != d.serial
                    && !o.serial.is_empty()
                    && (d.serial.contains(&o.serial)
                        || (!o.model.is_empty() && o.model == d.model && o.product == d.product))
            });
            if redundant {
                log::debug!("过滤冗余 mDNS 别名：{}", d.serial);
            }
            !redundant
        })
        .cloned()
        .collect();

    // USB 优先展示（sort_by_key 是稳定排序，保持 adb 原始顺序中的相对次序）。
    filtered.sort_by_key(|d| if d.transport == "usb" { 0 } else { 1 });
    filtered
}

/// 判断 serial 是否为网络形态：`ip:port`（IPv4 或 [IPv6]）或 mDNS 实例名。
fn is_network_serial(serial: &str) -> bool {
    if serial.contains("._tcp") {
        return true;
    }
    let Some((host, port)) = serial.rsplit_once(':') else {
        return false;
    };
    if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.is_empty() {
        return false;
    }
    if host.contains(':') {
        // IPv6（`::` 会拆出空段，允许）
        return host
            .split(':')
            .all(|p| p.chars().all(|c| c.is_ascii_hexdigit()));
    }
    host.split('.')
        .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
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
    let output = adb_command()
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
    let output = adb_command()
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 复现 Windows 实测输出：USB + WiFi(ip:port) + WiFi(mDNS 别名) 三行同一台设备。
    /// 期望：过滤 mDNS 别名，USB 排在最前，传输方式标注正确。
    #[test]
    fn parse_windows_usb_plus_wifi_dedup() {
        let raw = "\
List of devices attached
172cca1c               device product:picasso model:Redmi_K30_5G device:picasso transport_id:13
192.168.15.48:41977    device product:picasso model:Redmi_K30_5G device:picasso transport_id:12
adb-172cca1c-DppnRa._adb-tls-connect._tcp device product:picasso model:Redmi_K30_5G device:picasso transport_id:11
";
        let devices = parse_devices_output(raw);
        assert_eq!(devices.len(), 2, "应过滤 mDNS 别名，只留 USB 与 WiFi：{devices:?}");
        assert_eq!(devices[0].serial, "172cca1c");
        assert_eq!(devices[0].transport, "usb");
        assert_eq!(devices[1].serial, "192.168.15.48:41977");
        assert_eq!(devices[1].transport, "wifi");
    }

    /// macOS/Linux 的 adb 会输出 usb: 字段，直接以此判定。
    #[test]
    fn parse_usb_field_wins() {
        let raw = "List of devices attached\n172cca1c  device usb:1-1 product:picasso model:Redmi_K30_5G transport_id:1\n";
        let devices = parse_devices_output(raw);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].transport, "usb");
    }

    /// 只有 mDNS 别名（无对应 ip:port 行）时不误删。
    #[test]
    fn keep_mdns_alias_when_alone() {
        let raw = "List of devices attached\nadb-172cca1c-DppnRa._adb-tls-connect._tcp device product:picasso model:Redmi_K30_5G transport_id:11\n";
        let devices = parse_devices_output(raw);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].transport, "wifi");
    }

    #[test]
    fn network_serial_detection() {
        assert!(is_network_serial("192.168.15.48:41977"));
        assert!(is_network_serial("[fe80::1]:5555"));
        assert!(is_network_serial("adb-172cca1c-DppnRa._adb-tls-connect._tcp"));
        assert!(!is_network_serial("172cca1c"));
        assert!(!is_network_serial("emulator-5554"));
        assert!(!is_network_serial("1.2.3.4")); // 没有端口
    }
}
