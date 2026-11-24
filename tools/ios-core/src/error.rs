use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeError {
    pub kind: ProbeErrorKind,
    pub message: String,
}

impl ProbeError {
    pub fn new(kind: ProbeErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for ProbeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.kind.as_str(), self.message)
    }
}

impl std::error::Error for ProbeError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum ProbeErrorKind {
    InvalidArguments,
    ToolNotFound,
    InstallationDamaged,
    ToolVersionUnsupported,
    AppleServiceMissing,
    NoDevice,
    TrustRequired,
    DeviceLocked,
    PairingInvalid,
    DeviceDisconnected,
    ToolExited,
    OutputParseFailed,
    Io,
}

impl ProbeErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArguments => "InvalidArguments",
            Self::ToolNotFound => "ToolNotFound",
            Self::InstallationDamaged => "InstallationDamaged",
            Self::ToolVersionUnsupported => "ToolVersionUnsupported",
            Self::AppleServiceMissing => "AppleServiceMissing",
            Self::NoDevice => "NoDevice",
            Self::TrustRequired => "TrustRequired",
            Self::DeviceLocked => "DeviceLocked",
            Self::PairingInvalid => "PairingInvalid",
            Self::DeviceDisconnected => "DeviceDisconnected",
            Self::ToolExited => "ToolExited",
            Self::OutputParseFailed => "OutputParseFailed",
            Self::Io => "Io",
        }
    }
}

pub fn classify_tool_error(message: &str) -> ProbeErrorKind {
    let lower = message.to_ascii_lowercase();
    if lower.contains("usbmuxd")
        && (lower.contains("no such file")
            || lower.contains("connection refused")
            || lower.contains("cannot find"))
    {
        ProbeErrorKind::AppleServiceMissing
    } else if lower.contains("invalid hostid")
        || lower.contains("pair record")
        || lower.contains("readpair failed")
        || lower.contains("is the device paired")
    {
        ProbeErrorKind::PairingInvalid
    } else if lower.contains("password protected") || lower.contains("device is locked") {
        ProbeErrorKind::DeviceLocked
    } else if lower.contains("not paired")
        || lower.contains("trust")
        || lower.contains("user denied")
    {
        ProbeErrorKind::TrustRequired
    } else if lower.contains("no device") || lower.contains("device not found") {
        ProbeErrorKind::NoDevice
    } else if lower.contains("closed network connection")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || (lower.contains("failed reading syslog") && lower.contains("eof"))
    {
        ProbeErrorKind::DeviceDisconnected
    } else {
        ProbeErrorKind::ToolExited
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_tool_error, ProbeErrorKind};

    #[test]
    fn classifies_syslog_eof_as_device_disconnect() {
        let message = r#"{"level":"ERROR","msg":"failed reading syslog","err":"EOF"}"#;
        assert_eq!(
            classify_tool_error(message),
            ProbeErrorKind::DeviceDisconnected
        );
    }

    #[test]
    fn classifies_read_pair_failure_as_pairing_invalid() {
        let message = "could not retrieve PairRecord with error: ReadPair failed with errorcode '2', is the device paired?";
        assert_eq!(classify_tool_error(message), ProbeErrorKind::PairingInvalid);
    }
}
