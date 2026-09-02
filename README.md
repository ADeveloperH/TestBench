# TestBench（测试工作台）

面向测试与开发的一站式 Android 设备工作台，覆盖日志查看、设备管理、常用调试工具、日志回归测试、投屏录屏与性能监控。面向 Windows 与 macOS 用户，基于 Tauri 2 构建，后端用 Rust 调用内置 `adb` / `scrcpy`，前端用 React + TypeScript。

> 本文档面向**开发与维护者**。终端用户（安装包使用者）请阅读 [Docs/用户使用手册.md](Docs/用户使用手册.md)。

## 技术栈

- **框架**：Tauri 2（体积小、内存低，适合长时间挂着刷日志）
- **后端**：Rust —— 枚举设备、启动 `adb logcat` 子进程、流式读取 stdout、通过事件推给前端
- **前端**：React 19 + TypeScript + Vite，虚拟滚动用 `@tanstack/react-virtual`
- **依赖**：内置 `adb` / `scrcpy` 二进制，终端用户无需安装 Android Platform-Tools

## 功能概览

- 设备枚举（USB / WiFi）、多设备切换、无线配对（配对码 / 二维码）
- 实时流式日志（`adb logcat -v threadtime`），环形缓冲、级别/关键字/Tag/应用过滤、长日志折叠、导出
- 已保存过滤器、搜索/Tag 常用、测试用例（规则引擎：AND/OR 条件树、阈值、缺失判定）
- 工具页：应用后门、重启、清数据、卸载、截图、安装 APK、投屏、录屏、设备信息、性能
- 配置导入导出、调试日志导出、深色/浅色主题、系统托盘
- 内置配置远程更新（无需发版）、应用内自动更新（macOS）

## 架构

```
前端（React）
  ├─ core/      共享基础：类型、常量、日志解析、应用清单、内置配置注册表、远程配置、更新服务
  ├─ features/  按功能分模块：logcat / testcases / tools / filters / settings / devices
  ├─ components/ 通用 UI：Tip、HistoryInput、Select
  └─ App        视图切换 + 日志页组装
        │ invoke() 调用命令 / listen() 订阅事件
后端（Rust）
  ├─ lib.rs     命令定义 + 全局状态 + logcat 事件发射 + 更新检查/配置发布/打开浏览器
  └─ adb/       adb/scrcpy 模块：devices / logcat / apps / install / info / scrcpy
```

后端通过 `logcat-line` 事件把每一行原文推给前端，前端解析成结构化字段后统一过滤，因此切换过滤条件无需重启 `logcat` 进程。

## 目录结构

```
testbench/
├── .github/workflows/          # CI：build.yml 构建+发布、validate-config.yml 配置校验
├── config/                     # 内置配置：remote-config.json（远程更新）、projects.json（旧应用清单）
├── scripts/                    # 开发脚本：setup、bundle-bin、validate-config、release-macos、generate-update-json
├── src/                        # 前端源码
│   ├── App.tsx                 # 主界面（视图切换 + 日志页组装）
│   ├── App.css                 # 样式（深色主题）
│   ├── core/                   # 共享基础
│   │   ├── types.ts            # 类型与常量
│   │   ├── logcat.ts           # threadtime 行解析 + ANSI 过滤
│   │   ├── apps.ts             # 应用清单（代码内置来源）
│   │   ├── builtinRegistry.ts  # 内置配置注册表（远程按 section 覆盖代码内置）
│   │   ├── remoteConfig.ts     # 远程配置拉取/校验/缓存/应用、发布配置生成
│   │   └── debug.ts            # IS_DEBUG 编译期标志
│   ├── services/               # 跨模块服务
│   │   └── updater.ts          # 应用内更新（检查/下载进度/安装/重启）
│   ├── features/               # 按功能模块
│   │   ├── logcat/             # 日志查看（useLogcat + LogList）
│   │   ├── testcases/          # 测试用例（引擎 + 侧边栏 + 管理）
│   │   ├── tools/              # 工具页
│   │   ├── filters/            # 保存过滤器
│   │   ├── settings/           # 设置页（usePrefs + ManagePage + config）
│   │   └── devices/            # WiFi 配对面板
│   └── components/             # 通用 UI（Tip、HistoryInput、Select）
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

> 终端用户不需要任何环境，本节只针对开发者。

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

### 常见开发问题

- **`sh: tauri: command not found` / `node_modules missing`**：先执行 `pnpm install` 再启动。
- **`failed to run 'cargo metadata' ... No such file or directory`**：终端 PATH 里没有 cargo（macOS 新开终端常见，cargo 装在 `~/.cargo/bin`）。执行后再启动：

  ```bash
  export PATH="$HOME/.cargo/bin:$PATH"   # 可写入 ~/.zshrc 一劳永逸
  pnpm tauri dev
  ```

  Windows 下 rustup 安装时会自动把 `%USERPROFILE%\.cargo\bin` 加入 PATH，通常不需要手动处理。
- **`resource path 'bin' doesn't exist`（构建报错）**：`src-tauri/bin/` 目录不存在。正常 clone 不会出现（仓库提交了占位目录）；若手动删除了该目录，执行 `pnpm run setup` 或 `pnpm run bundle-bin` 重新生成。

## 构建与打包

```bash
pnpm tauri build
```

产物按当前操作系统生成（macOS 出 `.app`/`.dmg`，Windows 出 `.exe`/`.msi`）。跨平台构建、发布与自动更新产物统一由 GitHub Actions 完成。

### 两个 Workflow

| Workflow | 触发条件 | 做什么 |
|---|---|---|
| `构建安装包`（build.yml） | ① 手动 Run workflow；② 推送 `v*` tag | 构建三平台安装包；tag 触发时额外生成 macOS 更新包 + `latest.json` 并创建 GitHub Release |
| `校验配置`（validate-config.yml） | push / PR 且改动 `config/**` | 校验 `remote-config.json` / `projects.json` 的 JSON 格式，格式错误不允许合并 |

两者互相独立：改配置走「校验配置」，发版走「构建安装包」。

### 内部测试（手动触发）

仓库 Actions 页 → `构建安装包` → Run workflow，构建完成后从该次运行的 **Artifacts** 下载 Windows（msi/exe）与 macOS（arm64/x64 dmg）安装包。手动触发不会创建 Release。

### 发布版本（tag 触发，面向用户 + 自动更新）

1. 修改 `src-tauri/tauri.conf.json` 与 `package.json` 里的版本号（保持一致）
2. 提交并打 tag 推送：

   ```bash
   git add src-tauri/tauri.conf.json package.json
   git commit -m "chore: release v0.1.0"
   git push
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. `构建安装包` 自动跑完三个平台构建后，`publish` job 自动创建 GitHub Release 并上传：

   ```text
   安装包：dmg（arm64/x64）、exe、msi        ← 首次安装用
   macOS 更新包：TestBench_arm64.app.tar.gz / TestBench_x86_64.app.tar.gz
   更新清单：latest.json                     ← App 内自动更新读取
   ```

   用户下载：`https://github.com/ADeveloperH/TestBench/releases`

> 同一 tag 重新触发构建不会重复创建 Release，只会覆盖上传资产。

### 应用图标

图标源文件为 `src-tauri/icons/app-icon-source.png`。修改设计后重新生成各平台图标：

```bash
pnpm tauri icon src-tauri/icons/app-icon-source.png
```

生成产物包括 macOS `icon.icns`、Windows `icon.ico` 与各尺寸 PNG；窗口图标与系统托盘图标均随 bundle 配置自动使用。图标文件变化会自动触发重编译（`build.rs` 已做哈希跟踪），`pnpm tauri dev` 无需额外操作即可看到新图标。

## 应用内自动更新（实现细节）

自动更新基于 Tauri 官方 updater，采用**内部工具方案**（无 Apple Developer Program）：

- **代码签名**：macOS `ad-hoc`（`signingIdentity: "-"`，未公证）
- **更新签名**：Ed25519（公钥内置在 App，私钥仅存在于开发机/CI）
- **更新源**：GitHub Release 的静态 `latest.json`，端点见 `tauri.conf.json` 的 `plugins.updater.endpoints`
- **机制**：App 启动约 4 秒后自动检查（开发模式跳过）；对比版本 → 下载 `.app.tar.gz`（按架构）→ 校验签名 → 替换 /Applications 内 App → 自动重启

### 签名密钥

- 私钥：`~/.tauri/internal-workbench.key`（**绝不提交**，`.gitignore` 已保护）
- 公钥：已写入 `tauri.conf.json` → `plugins.updater.pubkey`
- CI secret：`TAURI_SIGNING_PRIVATE_KEY`（私钥内容）+ 空密码（`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）

### 发布流程

tag 触发 CI 自动完成：构建 → 签名更新包 → 生成 `latest.json` → 上传 Release。等价的手动本地发布（内部服务器方案，可选）：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/internal-workbench.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
export UPDATE_BASE_URL="https://INTERNAL_UPDATE_HOST/testbench"
pnpm release:mac
```

脚本 `scripts/release-macos.sh` 会构建 → codesign 校验 → 生成 `release-output/`（latest.json + 更新包），上传到内部服务器即可。`scripts/generate-update-json.mjs` 负责生成/合并 latest.json（signature 是 `.sig` 文件的内容）。

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

调试模式下各 tab 的**内置条目同样支持删除/编辑**（应用/搜索/Tag 常用/过滤器/测试用例）：删除的内置条目会记住，刷新不恢复；点「生成配置 JSON」时按删除后的生效配置生成，发布后所有用户的内置配置随之更新。正式包中内置条目仍不可删除/编辑。

发布凭据（首次使用）：

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
2. Repository access 选择仅 `ADeveloperH/TestBench`；Permissions 里 **Contents 设为 Read and write**，其余保持只读/无权限
3. 生成的 token 粘贴到发布页「保存凭据」（仅保存在本机，调试包本身不含凭据，可随时「清除凭据」）；点「**测试凭据**」可立即检查该 token 对本仓库的读写权限

提交走 GitHub Contents API，权限由 token 范围控制：没有该仓库写权限的账号无法提交。发布成功后发布者本机立即应用新配置；其他用户下次启动（本地缓存最多 12 小时）或点「刷新配置」时获取。远端 raw 链接有约 5 分钟 CDN 缓存，「刷新配置」只能跳过客户端本地缓存、无法绕过这一层。

正式包不包含该页面，普通用户无法上传配置。

## 相关文档

- [用户使用手册（安装 / 使用 / 自动更新 / 常见问题）](Docs/用户使用手册.md)
- [跨平台子进程与 Sidecar 集成规范（新增本地工具前必读）](Docs/跨平台子进程与Sidecar集成规范.md)
- [激励框架内置测试用例规划](Docs/内置测试用例规划.md)
- [界面开发规范（供后续开发代理延续当前风格）](Docs/界面开发规范.md)
