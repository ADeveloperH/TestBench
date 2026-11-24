# iOS 设备发现与日志采集 MVP 规划

更新时间：2026-11-04

## 一、背景

TestBench 当前是基于 Tauri 2、Rust、React 和 TypeScript 实现的 Android 日志与设备工作台。Android 设备能力通过内置 `adb` 和 `scrcpy` 提供：

- `adb devices -l` 枚举设备
- `adb logcat -v long` 实时采集日志
- `adb pair/connect/mdns` 提供 Android 无线调试
- `adb shell` 提供应用与设备操作
- `scrcpy` 提供投屏和录屏

当前设备模型、Tauri 命令、事件名、Logcat Buffer 和前端日志解析器均与 Android/Logcat 直接绑定。iOS 接入不能简单替换一条命令，需要先验证设备协议和日志可见性，再进行平台化改造。

## 二、目标与结论

### 2.1 MVP 目标

验证以下最小闭环：

```text
内置 iOS 工具
→ 发现 USB iPhone/iPad
→ 判断设备信任/可访问状态
→ 启动实时日志流
→ 解析基础日志字段
→ 正确处理拔线、停止和进程回收
```

### 2.2 推荐实施方式

不直接修改现有正式日志页，也不创建独立仓库。在当前仓库内增加隔离的命令行 Probe：

```text
tools/
└── ios-probe/
    ├── Cargo.toml
    ├── src/
    │   └── main.rs
    ├── samples/
    └── README.md
```

验证通过后，再在 TestBench 中增加仅开发模式可见的 iOS Probe 页面，最后接入正式设备和日志架构。

这样既能隔离未验证代码，也能复用当前仓库、Rust 工具链、内置资源目录和跨平台 CI。

## 三、工具选型

### 3.1 当前首选

首选内置固定版本的 `go-ios` sidecar：

```text
src-tauri/bin/
├── macos/
│   └── ios
└── windows/
    └── ios.exe
```

主要原因：

- 可生成 macOS 和 Windows 独立二进制
- 用户不需要安装 Go、Node、Python、Homebrew 或 Xcode
- MIT 许可证适合随 TestBench 分发
- 命令行与 JSON 输出便于 Rust 启动和解析
- 与项目现有 `adb`、`scrcpy`、Unity 音频 sidecar 模式一致

候选命令以实际固定版本的帮助信息为准，预期包括：

```bash
ios --version
ios list --details
ios syslog --parse --udid=<UDID>
```

在真机验证前，不把具体命令参数写入正式业务接口。

### 3.2 备选方案

- `pymobiledevice3`：功能完整，可用于对照验证 syslog/oslog；但 Python 冻结、体积、依赖和 GPL-3.0 分发要求使其不适合作为当前首选。
- `libimobiledevice`：成熟且支持 `idevicesyslog`；但 Windows 动态库、构建和分发维护成本较高。
- Rust iOS 协议库：长期适合直接集成 Rust 后端；目前主流实现仍处于实验或快速变化阶段，不作为第一版生产依赖。
- Apple `devicectl`/Xcode：只适用于 macOS，不能满足 Windows 与 macOS 双平台开包使用。

### 3.3 Windows 系统边界

TestBench 可以内置 iOS 用户态工具，但干净 Windows 系统仍需要 Apple 官方 USB 驱动和 Apple Mobile Device Service，通常由 Apple Devices 或 iTunes 安装。

MVP 必须区分：

```text
工具缺失
Apple 系统服务缺失
没有连接设备
设备未信任
设备锁定
配对记录失效
日志服务不可用
设备中途断开
```

不计划在 TestBench 安装包中私自分发 Apple USB 驱动。

## 四、MVP 范围

### 4.1 本期包含

1. 查找和启动内置 iOS 工具。
2. 输出工具路径和版本。
3. 枚举一个或多个 USB iOS 设备。
4. 读取 UDID、设备名、型号和系统版本（以工具实际可提供字段为准）。
5. 区分在线、未信任、锁定、不可访问等状态。
6. 为指定 UDID 启动实时日志。
7. 同时保留原始日志与初步结构化日志。
8. 正确处理停止、Ctrl+C、拔线和子进程退出。
9. 在 macOS 和 Windows 上完成真机验证。
10. 保存脱敏后的设备枚举和日志样本，用于解析器测试。

### 4.2 本期不包含

- 正式日志页接入
- Android/iOS 通用设备模型改造
- iOS Wi-Fi 连接
- iOS 应用安装、卸载和重启
- iOS 截图、投屏和录屏
- 完整 Unified Logging、signpost 或性能分析
- iOS 崩溃报告导出
- 正式 UI 与最终交互设计
- 自研或分发 Windows USB 驱动

## 五、Probe 命令设计

建议提供以下命令：

```bash
cargo run --manifest-path tools/ios-probe/Cargo.toml -- doctor
cargo run --manifest-path tools/ios-probe/Cargo.toml -- list
cargo run --manifest-path tools/ios-probe/Cargo.toml -- info <UDID>
cargo run --manifest-path tools/ios-probe/Cargo.toml -- logs <UDID>
```

### 5.1 doctor

检查：

- 当前操作系统与架构
- iOS 工具实际路径
- iOS 工具版本
- Windows Apple Mobile Device Service 可用性
- 工具能否访问设备通信服务

### 5.2 list

输出标准化设备列表，例如：

```json
{
  "id": "00008110-XXXXXXXXXXXX",
  "name": "测试 iPhone",
  "model": "iPhone",
  "osVersion": "18.x",
  "transport": "usb",
  "state": "online"
}
```

### 5.3 info

验证指定设备能否完成 Lockdown/配对层访问，并打印基础信息和明确错误类型。

### 5.4 logs

启动日志流，并输出：

- 原始行
- 解析后的时间
- PID
- 进程名
- 日志级别
- subsystem/category（如果数据源提供）
- message

## 六、建议的数据结构

MVP 阶段可先定义：

```rust
struct IosDevice {
    id: String,
    name: String,
    model: String,
    os_version: String,
    transport: String,
    state: IosDeviceState,
}

enum IosDeviceState {
    Online,
    TrustRequired,
    Locked,
    Offline,
    Unavailable,
}

struct IosLogRecord {
    timestamp: String,
    pid: Option<u32>,
    tid: Option<u64>,
    process: String,
    level: String,
    subsystem: Option<String>,
    category: Option<String>,
    message: String,
    raw: String,
}
```

建议把工具错误转换成项目可识别的类型：

```rust
enum IosDeviceError {
    ToolNotFound,
    ToolVersionUnsupported,
    AppleServiceMissing,
    NoDevice,
    TrustRequired,
    DeviceLocked,
    PairingInvalid,
    SyslogUnavailable,
    DeviceDisconnected,
    ToolExited,
    OutputParseFailed,
}
```

## 七、验证步骤

### 7.1 工具和设备发现

验证场景：

- 没有连接设备
- 插入但未点击“信任此电脑”
- 已信任且解锁
- 已信任但锁屏
- 同时连接两台设备
- 采集中拔出设备
- 拔出后重新插入
- 配对记录失效

### 7.2 目标日志可见性

使用目标 Unity iOS 测试包验证：

- `Debug.Log`
- `Debug.LogWarning`
- `Debug.LogError`
- C# 异常和堆栈
- 原生插件 `NSLog`
- 原生 `os_log`
- 应用启动与前后台切换
- 应用崩溃前日志
- Debug 包
- Release 包

必须明确哪些日志能从经典 syslog relay 获取，哪些只有 oslog/Unified Logging 能获取。

### 7.3 稳定性

连续采集至少 30～60 分钟，观察：

- CPU 和内存是否持续增长
- stdout/stderr 是否发生阻塞
- 中文、Emoji 和无效 UTF-8 的处理
- 超长日志和多行堆栈
- 高频日志下的吞吐量
- 子进程异常退出后的错误信息
- 正常停止后是否残留进程
- 拔线后的退出行为

### 7.4 平台矩阵

| 平台 | 验证要求 |
|---|---|
| macOS Apple Silicon | 完整真机验证 |
| macOS Intel | CI 构建、工具启动；有设备条件时做真机验证 |
| Windows x64 + Apple Devices | 完整真机验证 |
| Windows x64 未安装 Apple Devices | 正确识别并提示系统组件缺失 |

还需记录测试设备的 iOS 版本，至少覆盖团队实际使用的最低版本、主流版本和最新版本。

## 八、阶段计划

### 阶段 0：工具预检

- 固定一个 go-ios 版本或 commit
- 在 macOS、Windows 手工运行设备枚举和 syslog
- 使用同一设备与 pymobiledevice3/libimobiledevice 做必要对照
- 确认目标 Unity 日志能够出现

阶段产物：命令记录、原始输出样本、初步兼容性结论。

### 阶段 1：仓库内 CLI Probe

- 创建 `tools/ios-probe`
- 实现工具路径与版本探测
- 实现设备枚举和错误分类
- 实现实时日志和进程回收
- 加入脱敏样本与解析单元测试

阶段产物：可重复执行的跨平台验证程序。

### 阶段 2：TestBench 隔离 Probe 页面

- 增加开发模式默认可见、内部验收包可显式开启的 iOS Probe 页面；普通正式包保持隐藏
- 通过 Tauri `invoke` 枚举设备
- 通过有界队列和 Tauri Event 批量传输日志
- 验证 WebView 高频日志承载
- 验证安装包内资源路径和 Windows 无窗口启动

阶段产物：端到端桌面验证，但不影响正式日志功能。

阶段 2 已进一步拆分为带编号、依赖关系和验收标准的执行任务，实施与进度维护统一参见 [iOS 阶段 2 任务清单](iOS阶段2任务清单.md)。任务号采用 `IOS2-xxx`，后续提交、验证记录和问题讨论均引用该编号。

这里的 Probe 页面是阶段 2 的临时工程验证页，不代表最终产品维护独立 iOS 日志界面。阶段 3 将成熟的 iOS Provider 接入现有正式日志工作区，复用采集控制、筛选、虚拟列表、详情、导出和测试用例 UI，只对平台能力差异做局部适配。

### 阶段 3：正式架构接入

2026-11-05 优先级调整：阶段编号不代表必须串行收口。Probe 基础链路已通过验证，下一步优先实施 [IOS3 正式日志工作区任务清单](iOS阶段3任务清单.md)，随后完成内置打包及跨平台、生命周期和稳定性验收。阶段 2 未完成的发布验收继续保留，不作为启动正式接入开发的前置条件。IOS-LOG-001 单独追踪并披露限制。

- 建立通用 `Device` 模型
- 建立 Android/iOS Provider
- 把 `RunningLogcat` 抽象为 `RunningLogStream`
- 把 `logcat-*` 命令和事件逐步改为通用日志命名
- 在 Rust 侧生成统一结构化日志记录
- 前端按设备能力显示工具
- 保证现有 Android 功能和性能不回归

## 九、正式接入时的目标架构

```text
React 日志工作区
        │ Tauri invoke/event
        ▼
Rust 通用设备与日志层
├── AndroidProvider
│   ├── adb devices
│   └── adb logcat
└── IosProvider
    ├── go-ios list
    └── go-ios syslog
        │
        ▼
统一 DeviceLogRecord
        │
        ├── 完整会话落盘
        ├── 前端过滤与虚拟列表
        └── 测试用例引擎
```

正式设备模型建议包含：

```ts
interface Device {
  id: string;
  platform: "android" | "ios";
  connectionState: "online" | "offline" | "unavailable";
  trustState?: "trusted" | "trust_required" | "pairing_invalid" | "unknown";
  locked?: boolean | null;
  name: string;
  model: string;
  osVersion?: string;
  transport: "usb" | "wifi";
  capabilities: DeviceCapability[];
}
```

连接、信任和锁定不是同一个互斥状态：已锁屏设备仍可能保持 syslog 能力。功能显示优先判断 `capabilities`，避免前端散落大量平台判断，也避免把锁屏直接等同于设备不可用。

## 十、打包原则

1. 用户机器不安装 Go、Python、Node、Homebrew、Xcode 或 go-ios。
2. iOS 工具在 TestBench 构建阶段生成并随安装包分发。
3. 固定工具版本/commit，不在客户端首次启动时下载。
4. CI 校验工具存在、可执行、版本正确。
5. 正式构建发现工具缺失时直接失败，不静默回退 PATH。
6. 保留 `IOS_TOOL_PATH` 仅用于开发调试和兼容性对照。
7. 随安装包附带第三方许可证和版本信息。
8. macOS、Windows 分别构建目标架构二进制，不要求用户安装运行时。

建议路径优先级：

```text
开发模式：IOS_TOOL_PATH → 仓库内置文件 → PATH
正式模式：安装包内置文件；缺失则报告安装损坏
```

## 十一、进入正式接入的验收门槛

以下条件全部满足后，再改造正式日志页：

- macOS 能稳定发现和访问 iPhone/iPad
- Windows 安装 Apple Devices 后能稳定发现和访问设备
- Windows 缺少系统组件时能给出准确提示
- 未信任、锁屏、配对失效、拔线都有明确状态
- 目标 Unity Debug/Release 包的关键日志可以采集
- 连续采集一小时无明显内存持续增长
- 停止和退出后没有残留采集进程
- 日志字段足够映射为 TestBench 统一日志模型
- 固定工具版本能在所有目标 CI 平台构建或启动
- 打包后的应用可以从资源目录启动内置工具
- 开启内部验收开关的安装包可以通过 Probe 页面完成端到端采集，普通正式包中入口保持隐藏

## 十二、待确认事项

- 团队需要覆盖的最低和最高 iOS 版本
- Windows 是否统一允许安装 Apple Devices
- 第一版只支持 USB，还是必须同时支持 Wi-Fi
- 是否只要求 Unity 应用日志，还是需要完整系统日志
- Release 包中 `Debug.Log` 的实际保留策略
- 是否需要按 Bundle ID/进程过滤
- 是否需要保留 subsystem/category 等 Unified Logging 字段
- 日志原文和结构化日志的最终落盘格式
- go-ios 具体固定版本与升级策略

## 十三、阶段 0 真机验证记录

验证日期：2026-09-23

### 13.1 验证环境

- 主机：macOS 26.5.2，Apple Silicon
- 工具：`go-ios` v1.3.2 官方 macOS Universal Binary（arm64 + x86_64）
- 发布包：`go-ios-mac.zip`
- SHA-256：`100f225bfdd039081bcbdaf45029df3e67032673f3e0ca1fa3c050898c230c57`
- 设备：iPhone 13（iPhone14,5）
- 系统：iOS 26.6
- 连接：USB

设备 UDID、序列号、IMEI、MAC 地址等完整标识不写入本文档和样本。

### 13.2 验证结论

1. `ios list --details --pretty` 能发现 USB 设备，并返回 UDID、产品类型、系统版本和连接类型。
2. `ios info --pretty` 能读取设备名，且 `TrustedHostAttached=true`，证明 usbmuxd、配对记录和信任链路正常。
3. `ios syslog --parse` 无需启动 iOS 17+ tunnel 即可通过 USB 获取实时日志。
4. 解析模式逐行输出 JSON，当前已观察到 `timestamp`、`device`、`process`、`pid`、`level`、`message` 字段。
5. 日志吞吐量很高：本次约 3 秒产生约 1800 行。正式实现必须批量读取和推送，并提供进程/级别过滤，避免 UI 被系统日志淹没。
6. 工具未运行 tunnel agent 时会输出警告，但不影响本次 USB 设备枚举、信息读取和 syslog 采集。Probe 应把此警告与真正失败区分开。
7. 对日志进程发送 Ctrl+C 后，工具可能以非零状态退出，并报告 usbmuxd 连接已关闭。若停止操作由用户主动触发，Probe 应将其归类为正常停止。
8. 已采集到 `FruitQuest(UnityFramework)` 进程产生的 Unity 业务日志，包含关卡流程等实际游戏消息，证明 Unity 应用日志链路可用。`process` 字段可能带括号内模块名，应用过滤不能只做完整字符串相等判断。
9. `--parse` 模式会把部分中文 Unity 日志输出成乱码，而不加 `--parse` 的原始 syslog 中相同类型的中文内容正常。CLI Probe 应优先读取原始 JSON 的 `msg` 字段并在 Rust 中解析，不直接依赖 go-ios 的 `--parse` 结果。

### 13.3 待验证项

- 通过可控测试消息进一步确认 `Debug.LogWarning`、`Debug.LogError` 和异常堆栈的级别映射
- 原生 `NSLog` 与 `os_log` 的可见性
- 原始 syslog 自解析规则、中文/Emoji 和多行堆栈的稳定性
- 锁屏、拔线、重新插入和配对失效行为
- 30～60 分钟稳定性与资源占用
- macOS Intel 和 Windows x64 + Apple Devices

### 13.4 二进制集成决策

项目现有 `src-tauri/bin/<platform>/` 已被 Git 忽略，并由 setup/bundle 脚本准备 Android sidecar。iOS 工具沿用此机制：

- 固定版本和 SHA-256，不直接依赖用户环境中的 `ios` 命令。
- setup/bundle 阶段下载或复制到 `src-tauri/bin/macos/ios`、`src-tauri/bin/windows/ios.exe`。
- Tauri 继续通过 `bundle.resources = ["bin/"]` 打入安装包。
- Probe 优先使用内置路径；开发期可明确允许临时工具路径，但正式包不回退到系统安装。

## 十四、阶段 1 CLI Probe 实施记录

实施日期：2026-09-23

已完成首版 `tools/ios-probe`：

- 独立 Cargo 工程，不依赖或修改 Tauri 后端与 React 前端。
- `doctor` 校验操作系统、CPU 架构、go-ios 路径、固定版本和设备访问能力。
- `list` 枚举设备并只提取名称、型号、系统版本、连接方式和归一化状态；提供脱敏 `displayId`。
- `logs` 读取原始 syslog JSON，在 Rust 中拆分设备、进程、模块、PID、级别和消息。
- `--process` 使用进程名前缀过滤，可匹配 `FruitQuest(UnityFramework)` 等形式。
- 中文、Emoji 和多行消息通过 JSON 编解码保留。
- Ctrl+C 被识别为主动停止，采集子进程会回收并以成功状态退出。
- go-ios 固定为 v1.3.2，其他版本会返回 `ToolVersionUnsupported`。

验证结果：5 个解析和脱敏单元测试全部通过；macOS 真机 `doctor`、`list`、`logs` 均通过。验证过程中 USB 设备由 iOS 26.6 切换为 iOS 18.7.8，Probe 能实时返回当前设备，没有使用旧缓存。

### 14.1 锁屏场景验证

验证日期：2026-09-24

- 设备锁屏并保持 USB 连接后，`list` 仍能读取设备信息，状态为 `online`。
- 锁屏期间 FruitQuest 没有产生业务日志，符合应用进入后台或挂起的预期。
- 同期内核日志持续输出，证明锁屏没有中断 USB syslog 通道。
- 直接运行编译后的 `ios-probe` 时，Ctrl+C 返回成功且 `ios-probe`、`go-ios` 均无残留。
- 通过自动化终端向 `cargo run` 外层发送 Ctrl+C 时曾出现外层会话退出而内层进程残留，因此生命周期验证统一直接运行编译产物；阶段 2 也必须由 Tauri 后端显式持有和回收子进程。

### 14.2 解锁恢复与采集中拔线

验证日期：2026-09-24

- 解锁并将 FruitQuest 切回前台后，设备保持 `online`，目标进程日志立即恢复。
- 日志采集中拔出 USB 后，go-ios 在约 1 秒内报告 `failed reading syslog: EOF` 并退出。
- 拔线后 `list` 返回空数组，未继续显示旧设备，证明设备枚举没有缓存陈旧状态。
- `ios-probe` 和 `go-ios` 均无残留进程。
- 首次验证发现 `EOF` 被归类为 `ToolExited`；已将 `failed reading syslog + EOF` 映射为 `DeviceDisconnected` 并增加回归测试。

### 14.3 拔线后重新连接

验证日期：2026-09-24

- 重新插入 USB 后，`list` 能立即重新发现同一设备并恢复为 `online`。
- 重新启动 `logs --process FruitQuest` 后，目标进程日志正常输出，旧会话没有影响新会话。
- 新会话正常 Ctrl+C 停止，退出状态成功，`ios-probe` 和 `go-ios` 均无残留。

### 14.4 FruitQuest 随机操作日志

验证日期：2026-09-24

- 连续采集约 68 秒，共得到 9998 条 FruitQuest 进程相关日志，约 147 条/秒。
- 其中 `UnityFramework` 85 条：80 条 `notice`、5 条 `error`。
- 已观察到 UnityFramework 中的 Firebase 未配置和 Adjust 环境提示等错误，证明应用/SDK 错误级别能够进入日志流。
- 共观察到 108 条多行消息，其中 UnityFramework 2 条，JSON 输出能够保留换行。
- 未观察到真正的 C# 未捕获异常或 Unity 堆栈；唯一命中 `Exception` 的消息只是 Crashlytics 对异常处理器状态的说明，不能作为异常采集验证通过的证据。

## 十五、可控 Unity 日志测试包真机准备记录

验证日期：2026-11-03

测试工程位于 `<unity-fixture-dir>`，使用 Unity 2022.3.62f3，Bundle ID 为 `com.testbench.ioslogfixture`。

已完成：

- 安装 Unity 2022.3.62f3 iOS Build Support，并成功导出 `Build/iOS/Unity-iPhone.xcodeproj`。
- 使用 `CODE_SIGNING_ALLOWED=NO` 完成一次 Xcode 真机目标编译，验证 C#、IL2CPP、UnityFramework 和 `NativeLogBridge.mm` 均能编译链接。
- 配置 Apple Development Team 和自动签名，使用 `ReleaseForRunning` 完成签名构建。
- 通过 `devicectl device install app` 安装到已连接的 iPhone。
- 通过 `devicectl device process launch` 启动应用，并确认应用进程持续运行。
- 真机界面显示正常，可见 Unity 日志、异常、中文/Emoji、多行、高频日志、`NSLog` 和 `os_log` 等可控按钮。

运行标识：

```text
Bundle ID: com.testbench.ioslogfixture
Process:   TestBenchiOSLogFixture
```

构建时仅观察到 Unity 生成工程的非阻塞警告，包括缺少 App Store 1024×1024 图标和部分 UIKit API 弃用提示；均不影响开发包安装与运行。

下一步同时使用 `ios-probe/go-ios syslog` 与 `devicectl --console` 采集每个按钮产生的日志，记录可见性、级别、中文/Emoji、多行与高频完整性，形成日志能力矩阵。
- 仅按 `process=FruitQuest` 过滤仍包含 WebKit、Network、SDK 等大量模块日志。正式交互需要进一步支持模块和级别过滤，同时保留全量落盘能力。
- 本轮发现正文中出现 `<...>:` 时，旧解析器可能误判日志级别。解析规则已改为只读取 PID 后紧邻的 `<Level>`，并增加回归测试；当前共 7 个测试通过。

### 14.5 FruitQuest 第二轮操作日志

验证日期：2026-09-24

- 连续采集约 18 秒，共得到 233 条 FruitQuest 进程相关日志。
- 级别分布为 223 条 `notice`、10 条 `error`，没有出现异常的级别字段，证明上一轮解析修复生效。
- 本轮没有 `UnityFramework` 日志，也没有命中 Warning、C# Exception 或堆栈。
- 10 条错误均来自 `libsqlite3.dylib`，表现为广告或分析缓存数据库在使用期间被删除/失效；证明原生模块错误可以正确采集，但不能替代 Unity 异常验证。
- 正常停止后没有残留 `ios-probe` 或 `go-ios` 进程。
