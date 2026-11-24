# TestBench iOS Probe

独立的 iOS 设备发现与日志采集验证程序。它不依赖 TestBench 的 Tauri 后端和 React 前端，不会修改现有 Android 功能。设备模型、错误分类、固定版本检查和 syslog 解析来自共享的 `tools/ios-core`；CLI 自身只负责参数、开发环境工具查找、输出和 Ctrl+C 生命周期。

## 工具准备

Probe 按以下顺序查找 `go-ios`：

1. 环境变量 `IOS_TOOL_PATH`
2. `src-tauri/bin/macos/ios` 或 `src-tauri/bin/windows/ios.exe`
3. 系统 `PATH` 中的 `ios`

当前固定验证版本为 `go-ios` v1.3.2。

## 使用

```bash
cargo run --manifest-path tools/ios-probe/Cargo.toml -- doctor
cargo run --manifest-path tools/ios-probe/Cargo.toml -- list
cargo run --manifest-path tools/ios-probe/Cargo.toml -- logs <UDID>
cargo run --manifest-path tools/ios-probe/Cargo.toml -- logs <UDID> --process FruitQuest
```

开发期指定临时工具：

```bash
IOS_TOOL_PATH=/path/to/ios \
  cargo run --manifest-path tools/ios-probe/Cargo.toml -- doctor
```

`logs` 使用 go-ios 原始 syslog 输出并由 Rust 自行解析，不使用会破坏部分中文内容的 `--parse` 模式。按 `Ctrl+C` 可停止采集并回收子进程。

每条日志输出一行 JSON，主要字段包括：

- `level`：Apple syslog 原始设备级别，为兼容首版字段名而保留。
- `semanticLevel`：从 Unity 调用栈有限推断的 `info`、`warning`、`error` 或 `exception`；无法可靠判断时为 `null`。
- `semanticLevelSource`：当前仅可能为 `unity_heuristic`，明确表示结果不是设备原始级别。
- `encodingStatus`：`valid` 或 `suspected_mojibake`。Probe 只标记疑似乱码，不自动修改原文。
- `truncated`：消息是否包含已知的 syslog 截断标记。
- `message` 与 `raw`：解析后的消息和原始 syslog 行。

Unity 语义级别是启发式结果，正式展示时应与设备原始 `level` 区分。部分 Unity 中文日志在进入 Apple 日志通道前已经乱码，Probe 无法从 syslog 保证还原；原始内容始终保留。

涉及 Ctrl+C、拔线和残留进程的生命周期测试，建议先构建后直接运行 Probe，避免 `cargo run` 或自动化终端的外层进程干扰信号传递：

```bash
cargo build --manifest-path tools/ios-probe/Cargo.toml
IOS_TOOL_PATH=/path/to/ios \
  tools/ios-probe/target/debug/ios-probe logs <UDID> --process FruitQuest
```

## 隐私约定

- `list` 只输出 MVP 所需字段，不打印完整 Lockdown 信息。
- `displayId` 可用于截图、文档和测试报告。
- `id` 是后续命令所需的真实 UDID，不应写入公开文档或提交为测试样本。
