# Unity 音频资源导出功能规划（长期工程）

更新时间：2026-09-02

状态：**恢复开发中（2026-09-02）**。已完成一次真实应用提取验证、独立 extractor CLI `0.1.0`、安装路径预检、设备导出控制器、工具页入口和 macOS ARM64 sidecar 本地构建；设备工具扫描当前设备第三方应用并显示包名；Windows/x64 sidecar、发布资源接入和真实设备回归尚未完成。

## 当前检查点

本功能曾于 2026-09-01 因工作优先级调整暂停，2026-09-02 恢复实现。当前仍按“小切片、可验收、持续回写”推进。

已保留并验证的内容：

- `extractor/` 独立源码：JSONL v1、标准音频识别、UnityPy 后端、split 合并、逐 clip 容错、唯一命名、CSV manifest 和 JSON summary。
- extractor 18 项标准库测试通过，不需要安装 UnityPy 即可运行单元测试。
- `src-tauri/src/adb/audio_export.rs`：严格校验 Android 包名，解析 `adb shell pm path`，识别 base/split/Asset Pack，并拒绝缺少 `base.apk` 的不完整结果。
- `src-tauri/src/audio_export/`：新增 `AudioExportController`，负责空间预检、`.part` 原子拉取、APK 资源安全解压、临时目录清理、sidecar 进程生命周期和取消状态。
- Tauri 注册了 `audio_export_available`、`export_unity_audio`、`cancel_unity_audio_export` 命令及 `audio-export-progress` 事件；工具页已增加入口、进度、取消和结果展示。
- 设备工具的 Unity 音频选择器使用当前设备的 `app_runtime_status` 已安装包列表，数据来自设备实时扫描，不依赖 TestBench 应用清单；选择器支持按包名搜索。
- 当前仓库未跟踪平台二进制；本机 macOS ARM64 已生成 sidecar，能力探测会在开发模式找到它。未打包 sidecar 的发布包仍会禁用入口并提示组件未安装。
- Mahjong Blast 2.8.7 的历史内部基线仍为 391 个 WAV、0 个解析错误，但当前连接手机未安装该应用，因此本轮不重复实测。

暂停检查点曾主动撤回的内容（现已重新实现的控制器除外）：

- 临时尝试生成的 Unity fixture、生成脚本和产物。

因此当前仍不能把“控制器/UI/单个平台 sidecar 已接入”误认为“设备导出 MVP 已完成”。完成 MVP 还需要构建其余平台 sidecar、接入发布资源并进行真实设备回归。

### 当前版本发布隔离与验证记录

音频导出功能在当前 `0.0.21` 发布的影响如下：

- 前端入口已接入，但在 sidecar 不存在时按钮保持禁用，正常用户流程不变。
- `tauri.conf.json` 已包含 `src-tauri/bin/` 资源目录；平台二进制由各平台构建流程生成，不提交到 Git。`.github/workflows/build.yml` 会在 Tauri 构建前自动生成 sidecar。
- 导出命令只有在运行时探测到 sidecar 后才会启用；未找到 sidecar 时不会执行 ADB、创建目录或启动后台任务。

已完成以下非发布写入验证（历史发布检查与本轮恢复验证合并记录）：

| 检查 | 结果 |
|---|---|
| `pnpm build` | 通过，TypeScript 和 Vite production build 成功 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 通过，13/13（2026-09-02 复测） |
| extractor 单元测试 | 通过，18/18 |
| Rust 音频控制器测试 | 通过，13/13 |
| release Rust 二进制 | 编译成功 |
| `TestBench.app` | 生成成功，ad-hoc codesign 深度校验通过 |
| DMG | 全 bundle 探测在 `bundle_dmg.sh` 阶段退出；未继续排查，也不据此声明 DMG 已验证 |

项目正式 macOS 发布脚本 `scripts/release-macos.sh` 使用 `pnpm tauri build --bundles app`，并要求 updater 私钥和更新地址。后续发布、updater 产物与 DMG 由维护者按现有流程自行执行；本功能暂停期间不再修改发布脚本、签名、版本号或更新配置。

接下来从以下顺序继续：

1. 使用 `scripts/build-unity-audio-sidecar.sh` / `.ps1` 将 extractor 打成对应平台 sidecar，并接通 JSONL 进度、取消和结果类型。
2. 在真实设备上验证 base APK、全部 split/Asset Pack 的拉取、解压和失败清理。
3. 补充退出、更新、断连和空间不足时的后台任务处理。
4. 完成发布资源接入后，再开放用户级入口。
5. 找到安装目标应用的合适设备后恢复 391 文件内部基线；该实测不阻塞当前版本发布。

## 一、结论与产品定位

TestBench 适合集成该功能，但应将其定位为“高级应用工具”，能力名称建议使用：

> **导出 Unity 应用音频**

对外描述应是“导出当前安装包、资源 split 和可访问缓存中所有可发现、可解析的音频”，不能承诺“任何应用的所有音频都能导出”。以下情况天然无法保证：资源尚未下载、资源位于无权限访问的私有目录、资源经过自定义加密、音频由运行时代码生成，或采用尚未支持的音频中间件。

首版重点不是追求格式数量，而是把已经验证过的 Unity `AudioClip`、split APK、Play Asset Delivery 和 YooAsset 流程做稳定，建立可持续扩展的解析框架。

## 二、已验证基线

2026-08-27 使用 Mahjong Blast 2.8.7（`com.nebula.mahjongtile`）完成了一次端到端验证：

| 项目 | 结果 |
|---|---:|
| 本地 base APK 中 Unity 对象 | 15,425 |
| base APK 中 AudioClip | 0 |
| 设备安装路径中额外资源包 | `split_yoo_assetpack.apk` |
| YooAsset 资源包大小 | 175,298,279 bytes |
| 扫描 bundle 数量 | 1,058 |
| 找到 AudioClip | 391 |
| 成功导出音频 | 391 个 WAV |
| 导出音频总大小 | 134,516,078 bytes |
| 解析错误 | 0 |

这次验证暴露了三个必须进入正式设计的事实：

1. 只分析用户提供的 base APK 会得到错误结论，必须优先读取设备上的完整 split 列表。
2. 不能只扫描文件名包含 `audio` 的 bundle；应扫描全部 bundle，避免遗漏场景包、活动包或命名不规范的音频。
3. 文件重名不能只按源文件名计数。曾出现“清单 391 条、磁盘实际 390 个文件”的覆盖问题，最终输出名必须按目标目录中不区分大小写的完整文件名做唯一化。

Mahjong Blast 应作为 MVP 的真实验收样本，但不得将其 APK、资源包或导出的版权音频提交到仓库。

## 三、目标与非目标

### 3.1 长期目标

- 从已连接设备的一次操作中获取应用的 base APK、split APK 和安装时 Asset Pack。
- 从本地 APK、APKS、XAPK 等包文件中提取可发现音频。
- 支持 Unity Player Data、AssetBundle、YooAsset 和 Unity `AudioClip`。
- 直接复制包中已经是标准格式的 WAV、OGG、MP3、AAC、M4A、FLAC 等文件。
- 输出来源清单、错误清单和机器可读汇总，能够说明“导出了什么、没导出什么、为什么”。
- 提供稳定的进度、取消、磁盘空间检查和临时文件清理。
- 建立解析器插件边界，后续逐步增加 Wwise、FMOD、CRIWARE 和自定义格式支持。
- 保持 Windows、macOS ARM64、macOS x64 的一致行为。

### 3.2 首版非目标

- 不承诺绕过 DRM、商业加密或应用的安全保护。
- 不主动抓包、注入应用或 Hook 运行时音频。
- 不要求 root，不把 root 设备作为正常工作流前提。
- 不保证读取普通应用的 `/data/data/<package>` 私有目录。
- 不在首版实现 Wwise、FMOD Studio、CRIWARE 等全部中间件解码。
- 不把完整 FFmpeg 打进安装包，仅为音频校验引入庞大依赖。
- 不在前端 JavaScript 中直接解析 APK 或 Unity bundle。

## 四、能力边界与兼容矩阵

| 来源或格式 | 首版优先级 | 预期支持度 | 说明 |
|---|---:|---|---|
| APK 中标准音频文件 | P0 | 高 | 按扩展名和文件头识别，原样复制 |
| Unity `assets/bin/Data` | P0 | 高 | 扫描序列化资源中的 `AudioClip` |
| `.split0/.split1...` | P0 | 高 | 严格按数字顺序合并，缺片立即报告 |
| 普通 Unity AssetBundle | P0 | 高 | 扫描全部 bundle，不依赖文件名 |
| YooAsset bundle | P0 | 高 | 已通过 Mahjong Blast 验证 |
| 安装时 Play Asset Delivery split | P0 | 高 | 通过 `adb shell pm path` 获取 |
| APKS/XAPK 本地包 | P1 | 中高 | 需要识别内部 APK 和资源包结构 |
| OBB | P1 | 中 | 先支持普通 ZIP/Unity 内容，异常容器单独报告 |
| 外部存储下载缓存 | P2 | 中 | 受 Android 版本、路径和权限影响 |
| 按需/首次运行远程资源 | P2 | 中 | 只能导出设备上已经下载的部分 |
| Wwise `.bnk/.wem` | P3 | 中 | 需要独立解析/转码模块 |
| FMOD `.bank/.fsb` | P3 | 中 | 版本、编码与许可证需要单独评估 |
| CRIWARE `.acb/.awb` | P3 | 中 | 需要独立解析模块 |
| 自定义加密 YooAsset | P3+ | 低至中 | 需要逐游戏适配解密服务 |
| 运行时生成/网络流音频 | 不承诺 | 低 | 静态资源导出无法覆盖 |

兼容矩阵要随功能演进持续维护。每次新增格式必须标记为“已验证”“实验性”或“不支持”，不能仅因代码中存在分支就声明支持。

## 五、用户工作流

### 5.1 首版工作流：从已安装应用导出

1. 用户连接设备并进入“工具 > 设备工具”。
2. TestBench 扫描当前设备第三方应用包名，用户可按包名搜索并选择目标应用。
3. 点击“导出 Unity 音频”。
4. 选择输出目录。
5. TestBench 检查设备连接、应用安装状态和本机磁盘空间。
6. 后台获取应用全部安装路径，拉取 base/split/Asset Pack 到任务临时目录。
7. 扫描、解析、导出并验证音频。
8. UI 持续显示当前阶段、已扫描 bundle、已发现音频、已写入文件和警告数量。
9. 完成后显示导出目录、文件数、总体积、失败数和“不完整导出”提示。

### 5.2 后续工作流：从本地包导出

- 支持选择单个 APK。
- 支持选择 APKS、XAPK 或包含多个 split APK 的目录。
- 如果只选到 base APK 且清单表明需要 split，必须明确提示“当前包不完整”，不能只返回 0 个音频。
- 本地包和设备包共用同一套后续扫描、解析和输出逻辑。

### 5.3 输出目录结构

默认创建独立任务目录，避免覆盖用户已有文件：

```text
<用户选择目录>/TestBench-Audio-<package>-<timestamp>/
├── audio/
│   ├── mahjong_bgm_1.wav
│   ├── mahjong_bgm_1_2.wav
│   └── ...
├── audio-manifest.csv
├── extraction-summary.json
└── extraction.log
```

`audio-manifest.csv` 至少包含：

| 字段 | 含义 |
|---|---|
| `file` | 最终输出文件名 |
| `originalName` | 资源中的原始名称 |
| `format` | 输出格式 |
| `bytes` | 输出文件大小 |
| `sourceApk` | 来源 APK/split |
| `sourceBundle` | 来源 bundle |
| `clipName` | Unity AudioClip 名称 |
| `pathId` | Unity 对象 Path ID |
| `status` | exported/skipped/failed |
| `warning` | 该资源的警告或失败原因 |

## 六、技术架构

### 6.1 分层原则

```text
React 工具页
  -> Tauri command / progress event
    -> Rust AudioExportController
      -> ADB：发现与拉取 base/split/Asset Pack
      -> 文件系统：临时目录、空间检查、安全解压、清理
      -> unity-audio-extractor sidecar
         -> UnityPy：AssetBundle/AudioClip 解码
         -> 标准音频识别与复制
         -> manifest/summary 输出
```

职责划分：

- React：收集用户选择、显示进度和结果，不处理二进制内容。
- Rust：控制任务生命周期、ADB、路径、权限、磁盘空间、sidecar 子进程和 Tauri 事件。
- Sidecar：只负责扫描给定输入目录和导出资源，不直接操作设备。

这种划分能把 Unity 解析逻辑独立测试，也能避免 Python 环境侵入 Tauri 主进程。

### 6.2 推荐新增模块

```text
src/features/tools/audio-export/
├── AudioExportPanel.tsx
├── types.ts
└── useAudioExport.ts

src-tauri/src/adb/audio_export.rs
src-tauri/src/audio_export/controller.rs
src-tauri/src/audio_export/source.rs
src-tauri/src/audio_export/security.rs

extractor/
├── pyproject.toml
├── src/unity_audio_extractor/
├── tests/
└── fixtures/
```

最终目录可在实现时按代码量调整，但不能把全部流程继续堆进 `src-tauri/src/lib.rs`。

### 6.3 Sidecar 接口

Sidecar 应提供稳定 CLI，并以 JSON Lines 输出事件：

```text
unity-audio-extractor scan --input <dir> --output <dir> --manifest <path>
```

事件类型建议：

- `started`：解析器版本、输入路径、输出路径。
- `progress`：阶段、已扫描/总数、已导出数量、当前文件。
- `warning`：可恢复异常，如单个 bundle 不兼容。
- `error`：不可恢复错误。
- `completed`：总数、大小、失败数、耗时、汇总文件路径。

进度协议必须带 `schemaVersion`，方便以后升级 sidecar 而不破坏旧版 TestBench。

### 6.4 Sidecar 打包策略

首版建议使用 Python + UnityPy 实现，但发布时打成独立可执行文件：

- 用户不需要安装 Python、pip 或 UnityPy。
- Python、UnityPy 和相关解码依赖全部锁定版本。
- Windows x64、macOS ARM64、macOS x64 分别构建。
- Tauri 只启动当前平台对应的二进制。
- CI 对 sidecar 执行单元测试、样本测试和一次真实安装包结构测试。

如果 sidecar 使安装包显著增大，可在 MVP 验证后评估“首次使用时下载已签名组件”。在完成下载签名、版本匹配、断点续传和离线策略前，不采用运行时临时 `pip install`。

### 6.5 不引入完整 FFmpeg 的原则

- WAV 输出可以检查 RIFF/WAVE 头、数据长度和基础元数据。
- OGG/MP3/AAC 等原始复制文件可做文件头与最小长度检查。
- 开发测试和 CI 可以使用 FFprobe 做额外验证。
- 正式包只有在确实需要跨格式转码时，再单独评估 FFmpeg 体积、动态库、签名和许可证。

## 七、处理流水线

### 7.1 来源发现

- 设备模式执行 `adb shell pm path <package>`，保留返回的每个路径。
- 记录包名、版本、设备序列号、每个 split 的文件名和大小。
- 识别包含 `assetpack`、`yoo`、`unitydata` 等关键词的资源包，但不能因此忽略其他 split。
- 可选探测 OBB 和外部缓存；权限不足时记录为 skipped，不让主任务失败。

### 7.2 拉取与安全解压

- 每次任务使用独立随机临时目录。
- 拉取前检查空间，建议至少保留“输入资源总大小的 3–5 倍”和固定安全余量。
- 禁止 ZIP 路径穿越：规范化后目标必须仍位于任务目录内。
- 设置压缩包条目数、单文件大小和总解压大小上限，防止 ZIP Bomb。
- 不执行 APK 中任何脚本、二进制或配置指令。
- 取消或失败时清理任务临时目录；如果清理失败，记录路径供用户手动处理。

### 7.3 资源发现

- 直接音频：扩展名和文件头双重识别。
- Unity Player Data：扫描 `assets/bin/Data` 等常见目录。
- Split 文件：用严格的 `prefix.splitN` 规则分组，检查编号从 0 连续。
- Bundle：扫描所有 `.bundle`、UnityFS/UnityWeb/UnityRaw 文件，不只依赖扩展名和名称。
- 对无法识别的大文件记录类型、大小和前若干字节摘要，方便以后补格式。

### 7.4 Unity 音频导出

- 对每个 bundle 独立加载，单个 bundle 失败不能中断全部任务。
- 只读取 `AudioClip` 对象，不无条件实例化所有对象，控制内存。
- 每个 clip 的所有 sample 都要导出，不能假定一个 clip 只有一个 sample。
- 文件名需要移除路径分隔符、控制字符和 Windows 保留字符。
- 唯一化必须同时考虑大小写、自动后缀和已经存在的用户文件。
- manifest 写入必须与文件成功落盘绑定，不能先计数后写入。

### 7.5 验证与汇总

- 对每个输出文件做最小格式校验。
- 汇总 `found/exported/skipped/failed`，四者含义保持稳定。
- 发现权限不足、资源未下载、加密或未知格式时，将总体结果标记为 `partial`，而不是 `success`。
- 只有全部已发现音频成功写出且没有已知遗漏来源时，结果才是 `complete`。

## 八、分阶段实施计划

### 阶段 0：技术验证与基线固化

状态：大部分已完成。

- [x] 验证 base APK 与 split Asset Pack 的差异。
- [x] 验证 YooAsset bundle 全量扫描。
- [x] 验证 UnityPy 能导出当前 Unity 版本的 AudioClip。
- [x] 验证 391 个 WAV 均可播放。
- [x] 发现并修复一次重名覆盖问题。
- [x] 将临时脚本整理成可测试的 extractor 工程。
- [x] 建立标准音频、split、损坏资源和重名场景的运行时合成 fixture。

验收标准：Mahjong Blast 在真实设备基线中稳定得到 391 个音频；CI 用合成输入覆盖命名、协议、split 和失败隔离。MVP 不以制作 Unity bundle fixture 为阻塞项。

### 阶段 1：设备导出 MVP

目标：从 TestBench 选择一个已安装 Unity 应用，一键导出 `AudioClip`。

- [x] 建立 sidecar 源码工程、CLI 入口和依赖版本锁定。
- [x] 实现 sidecar 内的标准音频复制、Unity Data/AssetBundle 候选扫描、split 合并和 YooAsset 通用扫描。
- [x] 实现输出唯一化、manifest 和 summary。
- [x] Rust 实现 `pm path` 安装路径解析、包名校验、base/split/Asset Pack 分类和只读 Tauri 预检命令。
- [ ] Rust 拉取 base APK 和全部 split/Asset Pack，使用 `.part` 原子写入并安全解压资源目录（代码已接入，待真实设备回归）。
- [ ] Rust 新增 `AudioExportController`，防止重复任务并支持取消（代码已接入，待 sidecar/取消集成测试）。
- [ ] 建立 Tauri progress event 和完成结果类型（代码已接入，待 sidecar 端到端验证）。
- [ ] 工具页新增“导出 Unity 音频”入口、目录选择、进度和结果展示（代码已接入，sidecar 缺失时禁用）。
- [ ] 实现磁盘空间预检和临时目录清理（代码已接入，待异常路径测试）。
- [ ] 更新退出、隐藏、自动更新时的后台任务处理策略。

Sidecar 构建约定：

- macOS ARM64/x64 必须在对应架构机器上分别构建；Windows 使用 Windows x64 构建。
- 构建器依赖固定在 `extractor/packaging-requirements.txt`，运行时依赖固定在 `extractor/requirements.lock`。
- 构建脚本必须执行 `--version` 冒烟检查，并将二进制放入 `src-tauri/bin/<platform>/`；macOS CI 还会检查最终 `.app` 内嵌路径。
- `extractor/.sidecar-build/` 及 PyInstaller 临时产物不得提交到仓库。

验收标准：

- Mahjong Blast 导出结果为 391 个 WAV，错误数为 0。
- 只拿到 base APK 时能明确提示缺失资源 split，不显示“成功导出 0 个”。
- 同名、大小写不同名和原始带路径文件名不会覆盖。
- 用户取消后 sidecar/ADB 子进程退出，临时文件可清理。
- 任务失败不会影响日志、投屏、录屏等现有功能。

### 阶段 2：本地包与可靠性增强

- [ ] 支持本地 APK。
- [ ] 支持 APKS/XAPK 和 split APK 目录。
- [ ] 支持 OBB 中的标准 Unity 内容。
- [ ] 增加断连恢复提示和拉取失败重试。
- [ ] 增加未知大文件报告和诊断日志导出。
- [ ] 增加任务历史摘要，但不持久化 APK 或音频内容。
- [ ] 优化大包扫描内存和并发策略。

验收标准：同一完整应用通过“设备模式”和“本地包模式”导出的资源集合一致；异常包不会造成 UI 卡死或无限占用磁盘。

### 阶段 3：已下载缓存和更多资源系统

- [ ] 探测 `/sdcard/Android/data/<package>/files` 等可访问外部目录。
- [ ] 区分安装资源、首次启动资源、按需下载资源。
- [ ] 支持用户在运行游戏并下载资源后执行“重新扫描”。
- [ ] 评估可调试应用通过 `run-as` 读取私有目录的能力。
- [ ] 建立资源系统适配接口，不在主流程中写游戏特例。

验收标准：权限允许时能发现运行后下载的新资源；权限不足时提供明确边界，不诱导用户开启 root。

### 阶段 4：音频中间件扩展

按真实需求排序，不预先实现所有格式：

- [ ] Wwise `.bnk/.wem` 探测、清单和可选解码。
- [ ] FMOD `.bank/.fsb` 探测、清单和可选解码。
- [ ] CRIWARE `.acb/.awb` 探测、清单和可选解码。
- [ ] 常见编码转 WAV 的统一输出策略。
- [ ] 每个模块完成依赖许可证和再分发审计。

验收标准：每种中间件至少有自建 fixture、失败样本和跨平台 CI；实验性解析器必须在 UI 和 summary 中明确标注。

### 阶段 5：长期兼容与维护

- [ ] 建立 Unity 版本兼容矩阵。
- [ ] 建立 sidecar 独立版本和协议兼容策略。
- [ ] 建立默认关闭的匿名诊断选项；未获用户明确同意时，不上传任何文件名或资源内容。
- [ ] 增加解析性能基准，防止版本升级显著退化。
- [ ] 定期升级 UnityPy 和解码依赖，先跑兼容测试再发布。
- [ ] 根据真实失败样本补充解析器，而不是按格式列表盲目扩张。

## 九、已知问题与应对策略

| 问题 | 影响 | 应对策略 |
|---|---|---|
| 资源 split 缺失 | 导出为 0 或严重不完整 | 设备模式默认获取全部 `pm path`；本地模式检查 required split |
| 资源尚未下载 | 结果不完整 | 标记 partial，引导运行应用完成下载后重试 |
| 应用私有目录无权限 | 无法读取缓存 | 清晰报告权限边界，不默认 root |
| YooAsset 自定义加密 | bundle 无法解析 | 识别加密特征，保留适配器接口，按游戏单独扩展 |
| UnityPy/Unity 版本不兼容 | 单个或全部 bundle 失败 | 单 bundle 隔离、版本锁定、兼容矩阵、fixture 回归 |
| 音频中间件格式未知 | 找到容器但无法播放 | 先输出容器和清单，后续插件化解析 |
| 文件名冲突 | 静默覆盖资源 | 不区分大小写唯一化，写入后再计入 manifest |
| Windows 路径限制 | 写入失败 | 清洗保留名、控制长度、长路径测试 |
| 大包导致空间不足 | 任务中途失败 | 预估 3–5 倍空间、阶段检查、失败清理 |
| 扫描耗时长 | 用户误认为卡死 | JSONL 进度、当前文件、阶段耗时、取消按钮 |
| APK/ZIP 恶意内容 | 路径穿越或资源耗尽 | 不信任输入、限制条目和大小、绝不执行包内内容 |
| Sidecar 增大安装包 | 更新下载变大 | 测量后决定内置或签名按需下载 |
| 第三方许可证 | 无法安全分发 | 发布前建立 NOTICE 和依赖许可证审计 |

## 十、测试策略

### 10.1 单元测试

- split 编号排序、缺片、重复片处理。
- ZIP 路径穿越与解压大小限制。
- 文件名清洗、Windows 保留名、超长文件名。
- 大小写冲突、后缀冲突和多次导出冲突。
- manifest 只记录成功写入文件。
- JSONL 协议的未知字段、未知事件和版本兼容。
- 取消、超时和子进程退出。

### 10.2 Fixture 测试

仓库只保留自建或明确允许再分发的小样本：

- 单个 WAV AudioClip 的 Unity bundle。
- 一个 clip 多个 sample。
- 两个 bundle 内同名音频。
- `.split0/.split1` 合并样本。
- 损坏 bundle。
- 加密/未知 bundle 占位样本。
- 包含 ZIP 路径穿越条目的恶意测试包。

### 10.3 集成测试

- macOS ARM64、macOS x64、Windows x64 各跑一次 sidecar smoke test。
- 模拟 ADB 返回 base + ABI split + asset pack。
- 模拟设备断连、拉取中断和空间不足。
- 验证用户退出应用或安装更新时任务能停止。

### 10.4 真实应用验收

真实商业应用仅在内部测试环境使用，不进入 Git、CI Artifact 或公开日志。记录：

- 应用版本、Unity 版本、资源系统。
- 安装 split 清单和资源总大小。
- found/exported/skipped/failed 数量。
- 输出总大小和总耗时。
- 解析器版本和异常摘要。

## 十一、发布与依赖管理

- Sidecar 版本与 TestBench 版本均写入 `extraction-summary.json`。
- Python 和所有 wheel 使用锁文件固定，并保存构建哈希。
- macOS sidecar 需要分别为 ARM64/x64 构建并随 App 签名。
- Windows sidecar 启动时必须隐藏控制台窗口。
- CI 先构建 sidecar，再将其复制到对应平台 `src-tauri/bin` 或独立 resource 目录。
- 发布脚本必须验证 sidecar 存在、可执行、架构正确，并运行 `--version` smoke test。
- 维护第三方 NOTICE，特别审查音频解码库、FMOD/Wwise/CRIWARE 相关组件和未来可能引入的 FFmpeg。

## 十二、进度与可观测性

前端至少展示以下阶段：

1. 检查设备与应用。
2. 获取安装包清单。
3. 拉取资源包。
4. 解压与合并 split。
5. 扫描 bundle。
6. 解码和写入音频。
7. 校验与生成清单。
8. 清理临时文件。

日志不得输出音频内容，但可以记录包名、文件大小、bundle 名、Path ID、耗时和错误类型。对超大文件名或用户路径应做长度限制，避免日志本身被异常输入放大。

## 十三、首轮实现建议顺序

总体按以下顺序推进，前四步已经完成：

1. [x] 建立 `extractor/` 工程，迁移已经验证的 UnityPy 逻辑。
2. [x] 完成运行时合成 fixture、输出唯一化和 manifest 测试。
3. [x] 定义 JSONL 协议和 extractor `--version`。
4. [x] Rust 实现安装路径发现和只读预检命令。
5. [ ] Rust 实现 split 拉取和临时目录管理。
6. [ ] Rust 接入 sidecar、进度事件和取消控制器。
7. [ ] 前端应用工具页增加入口和进度面板。
8. [ ] 在真实设备上用 Mahjong Blast 做 391 文件基线验收。
9. [ ] 接入三平台 CI 和发布资源。
10. [ ] 更新用户手册、维护文档和第三方 NOTICE。

首个可交付切片应只覆盖“设备已安装 + Unity/YooAsset + WAV 输出”，不要同时展开 APKS、Wwise 和远程缓存。

恢复开发后的首个实现切片：

1. 手机连接并授权 ADB 后，用只读预检命令确认 Mahjong Blast 返回 `base.apk` 和 `split_yoo_assetpack.apk`。
2. 实现任务临时目录、逐个 split 拉取、空间预检和失败清理。
3. 定义 Rust 与 sidecar 之间的协议类型，并用真实设备资源跑通进度、警告和完成状态。
4. 完成以上后再接前端入口，避免 UI 先绑定不稳定的后端接口。

## 十四、长期维护规则

- 每发现一个失败应用，先保存脱敏诊断信息，再判断属于已有格式回归还是新格式。
- 新增游戏特例前，先确认能否抽象为资源系统、加密器或容器适配器。
- 新解析器必须有可重复的合成测试或获得授权的 fixture、失败行为、跨平台验证和许可证结论。
- 每次升级 UnityPy 或打包工具，都必须重新跑现有自动化测试和 Mahjong Blast 真实设备基线。
- 每个 TestBench 功能版本更新本文档的阶段状态、兼容矩阵和变更记录。
- 不把“没有抛异常”当作完整成功；完整性必须由来源覆盖和数量汇总共同判断。

## 十五、待确认决策

当前建议默认值如下，编码前可根据实际需求调整：

| 决策 | 当前建议 |
|---|---|
| 功能名称 | 导出 Unity 音频 |
| UI 位置 | 工具 > 设备工具 > Unity 音频导出 |
| MVP 来源 | 已安装应用 |
| MVP 输出 | WAV + CSV manifest + JSON summary |
| 解析实现 | Python + UnityPy 独立 sidecar |
| Sidecar 分发 | MVP 随安装包内置，测量体积后再评估按需下载 |
| Bundle 扫描 | 默认扫描全部 bundle |
| 私有目录/root | MVP 不支持 |
| 完整 FFmpeg | MVP 不内置 |
| 失败策略 | 单资源失败继续，总体标记 partial |

## 十六、变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-27 | 完成 Mahjong Blast 手工端到端提取，确认 split YooAsset 是关键资源来源，导出 391 个 WAV |
| 2026-09-01 | 建立长期规划，明确 MVP、分阶段路线、架构边界、风险与验收标准 |
| 2026-09-01 | 建立 `extractor/` CLI `0.1.0` 首版：JSONL v1、标准音频识别、split 合并、UnityPy 后端、逐 clip 容错、唯一命名、manifest/summary |
| 2026-09-01 | 优化 Unity 样本流式处理；补充不完整 split 隔离、`.resource/.resS` 伴随文件暂存，自动化测试增至 18 项并全部通过 |
| 2026-09-01 | Rust 新增安装路径预检：严格校验包名，解析 `pm path`，识别 base/split/Asset Pack，4 项新增测试通过；按实际验收选择，MVP 改为真实设备测试优先 |
| 2026-09-01 | 按工作优先级暂停功能；撤回未完成的拉取控制器和临时 Unity fixture，仅保留已验证 extractor 与只读预检。当前版本不展示入口、不打包 sidecar |
| 2026-09-01 | 暂停前完成发布隔离检查：前端构建、Rust 11 项测试、extractor 18 项测试通过，release 二进制与签名 `.app` 生成成功；DMG 探测未完成，后续发布由维护者自行处理 |
| 2026-09-02 | 恢复阶段 1：新增 Rust `AudioExportController`（空间检查、ADB 拉取、原子写入、安全解压、取消和清理），接入 Tauri 命令/进度事件与应用工具页；前端构建通过，Rust 13 项测试、extractor 18 项测试通过；sidecar 尚未打包，入口默认禁用 |
| 2026-09-02 | 增加 macOS/Windows sidecar 可重复打包脚本、PyInstaller 构建依赖锁定和 `--version` 冒烟校验；macOS ARM64 sidecar 已本地生成并通过临时 WAV 扫描冒烟测试，未提交平台二进制 |
| 2026-09-02 | 将 sidecar 构建接入 `.github/workflows/build.yml` 的 Windows/macOS 构建矩阵；tag 发布前会自动安装固定依赖、构建并校验 sidecar |
| 2026-09-02 | 按需求将 Unity 音频导出移至“设备工具”，应用选择改为设备实时 `pm list packages` 扫描结果，不再依赖 TestBench 应用清单；前端构建、Rust 测试和差异检查通过 |
| 2026-09-02 | 评估设备应用名称解析后放弃该方案：不同设备上的名称获取成本和可靠性不足，设备工具恢复为直接显示包名并按包名搜索 |

## 十七、长期任务推进方式

本功能按“小切片、可验收、持续回写”推进，不以一次性完成全部格式为目标。每轮实现遵循以下闭环：

1. 从真实失败样本、已有路线图或用户反馈中选择一个范围明确的能力。
2. 先补合成测试和预期结果，再修改 extractor、Rust 或前端中的对应一层；需要验证真实 UnityPy 路径时直接使用已授权的真实设备。
3. 运行单元测试、集成测试和已有真实应用内部基线，确认没有减少既有导出结果。
4. 更新本文档中的阶段勾选、兼容矩阵、已知限制和变更记录。
5. 记录下一轮唯一的优先切片，避免同时展开多个解析器或平台问题。

每个新增格式或适配器至少要留下以下维护信息：

| 信息 | 要求 |
|---|---|
| 来源类型 | APK、split、OBB、外部缓存或其他 |
| 容器/编码 | 识别依据、版本范围、输出格式 |
| 支持状态 | 已验证、实验性或仅探测 |
| 测试样本 | 优先运行时合成；需要保存 fixture 时必须具有明确再分发权限 |
| 完整性判定 | 哪些来源不可访问时必须标记 `partial` |
| 许可证 | 解析器、解码器和打包依赖的再分发结论 |
| 性能基线 | 样本大小、耗时、峰值内存和临时空间 |

完成某个任务项必须同时满足“功能实现、自动化测试、错误/取消行为、文档状态”四项；只有代码分支存在不能勾选完成。真实商业应用只保留脱敏计数和错误摘要，不保存或提交 APK、bundle、文件名清单及导出音频。

开发机执行大型 Tauri、Rust 或 sidecar 打包前必须检查剩余磁盘空间。空间不足时优先清理可再生成的构建缓存，且需要先确认目标；不得为赶进度删除用户源文件、测试样本或未提交改动。
