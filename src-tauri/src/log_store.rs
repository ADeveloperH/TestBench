//! 当前 logcat 会话的轻量落盘存储。
//!
//! 这里只负责顺序写入原始 logcat 行，不参与前端筛选。日志按 50 MiB 分段，
//! 既避免单个文件无限增长，也让后续分页读取和故障恢复有明确边界。

use std::fs::{create_dir_all, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SEGMENT_LIMIT_BYTES: u64 = 50 * 1024 * 1024;
const FLUSH_INTERVAL: Duration = Duration::from_millis(500);

pub struct LogSessionWriter {
    dir: PathBuf,
    segment: u32,
    bytes: u64,
    file: BufWriter<File>,
    last_flush: Instant,
}

impl LogSessionWriter {
    pub fn start(app_data_dir: &Path) -> Result<Self, String> {
        let sessions_dir = app_data_dir.join("sessions");
        create_dir_all(&sessions_dir).map_err(|e| format!("创建日志会话目录失败：{e}"))?;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("获取日志会话时间失败：{e}"))?
            .as_nanos();
        let dir = sessions_dir.join(format!("{stamp}"));
        create_dir_all(&dir).map_err(|e| format!("创建日志会话目录失败：{e}"))?;
        let file = open_segment(&dir, 0)?;

        Ok(Self {
            dir,
            segment: 0,
            bytes: 0,
            file: BufWriter::new(file),
            last_flush: Instant::now(),
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
}

fn open_segment(dir: &Path, segment: u32) -> Result<File, String> {
    File::create(dir.join(format!("logs-{segment:04}.log")))
        .map_err(|e| format!("创建日志文件失败：{e}"))
}
