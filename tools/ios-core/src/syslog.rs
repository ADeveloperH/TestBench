use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct RawEnvelope {
    msg: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosLogRecord {
    pub timestamp: String,
    pub device: String,
    pub process: String,
    pub module: Option<String>,
    pub pid: Option<u32>,
    /// Apple syslog 提供的原始设备级别。保留 `level` 字段以兼容首版 Probe 输出。
    pub level: String,
    pub semantic_level: Option<SemanticLevel>,
    pub semantic_level_source: Option<SemanticLevelSource>,
    pub encoding_status: EncodingStatus,
    pub truncated: bool,
    pub message: String,
    pub raw: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticLevel {
    Info,
    Warning,
    Error,
    Exception,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticLevelSource {
    UnityHeuristic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EncodingStatus {
    Valid,
    SuspectedMojibake,
}

pub fn parse_envelope(line: &str) -> Option<IosLogRecord> {
    let envelope: RawEnvelope = serde_json::from_str(line).ok()?;
    parse_syslog_message(&envelope.msg)
}

pub fn parse_syslog_message(raw: &str) -> Option<IosLogRecord> {
    // 级别字段紧跟在 PID 后面。不能从行尾反向查找 `<...>: `，因为日志正文
    // 自身也可能包含相同形式（例如 UIKit 对象描述）。
    let pid_level_separator = raw.find("] <")?;
    let level_start = pid_level_separator + 3;
    let level_end_relative = raw[level_start..].find(">: ")?;
    let level_end = level_start + level_end_relative;
    let header = &raw[..=pid_level_separator];
    let level = &raw[level_start..level_end];
    let message = &raw[level_end + 3..];

    if header.len() < 16 {
        return None;
    }
    let timestamp = header[..15].to_owned();
    let identity = header[15..].trim();
    let pid_start = identity.rfind('[')?;
    let pid_end = identity.rfind(']')?;
    if pid_end < pid_start {
        return None;
    }
    let pid = identity[pid_start + 1..pid_end].parse().ok();
    let before_pid = identity[..pid_start].trim_end();
    let process_start = before_pid.rfind(' ')?;
    let device = before_pid[..process_start].to_owned();
    let process_with_module = &before_pid[process_start + 1..];
    let (process, module) = split_process_module(process_with_module);
    let semantic_level = infer_unity_semantic_level(message);
    let semantic_level_source = semantic_level.map(|_| SemanticLevelSource::UnityHeuristic);

    Some(IosLogRecord {
        timestamp,
        device,
        process,
        module,
        pid,
        level: level.to_ascii_lowercase(),
        semantic_level,
        semantic_level_source,
        encoding_status: detect_encoding_status(message),
        truncated: detect_truncation(message),
        message: message.to_owned(),
        raw: raw.to_owned(),
    })
}

fn infer_unity_semantic_level(message: &str) -> Option<SemanticLevel> {
    if message.contains("UnityEngine.DebugLogHandler:LogException")
        || message.contains("UnityEngine.Debug:LogException")
        || looks_like_managed_exception(message)
    {
        return Some(SemanticLevel::Exception);
    }
    if message.contains("UnityEngine.Debug:LogError") {
        return Some(SemanticLevel::Error);
    }
    if message.contains("UnityEngine.Debug:LogWarning") {
        return Some(SemanticLevel::Warning);
    }
    if message.contains("UnityEngine.Debug:Log(") {
        return Some(SemanticLevel::Info);
    }
    None
}

fn looks_like_managed_exception(message: &str) -> bool {
    let first_line = message.lines().next().unwrap_or_default();
    first_line.contains("Exception:") && message.contains("\n  at ")
}

fn detect_encoding_status(message: &str) -> EncodingStatus {
    // Unity 写入 Apple 日志通道时，UTF-8 字节可能被按其他单字节编码解释。
    // 这里只做高置信度标记，不自动转码，避免破坏本来合法的非 ASCII 文本。
    const MOJIBAKE_MARKERS: [&str; 5] = ["‰∏", "Êñ", "ü", "Ôº", "Â§"];
    if MOJIBAKE_MARKERS
        .iter()
        .any(|marker| message.contains(marker))
    {
        EncodingStatus::SuspectedMojibake
    } else {
        EncodingStatus::Valid
    }
}

fn detect_truncation(message: &str) -> bool {
    message.contains("<…>") || message.contains("<...>")
}

fn split_process_module(value: &str) -> (String, Option<String>) {
    match (value.rfind('('), value.strip_suffix(')')) {
        (Some(start), Some(without_suffix)) if start + 1 < without_suffix.len() => (
            value[..start].to_owned(),
            Some(without_suffix[start + 1..].to_owned()),
        ),
        (Some(start), Some(without_suffix)) if start + 1 == without_suffix.len() => {
            (value[..start].to_owned(), None)
        }
        _ => (value.to_owned(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_envelope, parse_syslog_message, EncodingStatus, IosLogRecord, SemanticLevel,
        SemanticLevelSource,
    };

    #[test]
    fn parses_unity_log_and_preserves_chinese() {
        let raw = "Nov  3 21:48:30 Test-iPhone FruitQuest(UnityFramework)[42] <Notice>: [测试] 中文日志 😀";
        let record = parse_syslog_message(raw).expect("record");
        assert_eq!(
            record,
            IosLogRecord {
                timestamp: "Nov  3 21:48:30".to_owned(),
                device: "Test-iPhone".to_owned(),
                process: "FruitQuest".to_owned(),
                module: Some("UnityFramework".to_owned()),
                pid: Some(42),
                level: "notice".to_owned(),
                semantic_level: None,
                semantic_level_source: None,
                encoding_status: EncodingStatus::Valid,
                truncated: false,
                message: "[测试] 中文日志 😀".to_owned(),
                raw: raw.to_owned(),
            }
        );
    }

    #[test]
    fn ignores_tool_diagnostic_json() {
        assert!(
            parse_envelope(r#"{"level":"WARN","msg":"go-ios agent is not running"}"#).is_none()
        );
    }

    #[test]
    fn treats_empty_module_as_missing() {
        let record =
            parse_syslog_message("Nov  3 21:48:30 TestPhone kernel()[0] <Notice>: message")
                .expect("record");
        assert_eq!(record.process, "kernel");
        assert_eq!(record.module, None);
    }

    #[test]
    fn does_not_parse_angle_brackets_in_message_as_level() {
        let record = parse_syslog_message(
            "Sep 24 11:51:13 TestPhone FruitQuest(BaseBoard)[42] <Notice>: object <FBSceneSnapshotAction: 0x1234>: receiver is no longer valid",
        )
        .expect("record");
        assert_eq!(record.level, "notice");
        assert_eq!(
            record.message,
            "object <FBSceneSnapshotAction: 0x1234>: receiver is no longer valid"
        );
    }

    #[test]
    fn infers_unity_levels_without_overwriting_device_level() {
        let cases = [
            ("UnityEngine.Debug:Log(Object)", SemanticLevel::Info),
            ("UnityEngine.Debug:LogWarning(Object)", SemanticLevel::Warning),
            ("UnityEngine.Debug:LogError(Object)", SemanticLevel::Error),
            (
                "InvalidOperationException: controlled\n  at Fixture.Throw ()\nUnityEngine.DebugLogHandler:LogException(Exception, Object)",
                SemanticLevel::Exception,
            ),
        ];
        for (message, expected) in cases {
            let raw = format!(
                "Nov  3 21:48:30 Test-iPhone Fixture(UnityFramework)[42] <Notice>: {message}"
            );
            let record = parse_syslog_message(&raw).expect("record");
            assert_eq!(record.level, "notice");
            assert_eq!(record.semantic_level, Some(expected));
            assert_eq!(
                record.semantic_level_source,
                Some(SemanticLevelSource::UnityHeuristic)
            );
        }
    }

    #[test]
    fn does_not_infer_native_log_level() {
        let record = parse_syslog_message(
            "Nov  3 21:48:54 Test-iPhone Fixture(UnityFramework)[42] <Notice>: [TestBench.iOSFixture] kind=nslog message=原生日志",
        )
        .expect("record");
        assert_eq!(record.semantic_level, None);
        assert_eq!(record.semantic_level_source, None);
    }

    #[test]
    fn marks_suspected_mojibake_without_modifying_message() {
        let message = "[TestBench.iOSFixture] kind=unicode message=‰∏≠Êñá üöÄ";
        let raw =
            format!("Nov  3 21:48:47 Test-iPhone Fixture(UnityFramework)[42] <Notice>: {message}");
        let record = parse_syslog_message(&raw).expect("record");
        assert_eq!(record.encoding_status, EncodingStatus::SuspectedMojibake);
        assert_eq!(record.message, message);
    }

    #[test]
    fn marks_explicit_syslog_truncation_marker() {
        let record = parse_syslog_message(
            "Nov  3 21:48:40 Test-iPhone Fixture(UnityFramework)[42] <Notice>: InvalidOperationException: controlled\n  at Fixture.Throw ()\nUnityEngine.DebugLogHandler:LogException(Exception, Objec<…>",
        )
        .expect("record");
        assert!(record.truncated);
        assert_eq!(record.semantic_level, Some(SemanticLevel::Exception));
    }
}
