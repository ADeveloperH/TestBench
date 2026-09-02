# 跨平台子进程与 Sidecar 集成规范

更新时间：2026-09-02

## 目的

TestBench 会调用 ADB、scrcpy、Unity 音频解析器，以及未来可能增加的 helper、FFmpeg 或其他本地工具。此类功能在 macOS 开发环境正常，并不代表 Windows 安装包中也能正常运行。本规范记录已经遇到的问题，并作为后续新增子进程功能的最低接入要求。

## 已遇到的问题

### Windows 弹出控制台窗口

现象：启动 `unity-audio-extractor.exe` 后自动打开 Windows Terminal 或黑色控制台窗口。

原因：PyInstaller 生成的是控制台程序，Rust 使用普通 `Command` 启动时，Windows 会为它创建控制台窗口。

处理：Windows 上创建后台子进程必须设置 `CREATE_NO_WINDOW`（`0x0800_0000`）。不要简单把 PyInstaller 改为 `--noconsole`，因为 GUI 子系统程序可能没有可用的 stdin/stdout/stderr，会直接破坏当前 JSONL 管道协议。

### 管道输出不是 UTF-8

现象：Rust 报错 `stream did not contain valid UTF-8`，常在中文设备名、路径、资源名或错误信息出现时触发。

原因：Windows 上 Python 或原生程序可能按当前系统代码页写入管道，而 Rust 的文本逐行读取默认要求合法 UTF-8。

处理采用三层保护：

1. 启动 Python sidecar 时设置 `PYTHONUTF8=1` 和 `PYTHONIOENCODING=utf-8`。
2. Python 入口把 stdout/stderr 显式配置为 UTF-8。
3. JSONL 协议使用 ASCII 安全的 JSON 转义；Rust 按字节分行并做 lossy UTF-8 兜底，单个异常字节不能中断整个任务。

### stderr 管道未消费导致子进程卡死

现象：小样本正常，大量警告或异常堆栈出现后任务永久不结束。

原因：如果父进程把 stderr 设为 pipe 却不读取，操作系统管道缓冲区写满后，子进程会阻塞。

处理：stdout 和 stderr 必须同时持续读取。stderr 只保留最后 64 KiB 用于诊断，避免错误输出无限占用内存；子进程失败时优先展示协议中的 `fatal.error`，其次展示 stderr 尾部。

## 新功能接入硬性要求

每个通过 Rust 启动的后台工具都必须检查以下事项：

- Windows 启动是否设置 `CREATE_NO_WINDOW`。
- 是否需要标准输入输出；需要管道时不得使用会移除标准流的 GUI/no-console 打包方式。
- stdout 的编码和协议是否明确，推荐 UTF-8 JSONL；跨语言协议优先使用 ASCII 安全转义。
- stdout、stderr 是否被同时消费，不能创建无人读取的 pipe。
- 是否限制错误输出的内存占用，并在失败信息中保留有效诊断。
- 是否检查退出码、协议完成事件和版本字段，不能只满足其中一个条件。
- 用户取消、设备断开、应用退出和自动更新前，子进程是否会被终止并等待回收。
- 文件路径是否通过参数对象传递，不能拼接 shell 字符串；必须覆盖空格、中文和超长路径。
- 临时文件是否使用独立任务目录、原子落盘并在成功、失败、取消时清理。
- sidecar 是否按目标平台和架构单独构建，并随最终安装包分发，不能依赖用户本机环境。

## 推荐进程协议

- stdout：只输出一行一个对象的版本化 JSONL，不输出调试文字。
- stderr：输出诊断和异常堆栈，由 Rust 后台读取并截断保存。
- 每条事件包含 `schemaVersion` 和 `event`。
- 正常结束必须发送 `completed`，再以退出码 0 退出。
- 可恢复问题发送 `warning`，不能污染协议输出。
- 致命问题发送 `fatal`，再以非 0 退出。
- Rust 同时验证退出码和 `completed`；退出码为 0 但没有完成事件仍视为失败。

## 发布前测试矩阵

| 检查 | macOS ARM64 | macOS x64 | Windows x64 |
|---|---:|---:|---:|
| `--version` 冒烟测试 | 必须 | 必须 | 必须 |
| 无控制台弹窗 | 不适用 | 不适用 | 必须 |
| 中文路径和文件名 | 必须 | 必须 | 必须 |
| 大量 stderr 不阻塞 | 必须 | 必须 | 必须 |
| 非 UTF-8 噪声不导致崩溃 | 必须 | 必须 | 必须 |
| 取消后进程退出 | 必须 | 必须 | 必须 |
| 安装包内无需外部运行环境 | 必须 | 必须 | 必须 |

## 本次 Unity 音频导出修复

Windows `v0.0.22` 首次真实测试发现控制台弹窗和 UTF-8 读取失败。本轮已在 Unity 音频 sidecar 启动链路落实上述规则，并增加协议与 stderr 尾部测试。后续新增任何 sidecar 时应复用同一进程启动封装，避免在不同功能中重复实现和重复踩坑。
