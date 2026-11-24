# iOS 内置工具准备与打包

日期：2026-11-10；任务：IOS2-300/310/320/330。本文区分构建准备、安装包验收和最终用户系统依赖。

## 构建准备约定

- 使用 `scripts/ios-sidecar-assets.json` 作为下载资产白名单，固定 go-ios v1.3.2，不查询 latest，不使用 PATH 中的 ios 替代内置文件。
- macOS arm64/x64 共用官方 Universal Binary `go-ios-mac.zip`；Windows x64 使用 `go-ios-win.zip`。不支持的系统/架构直接失败，不默认选择其他架构。
- 下载地址及 ZIP SHA-256 以[官方固定版本](https://github.com/danielpaulus/go-ios/releases/tag/v1.3.2)资产为准；本次通过官方 Release API digest 及实际下载交叉核对。清单中的可执行文件 SHA-256 是对已验证 ZIP 内文件另外计算的值，不冒充上游单独发布的校验文件。
- 先校验 ZIP，再只提取固定文件 ios / ios.exe，校验可执行文件哈希和 Mach-O/PE 架构；同平台准备还实际执行 `--version` 核对版本。跨平台准备只作静态验证，不声称 Windows 程序已在 macOS 运行。
- 验证成功后才替换目标 ios 文件，失败保留旧文件；临时文件清理。其他 adb、scrcpy、Unity 音频工具文件不删除、不覆盖。
- 已有正确内置文件可离线复用；缓存 ZIP 每次使用都校验，不信任已有缓存或版本标记文件。显式本地 ZIP 校验失败不回退下载其他版本。
- iOS 准备失败返回非零退出码；setup 保留 Android 原有 best-effort 行为，但不能把 iOS 准备失败降级为成功。Shell/PowerShell bundle 入口与独立 Node 入口使用同一清单与实现。

## 命令

```bash
pnpm bundle-ios                      # 仅准备当前平台 go-ios
node scripts/prepare-ios-sidecar.mjs --check  # 校验当前内置文件，不联网
pnpm bundle-bin                      # 原 adb/scrcpy 流程 + go-ios
pnpm run setup                       # 开发环境完整准备（显式运行项目脚本）
```

离线与跨平台资产检查：

```bash
node scripts/prepare-ios-sidecar.mjs --archive /path/to/go-ios-mac.zip
node scripts/prepare-ios-sidecar.mjs --platform win32 --arch x64 --archive /path/to/go-ios-win.zip --dest /tmp/testbench-ios-windows
```

`--dest` 可指定隔离目录；`--cache-dir` 可指定下载缓存目录。macOS 解包使用系统 unzip；Windows 使用系统 Windows PowerShell 的 .NET ZIP 接口，不要求安装第三方解压程序。Node 仅在开发/构建阶段使用，最终用户不需要 Node、Go、Python、Homebrew 或 Xcode。

默认输出为 `src-tauri/bin/macos/ios` 或 `src-tauri/bin/windows/ios.exe`，由 Tauri `bundle.resources = ["bin/", "third-party/"]` 收入安装包；二进制和缓存不提交 Git。

## IOS2-310 构建与产物门禁约定

- 标准 Tauri 构建前只校验内置 go-ios，不下载或修复；缺失、哈希、架构、版本不符直接失败。CI 在三个原生 runner 分别准备、校验并执行版本检查。
- macOS 构建后检查 `.app/Contents/Resources/bin/macos/ios`，校验 Universal 架构、执行权限、实际版本，并验证应用包签名；签名可能改变二进制哈希，产物阶段不强制等于上游未签名文件哈希，来源完整性由构建前门禁保证。
- Windows 对 MSI 做管理解包，检查真实安装目录 `bin/windows/ios.exe` 的哈希、PE 架构和实际版本；不以源码目录存在文件代替安装包检查。NSIS 安装及真机枚举留给 IOS2-330。
- 当前配置仅 ad-hoc 签名，没有配置 Developer ID / Apple 公证；不能宣称公证通过。未来接入公证后仍须运行同一产物检查。
- 本地检查通过与远程三个 runner 实际通过分别记账；本任务不触发发布。

标准入口 `pnpm tauri build` 通过 `beforeBuildCommand` 调用 `scripts/check-ios-build.mjs`；根据 Tauri hook 的平台/架构（独立调用时回退 Cargo target 或当前宿主）选择对应工具。单独 `pnpm build` 仅构建前端，不代表桌面安装包校验。

产物检查命令：`node scripts/check-ios-bundle.mjs /path/to/TestBench.app arm64`；Windows 参数为 MSI 管理解包后的安装根目录及 `x64`。CI 同时解开 macOS updater tar 包并运行相同检查；DMG 挂载、NSIS 安装及最终用户设备操作仍归 IOS2-330。

## IOS2-320 随包许可约定

- 在受版本控制的 `src-tauri/third-party/go-ios/` 保存固定版本上游 MIT 许可证全文及 `NOTICE.json`，记录组件版本、项目与发布来源、许可证来源和未修改上游二进制的说明；Tauri 资源配置显式随包携带该目录。
- 许可证按 v1.3.2 标签核对，哈希固定在资产清单中；版本或来源变化必须同时更新许可记录。构建前和产物检查均校验许可文件存在、内容哈希及版本来源一致，检查不联网、不自动生成替代文件。
- macOS 路径为 `.app/Contents/Resources/third-party/go-ios/`，Windows 为安装目录 `third-party/go-ios/`，不要求用户联网查看许可证。
- 本项记录 go-ios 组件许可，不宣称完成整个 TestBench 或上游全部传递依赖的许可证审计。不打包 Apple USB 驱动，Windows 连接依赖及诊断约定保持不变。

## 验收边界

IOS2-300 负责准备脚本和资产验证。IOS2-310 实现 CI/安装包门禁，IOS2-320 提供随包许可和一致性检查；Windows 原生执行、Intel runner 和远程 CI 仍待验收。内部安装包真机端到端留给 IOS2-330。不得把本地 ZIP 解包成功写成双平台安装包已通过。

Windows USB 设备连接仍依赖 Apple 官方 USB 驱动和 Apple Mobile Device Service；TestBench 不分发 Apple 驱动，驱动缺失应由设备诊断明确提示。

## 本轮验证记录

### 2026-11-23 · 优先进行 Windows x64 安装包验收

- 基线为 `d638c0f`。macOS 已真机验证正式日志骨架、应用过滤、双向切换、启停、搜索、详情和导出。iOS 保留 Apple 原始级别、Unity 推断和正文业务标记，应用选择通过 Bundle ID 映射可执行文件，采集中切换应用需先停止。这些平台差异无需在 Windows 出包前重做。
- `IOS-LOG-001～003` 继续记录 Syslog 隐私隐藏、Xcode 输出副本差异和源侧截断。可逆中文还原及搜索已接入。Windows 安装包、WebView2、进程回收和长稳仍需要实测。现有日志差异不阻塞内部出包。
- 在 macOS 临时目录使用当前提交的脚本下载官方 Windows x64 ZIP，校验固定 ZIP／二进制 SHA-256 和 PE x64 架构。打包检查 12 项通过、1 项跳过，包含 Windows 官方 ZIP 的离线准备和损坏恢复。此轮未在 Windows 执行 `ios.exe` 或构建 MSI／NSIS。
- Windows 构建走现有 GitHub Actions 手动入口，选择包含该基线的分支，下载 `testbench-windows`。手动构建只产出 Artifacts。当前远端未找到 `feature/ios`，需先提供可构建的远端分支，或在 Windows x64 上从同一提交本地构建。
- 验收顺序为 `IOS2-310/320` 原生构建与 MSI 产物检查，`IOS2-330` 实际安装并确认工具从包内启动，`IOS2-410` 无 Apple 组件时的诊断及安装 Apple Devices 后的 USB 真机启停、锁屏、拔线重连和进程回收，随后做 `IOS3-065/090` 的列表、快捷键、导出、Android 切换与 iOS 崩溃用例冒烟。60 分钟稳定性由 `IOS2-420` 单独验收。

### 2026-11-10：macOS arm64 Release DMG 与真机验收

- 基于 `4d6b000`，使用 `<local-evidence-file>` 合并临时配置：独立名称/标识、禁用 updater 产物，开启 `VITE_ENABLE_IOS_PROBE=true`。执行 `pnpm tauri build --bundles app`，实际为 Release/optimized 构建，未使用 `--debug`。构建前工具和许可门禁、前端生产构建通过。
- `pnpm tauri bundle --bundles dmg` 在沙箱内无法完成磁盘镜像操作，经系统磁盘镜像服务重试成功。DMG 为 `src-tauri/target/release/bundle/dmg/TestBench UI Acceptance_1.0.8_aarch64.dmg`。只读挂载镜像，完整复制应用到 `<acceptance-app>` 后卸载；未人工补拷内嵌工具或许可文件。
- 对复制后的应用运行产物检查：主程序 arm64、go-ios 为 arm64/x86_64 Universal；`codesign --verify --deep --strict`、内嵌工具 `--version` 和许可哈希/版本来源检查全部通过。当前仍为 ad-hoc 签名，构建明确跳过公证。
- 通过真实 `tauri://localhost` 窗口发现 iOS 18 测试机 A（iOS 18.7.8），USB/在线/已信任/未锁定/Syslog 可用，发现 1 条设备记录、1 台可采集。Probe 工具诊断显示 `<acceptance-app>/Contents/Resources/bin/macos/ios`；只读进程检查确认采集工具由该应用启动，实际执行相同包内路径，未使用仓库或 PATH 回退。
- Probe 会话 `验收会话-03`：主动停止后 idle，接收/发送均 6458，后端丢弃 0，展示窗口 5000、淘汰 1458；JSONL 实际 6458 条、3870986 字节，停止后采集子进程为 0。
- 返回正式工作区，保留原有 kernel/notice/无推断级别过滤偏好，重新开始会话，窗口及计数从 0 重新增长，真实列表出现匹配日志。观察时接收/发送均 5349、后端丢弃 0；随后采集中通过应用正常退出（⌘Q），应用和其 go-ios 子进程均退出。会话 `验收会话-04` 最终落盘 8546 条、5098178 字节。退出瞬间未读取最终 UI 计数，不把 5349 与最终落盘量直接判为不一致。
- 本轮完成 IOS2-300/310/320/330 的本机 Apple Silicon 侧验证及正式工作区安装包冒烟；配置校验、TS、生产构建、差异检查通过，无实现改动。Windows、Intel 原生 runner、远程 CI、updater 签名产物、Developer ID/公证/Gatekeeper 分发，以及无开发工具的全新机器尚未验证；不能将本机结果等同于全部平台通过。IOS2-150 只补充正常退出证据，托盘及更新前清理等未覆盖项保留。

2026-11-09（IOS2-320）：许可证全文与[固定标签原文](https://raw.githubusercontent.com/danielpaulus/go-ios/v1.3.2/LICENSE)字节一致，SHA-256 为 `d368be6f632f8f928369c6f1923cf2f884a1ae42a5f0dd218acd96f9bcfa75b4`。macOS arm64 临时 debug `.app` 实际打包 LICENSE.txt / NOTICE.json，通过签名、许可和内嵌工具启动检查。新增许可缺失、正文篡改、版本/来源过期的拒绝测试；与准备测试合计 13 项通过、0 跳过（提供两个官方 ZIP），配置/TS/前端生产构建/差异检查通过。首次构建遇到磁盘空间不足，清理可重建缓存后重试成功。Windows 安装目录随包验证仍待对应 runner；未提交或发布。

2026-11-09：macOS Apple Silicon 完成官方在线下载、SHA-256 校验、解包、架构和 `--version` 检查；官方 Windows ZIP 完成相同解包和静态校验。实际执行 `pnpm bundle-ios`、`--check`、`pnpm bundle-bin`、`pnpm run setup`，均成功准备或复用内置 ios；adb 按原脚本准备，本机 scrcpy 缺失仍按原逻辑提示，不能据此声称 Android 全部打包资源齐备。

```bash
IOS_MAC_ARCHIVE=/path/to/go-ios-mac.zip IOS_WINDOWS_ARCHIVE=/path/to/go-ios-win.zip \
  node --test scripts/tests/ios-sidecar-prepare.test.mjs
```

8 项测试通过；不提供官方 ZIP 环境变量时，其中两个真实资产测试会明确跳过，其他纯逻辑与故障测试仍运行。Windows PowerShell 原生执行、Intel 原生启动、完整安装包和签名后可执行性仍未验收。下载和二进制没有提交 Git，未修改 CI、版本号或发布配置。

2026-11-09（IOS2-310）：新增标准 Tauri 构建门禁、双平台原生产物检查脚本及 CI 接入。macOS Apple Silicon 本地使用临时配置（禁用 updater 产物、独立应用名称）执行 `pnpm tauri build --debug --bundles app` 成功；真实 `.app` 的 `codesign --verify --deep --strict` 与包内 ios 启动、版本验证通过。未修改或人工补拷应用包内资源。准备与产物故障测试共 11 项通过、0 跳过（提供两个官方 ZIP）；配置校验、TypeScript、前端生产构建和差异检查通过。未触发远程 CI，未生成正式发布包，未验证公证、Windows MSI 或 Intel 原生启动；任务保持待验收。
