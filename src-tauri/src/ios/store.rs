use std::{
    fs::{create_dir_all, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use ios_core::IosLogRecord;
use serde::Serialize;

const SEGMENT_LIMIT_BYTES: u64 = 50 * 1024 * 1024;
const FLUSH_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMetadata<'a> {
    created_at_unix_ms: u128,
    platform: &'static str,
    device_display_id: &'a str,
    tool_version: &'a str,
    process_filter: Option<&'a str>,
    process_filter_match: &'static str,
    format: &'static str,
}

pub struct IosSessionWriter {
    dir: PathBuf,
    segment: u32,
    bytes: u64,
    file: BufWriter<File>,
    last_flush: Instant,
}

impl IosSessionWriter {
    pub fn start(
        app_data_dir: &Path,
        device_display_id: &str,
        tool_version: &str,
        process_filter: Option<&str>,
        exact_process: bool,
    ) -> Result<Self, String> {
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("获取 iOS 日志会话时间失败：{error}"))?;
        let dir = app_data_dir
            .join("log-sessions")
            .join("ios")
            .join(created.as_nanos().to_string());
        create_dir_all(&dir).map_err(|error| format!("创建 iOS 日志会话目录失败：{error}"))?;

        let metadata = SessionMetadata {
            created_at_unix_ms: created.as_millis(),
            platform: std::env::consts::OS,
            device_display_id,
            tool_version,
            process_filter,
            process_filter_match: if process_filter.is_none() { "all" } else if exact_process { "exact" } else { "prefix" },
            format: "ios-log-record-jsonl-v1",
        };
        let metadata_json = serde_json::to_vec_pretty(&metadata)
            .map_err(|error| format!("序列化 iOS 会话元数据失败：{error}"))?;
        std::fs::write(dir.join("metadata.json"), metadata_json)
            .map_err(|error| format!("写入 iOS 会话元数据失败：{error}"))?;
        let file = open_segment(&dir, 0)?;

        Ok(Self {
            dir,
            segment: 0,
            bytes: 0,
            file: BufWriter::new(file),
            last_flush: Instant::now(),
        })
    }

    pub fn append(&mut self, record: &IosLogRecord) -> Result<(), String> {
        let line = serde_json::to_vec(record)
            .map_err(|error| format!("序列化 iOS 日志记录失败：{error}"))?;
        let bytes = line.len() as u64 + 1;
        if self.bytes > 0 && self.bytes + bytes > SEGMENT_LIMIT_BYTES {
            self.file
                .flush()
                .map_err(|error| format!("刷新 iOS 日志分段失败：{error}"))?;
            self.segment += 1;
            self.file = BufWriter::new(open_segment(&self.dir, self.segment)?);
            self.bytes = 0;
        }
        self.file
            .write_all(&line)
            .and_then(|_| self.file.write_all(b"\n"))
            .map_err(|error| format!("写入 iOS 日志记录失败：{error}"))?;
        self.bytes += bytes;

        if self.last_flush.elapsed() >= FLUSH_INTERVAL {
            self.flush()?;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> Result<(), String> {
        self.file
            .flush()
            .map_err(|error| format!("刷新 iOS 日志会话失败：{error}"))?;
        self.last_flush = Instant::now();
        Ok(())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

fn open_segment(dir: &Path, segment: u32) -> Result<File, String> {
    File::create(dir.join(format!("records-{segment:04}.jsonl")))
        .map_err(|error| format!("创建 iOS 日志分段失败：{error}"))
}

/// 仅对已停止且完成刷新写入的会话调用，不把完整历史加载到内存。
pub fn export_archive(dir: &Path, destination: &Path, status: &[u8]) -> Result<(), String> {
    let source_dir = dir
        .canonicalize()
        .map_err(|e| format!("读取 iOS 会话目录失败：{e}"))?;
    let parent = destination
        .parent()
        .ok_or("导出文件缺少目标目录")?
        .canonicalize()
        .map_err(|e| format!("读取导出目标目录失败：{e}"))?;
    if parent.starts_with(&source_dir) {
        return Err("不能将导出文件保存到原始 iOS 会话目录内".into());
    }
    let mut numbered_segments = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    numbered_segments.retain(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("records-") && name.ends_with(".jsonl"))
    });
    let mut numbered_segments = numbered_segments
        .into_iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy();
            let index = name
                .strip_prefix("records-")
                .unwrap()
                .strip_suffix(".jsonl")
                .unwrap()
                .parse::<u32>()
                .map_err(|_| format!("iOS 日志分段名称无效：{name}"))?;
            Ok((index, path))
        })
        .collect::<Result<Vec<_>, String>>()?;
    numbered_segments.sort_by_key(|(index, _)| *index);
    if numbered_segments.is_empty()
        || numbered_segments
            .iter()
            .enumerate()
            .any(|(expected, (index, _))| expected as u64 != u64::from(*index))
    {
        return Err("iOS 日志分段缺失或编号重复，无法导出完整会话".into());
    }
    let mut segments = numbered_segments
        .into_iter()
        .map(|(_, path)| path)
        .collect::<Vec<_>>();
    segments.insert(0, dir.join("metadata.json"));
    let mut output = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("创建导出临时文件失败：{e}"))?;
    write_archive(&mut output, &segments, status)?;
    output
        .as_file()
        .sync_all()
        .map_err(|e| format!("刷新导出文件失败：{e}"))?;
    output
        .persist(destination)
        .map_err(|e| format!("保存导出文件失败，原目标保持不变：{}", e.error))?;
    Ok(())
}

fn write_archive<W: Write + std::io::Seek>(
    output: W,
    segments: &[PathBuf],
    status: &[u8],
) -> Result<(), String> {
    let mut archive = zip::ZipWriter::new(output);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for path in segments {
        let mut input = File::open(path)
            .map_err(|e| format!("读取 iOS 会话文件 {} 失败：{e}", path.display()))?;
        archive
            .start_file(path.file_name().unwrap().to_string_lossy(), options)
            .map_err(|e| format!("写入 ZIP 分段失败：{}", zip_error(e)))?;
        std::io::copy(&mut input, &mut archive)
            .map_err(|e| format!("导出 iOS 日志分段失败：{e}"))?;
    }
    archive
        .start_file("export-status.json", options)
        .map_err(|e| format!("写入 ZIP 状态失败：{}", zip_error(e)))?;
    archive
        .write_all(status)
        .map_err(|e| format!("写入 ZIP 状态失败：{e}"))?;
    archive
        .finish()
        .map_err(|e| format!("完成 ZIP 文件失败：{}", zip_error(e)))?;
    Ok(())
}

fn zip_error(error: zip::result::ZipError) -> String {
    match error {
        zip::result::ZipError::Io(error) => error.to_string(),
        error => error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::IosSessionWriter;
    use ios_core::{EncodingStatus, IosLogRecord};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn large_session_rotates_at_real_limit_and_exports_all_bytes() {
        use std::io::Read;
        let root = tempfile::tempdir().unwrap();
        let mut writer = IosSessionWriter::start(root.path(), "masked", "1.3.2", None, false).unwrap();
        let text = "x".repeat(1024 * 1024);
        let record = IosLogRecord {
            timestamp: "Nov 6 12:00:00".into(),
            device: "Fixture".into(),
            process: "Fixture".into(),
            module: None,
            pid: Some(42),
            level: "notice".into(),
            semantic_level: None,
            semantic_level_source: None,
            encoding_status: EncodingStatus::Valid,
            truncated: false,
            message: text.clone(),
            raw: text,
        };
        for _ in 0..27 {
            writer.append(&record).unwrap();
        }
        writer.flush().unwrap();
        let dir = writer.dir().to_owned();
        drop(writer);
        assert!(dir.join("records-0001.jsonl").exists());
        assert!(
            std::fs::metadata(dir.join("records-0000.jsonl"))
                .unwrap()
                .len()
                <= super::SEGMENT_LIMIT_BYTES
        );
        let target = root.path().join("大文件会话.zip");
        super::export_archive(&dir, &target, b"{\"receivedCount\":27}").unwrap();
        let mut zip = zip::ZipArchive::new(std::fs::File::open(target).unwrap()).unwrap();
        let mut total = 0u64;
        let mut lines = 0;
        for name in ["records-0000.jsonl", "records-0001.jsonl"] {
            let mut source = std::fs::File::open(dir.join(name)).unwrap();
            let mut exported = zip.by_name(name).unwrap();
            let mut chunk = [0u8; 65536];
            let mut original = [0u8; 65536];
            loop {
                let n = exported.read(&mut chunk).unwrap();
                if n == 0 {
                    break;
                }
                source.read_exact(&mut original[..n]).unwrap();
                assert_eq!(&chunk[..n], &original[..n]);
                total += n as u64;
                lines += chunk[..n].iter().filter(|byte| **byte == b'\n').count();
            }
            assert_eq!(source.read(&mut original).unwrap(), 0);
        }
        assert!(total > super::SEGMENT_LIMIT_BYTES);
        assert_eq!(lines, 27);
    }

    #[test]
    fn failed_export_preserves_target_and_cleans_temporary_files() {
        let root = tempfile::tempdir().unwrap();
        let mut writer = IosSessionWriter::start(root.path(), "masked", "1.3.2", None, false).unwrap();
        writer.flush().unwrap();
        let dir = writer.dir().to_owned();
        drop(writer);
        let target = root.path().join("existing.zip");
        std::fs::write(&target, b"original archive").unwrap();
        // 在已写入 metadata 后读取分段失败，覆盖原文件仍必须安全。
        std::fs::remove_file(dir.join("records-0000.jsonl")).unwrap();
        std::fs::create_dir(dir.join("records-0000.jsonl")).unwrap();
        let before = std::fs::read_dir(root.path()).unwrap().count();
        assert!(super::export_archive(&dir, &target, b"{}").is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original archive");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), before);
        std::fs::remove_dir(dir.join("records-0000.jsonl")).unwrap();
        std::fs::write(dir.join("records-0000.jsonl"), b"{}\n").unwrap();
        let occupied = root.path().join("occupied.zip");
        std::fs::create_dir(&occupied).unwrap();
        std::fs::write(occupied.join("keep"), b"keep").unwrap();
        let before = std::fs::read_dir(root.path()).unwrap().count();
        assert!(super::export_archive(&dir, &occupied, b"{}")
            .unwrap_err()
            .contains("保存导出文件失败"));
        assert_eq!(std::fs::read(occupied.join("keep")).unwrap(), b"keep");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), before);
        assert!(super::export_archive(&dir, &dir.join("metadata.json"), b"{}").is_err());
        assert!(std::fs::read_to_string(dir.join("metadata.json"))
            .unwrap()
            .contains("ios-log-record-jsonl-v1"));
        // 成功覆盖只在完整 ZIP 写完之后发生。
        super::export_archive(&dir, &target, b"{}").unwrap();
        assert!(zip::ZipArchive::new(std::fs::File::open(target).unwrap()).is_ok());
    }

    #[test]
    fn missing_segment_does_not_silently_export_incomplete_history() {
        let root = tempfile::tempdir().unwrap();
        let writer = IosSessionWriter::start(root.path(), "masked", "1.3.2", None, false).unwrap();
        let dir = writer.dir().to_owned();
        drop(writer);
        std::fs::write(dir.join("records-0002.jsonl"), b"{}\n").unwrap();
        let target = root.path().join("result.zip");
        assert!(super::export_archive(&dir, &target, b"{}")
            .unwrap_err()
            .contains("分段缺失"));
        assert!(!target.exists());
    }

    #[test]
    fn archive_reports_output_write_failure() {
        use std::io::{self, Cursor, Seek, SeekFrom, Write};
        struct FullDisk(Cursor<Vec<u8>>);
        impl Write for FullDisk {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::other("simulated disk full"))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        impl Seek for FullDisk {
            fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
                self.0.seek(pos)
            }
        }
        let error =
            super::write_archive(FullDisk(Cursor::new(Vec::new())), &[], b"{}").unwrap_err();
        assert!(error.contains("simulated disk full"), "{error}");
    }

    #[test]
    fn writes_metadata_and_raw_jsonl_record() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("testbench-ios-store-{suffix}"));
        let mut writer =
            IosSessionWriter::start(&root, "00008110-****-21E2401E", "1.3.2", Some("Fixture"), false)
                .expect("start writer");
        let record = IosLogRecord {
            timestamp: "Nov  4 12:00:00".to_owned(),
            device: "TestPhone".to_owned(),
            process: "Fixture".to_owned(),
            module: Some("UnityFramework".to_owned()),
            pid: Some(42),
            level: "notice".to_owned(),
            semantic_level: None,
            semantic_level_source: None,
            encoding_status: EncodingStatus::Valid,
            truncated: false,
            message: "hello".to_owned(),
            raw: "raw syslog line".to_owned(),
        };
        writer.append(&record).expect("append");
        writer.flush().expect("flush");
        let dir = writer.dir().to_path_buf();
        drop(writer);

        let metadata = std::fs::read_to_string(dir.join("metadata.json")).expect("metadata");
        assert!(metadata.contains("00008110-****-21E2401E"));
        assert!(!metadata.contains("0004294E"));
        let jsonl = std::fs::read_to_string(dir.join("records-0000.jsonl")).expect("jsonl record");
        assert!(jsonl.contains("raw syslog line"));
        assert!(jsonl.ends_with('\n'));

        std::fs::write(
            dir.join("records-0001.jsonl"),
            "{\"raw\":\"second segment\"}\n",
        )
        .expect("segment");
        let destination = root.join("export.zip");
        super::export_archive(&dir, &destination, b"{\"receivedCount\":2}").expect("export");
        let mut archive = zip::ZipArchive::new(std::fs::File::open(destination).unwrap()).unwrap();
        assert_eq!(archive.len(), 4);
        assert_eq!(archive.by_index(0).unwrap().name(), "metadata.json");
        assert_eq!(archive.by_index(1).unwrap().name(), "records-0000.jsonl");
        assert_eq!(archive.by_index(2).unwrap().name(), "records-0001.jsonl");
        let mut exported = String::new();
        std::io::Read::read_to_string(
            &mut archive.by_name("records-0000.jsonl").unwrap(),
            &mut exported,
        )
        .unwrap();
        assert_eq!(exported, jsonl);
        assert!(archive.by_name("export-status.json").is_ok());
        drop(archive);

        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
