//! logcat 子进程封装。

use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};

use super::adb_path;

/// 清除指定设备的 logcat 缓冲区。
pub fn clear_log(device: Option<&str>) -> Result<(), String> {
    log::info!("清空 logcat 缓冲区，设备：{:?}", device);
    let mut cmd = Command::new(adb_path());
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["logcat", "-c"])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if output.status.success() {
        log::debug!("adb logcat -c 成功");
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::error!("adb logcat -c 失败：{err}");
        Err(err)
    }
}

/// 一个运行中的 `adb logcat` 子进程。
pub struct LogcatProcess {
    child: Child,
}

impl LogcatProcess {
    /// 启动 `adb [-s <device>] logcat -v threadtime [-b <buffer>]`。
    pub fn start(device: Option<&str>, buffer: Option<&str>) -> Result<Self, String> {
        let mut cmd = Command::new(adb_path());
        if let Some(d) = device {
            cmd.arg("-s").arg(d);
        }
        cmd.args(["logcat", "-v", "threadtime"]);
        if let Some(b) = buffer {
            cmd.arg("-b").arg(b);
        }
        log::info!("启动 logcat：device={:?} buffer={:?}", device, buffer);
        log::debug!("完整命令：{:?}", cmd);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let child = cmd.spawn().map_err(|e| format!("无法启动 logcat：{e}"))?;
        log::info!("logcat 子进程已启动，pid={}", child.id());
        Ok(Self { child })
    }

    /// 取出 stdout，供独立线程按行读取。
    pub fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    /// 取出 stderr，供独立线程读取错误信息。
    pub fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    /// 结束进程并回收。
    pub fn stop(&mut self) {
        log::info!("停止 logcat 子进程，pid={}", self.child.id());
        let _ = self.child.kill();
        let _ = self.child.wait();
        log::debug!("logcat 子进程已停止");
    }
}
