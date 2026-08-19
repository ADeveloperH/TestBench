//! 调试/开发模式标志（编译期确定）：
//! 仅 `pnpm tauri dev`（Vite 开发服务器）下为 true；
//! 正式打包（包括 `tauri build --debug` 的 Rust 调试构建，前端仍是生产 bundle）为 false。
//!
//! 用途：调试模式下允许维护者删除/编辑内置条目、显示「发布配置」页；
//! 正式包中所有内置保护照旧生效。

export const IS_DEBUG = import.meta.env.DEV;
