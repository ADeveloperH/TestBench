//! 当前 logcat 会话的轻量落盘存储。
//!
//! 这里只负责顺序写入原始 logcat 行，不参与前端筛选。日志按 50 MiB 分段，
//! 既避免单个文件无限增长，也让后续分页读取和故障恢复有明确边界。

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SEGMENT_LIMIT_BYTES: u64 = 50 * 1024 * 1024;
const FLUSH_INTERVAL: Duration = Duration::from_millis(500);

pub struct LogSessionWriter {
    dir: PathBuf,
    segment: u32,
    bytes: u64,
    file: BufWriter<File>,
    last_flush: Instant,
    // File最后一个副本关闭才释放OS锁，停止采集不释放当前会话，导出可独立续持。
    lease: File,
}

impl LogSessionWriter {
    pub fn start(app_data_dir: &Path) -> Result<Self, String> {
        let (dir, lease) = crate::log_storage::create_session(app_data_dir)?;
        let file = open_segment(&dir, 0)?;

        Ok(Self {
            dir,
            segment: 0,
            bytes: 0,
            file: BufWriter::new(file),
            last_flush: Instant::now(),
            lease,
        })
    }

    pub fn append_lines(&mut self, lines: &[String]) -> Result<(), String> {
        for line in lines {
            let line_bytes = line.as_bytes();
            let bytes = line_bytes.len() as u64 + 1;
            if self.bytes > 0 && self.bytes + bytes > SEGMENT_LIMIT_BYTES {
                self.file
                    .flush()
                    .map_err(|e| format!("刷新日志文件失败：{e}"))?;
                self.segment += 1;
                self.file = BufWriter::new(open_segment(&self.dir, self.segment)?);
                self.bytes = 0;
            }
            self.file
                .write_all(line_bytes)
                .and_then(|_| self.file.write_all(b"\n"))
                .map_err(|e| format!("写入日志文件失败：{e}"))?;
            self.bytes += bytes;
        }
        if self.last_flush.elapsed() >= FLUSH_INTERVAL {
            self.file
                .flush()
                .map_err(|e| format!("刷新日志文件失败：{e}"))?;
            self.last_flush = Instant::now();
        }
        Ok(())
    }

    pub fn flush(&mut self) {
        let _ = self.file.flush();
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn export_snapshot(&mut self) -> Result<(File, Vec<(PathBuf, u64)>), String> {
        self.file.flush().map_err(|e| e.to_string())?;
        let pin = self.lease.try_clone().map_err(|e| e.to_string())?;
        let mut files = Vec::new();
        for entry in std::fs::read_dir(&self.dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if crate::log_storage::is_segment(&entry.file_name().to_string_lossy()) {
                let metadata =
                    std::fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err("日志分段不是普通文件".into());
                }
                files.push((entry.path(), metadata.len()));
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));
        Ok((pin, files))
    }
}

fn open_segment(dir: &Path, segment: u32) -> Result<File, String> {
    File::create(dir.join(format!("logs-{segment:04}.log")))
        .map_err(|e| format!("创建日志文件失败：{e}"))
}
