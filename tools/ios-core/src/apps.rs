use crate::{IosTool, ProbeError, ProbeErrorKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosApplication {
    pub bundle_id: String,
    pub name: String,
    pub executable: Option<String>,
}

pub fn list_applications(tool: &IosTool, udid: &str) -> Result<Vec<IosApplication>, ProbeError> {
    if udid.trim().is_empty() {
        return Err(ProbeError::new(
            ProbeErrorKind::InvalidArguments,
            "请先选择 iOS 设备",
        ));
    }
    let output = tool.checked_output_timeout(
        &["apps", &format!("--udid={udid}")],
        std::time::Duration::from_secs(15),
    )?;
    parse_applications(&output)
}

pub fn parse_applications(bytes: &[u8]) -> Result<Vec<IosApplication>, ProbeError> {
    let values: Vec<serde_json::Value> = serde_json::from_slice(bytes).map_err(|_| {
        ProbeError::new(
            ProbeErrorKind::OutputParseFailed,
            "无法解析 go-ios 应用列表",
        )
    })?;
    let mut result = std::collections::BTreeMap::new();
    for value in values {
        let field = |key| {
            value
                .get(key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        };
        let Some(bundle) = field("CFBundleIdentifier") else {
            continue;
        };
        let executable = field("CFBundleExecutable").map(str::to_owned);
        let app = IosApplication {
            bundle_id: bundle.into(),
            name: field("CFBundleDisplayName")
                .or_else(|| field("CFBundleName"))
                .unwrap_or(bundle)
                .into(),
            executable,
        };
        result.entry(bundle.to_owned()).or_insert(app);
    }
    let mut result: Vec<_> = result.into_values().collect();
    result.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.bundle_id.cmp(&b.bundle_id))
    });
    Ok(result)
}

pub fn matches_process(process: &str, filter: &str, exact: bool) -> bool {
    if exact {
        process.eq_ignore_ascii_case(filter)
    } else {
        process
            .to_ascii_lowercase()
            .starts_with(&filter.to_ascii_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_names_ids_and_executables_without_guessing() {
        let data = br#"[{"CFBundleIdentifier":"com.game","CFBundleDisplayName":"Fruit Quest","CFBundleExecutable":"FruitQuest"},{"CFBundleIdentifier":"com.other","CFBundleName":"Other"},{"CFBundleIdentifier":"com.game","CFBundleExecutable":"wrong"},{"CFBundleExecutable":"orphan"}]"#;
        let apps = parse_applications(data).unwrap();
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].bundle_id, "com.game");
        assert_eq!(apps[0].executable.as_deref(), Some("FruitQuest"));
        assert_eq!(apps[1].executable, None);
        assert!(parse_applications(br#"{"apps":[]}"#).is_err());
    }
    #[test]
    fn exact_app_scope_does_not_capture_prefix_siblings() {
        assert!(matches_process("FruitQuest", "fruitquest", true));
        assert!(!matches_process("FruitQuestHelper", "FruitQuest", true));
        assert!(matches_process("FruitQuestHelper", "FruitQuest", false));
    }
}
