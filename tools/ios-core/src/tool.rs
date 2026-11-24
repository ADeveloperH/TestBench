use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

use serde::Deserialize;

use crate::error::{classify_tool_error, ProbeError, ProbeErrorKind};

#[derive(Default)]
struct ToolQueries {
    closing: bool,
    children: Vec<std::sync::Weak<std::sync::Mutex<std::process::Child>>>,
}
static TOOL_QUERIES: std::sync::OnceLock<std::sync::Mutex<ToolQueries>> =
    std::sync::OnceLock::new();

/// 真退出时先禁止新的长查询，再回收本进程持有的查询句柄。
pub fn shutdown_tool_queries() {
    stop_tool_queries(true);
}
pub fn cancel_tool_queries() {
    stop_tool_queries(false);
}
fn stop_tool_queries(closing: bool) {
    let mut queries = TOOL_QUERIES.get_or_init(Default::default).lock().unwrap();
    queries.closing |= closing;
    for weak in queries.children.drain(..) {
        if let Some(child) = weak.upgrade() {
            let mut child = child.lock().unwrap();
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub const SUPPORTED_VERSION: &str = "1.3.2";

#[derive(Debug, Clone)]
pub struct IosTool {
    path: PathBuf,
}

#[derive(Deserialize)]
struct VersionOutput {
    version: String,
}

impl IosTool {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn command(&self) -> Command {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let mut command = Command::new(&self.path);
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            command
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new(&self.path)
        }
    }

    pub fn output(&self, arguments: &[&str]) -> Result<Output, ProbeError> {
        self.command().args(arguments).output().map_err(|error| {
            ProbeError::new(
                ProbeErrorKind::Io,
                format!("无法执行 {}：{error}", self.path.display()),
            )
        })
    }

    pub fn checked_output(&self, arguments: &[&str]) -> Result<Output, ProbeError> {
        let output = self.output(arguments)?;
        if output.status.success() {
            return Ok(output);
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        Err(ProbeError::new(
            classify_tool_error(message),
            format!("go-ios 执行失败：{message}"),
        ))
    }

    /// 应用枚举可能受设备服务阻塞，限定时间与输出并显式回收命令子进程。
    pub fn checked_output_timeout(
        &self,
        arguments: &[&str],
        timeout: std::time::Duration,
    ) -> Result<Vec<u8>, ProbeError> {
        use std::{io::Read, process::Stdio, thread, time::Instant};
        const LIMIT: u64 = 16 * 1024 * 1024;
        let child = {
            let mut queries = TOOL_QUERIES.get_or_init(Default::default).lock().unwrap();
            if queries.closing {
                return Err(ProbeError::new(
                    ProbeErrorKind::Io,
                    "应用正在退出，不能枚举设备应用",
                ));
            }
            let child = self
                .command()
                .args(arguments)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| {
                    ProbeError::new(ProbeErrorKind::Io, format!("无法启动 go-ios：{e}"))
                })?;
            let child = std::sync::Arc::new(std::sync::Mutex::new(child));
            queries.children.retain(|child| child.strong_count() > 0);
            queries.children.push(std::sync::Arc::downgrade(&child));
            child
        };
        let stdout = child.lock().unwrap().stdout.take().unwrap();
        let stderr = child.lock().unwrap().stderr.take().unwrap();
        let read = |stream: Box<dyn Read + Send>| {
            thread::spawn(move || {
                let mut bytes = Vec::new();
                stream
                    .take(LIMIT + 1)
                    .read_to_end(&mut bytes)
                    .map(|_| bytes)
            })
        };
        let out = read(Box::new(stdout));
        let err = read(Box::new(stderr));
        let started = Instant::now();
        let status = loop {
            let next = child.lock().unwrap().try_wait();
            match next {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if started.elapsed() < timeout => {
                    thread::sleep(std::time::Duration::from_millis(20))
                }
                other => {
                    {
                        let mut child = child.lock().unwrap();
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    break Err(ProbeError::new(
                        ProbeErrorKind::Io,
                        if other.is_err() {
                            "等待 go-ios 命令失败"
                        } else {
                            "iOS 应用枚举超时，请解锁设备后刷新"
                        },
                    ));
                }
            }
        };
        let stdout = out
            .join()
            .ok()
            .and_then(Result::ok)
            .ok_or_else(|| ProbeError::new(ProbeErrorKind::Io, "读取应用列表失败"))?;
        let stderr = err
            .join()
            .ok()
            .and_then(Result::ok)
            .ok_or_else(|| ProbeError::new(ProbeErrorKind::Io, "读取应用枚举错误失败"))?;
        let status = status?;
        if stdout.len() as u64 > LIMIT || stderr.len() as u64 > LIMIT {
            return Err(ProbeError::new(
                ProbeErrorKind::OutputParseFailed,
                "iOS 应用枚举输出超过限制",
            ));
        }
        if !status.success() {
            let message =
                String::from_utf8_lossy(if stderr.is_empty() { &stdout } else { &stderr });
            return Err(ProbeError::new(
                classify_tool_error(&message),
                "iOS 应用枚举失败，请检查设备信任、解锁状态后刷新",
            ));
        }
        Ok(stdout)
    }

    pub fn version(&self) -> Result<String, ProbeError> {
        let output = self.checked_output(&["--version"])?;
        let value: VersionOutput = serde_json::from_slice(&output.stdout).map_err(|error| {
            ProbeError::new(
                ProbeErrorKind::ToolVersionUnsupported,
                format!("无法识别 go-ios 版本输出：{error}"),
            )
        })?;
        if value.version != SUPPORTED_VERSION {
            return Err(ProbeError::new(
                ProbeErrorKind::ToolVersionUnsupported,
                format!(
                    "go-ios 版本不匹配：期望 {SUPPORTED_VERSION}，实际 {}",
                    value.version
                ),
            ));
        }
        Ok(value.version)
    }
}

#[cfg(all(test, unix))]
mod query_tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    struct ToolFile(PathBuf);
    impl ToolFile {
        fn new(body: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "testbench-app-query-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            Self(path)
        }
    }
    impl Drop for ToolFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    #[test]
    fn timeout_kills_and_reaps_query_closing_its_pipes() {
        let file = ToolFile::new("exec sleep 5");
        let started = Instant::now();
        let result = IosTool::new(&file.0).checked_output_timeout(&[], Duration::from_millis(80));
        assert_eq!(result.unwrap_err().kind, ProbeErrorKind::Io);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn query_retains_error_class_without_exposing_raw_device_output() {
        let file = ToolFile::new("echo 'not paired SECRET-DEVICE' >&2; exit 1");
        let error = IosTool::new(&file.0)
            .checked_output_timeout(&[], Duration::from_secs(5))
            .unwrap_err();
        assert_eq!(
            error.kind,
            ProbeErrorKind::TrustRequired,
            "{}",
            error.message
        );
        assert!(!error.message.contains("SECRET-DEVICE"));
    }
    #[test]
    fn excessive_query_output_is_rejected_instead_of_allocated_without_limit() {
        let file = ToolFile::new("exec head -c 18000000 /dev/zero");
        let result = IosTool::new(&file.0).checked_output_timeout(&[], Duration::from_secs(2));
        assert_eq!(result.unwrap_err().kind, ProbeErrorKind::OutputParseFailed);
    }
}
