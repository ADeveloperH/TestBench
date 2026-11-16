//! 手机录屏子进程：真实视频数据就绪、持续消费 stderr、有界退出。
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

fn parameters(settings: &Value) -> Result<(f64, u64, u64, u64), String> {
    let invalid = || "recording_settings_invalid：请检查录屏尺寸、帧率、码率及音频开关".to_string();
    let bitrate = settings["BitRateMbps"].as_f64().ok_or_else(invalid)?;
    let fps = settings["FrameRate"].as_u64().ok_or_else(invalid)?;
    let width = settings["Width"].as_u64().ok_or_else(invalid)?;
    let height = settings["Height"].as_u64().ok_or_else(invalid)?;
    if settings["CaptureAudio"].as_bool().is_none()
        || !(1.0..=100.0).contains(&bitrate)
        || !(1..=60).contains(&fps)
        || !(240..=4096).contains(&width)
        || !(240..=4096).contains(&height)
    {
        return Err(invalid());
    }
    Ok((bitrate, fps, width, height))
}
pub fn validate_settings(settings: &Value) -> Result<(), String> {
    parameters(settings).map(|_| ())
}

pub struct Recording {
    child: Child,
    pub path: PathBuf,
    log_path: PathBuf,
}
impl Recording {
    pub fn start(
        device: &str,
        path: &Path,
        settings: &Value,
        cancelled: &AtomicBool,
    ) -> Result<Self, String> {
        let (bitrate, fps, width, height) = parameters(settings)?;
        let mut cmd = crate::adb::scrcpy_command();
        crate::adb::scrcpy_select_device(&mut cmd, Some(device));
        // Headless capture must not depend on Cocoa window activation/event delivery.
        // In particular, the native driver can stall startup and SIGINT finalization.
        #[cfg(target_os = "macos")]
        cmd.env("SDL_VIDEODRIVER", "dummy");
        cmd.args([
            "--no-playback",
            "--no-control",
            "--no-downsize-on-error",
            "--video-codec=h264",
        ])
        .arg(format!(
            "--video-bit-rate={}",
            (bitrate * 1_000_000.0) as u64
        ))
        .arg(format!("--max-fps={fps}"))
        .arg(format!("--max-size={}", width.max(height)))
        .arg("--record")
        .arg(path);
        if settings["CaptureAudio"].as_bool().unwrap_or(false) {
            cmd.args(["--require-audio", "--audio-codec=aac"]);
        } else {
            cmd.arg("--no-audio");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000 | 0x0000_0200);
        }
        let log_path = path.with_file_name(format!(
            "{}-recorder.log",
            path.file_stem().unwrap_or_default().to_string_lossy()
        ));
        let log = File::create(&log_path).map_err(|e| format!("recorder_log_failed：{e}"))?;
        cmd.stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log));
        let child = cmd
            .spawn()
            .map_err(|e| format!("recorder_start_failed：{e}"))?;
        let mut recording = Self {
            child,
            path: path.to_owned(),
            log_path,
        };
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if cancelled.load(Ordering::SeqCst) {
                return Err("cancelled：准备录屏时用户停止".into());
            }
            if let Some(status) = recording.child.try_wait().map_err(|e| e.to_string())? {
                return Err(format!("recorder_exited：{status} {}", recording.stderr()));
            }
            if mp4_info(path, false).is_ok() {
                return Ok(recording);
            }
            if Instant::now() >= deadline {
                let _ = recording.finish();
                return Err(format!(
                    "recorder_ready_timeout：20秒没有可用视频数据 {}",
                    recording.stderr()
                ));
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
    pub fn stderr(&self) -> String {
        let read = || -> std::io::Result<String> {
            let mut file = File::open(&self.log_path)?;
            let len = file.metadata()?.len();
            file.seek(SeekFrom::Start(len.saturating_sub(65536)))?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        };
        read().unwrap_or_default()
    }
    pub fn finish(&mut self) -> Result<Value, String> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err(format!("recorder_exited：{}", self.stderr()));
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(self.child.id() as i32, libc::SIGINT);
        }
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::System::Console::GenerateConsoleCtrlEvent(
                windows_sys::Win32::System::Console::CTRL_BREAK_EVENT,
                self.child.id(),
            );
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.child.try_wait().map_err(|e| e.to_string())? {
                if !status.success() {
                    return Err(format!("recorder_failed：{status} {}", self.stderr()));
                }
                break;
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                let _ = self.child.wait();
                return Err(format!(
                    "recorder_stop_timeout：录屏未正常封装 {}",
                    self.stderr()
                ));
            }
            thread::sleep(Duration::from_millis(50));
        }
        mp4_info(&self.path, true)
    }
}
impl Drop for Recording {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.finish();
            if self.child.try_wait().ok().flatten().is_none() {
                let _ = self.child.kill();
                let _ = self.child.wait();
            }
        }
    }
}

/// 只读容器校验，不把“进程存活/文件头已创建”当作收到视频帧。
pub fn mp4_info(path: &Path, finalized: bool) -> Result<Value, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    let mut pos = 0u64;
    let mut media = false;
    let mut movie = None;
    while pos + 8 <= length {
        file.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;
        let mut header = [0u8; 16];
        file.read_exact(&mut header[..8])
            .map_err(|e| e.to_string())?;
        let mut size = u32::from_be_bytes(header[..4].try_into().unwrap()) as u64;
        let mut head = 8;
        if size == 1 {
            file.read_exact(&mut header[8..16])
                .map_err(|e| e.to_string())?;
            size = u64::from_be_bytes(header[8..16].try_into().unwrap());
            head = 16;
        }
        if size == 0 {
            size = length - pos;
        }
        if size < head || size > length - pos {
            if finalized {
                return Err("video_invalid：MP4块被截断".into());
            }
            break;
        }
        if &header[4..8] == b"mdat" && size > head + 1024 {
            media = true;
        }
        if &header[4..8] == b"moov" && size <= 16 * 1024 * 1024 {
            let mut bytes = vec![0; (size - head) as usize];
            file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
            movie = Some(bytes);
        }
        pos += size;
    }
    if finalized && pos != length {
        return Err("video_invalid：MP4尾部数据不完整".into());
    }
    if !media || (finalized && movie.is_none()) {
        return Err("video_invalid：缺少视频帧或完成的MP4索引".into());
    }
    let mut result = json!({"bytes":length,"container":"mp4","finalized":finalized});
    if let Some(bytes) = movie {
        let mut width = 0;
        let mut height = 0;
        let mut duration = 0f64;
        scan_boxes(&bytes, &mut |kind, data| {
            if kind == b"tkhd" && data.len() >= 8 {
                let n = data.len();
                let w = u32::from_be_bytes(data[n - 8..n - 4].try_into().unwrap()) >> 16;
                let h = u32::from_be_bytes(data[n - 4..].try_into().unwrap()) >> 16;
                if w > 0 && h > 0 {
                    width = w;
                    height = h;
                }
            }
            if kind == b"mvhd" && data.len() >= 20 {
                let v = data[0];
                let offset = if v == 1 { 20 } else { 12 };
                if data.len() >= offset + 12 {
                    let timescale =
                        u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap());
                    let ticks = if v == 1 {
                        u64::from_be_bytes(data[offset + 4..offset + 12].try_into().unwrap())
                    } else {
                        u32::from_be_bytes(data[offset + 4..offset + 8].try_into().unwrap()) as u64
                    };
                    if timescale > 0 {
                        duration = ticks as f64 / timescale as f64;
                    }
                }
            }
        });
        if width == 0 || height == 0 || duration <= 0.0 {
            return Err("video_invalid：视频尺寸或时长无效".into());
        }
        result["width"] = json!(width);
        result["height"] = json!(height);
        result["durationSeconds"] = json!(duration);
    }
    Ok(result)
}
fn scan_boxes(bytes: &[u8], visit: &mut impl FnMut(&[u8], &[u8])) {
    let mut p = 0;
    while p + 8 <= bytes.len() {
        let size = u32::from_be_bytes(bytes[p..p + 4].try_into().unwrap()) as usize;
        if size < 8 || size > bytes.len() - p {
            break;
        }
        let kind = &bytes[p + 4..p + 8];
        let data = &bytes[p + 8..p + size];
        visit(kind, data);
        if [b"trak".as_slice(), b"mdia", b"minf", b"stbl"].contains(&kind) {
            scan_boxes(data, visit);
        }
        p += size;
    }
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Unix rename atomically replaces the previous manifest. Windows keeps a recoverable backup.
    #[cfg(windows)]
    if path.exists() {
        let backup = path.with_extension("json.bak");
        if backup.exists() {
            fs::remove_file(&backup).map_err(|e| e.to_string())?;
        }
        fs::rename(path, &backup).map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&temp, path) {
            let _ = fs::rename(backup, path);
            return Err(error.to_string());
        }
        let _ = fs::remove_file(backup);
        return Ok(());
    }
    fs::rename(temp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(bytes: &[u8], check: impl FnOnce(&Path)) {
        let path = std::env::temp_dir().join(format!(
            "testbench-mp4-{}-{}.mp4",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, bytes).unwrap();
        check(&path);
        fs::remove_file(path).unwrap();
    }
    fn atom(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut out = ((data.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend(kind);
        out.extend(data);
        out
    }
    #[test]
    fn header_or_audio_only_is_never_a_deliverable_video() {
        fixture(&atom(b"ftyp", b"isom"), |p| {
            assert!(mp4_info(p, false).is_err())
        });
        let mut bytes = atom(b"mdat", &vec![0; 2048]);
        bytes.extend(atom(b"moov", &atom(b"mvhd", &[0; 24])));
        fixture(&bytes, |p| assert!(mp4_info(p, true).is_err()));
    }
    #[test]
    fn ready_frames_require_final_index_before_delivery() {
        let mut bytes = atom(b"mdat", &vec![0; 2048]);
        fixture(&bytes, |p| {
            assert!(mp4_info(p, false).is_ok());
            assert!(mp4_info(p, true).is_err());
        });
        let mut mvhd = [0u8; 24];
        mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
        mvhd[16..20].copy_from_slice(&2500u32.to_be_bytes());
        let mut tkhd = [0u8; 84];
        tkhd[76..80].copy_from_slice(&(1080u32 << 16).to_be_bytes());
        tkhd[80..84].copy_from_slice(&(1920u32 << 16).to_be_bytes());
        let mut movie = atom(b"mvhd", &mvhd);
        movie.extend(atom(b"trak", &atom(b"tkhd", &tkhd)));
        bytes.extend(atom(b"moov", &movie));
        fixture(&bytes, |p| {
            let info = mp4_info(p, true).unwrap();
            assert_eq!(info["width"], 1080);
            assert_eq!(info["height"], 1920);
            assert_eq!(info["durationSeconds"], 2.5);
        });
        bytes.extend([0, 0, 0, 99, b'm', b'o', b'o', b'v']);
        fixture(&bytes, |p| assert!(mp4_info(p, true).is_err()));
    }
}
