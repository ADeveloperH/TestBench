# iOS 日志能力矩阵

## 未解决问题 IOS-LOG-001：部分设备 Unity 日志正文被隐私隐藏

- 记录日期：2026-11-05；状态：已复现，待定位系统行为与设备配置差异。
- 环境：go-ios v1.3.2、Unity 2022.3.62f3、测试包 `com.testbench.ioslogfixture`。
- iOS 17.5（iPhone XR）与 iOS 18.7.8（iPhone 13）：Syslog 可见 Unity Log/Warning/Error 正文和堆栈，Exception 正文可见但尾部截断，NSLog/os_log 正文可见。
- iOS 27.2（iPhone 13）：Unity Log/Warning/Error/Exception 和 NSLog 正文为 `<private>`；显式 `%{public}s` 的 os_log 正文可见。将 iOS 17.5 使用的同一份签名产物安装到该机后仍复现，排除了这两轮构建产物差异。
- 同机 devicectl 控制台可见 Unity 正文和堆栈；go-ios ostrace 仍隐藏正文。本机独立工具 libimobiledevice `idevicesyslog` 读取同一 Syslog 服务也复现 `<private>`，基本排除 go-ios 特有的解析问题；不能据此宣称所有 iOS 27.2 设备均受影响。
- 测试包未设置 `OSLogPreferences`；本轮未修改设备隐私配置。设备级配置差异尚未查明，不能标记为已排除。
- 影响：正文已隐藏时，搜索和 Unity semanticLevel 推断无法恢复内容；当前方案不能承诺任意设备上完整采集 Unity 业务日志。以下早期能力结论仅适用于其记录的测试环境。
- 后续：评估跨平台内置标准输出通道；核对设备配置差异；必要时验证应用 public 输出方案。暂无默认采集源替换或工具升级决定。
- 证据：本机临时目录中的 `testbench-ios27-samebuild-*`、`testbench-ios18-compare-*`、`testbench-ios17-installed-*`、`testbench-ios27-ostrace-direct.*` 和 `testbench-ios27-independent-syslog.log`；原始日志未纳入仓库，临时文件可能被系统清理。

## 未解决问题 IOS-LOG-002：Unity 中文乱码与 Xcode 双份输出差异

- 记录日期：2026-11-13；状态：用户实测已复现；后续已优先实现可逆编码还原显示，独立正常副本来源仍待查。
- 环境：iOS 18 测试机 A，应用/进程 FruitQuest，模块 UnityFramework；本次样本时间 〔时点 01〕、PID 示例-01。系统具体版本、应用构建及 Unity 版本本次未重新核对。
- 操作：TestBench 按 FruitQuest 进程采集，再搜索 `InLevelAdReward`；用户另用 Xcode 运行 FruitQuest 对照输出。本次不是经过同步标记核对的双通道实验。
- TestBench：一条原始 `notice` 记录，中文正文乱码，保留多行调用栈；显示“Unity 推断 未知（无推断来源）”“疑似乱码”。
- Xcode：用户提供两份输出，第一份正文与 TestBench 一样乱码并附完整堆栈，第二份中文正常并附 `IncentiveEngine.InLevelAdRewardManager:LogStrategyIfNeeded()`。
- 复现示例（合成正文）：`[InLevelAdReward] Á§∫‰æãËøõÂ∫¶Ôºö50%`，按 MacRoman 编码后以 UTF-8 解读得到 `[InLevelAdReward] 示例进度：50%`。实测样本也保留了多行 Unity 调用栈。

- 初步判断：与首轮测试包已验证的“标准输出副本中文正常、Apple 日志副本乱码”现象一致。但本次正常副本的具体来源仍待同步采集确认，不能据这段对照认定 UI 搜索漏日志，也不能断言所有设备/构建都相同。
- 现有代码：保留原始 raw/message，只对疑似乱码做标记；样本缺少明确 Unity Log/Warning/Error 调用特征，因此推断未知，不能将 notice 直接映射为 Unity Info。
- 后续排查：同构建、同次触发同步采集 Xcode/标准输出与 go-ios 原始流，核对正常副本是否进入 Syslog、是否经过筛选/解析丢失；再评估可内置的 macOS/Windows 标准输出通道，以及可选可逆的乱码预览方案。原文与落盘必须保留，不先做自动转码或更换默认采集源。
- 与其他问题关系：补充既有 R2-02 中文乱码限制；与 IOS-LOG-001 的 `<private>` 隐私隐藏分别追踪。暂缓排查不阻塞当前面板验证，但不能据 UI 验收宣称完整 Unity 中文采集已支持。

### 2026-11-13 后续：优先排查正常中文副本缺失

- 用户将本问题恢复为优先排查；IOS-LOG-003 截断问题先保留记账。
- 新样本：`〔时点 05〕`、FruitQuest PID 示例-02，搜索 `[InLevelAdRewardManager]`，一条关卡进度记录正文乱码。
- 已核对会话 `验收会话-12/records-0000.jsonl`：该进度事件仅发现乱码记录，未找到对应正常中文副本；本文件共有 6 条包含该业务标记的记录，肉眼核对首行均有乱码。其中一条被现有启发式标成 `valid`，说明编码状态只是提示，不能当作内容正确的保证。
- 源码检查：正文搜索匹配 raw，业务标记匹配 message，均未按 encodingStatus 排除记录；后端先解析、按进程匹配，再落盘。因此目前可排除“正常副本已落盘但被乱码状态隐藏”的解释，但仅凭落盘不能排除解析或进程匹配阶段漏收。
- 重要边界：Xcode 控制台可能同时展示标准输出与 Apple 日志；当前 TestBench 只接 Syslog，不能预设该通道一定有两份日志。缺失副本是否仅来自 stdout，仍需同事件、同构建同步对照未过滤 Syslog 与 Xcode/标准输出。之前截断对照原始流未覆盖本次 〔时点 04〕 事件，不用它证明本次缺失发生在哪一层。
- 后续修复方向由对照结果决定：若原始 Syslog 有正常副本，修复解析/进程匹配；若仅 stdout 有正常副本，评估内置补采能力。可逆编码预览仅能改善已有乱码记录显示，不等同于补采或恢复正常副本，原文必须保留。

### MacRoman 可逆验证（2026-11-13）

- 对上述 〔时点 04〕 完整 message 执行严格 `encode('mac_roman').decode('utf-8')` 成功，首行成功还原为中文进度文本，ASCII 调用栈保持不变；反向 UTF-8 编码、MacRoman 解码与原 message 完全一致。该样本符合 UTF-8 字节曾被按 MacRoman 解释的特征，但不能仅据此定位误解码发生的组件。
- 当前 TestBench 只标记疑似乱码，parse_envelope → parse_syslog_message → message/raw → 展示/搜索没有 MacRoman 逆转换，因此不会从这一条记录生成正常中文显示。这与是否另有 Xcode 标准输出副本是两个独立问题；不应把“先补采另一副本”视为改善该可逆样本显示的必要条件。
- 后续优先实现保留 raw 的可逆解码显示及搜索策略，再独立调查通道副本差异；不能对所有非 ASCII 日志无条件应用转换。实施情况见下方。

### 编码还原显示约定（2026-11-13）

- 仅在展示投影中尝试 MacRoman 字节逆转换；逐行严格 UTF-8 解码，要求可逆且新增中文字符，不满足时保留该行。已有正常中文、普通外文、无法严格还原的片段不强行改写。
- 正式页与 Probe 显示恢复后的正文并标识“编码还原”；详情同时提供还原正文与日志原文，复制及导出继续使用原文。原始 record、raw/message、后端落盘、级别及推断来源不改变，不凭还原生成额外日志条目。
- 搜索对原文和还原正文分别匹配（文字和正则），业务标记在两份正文组成的内容中执行原有包含/排除语义；恢复结果不绕过级别、暂停快照、清空或窗口边界。结果按不可变来源记录缓存，避免每批重复转码。
- 此功能不代表补采到了 Xcode 的另一份输出，也不解决隐私隐藏、截断或不可逆损坏。

实施与验证：展示还原已实现，正式页与 Probe 共用缓存的还原结果；详情标明 MacRoman → UTF-8，并保留原文，复制/导出沿用原文。用户本机会话中该业务标记的 6 条记录均还原成功，源对象未变。21 项日志投影/搜索/共享列表回归通过，覆盖中文及原文搜索、正则、排除标记、正常中文/外文、无效 UTF-8、Emoji 与逐行混合文本；浏览器固定样本检查了正式列表、详情、Probe、深浅主题与 800px 宽布局。配置校验、TypeScript、生产构建及差异检查通过；本轮不等同于真实 Tauri/设备新增采集验收。IOS-LOG-002 的独立标准输出副本来源仍未解决。

## 未解决问题 IOS-LOG-003：长日志在源侧链路中截断

- 记录日期：2026-11-13；状态：已复现并缩小范围，尚未解决。
- 用户样本：iOS 18 测试机 A / FruitQuest / UnityFramework，`〔时点 02〕`、PID 示例-02，`[IAA] AdsCloudConfig UpdateRewardAdData` 的调用栈以 `S<…>` 结束。会话 `验收会话-11/records-0000.jsonl` 中原文已带该结尾；正文 UTF-8 长度为 1020 字节，原文含头部为 1093 字节。同会话 14 条带截断标记的记录（含重复）正文均为 1020 字节。
- 本地实现检查：TestBench 保留 raw/message，`detect_truncation` 仅识别 `<…>` / `<...>`，不裁短正文；列表折叠和展示窗口淘汰与此问题不同。扩大显示长度无法恢复这条落盘记录已缺少的尾部。
- 官方固定版本源码检查：[go-ios v1.3.2 Syslog](https://github.com/danielpaulus/go-ios/blob/v1.3.2/ios/syslog/syslog.go) 使用 `com.apple.syslog_relay`，按 NUL 结束符读取消息；[命令入口](https://github.com/danielpaulus/go-ios/blob/v1.3.2/main.go) 去掉末尾结束符后输出，未发现固定 1024 字节裁切或补截断标记的逻辑。
- 独立实测：未重启游戏、未修改设备配置，同时运行 go-ios v1.3.2 与本机 `idevicesyslog`。两者于 `〔时点 03〕` 收到同一条 FruitQuest / Foundation 长日志；解码 BSD vis 转义并剥离采集工具末尾分隔符后，正文逐字节一致，均为 1020 字节、以 `<…>` 结束，两路 SHA-256 一致。业务正文不纳入仓库。两工具记录数量未做完整对账，不据此推断丢失率。
- 结论边界：此类截断在不经过 TestBench 或 go-ios 的独立采集路径也发生，范围更靠近应用输出或设备提供的日志通道；尚不能确定 Unity、NSLog、系统转换或 Syslog 服务中的具体环节，也不能把观察到的 1020 字节宣称为所有 iOS 日志的统一上限。本轮同步匹配样本不是用户原来的 IAA 回调，尚未完成同事件 Xcode/标准输出对照。
- 后续：优先同步比较同一次 IAA 事件的 Syslog 与 Xcode/标准输出，再评估可内置的补采通道或应用分条输出；不先调整读取缓冲或声称更换工具即可恢复。与隐私隐藏（001）、中文乱码（002）分别追踪。
- 本机临时证据：`<local-evidence-dir>` 中的双工具原始流与 `summary.json`；临时文件可能被系统清理，原始流不提交。两路限时采集均已结束；本轮未修改采集实现。

更新时间：2026-11-13（下方首轮验证保留原始环境）

## 一、首轮验证环境

- 测试工程：Unity 2022.3.62f3，Development Build
- Bundle ID：`com.testbench.ioslogfixture`
- 进程：`TestBenchiOSLogFixture`
- 设备：iPhone 13（iPhone14,5）
- 系统：iOS 18.7.8
- 连接：USB
- 设备日志：`ios-probe` + `go-ios` v1.3.2 raw syslog
- 控制台对照：`xcrun devicectl device process launch --console --terminate-existing`
- 固定标记：`[TestBench.iOSFixture]`

## 二、能力矩阵

| 测试类型 | ios-probe/syslog | devicectl console | ios-probe 级别 | 内容结论 |
|---|---|---|---|---|
| `Debug.Log` | 可见 | 可见，出现双通道副本 | `notice` | 堆栈完整 |
| `Debug.LogWarning` | 可见 | 可见，出现双通道副本 | `notice` | syslog 未保留 Unity Warning 语义 |
| `Debug.LogError` | 可见 | 可见，出现双通道副本 | `notice` | syslog 未保留 Unity Error 语义 |
| `Debug.LogException` | 可见 | 可见，出现双通道副本 | `notice` | 异常类型、消息和 C# 堆栈可见 |
| 中文 + Emoji | 可见但乱码 | 一份正确、一份乱码 | `notice` | stdout 副本正确；进入 Apple 日志通道的 Unity 副本乱码 |
| 多行消息 | 可见但中文/Emoji 乱码 | 一份正确、一份乱码 | `notice` | 换行结构和堆栈保留 |
| 原生 `NSLog` | 可见 | 可见 | `notice` | 原生中文完整 |
| 原生 `os_log` | 可见 | 不可见 | `notice` | 证明 console 标准流不等于设备日志流 |
| 未捕获协程异常 | 可见 | 可见，出现双通道副本 | `notice` | 异常类型、消息和堆栈可见，App 未在触发时闪退 |
| Burst 1000 | 1000/1000 | 去重后 1000/1000 | `notice` | 索引 `0000`～`0999` 连续，无缺失 |

## 三、关键观察

### 3.1 两种采集方式不等价

`devicectl --console` 同时能看到 Unity 写入标准流的副本以及部分带时间戳的 Apple 日志副本，因此多数 Unity 消息出现两次。原生 `NSLog` 只有 Apple 日志副本；原生 `os_log` 没有进入 console。

`ios-probe` 从设备 syslog 流按进程过滤，每个可控事件得到一条结构化记录，没有 console 中的双份重复；同时它能捕获 `os_log`。

### 3.2 日志级别不足

本轮所有可控消息在 syslog 中均为 `notice`，包括 Unity Warning、Error 和 Exception。因此不能直接把 syslog 的 `level` 当作 Unity 日志级别。正式解析需要结合消息/堆栈特征做有限推断，或者接受 iOS 第一版只提供设备原始级别。

### 3.3 Unity 中文乱码发生在上游日志通道

同一条 Unity 中文日志在 `devicectl` 标准输出副本中 UTF-8 正常，但在带时间戳的 Apple 日志副本中已经乱码；`ios-probe` 得到的是后者。原生 `NSLog` 和 `os_log` 的中文均能被 `ios-probe` 正确读取。

这表明乱码不是 Rust JSON 编解码造成的，而是 Unity iOS 输出进入 Apple 日志通道时的编码行为。正式方案不能承诺所有 Unity 中文日志都能从 syslog 还原。

### 3.4 高频吞吐

- ios-probe：1000 条结构化 burst 记录，1000 个唯一索引。
- devicectl：2000 次 marker 命中，去重后 1000 个唯一索引。
- 两边索引范围均为 `0000`～`0999`，无断号。

本结果证明短时 1000 条突发在当前设备上没有采集丢失，但不能替代 30～60 分钟稳定性测试。

## 四、当前结论

1. `go-ios` raw syslog 能覆盖 Unity 业务日志、异常、原生 `NSLog` 和原生 `os_log`，适合作为 TestBench 跨平台内置 MVP 数据源。
2. `devicectl --console` 更适合 macOS 开发对照，不能替代跨平台设备日志采集。
3. iOS 日志模型需要保留原始设备级别，不应直接映射成 Unity Warning/Error。
4. UI 应允许按进程和固定文本过滤，并明确 iOS 中文日志可能受应用输出通道影响。
5. 后续仍需验证 Release Build、长时间稳定性、Windows + Apple Devices 和多 iOS 版本。

## 五、首轮结果后的 Probe 优化

实施日期：2026-11-03

- 保留兼容字段 `level` 作为 Apple syslog 原始设备级别。
- 新增 `semanticLevel`，根据 Unity 调用栈有限推断 `info`、`warning`、`error`、`exception`。
- 新增 `semanticLevelSource=unity_heuristic`，避免把推断结果误认为设备原始级别。
- 新增 `encodingStatus`，只标记 `suspected_mojibake`，不自动修改日志原文。
- 新增 `truncated`，识别已知 syslog 截断标记。
- 从本轮结果人工脱敏重建 `syslog-unity-capabilities.jsonl`，不保存真实设备标识和本地路径。
- 单元测试由 7 个增加到 12 个，全部通过。

下一轮真机验证重点：确认新增字段在实际 `Debug.Log`、Warning、Error、异常、中文/Emoji、`NSLog` 和 `os_log` 输出中符合预期。

## 六、优化后真机复验

复验日期：2026-11-03

使用同一台 iOS 18.7.8 测试机重新构建并直接运行新版 `ios-probe`，同时保留 `devicectl --console` 对照。复验结果：

| 测试类型 | `level` | `semanticLevel` | `encodingStatus` | `truncated` |
|---|---|---|---|---:|
| 启动日志 | `notice` | `info` | `valid` | false |
| `Debug.Log` | `notice` | `info` | `valid` | false |
| `Debug.LogWarning` | `notice` | `warning` | `valid` | false |
| `Debug.LogError` | `notice` | `error` | `valid` | false |
| 受控 Exception | `notice` | `exception` | `valid` | true |
| 中文 + Emoji | `notice` | `info` | `suspected_mojibake` | false |
| 多行消息 | `notice` | `info` | `suspected_mojibake` | false |
| 原生 `NSLog` | `notice` | null | `valid` | false |
| 原生 `os_log` | `notice` | null | `valid` | false |
| 未捕获协程异常 | `notice` | `exception` | `valid` | false |

补充结果：

- 所有非空 `semanticLevel` 均同时输出 `semanticLevelSource=unity_heuristic`。
- 原生日志没有 Unity 调用栈，因此保持 `semanticLevel=null`，没有进行不可靠猜测。
- 受控 Exception 的 syslog 正文包含 `<…>`，正确标记 `truncated=true`；本轮未捕获协程异常未出现该标记，因此为 false。
- 新版 ios-probe 再次捕获 1000/1000 条 burst，唯一索引为 `0000`～`0999`，无断号。
- devicectl 对照去重后同样为 1000 个唯一 burst 索引，仍未捕获原生 `os_log`。

结论：本轮新增字段与真机证据一致，可以作为阶段 2 UI 和统一日志模型的输入。语义级别必须在 UI 中标明为推断结果，疑似乱码只提示、不自动改写原文。
