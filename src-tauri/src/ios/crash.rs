use std::{collections::HashSet, fs::File, io::Read, time::Duration};

use chrono::{DateTime, Utc};
use ios_core::{IosTool, ProbeError, ProbeErrorKind};
use serde::{Deserialize, Serialize};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_REPORT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Deserialize)]
struct FileListing {
    files: Option<Vec<String>>,
    #[serde(rename = "length")]
    _length: usize,
}

#[derive(Deserialize)]
struct ReportHeader {
    #[serde(rename = "bundleID")]
    bundle_id: String,
    #[serde(rename = "bug_type")]
    kind: String,
    incident_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportBody {
    incident: String,
    capture_time: String,
    proc_name: String,
    pid: u32,
    bundle_info: BundleInfo,
    exception: Exception,
}

#[derive(Deserialize)]
struct BundleInfo {
    #[serde(rename = "CFBundleIdentifier")]
    identifier: String,
}

#[derive(Deserialize)]
struct Exception {
    #[serde(rename = "type")]
    kind: String,
    signal: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosCrashReport {
    incident_id: String,
    captured_at: i64,
    pid: u32,
    process: String,
    bundle_id: String,
}

pub(super) struct CrashWatch {
    pub(super) session_id: String,
    files: HashSet<String>,
    incidents: HashSet<String>,
    reports: Vec<IosCrashReport>,
}

impl CrashWatch {
    pub(super) fn new(session_id: String) -> Self {
        Self {
            session_id,
            files: HashSet::new(),
            incidents: HashSet::new(),
            reports: Vec::new(),
        }
    }

    pub(super) fn scan(
        &mut self,
        tool: &IosTool,
        udid: &str,
        bundle_id: &str,
        process: &str,
        started_at: i64,
    ) -> Result<Vec<IosCrashReport>, ProbeError> {
        let pattern = format!("{process}-*.ips");
        let listing = tool
            .checked_output_timeout(&["--udid", udid, "crash", "ls", &pattern], COMMAND_TIMEOUT)?;
        let mut names = String::from_utf8_lossy(&listing)
            .lines()
            .rev()
            .find_map(|line| serde_json::from_str::<FileListing>(line).ok())
            .ok_or_else(|| {
                ProbeError::new(
                    ProbeErrorKind::OutputParseFailed,
                    "无法读取 iOS 崩溃报告列表",
                )
            })?
            .files
            .unwrap_or_default();
        names.sort_unstable_by(|a, b| b.cmp(a));

        let mut attempted = 0;
        for name in names {
            if !valid_name(&name, process) || self.files.contains(&name) {
                continue;
            }
            attempted += 1;
            if attempted > 2 {
                break;
            }
            let dir = tempfile::tempdir().map_err(|error| {
                ProbeError::new(
                    ProbeErrorKind::Io,
                    format!("无法创建临时崩溃报告目录：{error}"),
                )
            })?;
            let Some(destination) = dir.path().to_str() else {
                continue;
            };
            if tool
                .checked_output_timeout(
                    &["--udid", udid, "crash", "cp", &name, destination],
                    COMMAND_TIMEOUT,
                )
                .is_err()
            {
                continue;
            }
            let path = dir.path().join(&name);
            let Ok(metadata) = path.symlink_metadata() else {
                continue;
            };
            self.files.insert(name);
            if !metadata.file_type().is_file() || metadata.len() > MAX_REPORT_BYTES {
                continue;
            }
            let Ok(file) = File::open(path) else { continue };
            let mut contents = String::new();
            if file
                .take(MAX_REPORT_BYTES + 1)
                .read_to_string(&mut contents)
                .is_err()
                || contents.len() as u64 > MAX_REPORT_BYTES
            {
                continue;
            }
            if let Some(report) = parse_report(
                &contents,
                bundle_id,
                process,
                started_at,
                Utc::now().timestamp_millis(),
            ) {
                if self.incidents.insert(report.incident_id.clone()) {
                    self.reports.push(report);
                }
            }
        }
        Ok(self.reports.clone())
    }
}

fn valid_name(name: &str, process: &str) -> bool {
    name.strip_prefix(process)
        .and_then(|rest| rest.strip_prefix('-'))
        .and_then(|rest| rest.strip_suffix(".ips"))
        .is_some_and(|stamp| {
            stamp.len() == 17 && stamp.bytes().all(|c| c == b'-' || c.is_ascii_digit())
        })
}

fn parse_report(
    contents: &str,
    bundle_id: &str,
    process: &str,
    started_at: i64,
    now: i64,
) -> Option<IosCrashReport> {
    let (header, body) = contents.split_once('\n')?;
    let header: ReportHeader = serde_json::from_str(header).ok()?;
    let body: ReportBody = serde_json::from_str(body).ok()?;
    let captured_at = DateTime::parse_from_str(&body.capture_time, "%Y-%m-%d %H:%M:%S%.f %z")
        .ok()?
        .timestamp_millis();
    if header.kind != "309"
        || header.bundle_id != bundle_id
        || body.bundle_info.identifier != bundle_id
        || body.proc_name != process
        || !(started_at..=now).contains(&captured_at)
        || body.pid == 0
        || body.incident != header.incident_id
        || body.incident.len() != 36
        || !body
            .incident
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
        || body.exception.kind != "EXC_CRASH"
        || body.exception.signal != "SIGABRT"
    {
        return None;
    }
    Some(IosCrashReport {
        incident_id: body.incident.to_ascii_uppercase(),
        captured_at,
        pid: body.pid,
        process: body.proc_name,
        bundle_id: body.bundle_info.identifier,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matches_only_target_bundle_process_time_and_explicit_crash_signal() {
        let incident = "12ab5678-f0ee-1234-abcd-123456789abc";
        let header =
            json!({ "bundleID": "com.test.app", "bug_type": "309", "incident_id": incident });
        let mut body = json!({
            "incident": incident,
            "captureTime": "2026-11-23 18:13:08.0944 +0800",
            "procName": "Fixture",
            "pid": 123,
            "bundleInfo": { "CFBundleIdentifier": "com.test.app" },
            "exception": { "type": "EXC_CRASH", "signal": "SIGABRT" },
        });
        let capture = DateTime::parse_from_rfc3339("2026-11-23T10:13:08.094Z")
            .unwrap()
            .timestamp_millis();
        let read = |body: &serde_json::Value, bundle, process, start, now| {
            parse_report(&format!("{header}\n{body}"), bundle, process, start, now)
        };
        assert_eq!(
            read(&body, "com.test.app", "Fixture", capture, capture)
                .unwrap()
                .pid,
            123
        );
        assert!(read(&body, "com.test.other", "Fixture", capture, capture).is_none());
        assert!(read(&body, "com.test.app", "Other", capture, capture).is_none());
        assert!(read(&body, "com.test.app", "Fixture", capture + 1, capture + 10).is_none());
        assert!(read(&body, "com.test.app", "Fixture", capture - 10, capture - 1).is_none());
        body["exception"]["signal"] = json!("SIGKILL");
        assert!(read(&body, "com.test.app", "Fixture", capture, capture).is_none());
        assert!(valid_name("Fixture-2026-11-23-181308.ips", "Fixture"));
        assert!(!valid_name("Fixture-2026-11-23-18130?.ips", "Fixture"));
        assert!(!valid_name(
            "Retired/Fixture-2026-11-23-181308.ips",
            "Fixture"
        ));
    }
}
