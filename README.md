# TestBench（测试工作台）

面向测试与开发的一站式 Android 设备工作台，覆盖日志查看、设备管理、常用调试工具、日志回归测试、投屏录屏与性能监控。面向 Windows 与 macOS 用户，基于 Tauri 2 构建，后端用 Rust 调用内置 `adb` / `scrcpy`，前端用 React + TypeScript。

## 技术栈

- **框架**：Tauri 2（体积小、内存低，适合长时间挂着刷日志）
- **后端**：Rust —— 枚举设备、启动 `adb logcat` 子进程、流式读取 stdout、通过事件推给前端
- **前端**：React 19 + TypeScript + Vite，虚拟滚动用 `@tanstack/react-virtual`
- **依赖**：内置 `adb` / `scrcpy` 二进制，终端用户无需安装 Android Platform-Tools

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
- 测试用例（规则引擎：AND/OR 条件树、出现 N 次阈值、缺失判定；按模块分组管理；侧边栏实时状态与问题优先排序）
- 内置配置远程更新（remote-config.json：应用/常用/过滤器/测试用例，远程 → 缓存 → 代码内置三级兜底，更新无需发版）
- 检查更新（查询 GitHub Releases 提示新版本，一键跳转下载页）

## 计划中的功能

- [ ] macOS 签名/公证、Windows 签名（分发必需）
- [x] 检查更新提示（已实现：无签名环境下采用「提示 + 跳转下载页」的半自动方式）
- [ ] 全自动安装式更新（tauri-updater，需先完成代码签名）
- [x] 应用图标（自定义图标，源文件 `src-tauri/icons/app-icon-source.png`）

## 架构

```
前端（React）
  ├─ core/      共享基础：类型、常量、日志解析、应用清单、内置配置注册表、远程配置
  ├─ features/  按功能分模块：logcat / testcases / tools / filters / settings / devices
  ├─ components/ 通用 UI：Tip、HistoryInput
  └─ App        视图切换 + 日志页组装
        │ invoke() 调用命令 / listen() 订阅事件
后端（Rust）
  ├─ lib.rs     命令定义 + 全局状态 + logcat 事件发射 + 更新检查/配置发布
  └─ adb/       adb/scrcpy 模块：devices / logcat / apps / install / info / scrcpy
```

后端通过 `logcat-line` 事件把每一行原文推给前端，前端解析成结构化字段后统一过滤，因此切换过滤条件无需重启 `logcat` 进程。

## 目录结构

```
testbench/
├── .github/workflows/          # CI：build.yml 构建+发布 Release、validate-config.yml 配置校验
├── config/                     # 内置配置：remote-config.json（远程更新）、projects.json（旧应用清单）
├── scripts/                    # 开发脚本：setup、bundle-bin、validate-config
├── src/                        # 前端源码
│   ├── App.tsx                 # 主界面（视图切换 + 日志页组装）
│   ├── App.css                 # 样式（深色主题）
│   ├── core/                   # 共享基础
│   │   ├── types.ts            # 类型与常量
│   │   ├── logcat.ts           # threadtime 行解析 + ANSI 过滤
│   │   ├── apps.ts             # 应用清单（代码内置来源）
│   │   ├── builtinRegistry.ts  # 内置配置注册表（远程按 section 覆盖代码内置）
│   │   └── remoteConfig.ts     # 远程配置拉取/校验/缓存/应用、发布配置生成
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

> **终端用户不需要任何环境**，本节约环境搭建只针对开发者。

### 环境要求

- **Node.js 18+**（建议装最新 LTS）
- **pnpm**：`npm install -g pnpm`
- **Rust 工具链**：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- 平台依赖：
  - **macOS**：`xcode-select --install`（Xcode Command Line Tools）
  - **Windows**：Visual Studio Build Tools（勾选「使用 C++ 的桌面开发」）+ WebView2 Runtime（Win11 自带）
- 本机调试需要 adb / scrcpy 二进制：运行 `pnpm run setup`（或 `pnpm run bundle-bin`）生成内置二进制，或安装 Android Platform-Tools 走 PATH 回退

### 安装与启动

```bash
pnpm install
pnpm run setup     # 可选：一键检查 pnpm/cargo、安装依赖、打包内置 adb/scrcpy
pnpm tauri dev
```

`pnpm run setup` 做的事：检查 pnpm 与 cargo（缺失时打印对应安装命令）→ `pnpm install` → 打包内置 adb/scrcpy（macOS 依赖 brew 的 scrcpy 与 dylibbundler，缺失时仅告警不阻断）。跳过它也能直接 `pnpm tauri dev`：仓库已提交 `src-tauri/bin/` 的占位目录保证构建通过，运行时找不到内置二进制会自动回退到系统 PATH 的 adb/scrcpy；但要投屏/录屏或打包分发前建议先执行一次。

首次启动会编译整个 Rust 工程，需等待几分钟。若 `pnpm install` 报 pnpm store 路径问题，可显式指定：`pnpm install --store-dir <本地可写目录>`。

### 常见问题

- **`sh: tauri: command not found` / `node_modules missing`**：先执行 `pnpm install` 再启动。
- **`failed to run 'cargo metadata' ... No such file or directory`**：终端 PATH 里没有 cargo（macOS 新开终端常见，cargo 装在 `~/.cargo/bin`）。执行后再启动：

  ```bash
  export PATH="$HOME/.cargo/bin:$PATH"   # 可写入 ~/.zshrc 一劳永逸
  pnpm tauri dev
  ```

  Windows 下 rustup 安装时会自动把 `%USERPROFILE%\.cargo\bin` 加入 PATH，通常不需要手动处理。
- **`resource path 'bin' doesn't exist`（构建报错）**：`src-tauri/bin/` 目录不存在。正常 clone 不会出现（仓库提交了占位目录）；若手动删除了该目录，执行 `pnpm run setup` 或 `pnpm run bundle-bin` 重新生成。
- **投屏后系统界面能点、游戏内点击无效**：OPPO/小米等 ROM 需开启开发者选项里的「**USB调试（安全设置）**」（不同品牌叫法略有差异，小米/OPPO 均为该名称）。未开启时，模拟点击无法注入第三方应用（系统桌面/Home 不受影响），表现为投屏点击在游戏内无反应。快速判定：开发者选项打开「指针位置」，执行 `adb shell input tap <x> <y>`——若屏幕上出现白色轨迹但应用不响应，即为该开关未开启。注意：部分 OPPO 机型开启该开关需插入 SIM 卡并登录 OPPO 账号验证身份；验证通过后拔掉 SIM 卡开关依然保持开启。

## 构建与打包

```bash
pnpm tauri build
```

产物按当前操作系统生成（macOS 出 `.app`/`.dmg`，Windows 出 `.exe`/`.msi`）。跨平台构建已配置 GitHub Actions（`.github/workflows/build.yml`），分两种使用方式：

### 内部测试（手动触发）

仓库 Actions 页 → `构建安装包` → Run workflow，构建完成后从该次运行的 **Artifacts** 下载 Windows（msi/exe）与 macOS（arm64/x64 dmg）安装包。手动触发不会创建 Release。

### 发布版本（面向用户，自动创建 Release）

1. 修改 `src-tauri/tauri.conf.json` 与 `package.json` 里的版本号（保持一致）
2. 打 tag 并推送：

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. Actions 自动构建三个平台的安装包，完成后自动创建 GitHub Release 并上传资产。用户下载地址：

   ```text
   https://github.com/ADeveloperH/TestBench/releases
   ```

   每个版本一个 Release，点开版本即可看到 dmg / exe / msi 附件直接下载。

> 同一 tag 重新触发构建时不会重复创建 Release，只会把新构建的安装包覆盖上传到已有 Release。

### 应用图标

图标源文件为 `src-tauri/icons/app-icon-source.png`。修改设计后重新生成各平台图标：

```bash
pnpm tauri icon src-tauri/icons/app-icon-source.png
```

生成产物包括 macOS `icon.icns`、Windows `icon.ico` 与各尺寸 PNG；窗口图标与系统托盘图标均随 bundle 配置自动使用。图标文件变化会自动触发重编译（`build.rs` 已做哈希跟踪），`pnpm tauri dev` 无需额外操作即可看到新图标。

## 日志与调试

调试阶段开启详细日志（Debug 级别），同时输出到终端和日志文件：

- **终端**：`pnpm tauri dev` 运行时会实时打印。
- **日志文件**：
  - macOS：`~/Library/Logs/com.ushareit.testbench/testbench.log`
  - Windows：`%LOCALAPPDATA%\com.ushareit.testbench\logs\testbench.log`

遇到问题时，把日志文件内容（或终端输出）发出来即可定位。正式发布前可把日志级别调低（`lib.rs` 里 `.level(log::LevelFilter::Debug)` 改为 `Info`）并移除不必要的日志。

## 内置 adb / scrcpy（免安装分发）

应用内置了 adb 与 scrcpy 二进制（`src-tauri/bin/<平台>/`），运行时优先使用内置版本、找不到时回退到系统 PATH，因此终端用户无需自行安装 Android Platform-Tools 或 scrcpy。

- 生成内置二进制：`pnpm run bundle-bin`（macOS 等价于 `bash scripts/bundle-binaries.sh`，依赖 brew 的 scrcpy 与 dylibbundler）
- Windows 生成内置二进制：在 Windows 机器上运行 `pnpm run bundle-bin`（自动下载 scrcpy-win64 与 adb）
- 二进制不提交仓库（`.gitignore`），目录本身提交了 `.gitkeep` 占位，保证 clone 后可直接构建运行

## 内置配置（远程更新）

设置页各 tab 的**内置**配置（应用清单、搜索/Tag 常用、过滤器、测试用例）统一由仓库 `config/remote-config.json` 维护，采用三级兜底：

```
远程配置（remote-config.json）
  → 本地缓存（上次拉取结果，12 小时有效）
    → 代码内置（apps.ts / builtins.ts / engine.ts 里的默认值）
```

- 远程地址：`https://raw.githubusercontent.com/ADeveloperH/TestBench/main/config/remote-config.json`（备选镜像 `cdn.jsdelivr.net`，失败自动切换）
- 每个 section（`apps` / `searchFavorites` / `tagFavorites` / `filters` / `testCases`）可选：**远程配置写了哪个 section 就整体覆盖哪个**，没写的继续用代码内置
- 用户本地数据（自己添加的应用/常用/过滤器/用例）与远程内置合并时**本地优先、只增不改**，永远不会被远程覆盖
- 修改该文件 push 后，用户下次启动（或设置页点「刷新配置」）自动更新，无需重新打包/安装
- push 时 CI 会自动校验 JSON 格式（`.github/workflows/validate-config.yml`），格式错误不允许合并

> 注意：某个 section 一旦在 `remote-config.json` 中出现，**代码内置即整体失效、以远程为准**。当前远程文件已包含全部 5 个 section（含测试用例），因此之后调整内置配置（包括测试用例）请走发布页或直接改远程文件，修改 `apps.ts` / `builtins.ts` / `engine.ts` 里的代码内置不再生效。

### 调试模式发布配置页

开发构建（`pnpm tauri dev`）的设置页会多出一个「**发布配置**」tab：

1. 先在界面上把各 tab 的配置整理好（内置 + 本地增删）
2. 「发布配置」→「生成配置 JSON」把当前生效配置导出为 remote-config.json 内容
3. 「校验」→ 一键「**发布到远程**」自动提交到仓库，所有用户下次启动生效

发布凭据（首次使用）：

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
2. Repository access 选择仅 `ADeveloperH/TestBench`；Permissions 里 **Contents 设为 Read and write**，其余保持只读/无权限
3. 生成的 token 粘贴到发布页「保存凭据」（仅保存在本机，调试包本身不含凭据，可随时「清除凭据」）；点「**测试凭据**」可立即检查该 token 对本仓库的读写权限，确认有写权限后再发布

提交走 GitHub Contents API，权限由 token 范围控制：没有该仓库写权限的账号无法提交。发布成功后**发布者本机立即应用新配置**；其他用户下次启动（本地缓存最多 12 小时）或点「刷新配置」时获取。注意：远端 raw 链接有约 5 分钟 CDN 缓存，「刷新配置」只能跳过客户端本地缓存、无法绕过这一层——发布后 5 分钟内其他用户可能仍拿到旧配置。

正式包不包含该页面，普通用户无法上传配置。

### 检查更新

设置页「检查更新」按钮会查询 GitHub Releases 最新版本，与当前版本比较：

- 有新版：提示版本号并一键打开 Releases 下载页，用户手动下载安装
- 无新版/查询失败：显示「已是最新版本」或错误原因

版本比较按 semver 规则：发版时 `src-tauri/tauri.conf.json` 的版本号必须递增，否则不会提示更新。

> 由于未做代码签名，App 内不提供全自动安装式更新（macOS 会被 Gatekeeper 拦截），采用「提示 + 跳转下载页」的半自动方式。

## WiFi 配对说明

Android 11+ 无线调试分「配对」与「连接」两步：

- **配对**（一次性建立信任），两种方式：
  - 配对码：手机「使用配对码配对设备」给出配对地址与 6 位码，填入工具点「配对」；
  - 二维码：工具「生成二维码配对」，手机「无线调试 → 扫码配对」扫工具上的二维码，配对自动完成。
- **连接**：配对成功后工具自动用 mDNS 发现连接地址并连接；若未自动发现，把手机「无线调试」页面顶部的「IP 地址和端口」填入「连接地址」点「连接」。

配对地址与连接地址均带历史记录（点击输入框弹出，可删除）。注意：公共/访客 WiFi（客户端隔离）会因 mDNS 不通而配对失败，建议改用手机热点。

## 相关文档

- [安装说明（含未签名包放行步骤）](Docs/安装说明.md)
- [激励框架内置测试用例规划](Docs/内置测试用例规划.md)
- [界面开发规范（供后续开发代理延续当前风格）](Docs/界面开发规范.md)
