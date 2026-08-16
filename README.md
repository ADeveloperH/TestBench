# TestBench（测试工作台）

面向测试与开发的一站式 Android 设备工作台，覆盖日志查看、设备管理、常用调试工具、日志回归测试、投屏录屏与性能监控。面向 Windows 与 macOS 用户，基于 Tauri 2 构建，后端用 Rust 调用本机 `adb` / `scrcpy`，前端用 React + TypeScript。

## 技术栈

- **框架**：Tauri 2（体积小、内存低，适合长时间挂着刷日志）
- **后端**：Rust —— 枚举设备、启动 `adb logcat` 子进程、流式读取 stdout、通过事件推给前端
- **前端**：React 19 + TypeScript + Vite，虚拟滚动用 `@tanstack/react-virtual`
- **依赖**：本机需安装 Android Platform-Tools（`adb` 在 `PATH` 中）

## 已实现功能

- 设备枚举（USB 与 WiFi，`adb devices -l`），手动刷新，多设备下拉选择
- 选中设备自动开始抓取 `adb logcat -v threadtime`
- 实时流式日志，批量刷新 + 环形缓冲（上限 20 万行，超出丢最旧）
- 按级别过滤（Verbose/Debug/Info/Warn/Error/Fatal/Assert，取最低级别）
- 关键字搜索（子串或正则，匹配消息或 Tag）
- Tag 过滤（逗号分隔，多值命中任一）
- 应用下拉选择过滤（只显示配置中的应用，选中后按包名解析 PID 过滤，支持远程更新清单）
- 按级别着色、多行消息续行合并
- 长日志折叠（超长单行折叠为一行，双击整行或点左侧箭头展开/收起完整内容）
- 暂停/继续、自动滚动、清空（本地缓冲 + 设备 logcat 缓冲区）、导出（系统保存对话框）
- 缓冲区选择（main/system/crash/radio/events/all）
- 已保存过滤器（命名保存当前级别/搜索/Tag/PID 组合，下拉一键切换；设置页支持增删改查与排序）
- 日志跳转（跳到最早 / 最新 / 指定行号）
- WiFi 配对（配对码/二维码扫码）与连接，配对成功后自动连接，地址带历史记录
- 配置导入导出（打包分享给同事，导入按「本地优先」合并）与调试日志导出（诊断报告）
- 单实例、窗口大小位置记忆、日志按天轮转、系统托盘（关窗口隐藏继续抓日志）
- 拖拽 APK 安装、快捷键（空格暂停、Cmd/Ctrl+L 清空、Cmd/Ctrl+E 导出）
- 录屏/安装完成系统通知、深色/浅色主题切换

## 计划中的功能

- [ ] macOS 签名/公证、Windows 签名（分发必需）
- [ ] 自动更新（GitHub Releases + tauri-updater，发布后一键更新）
- [ ] 应用图标（替换默认 Tauri 图标）
- [ ] CI 双平台构建（GitHub Actions 出 macOS + Windows 包）

## 架构

```
前端（React）
  ├─ core/      共享基础：类型、常量、日志解析、应用清单
  ├─ features/  按功能分模块：logcat / testcases / tools / filters / settings / devices
  ├─ components/ 通用 UI：Tip、HistoryInput
  └─ App        视图切换 + 日志页组装
        │ invoke() 调用命令 / listen() 订阅事件
后端（Rust）
  ├─ lib.rs     命令定义 + 全局状态 + logcat 事件发射
  └─ adb/       adb/scrcpy 模块：devices / logcat / apps / install / info / scrcpy
```

后端通过 `logcat-line` 事件把每一行原文推给前端，前端解析成结构化字段后统一过滤，因此切换过滤条件无需重启 `logcat` 进程。

## 目录结构

```
testbench/
├── src/                        # 前端源码
│   ├── App.tsx                 # 主界面（视图切换 + 日志页组装）
│   ├── App.css                 # 样式（深色主题）
│   ├── core/                   # 共享基础
│   │   ├── types.ts            # 类型与常量
│   │   ├── logcat.ts           # threadtime 行解析 + ANSI 过滤
│   │   └── apps.ts             # 应用清单（远程 + 内置）
│   ├── features/               # 按功能模块
│   │   ├── logcat/             # 日志查看（useLogcat + LogList）
│   │   ├── testcases/          # 测试用例（引擎 + 侧边栏 + 管理）
│   │   ├── tools/              # 工具页
│   │   ├── filters/            # 保存过滤器
│   │   ├── settings/           # 设置页（usePrefs + ManagePage）
│   │   └── devices/            # WiFi 配对面板
│   └── components/             # 通用 UI（Tip、HistoryInput）
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs              # 命令定义 + 全局状态 + 事件发射
│   │   └── adb/                # adb/scrcpy 模块拆分
│   │       ├── mod.rs          # 路径初始化 + 共享 helper + 重导出
│   │       ├── devices.rs      # 设备枚举、配对、连接
│   │       ├── logcat.rs       # logcat 子进程
│   │       ├── apps.rs         # 应用清单、PID、后门、重启、清数据、卸载
│   │       ├── install.rs      # 截图、安装 APK
│   │       ├── info.rs         # 设备信息、Activity、Alarm、性能
│   │       └── scrcpy.rs       # 投屏、录屏
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

## 开发

前置：Rust 工具链、Node.js + pnpm、Android Platform-Tools。

```bash
pnpm install
pnpm tauri dev
```

## 构建与打包

```bash
pnpm tauri build
```

产物按当前操作系统生成（macOS 出 `.app`/`.dmg`，Windows 出 `.exe`/`.msi`）。跨平台产物建议用 CI（GitHub Actions）分别跑 macOS 与 Windows runner。

## 日志与调试

调试阶段开启详细日志（Debug 级别），同时输出到终端和日志文件：

- **终端**：`pnpm tauri dev` 运行时会实时打印。
- **日志文件**：
  - macOS：`~/Library/Logs/com.ushareit.testbench/testbench.log`
  - Windows：`%LOCALAPPDATA%\com.ushareit.testbench\logs\testbench.log`

遇到问题时，把日志文件内容（或终端输出）发出来即可定位。正式发布前可把日志级别调低（`lib.rs` 里 `.level(log::LevelFilter::Debug)` 改为 `Info`）并移除不必要的日志。

## 内置 adb / scrcpy（免安装分发）

应用内置了 adb 与 scrcpy 二进制（`src-tauri/bin/<平台>/`），运行时优先使用内置版本、找不到时回退到系统 PATH，因此终端用户无需自行安装 Android Platform-Tools 或 scrcpy。

- 生成内置二进制：`bash scripts/bundle-binaries.sh`（macOS 依赖 brew 的 scrcpy 与 dylibbundler）
- Windows 生成内置二进制：在 Windows 机器上运行 `scripts/bundle-binaries.ps1`（自动下载 scrcpy-win64 与 adb）
- `src-tauri/bin/` 已加入 `.gitignore`，二进制不提交仓库，由脚本按需生成

## 应用清单（远程更新）

「应用」下拉框的清单采用三级兜底：远程 → 本地缓存 → 内置默认。

- 远程地址：`https://raw.githubusercontent.com/ADeveloperH/ADBTools/main/config/projects.json`
- 新增应用只需修改该文件并 push，用户下次启动自动更新，无需重新打包/安装；
- 离线时使用上次拉取的本地缓存；首次安装即离线则用内置的默认应用清单。

## WiFi 配对说明

Android 11+ 无线调试分「配对」与「连接」两步：

- **配对**（一次性建立信任），两种方式：
  - 配对码：手机「使用配对码配对设备」给出配对地址与 6 位码，填入工具点「配对」；
  - 二维码：工具「生成二维码配对」，手机「无线调试 → 扫码配对」扫工具上的二维码，配对自动完成。
- **连接**：配对成功后工具自动用 mDNS 发现连接地址并连接；若未自动发现，把手机「无线调试」页面顶部的「IP 地址和端口」填入「连接地址」点「连接」。

配对地址与连接地址均带历史记录（点击输入框弹出，可删除）。注意：公共/访客 WiFi（客户端隔离）会因 mDNS 不通而配对失败，建议改用手机热点。
