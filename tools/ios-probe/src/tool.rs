use std::{
    env,
    path::{Path, PathBuf},
};

use ios_core::{IosTool, ProbeError, ProbeErrorKind};

/// CLI 开发工具查找策略。正式 Tauri 安装包的资源路径策略不属于 ios-core，
/// 将由阶段 2 后端适配层单独实现。
pub fn locate_cli_tool() -> Result<IosTool, ProbeError> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("IOS_TOOL_PATH") {
        candidates.push(PathBuf::from(path));
    }

    let repository_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    #[cfg(target_os = "macos")]
    candidates.push(repository_root.join("src-tauri/bin/macos/ios"));
    #[cfg(target_os = "windows")]
    candidates.push(repository_root.join("src-tauri/bin/windows/ios.exe"));

    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return Ok(IosTool::new(path));
    }
    if command_exists("ios") {
        return Ok(IosTool::new("ios"));
    }

    Err(ProbeError::new(
        ProbeErrorKind::ToolNotFound,
        "未找到 go-ios。请设置 IOS_TOOL_PATH，或将工具放入 src-tauri/bin/<platform>/",
    ))
}

fn command_exists(command: &str) -> bool {
    env::var_os("PATH").is_some_and(|paths| {
        env::split_paths(&paths).any(|path| {
            let candidate = path.join(command);
            if candidate.is_file() {
                return true;
            }
            #[cfg(target_os = "windows")]
            return path.join(format!("{command}.exe")).is_file();
            #[cfg(not(target_os = "windows"))]
            false
        })
    })
}
