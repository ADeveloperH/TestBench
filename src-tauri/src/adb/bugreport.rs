//! 生成 Android Bugreport，并从报告中提取 ANR / Java Crash / Native Crash 线索。

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

use super::adb_command;

const DIAGNOSTIC_LIMIT: usize = 64 * 1024;
const EMBEDDED_FILE_LIMIT: u64 = 2 * 1024 * 1024;
const EMBEDDED_TOTAL_LIMIT: u64 = 20 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BugreportProgress {
    pub stage: String,
    pub percent: Option<u8>,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BugreportResult {
    pub report_path: String,
    pub summary_path: Option<String>,
    pub size_bytes: u64,
    pub anr_matches: usize,
    pub java_crash_matches: usize,
    pub native_crash_matches: usize,
    pub warning: Option<String>,
}

#[derive(Clone, Default)]
pub struct BugreportController {
    child: Arc<Mutex<Option<Child>>>,
}

impl BugreportController {
    pub fn is_running(&self) -> bool {
        self.child.lock().unwrap().is_some()
    }

    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
            log::info!("已停止正在生成的 Bugreport");
        }
    }

    pub fn generate<F>(
        &self,
        device: Option<&str>,
        output_path: &Path,
        on_progress: F,
    ) -> Result<BugreportResult, String>
    where
        F: Fn(BugreportProgress) + Send + Sync + 'static,
    {
        {
            let guard = self.child.lock().unwrap();
            if guard.is_some() {
                return Err("已有故障报告正在生成，请稍候".to_string());
            }
        }

        let progress: Arc<dyn Fn(BugreportProgress) + Send + Sync> = Arc::new(on_progress);
        progress(BugreportProgress {
            stage: "generating".into(),
            percent: None,
            message: "设备正在生成故障报告，可能需要几分钟…".into(),
        });

        let mut command = adb_command();
        if let Some(serial) = device.filter(|value| !value.is_empty()) {
            command.args(["-s", serial]);
        }
        command
            .arg("bugreport")
            .arg(output_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        log::info!(
            "开始生成 Bugreport：device={:?} output={}",
            device,
            output_path.display()
        );
        let mut child = command
            .spawn()
            .map_err(|e| format!("无法启动 adb bugreport：{e}"))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *self.child.lock().unwrap() = Some(child);

        let diagnostics = Arc::new(Mutex::new(String::new()));
        let mut readers = Vec::new();
        if let Some(stream) = stdout {
            readers.push(spawn_output_reader(
                stream,
                progress.clone(),
                diagnostics.clone(),
            ));
        }
        if let Some(stream) = stderr {
            readers.push(spawn_output_reader(
                stream,
                progress.clone(),
                diagnostics.clone(),
            ));
        }

        let status = loop {
            let polled = {
                let mut guard = self.child.lock().unwrap();
                let Some(child) = guard.as_mut() else {
                    return Err("故障报告生成已取消".to_string());
                };
                match child.try_wait() {
                    Ok(status) => status,
                    Err(error) => {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                        return Err(format!("等待 adb bugreport 失败：{error}"));
                    }
                }
            };
            if let Some(status) = polled {
                self.child.lock().unwrap().take();
                break status;
            }
            std::thread::sleep(Duration::from_millis(100));
        };

        for reader in readers {
            let _ = reader.join();
        }
        let diagnostic_text = diagnostics.lock().unwrap().trim().to_string();
        if !status.success() {
            let detail = if diagnostic_text.is_empty() {
                format!("退出码 {:?}", status.code())
            } else {
                diagnostic_text
            };
            return Err(format!("adb bugreport 执行失败：{detail}"));
        }

        let metadata = std::fs::metadata(output_path)
            .map_err(|e| format!("故障报告未生成或无法读取：{e}"))?;
        if metadata.len() == 0 {
            return Err("故障报告为空，请重新尝试".to_string());
        }

        progress(BugreportProgress {
            stage: "analyzing".into(),
            percent: Some(96),
            message: "报告已生成，正在提取 ANR 与 Crash 线索…".into(),
        });

        let summary_path = summary_path_for(output_path);
        let (summary, stats, warning) = match build_summary(output_path, &summary_path, device) {
            Ok(stats) => (Some(summary_path.display().to_string()), stats, None),
            Err(error) => {
                log::warn!("Bugreport 已生成，但摘要提取失败：{error}");
                let _ = std::fs::remove_file(&summary_path);
                (
                    None,
                    SummaryStats::default(),
                    Some(format!("完整报告已保存，但摘要提取失败：{error}")),
                )
            }
        };

        progress(BugreportProgress {
            stage: "complete".into(),
            percent: Some(100),
            message: "故障报告导出完成".into(),
        });

        Ok(BugreportResult {
            report_path: output_path.display().to_string(),
            summary_path: summary,
            size_bytes: metadata.len(),
            anr_matches: stats.anr,
            java_crash_matches: stats.java_crash,
            native_crash_matches: stats.native_crash,
            warning,
        })
    }
}

fn spawn_output_reader<R>(
    mut stream: R,
    progress: Arc<dyn Fn(BugreportProgress) + Send + Sync>,
    diagnostics: Arc<Mutex<String>>,
) -> std::thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut chunk = [0_u8; 1024];
        let mut line = Vec::new();
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(size) => {
                    for byte in &chunk[..size] {
                        if *byte == b'\n' || *byte == b'\r' {
                            if !line.is_empty() {
                                handle_adb_output(&line, &progress, &diagnostics);
                                line.clear();
                            }
                        } else {
                            line.push(*byte);
                        }
                    }
                }
                Err(error) => {
                    log::debug!("读取 adb bugreport 输出结束：{error}");
                    break;
                }
            }
        }
        if !line.is_empty() {
            handle_adb_output(&line, &progress, &diagnostics);
        }
    })
}

fn handle_adb_output(
    bytes: &[u8],
    progress: &Arc<dyn Fn(BugreportProgress) + Send + Sync>,
    diagnostics: &Arc<Mutex<String>>,
) {
    let line = String::from_utf8_lossy(bytes).trim().to_string();
    if line.is_empty() {
        return;
    }
    log::debug!("adb bugreport：{line}");
    append_diagnostic(diagnostics, &line);
    if let Some(event) = parse_progress(&line) {
        progress(event);
    }
}

fn append_diagnostic(diagnostics: &Arc<Mutex<String>>, line: &str) {
    let mut text = diagnostics.lock().unwrap();
    if text.len() >= DIAGNOSTIC_LIMIT {
        return;
    }
    let remaining = DIAGNOSTIC_LIMIT - text.len();
    let part = if line.len() > remaining {
        let boundary = line
            .char_indices()
            .map(|(index, _)| index)
            .take_while(|index| *index <= remaining)
            .last()
            .unwrap_or(0);
        &line[..boundary]
    } else {
        line
    };
    text.push_str(part);
    text.push('\n');
}

fn parse_progress(line: &str) -> Option<BugreportProgress> {
    let percent_index = line.find('%')?;
    let digits = line[..percent_index]
        .chars()
        .rev()
        .take_while(|ch| ch.is_ascii_digit() || ch.is_ascii_whitespace())
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let raw = digits.trim().parse::<u8>().ok()?.min(100);
    let lower = line.to_ascii_lowercase();
    let pulling = lower.contains("pull") || lower.contains("copy");
    let (stage, percent, message) = if pulling {
        (
            "pulling",
            90_u8.saturating_add(raw / 10),
            "正在从设备复制故障报告…",
        )
    } else {
        (
            "generating",
            ((raw as u16 * 90) / 100) as u8,
            "设备正在生成故障报告…",
        )
    };
    Some(BugreportProgress {
        stage: stage.into(),
        percent: Some(percent),
        message: message.into(),
    })
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct SummaryStats {
    anr: usize,
    java_crash: usize,
    native_crash: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IncidentKind {
    Anr,
    JavaCrash,
    NativeCrash,
}

impl IncidentKind {
    fn label(self) -> &'static str {
        match self {
            Self::Anr => "ANR",
            Self::JavaCrash => "Java Crash",
            Self::NativeCrash => "Native Crash",
        }
    }
}

fn classify_incident(line: &str) -> Option<IncidentKind> {
    let lower = line.to_ascii_lowercase();
    if lower.contains("am_anr")
        || lower.contains("anr in ")
        || lower.contains("vm traces at last anr")
        || lower.contains("data_app_anr")
    {
        Some(IncidentKind::Anr)
    } else if lower.contains("fatal exception")
        || lower.contains("am_crash")
        || lower.contains("data_app_crash")
    {
        Some(IncidentKind::JavaCrash)
    } else if lower.contains("tombstone written to")
        || lower.contains("native crash")
        || lower.starts_with("*** *** *** *** ***")
        || (lower.contains("signal 6") && lower.contains("sigabrt"))
        || (lower.contains("signal 11") && lower.contains("sigsegv"))
    {
        Some(IncidentKind::NativeCrash)
    } else {
        None
    }
}

fn build_summary(
    report_path: &Path,
    summary_path: &Path,
    device: Option<&str>,
) -> Result<SummaryStats, String> {
    let file = File::open(report_path).map_err(|e| format!("打开完整报告失败：{e}"))?;
    let mut body = Vec::new();
    let mut stats = SummaryStats::default();

    match zip::ZipArchive::new(file) {
        Ok(mut archive) => {
            let main_index = find_main_report(&mut archive)?;
            {
                let main = archive
                    .by_index(main_index)
                    .map_err(|e| format!("读取主报告失败：{e}"))?;
                writeln!(body, "===== 主报告中的 ANR / Crash 上下文 =====\n")
                    .map_err(|e| e.to_string())?;
                scan_report(BufReader::new(main), &mut body, &mut stats)?;
            }
            append_embedded_reports(&mut archive, main_index, &mut body, &mut stats)?;
        }
        Err(_) => {
            let file = File::open(report_path).map_err(|e| format!("打开文本报告失败：{e}"))?;
            writeln!(body, "===== 报告中的 ANR / Crash 上下文 =====\n")
                .map_err(|e| e.to_string())?;
            scan_report(BufReader::new(file), &mut body, &mut stats)?;
        }
    }

    let mut output = File::create(summary_path).map_err(|e| format!("创建摘要失败：{e}"))?;
    writeln!(output, "TestBench Android 故障报告摘要")
        .map_err(|e| format!("写入摘要失败：{e}"))?;
    writeln!(output, "生成时间：{}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))
        .map_err(|e| format!("写入摘要失败：{e}"))?;
    writeln!(output, "设备：{}", device.unwrap_or("默认设备"))
        .map_err(|e| format!("写入摘要失败：{e}"))?;
    writeln!(output, "完整报告：{}", report_path.display())
        .map_err(|e| format!("写入摘要失败：{e}"))?;
    writeln!(output, "ANR 线索：{}", stats.anr).map_err(|e| e.to_string())?;
    writeln!(output, "Java Crash 线索：{}", stats.java_crash).map_err(|e| e.to_string())?;
    writeln!(output, "Native Crash 线索：{}", stats.native_crash).map_err(|e| e.to_string())?;
    writeln!(output, "\n说明：此文件用于快速定位，最终结论请以完整 Bugreport 为准。\n")
        .map_err(|e| e.to_string())?;
    output
        .write_all(&body)
        .map_err(|e| format!("写入摘要内容失败：{e}"))?;
    Ok(stats)
}

fn find_main_report(archive: &mut zip::ZipArchive<File>) -> Result<usize, String> {
    let mut preferred = None;
    let mut largest_txt: Option<(usize, u64)> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| format!("检查报告条目失败：{e}"))?;
        let name = entry.name().replace('\\', "/");
        let base = name.rsplit('/').next().unwrap_or(&name).to_ascii_lowercase();
        if base.starts_with("bugreport-") && base.ends_with(".txt") {
            preferred = Some(index);
            break;
        }
        if base.ends_with(".txt")
            && largest_txt
                .map(|(_, size)| entry.size() > size)
                .unwrap_or(true)
        {
            largest_txt = Some((index, entry.size()));
        }
    }
    preferred
        .or_else(|| largest_txt.map(|(index, _)| index))
        .ok_or_else(|| "压缩包中未找到 Bugreport 主文本".to_string())
}

fn scan_report<R: BufRead>(
    mut reader: R,
    output: &mut Vec<u8>,
    stats: &mut SummaryStats,
) -> Result<(), String> {
    let mut previous = VecDeque::<String>::with_capacity(5);
    let mut remaining = 0_usize;
    let mut active_kind = None;
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|e| format!("扫描报告失败：{e}"))?;
        if read == 0 {
            break;
        }

        if let Some(kind) = classify_incident(&line) {
            let is_new = active_kind != Some(kind) || remaining < 80;
            if is_new {
                match kind {
                    IncidentKind::Anr => stats.anr += 1,
                    IncidentKind::JavaCrash => stats.java_crash += 1,
                    IncidentKind::NativeCrash => stats.native_crash += 1,
                }
                writeln!(output, "\n----- {} 线索 -----", kind.label())
                    .map_err(|e| e.to_string())?;
                for context in &previous {
                    output.write_all(context.as_bytes()).map_err(|e| e.to_string())?;
                }
            }
            active_kind = Some(kind);
            remaining = 160;
        }

        if remaining > 0 {
            output.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
            remaining -= 1;
            if remaining == 0 {
                active_kind = None;
            }
        }

        if previous.len() == 5 {
            previous.pop_front();
        }
        previous.push_back(line.clone());
    }
    if stats == &SummaryStats::default() {
        writeln!(output, "未在主报告中识别到明确的 ANR 或 Crash 事件。")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn append_embedded_reports(
    archive: &mut zip::ZipArchive<File>,
    main_index: usize,
    output: &mut Vec<u8>,
    stats: &mut SummaryStats,
) -> Result<(), String> {
    let mut indexes = Vec::new();
    for index in 0..archive.len() {
        if index == main_index {
            continue;
        }
        let entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let lower = entry.name().replace('\\', "/").to_ascii_lowercase();
        if is_relevant_embedded_name(&lower) && !entry.is_dir() {
            indexes.push(index);
            if indexes.len() >= 20 {
                break;
            }
        }
    }

    let mut total = 0_u64;
    for index in indexes {
        if total >= EMBEDDED_TOTAL_LIMIT {
            break;
        }
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let limit = entry
            .size()
            .min(EMBEDDED_FILE_LIMIT)
            .min(EMBEDDED_TOTAL_LIMIT - total);
        if limit == 0 {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if lower.contains("anr") {
            stats.anr += 1;
        } else if lower.contains("tombstone") {
            stats.native_crash += 1;
        } else if lower.contains("crash") {
            stats.java_crash += 1;
        }
        writeln!(output, "\n===== 内嵌报告：{name} =====").map_err(|e| e.to_string())?;
        let mut limited = (&mut entry).take(limit);
        std::io::copy(&mut limited, output).map_err(|e| format!("读取内嵌报告失败：{e}"))?;
        writeln!(output).map_err(|e| e.to_string())?;
        total += limit;
    }
    Ok(())
}

fn is_relevant_embedded_name(name: &str) -> bool {
    name.contains("/anr/")
        || name.contains("fs/data/anr")
        || name.contains("/tombstones/")
        || name.contains("fs/data/tombstones")
        || (name.contains("dropbox")
            && (name.contains("anr") || name.contains("crash") || name.contains("tombstone")))
}

fn summary_path_for(report_path: &Path) -> PathBuf {
    let stem = report_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("bugreport");
    report_path.with_file_name(format!("{stem}-anr-crash.txt"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_progress() {
        let progress = parse_progress("[ 50%] generating bugreport").unwrap();
        assert_eq!(progress.stage, "generating");
        assert_eq!(progress.percent, Some(45));

        let progress = parse_progress("[ 80%] pulling bugreport").unwrap();
        assert_eq!(progress.stage, "pulling");
        assert_eq!(progress.percent, Some(98));
    }

    #[test]
    fn recognizes_incident_markers() {
        assert_eq!(classify_incident("ANR in com.demo"), Some(IncidentKind::Anr));
        assert_eq!(
            classify_incident("FATAL EXCEPTION: main"),
            Some(IncidentKind::JavaCrash)
        );
        assert_eq!(
            classify_incident("signal 11 (SIGSEGV), code 1"),
            Some(IncidentKind::NativeCrash)
        );
    }

    #[test]
    fn scans_context_around_incident() {
        let input = b"before one\nbefore two\nFATAL EXCEPTION: main\njava.lang.IllegalStateException\nafter\n";
        let mut output = Vec::new();
        let mut stats = SummaryStats::default();
        scan_report(BufReader::new(&input[..]), &mut output, &mut stats).unwrap();
        assert_eq!(stats.java_crash, 1);
        let text = String::from_utf8(output).unwrap();
        assert!(text.contains("before two"));
        assert!(text.contains("IllegalStateException"));
    }
}
