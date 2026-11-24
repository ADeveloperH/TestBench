use std::{
    io::{BufRead, BufReader},
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};

use ios_core::{classify_tool_error, parse_envelope, IosTool, ProbeError, ProbeErrorKind};

pub fn stream_logs(
    tool: &IosTool,
    udid: &str,
    process_filter: Option<&str>,
) -> Result<(), ProbeError> {
    let mut child = tool
        .command()
        .args(["--udid", udid, "syslog"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ProbeError::new(
                ProbeErrorKind::Io,
                format!("无法启动 go-ios syslog：{error}"),
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ProbeError::new(ProbeErrorKind::Io, "无法读取 go-ios stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ProbeError::new(ProbeErrorKind::Io, "无法读取 go-ios stderr"))?;

    let child = Arc::new(Mutex::new(child));
    let manual_stop = Arc::new(AtomicBool::new(false));
    install_ctrl_c_handler(Arc::clone(&child), Arc::clone(&manual_stop))?;

    let stderr_thread = thread::spawn(move || {
        let mut collected = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                eprintln!("[go-ios] {line}");
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    let filter = process_filter.map(str::to_ascii_lowercase);
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|error| {
            ProbeError::new(ProbeErrorKind::Io, format!("读取 syslog 失败：{error}"))
        })?;
        let Some(record) = parse_envelope(&line) else {
            continue;
        };
        if filter
            .as_ref()
            .is_some_and(|expected| !record.process.to_ascii_lowercase().starts_with(expected))
        {
            continue;
        }
        println!(
            "{}",
            serde_json::to_string(&record).map_err(|error| {
                ProbeError::new(
                    ProbeErrorKind::OutputParseFailed,
                    format!("日志序列化失败：{error}"),
                )
            })?
        );
    }

    let status = child
        .lock()
        .map_err(|_| ProbeError::new(ProbeErrorKind::Io, "日志进程锁已损坏"))?
        .wait()
        .map_err(|error| {
            ProbeError::new(ProbeErrorKind::Io, format!("等待日志进程失败：{error}"))
        })?;
    let stderr = stderr_thread.join().unwrap_or_default();

    if manual_stop.load(Ordering::SeqCst) || status.success() {
        return Ok(());
    }
    Err(ProbeError::new(
        classify_tool_error(&stderr),
        format!("go-ios syslog 异常退出：{status}"),
    ))
}

fn install_ctrl_c_handler(
    child: Arc<Mutex<Child>>,
    manual_stop: Arc<AtomicBool>,
) -> Result<(), ProbeError> {
    ctrlc::set_handler(move || {
        manual_stop.store(true, Ordering::SeqCst);
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    })
    .map_err(|error| {
        ProbeError::new(
            ProbeErrorKind::Io,
            format!("无法注册 Ctrl+C 处理器：{error}"),
        )
    })
}
