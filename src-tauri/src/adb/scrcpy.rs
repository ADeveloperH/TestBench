//! scrcpy 投屏与无头录屏。

use std::process::{Child, Stdio};

use super::scrcpy_command;

/// 一个运行中的 scrcpy 无头录屏子进程。
pub struct ScrcpyRecord {
    child: Child,
}

impl ScrcpyRecord {
    pub fn start(device: Option<&str>, output: &str, mbps: u32) -> Result<Self, String> {
        use std::io::Read;
        let br = format!("{mbps}M");
        log::info!("开始 scrcpy 录屏：device={:?} output={output} bitrate={br}", device);
        let mut cmd = scrcpy_command();
        if let Some(d) = device {
            cmd.arg("-s").arg(d);
        }
        cmd.args(["--no-playback", "--record", output, "--video-bit-rate", &br]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP：
            // 隐藏控制台，并让子进程成为新进程组 leader，停止时可发 CTRL_BREAK 优雅收尾
            cmd.creation_flags(0x0800_0000 | 0x0000_0200);
        }
        cmd.stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("无法启动 scrcpy 录屏：{e}"))?;

        // 稍等判断是否立即失败（如设备离线、scrcpy 启动失败）。
        std::thread::sleep(std::time::Duration::from_millis(1500));
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let mut stderr = String::new();
            if let Some(mut se) = child.stderr.take() {
                let _ = se.read_to_string(&mut stderr);
            }
            let msg = stderr.trim().to_string();
            log::error!("scrcpy 录屏立即退出（exit={status}）：{msg}");
            return Err(if msg.is_empty() {
                format!("scrcpy 录屏启动失败（exit={status}）")
            } else {
                msg
            });
        }

        log::info!("scrcpy 录屏已启动，pid={}", child.id());
        Ok(Self { child })
    }

    /// 停止录屏：Unix 发 SIGINT（Ctrl+C）；Windows 发 CTRL_BREAK 事件，
    /// 让 scrcpy 正常收尾并保存 mp4；等待超时后兜底强杀。
    pub fn stop(&mut self) {
        log::info!("停止 scrcpy 录屏，pid={}", self.child.id());
        #[cfg(unix)]
        unsafe {
            libc::kill(self.child.id() as i32, libc::SIGINT);
        }
        #[cfg(windows)]
        {
            unsafe {
                windows_sys::Win32::System::Console::GenerateConsoleCtrlEvent(
                    windows_sys::Win32::System::Console::CTRL_BREAK_EVENT,
                    self.child.id(),
                );
            }
            // 等待优雅退出，最多 10 秒，超时强杀兜底
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                match self.child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if std::time::Instant::now() >= deadline {
                            log::warn!("scrcpy 录屏未在 10 秒内优雅退出，强杀兜底");
                            let _ = self.child.kill();
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(200));
                    }
                    Err(_) => break,
                }
            }
        }
        let _ = self.child.wait();
        log::debug!("scrcpy 录屏已停止");
    }
}

/// 启动 scrcpy 投屏（独立窗口，带鼠标/键盘/触控）。
pub fn mirror(device: Option<&str>, mbps: u32) -> Result<(), String> {
    let br = format!("{mbps}M");
    log::info!("启动 scrcpy 投屏：device={:?} bitrate={br}", device);
    let mut cmd = scrcpy_command();
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    cmd.args(["--video-bit-rate", &br, "--stay-awake"]);
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn().map_err(|e| format!("无法启动 scrcpy 投屏：{e}"))?;
    Ok(())
}
