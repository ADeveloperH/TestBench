use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{classify_tool_error, ProbeError, ProbeErrorKind},
    tool::IosTool,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawDevice {
    udid: String,
    product_type: Option<String>,
    product_version: Option<String>,
    connection_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceList {
    device_list: Vec<RawDevice>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BasicDeviceList {
    device_list: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosDevice {
    pub id: String,
    pub display_id: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub os_version: Option<String>,
    pub transport: String,
    /// 首版 CLI 兼容字段；新 UI 使用 connection/trust/locked/capabilities。
    pub state: DeviceState,
    pub connection_state: ConnectionState,
    pub trust_state: TrustState,
    pub locked: Option<bool>,
    pub capabilities: Vec<DeviceCapability>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceState {
    Online,
    TrustRequired,
    Locked,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Online,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustState {
    Trusted,
    TrustRequired,
    PairingInvalid,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceCapability {
    Syslog,
}

pub fn list_devices(tool: &IosTool) -> Result<Vec<IosDevice>, ProbeError> {
    let raw_devices = match tool.output(&["list", "--details"]) {
        Ok(output) if output.status.success() => parse_detailed_devices(&output.stdout)?,
        _ => {
            // go-ios 的批量详情查询是全有或全无：任意一台设备 PairRecord 失效，
            // 整条命令都会失败。退回基础列表后逐台执行 info，避免误伤其他在线设备。
            let output = tool.checked_output(&["list"])?;
            parse_basic_devices(&output.stdout)?
        }
    };

    let mut devices = Vec::with_capacity(raw_devices.len());
    for raw in raw_devices {
        devices.push(enrich_device(tool, raw));
    }
    Ok(devices)
}

fn parse_detailed_devices(output: &[u8]) -> Result<Vec<RawDevice>, ProbeError> {
    serde_json::from_slice::<DeviceList>(output)
        .map(|parsed| parsed.device_list)
        .map_err(|error| {
            ProbeError::new(
                ProbeErrorKind::OutputParseFailed,
                format!("无法解析设备详情列表：{error}"),
            )
        })
}

fn parse_basic_devices(output: &[u8]) -> Result<Vec<RawDevice>, ProbeError> {
    serde_json::from_slice::<BasicDeviceList>(output)
        .map(|parsed| {
            parsed
                .device_list
                .into_iter()
                .map(|udid| RawDevice {
                    udid,
                    product_type: None,
                    product_version: None,
                    connection_type: None,
                })
                .collect()
        })
        .map_err(|error| {
            ProbeError::new(
                ProbeErrorKind::OutputParseFailed,
                format!("无法解析设备基础列表：{error}"),
            )
        })
}

fn enrich_device(tool: &IosTool, raw: RawDevice) -> IosDevice {
    let mut device = IosDevice {
        display_id: mask_udid(&raw.udid),
        id: raw.udid.clone(),
        name: None,
        model: raw.product_type,
        os_version: raw.product_version,
        transport: raw
            .connection_type
            .unwrap_or_else(|| "unknown".to_owned())
            .to_ascii_lowercase(),
        state: DeviceState::Unavailable,
        connection_state: ConnectionState::Online,
        trust_state: TrustState::Unknown,
        locked: None,
        capabilities: Vec::new(),
    };

    match tool.output(&["--udid", &raw.udid, "info"]) {
        Ok(output) if output.status.success() => {
            if let Ok(info) = serde_json::from_slice::<Value>(&output.stdout) {
                apply_device_info(&mut device, &info);
            }
        }
        Ok(output) => {
            let message = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stderr),
                String::from_utf8_lossy(&output.stdout)
            );
            device.state = match classify_tool_error(&message) {
                ProbeErrorKind::TrustRequired => {
                    device.trust_state = TrustState::TrustRequired;
                    DeviceState::TrustRequired
                }
                ProbeErrorKind::PairingInvalid => {
                    device.trust_state = TrustState::PairingInvalid;
                    DeviceState::TrustRequired
                }
                ProbeErrorKind::DeviceLocked => {
                    device.locked = Some(true);
                    device.capabilities.push(DeviceCapability::Syslog);
                    DeviceState::Locked
                }
                _ => {
                    device.connection_state = ConnectionState::Unavailable;
                    DeviceState::Unavailable
                }
            };
        }
        Err(_) => {
            device.connection_state = ConnectionState::Unavailable;
        }
    }
    device
}

fn apply_device_info(device: &mut IosDevice, info: &Value) {
    device.name = info
        .get("DeviceName")
        .and_then(Value::as_str)
        .map(str::to_owned);
    device.model = info
        .get("ProductType")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| device.model.clone());
    device.os_version = info
        .get("ProductVersion")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| device.os_version.clone());
    device.state = if info
        .get("TrustedHostAttached")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        device.trust_state = TrustState::Trusted;
        let locked = info
            .get("PasswordProtected")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        device.locked = Some(locked);
        if locked {
            DeviceState::Locked
        } else {
            device.capabilities.push(DeviceCapability::Syslog);
            DeviceState::Online
        }
    } else {
        device.trust_state = TrustState::TrustRequired;
        DeviceState::TrustRequired
    };
}

pub fn mask_udid(udid: &str) -> String {
    const KEEP: usize = 8;
    if udid.chars().count() <= KEEP * 2 {
        return "****".to_owned();
    }
    let start: String = udid.chars().take(KEEP).collect();
    let end: String = udid
        .chars()
        .rev()
        .take(KEEP)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("{start}-****-{end}")
}

#[cfg(test)]
mod tests {
    use super::{
        apply_device_info, mask_udid, parse_basic_devices, ConnectionState, DeviceCapability,
        DeviceState, IosDevice, TrustState,
    };
    use serde_json::json;

    #[test]
    fn masks_middle_of_udid() {
        assert_eq!(
            mask_udid("00008110-0000000000000000"),
            "00008110-****-00000000"
        );
    }

    #[test]
    fn parses_basic_list_for_per_device_fallback() {
        let devices = parse_basic_devices(
            br#"{"deviceList":["00008110-0000000000000001","00008110-0000000000000002"]}"#,
        )
        .expect("basic device list");
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].udid, "00008110-0000000000000001");
        assert!(devices[0].product_type.is_none());
    }

    #[test]
    fn trusted_but_locked_device_cannot_start_new_syslog_session() {
        let mut device = IosDevice {
            id: "id".to_owned(),
            display_id: "****".to_owned(),
            name: None,
            model: None,
            os_version: None,
            transport: "unknown".to_owned(),
            state: DeviceState::Unavailable,
            connection_state: ConnectionState::Online,
            trust_state: TrustState::Unknown,
            locked: None,
            capabilities: Vec::new(),
        };
        apply_device_info(
            &mut device,
            &json!({
                "DeviceName": "Locked iPhone",
                "ProductType": "iPhone14,5",
                "ProductVersion": "18.7.8",
                "TrustedHostAttached": true,
                "PasswordProtected": true
            }),
        );
        assert_eq!(device.state, DeviceState::Locked);
        assert_eq!(device.trust_state, TrustState::Trusted);
        assert_eq!(device.locked, Some(true));
        assert!(!device.capabilities.contains(&DeviceCapability::Syslog));
    }
}
