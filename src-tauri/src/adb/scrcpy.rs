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

    /// 停止录屏：发送 SIGINT（相当于 Ctrl+C），让 scrcpy 正常收尾并保存文件。
    pub fn stop(&mut self) {
        log::info!("停止 scrcpy 录屏，pid={}", self.child.id());
        #[cfg(unix)]
        unsafe {
            libc::kill(self.child.id() as i32, libc::SIGINT);
        }
        #[cfg(not(unix))]
        {
            let _ = self.child.kill();
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
