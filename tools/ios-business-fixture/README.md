# iOS 业务规则可控验证源

用于 IOS3-080-B00/B05 的独立真机链路验证。`BusinessRuleScenario.cs` 依赖现有 Unity 日志测试工程的 `NativeLogBridge`，不放入 Fruit 或产品包。

## 构建方式

1. 将 `<unity-fixture-dir>` 的 Assets、Packages、ProjectSettings 复制到临时目录；不要复制 Library/Build，不改原工程。
2. 将本目录的 `BusinessRuleScenario.cs` 放入临时工程 Assets/Scripts，`BusinessRuleScenario.mm` 放入 Assets/Plugins/iOS（使用 NSProcessInfo 读取 iOS 启动参数，避免 IL2CPP 丢失参数）。
3. 临时工程的 `Assets/Editor/IosFixtureBuild.cs` 改用 productName=`TestBenchIOSBusinessFixture`、Bundle ID=`com.testbench.iosbusinessfixture`。保留 Development Build。
4. Unity 2022.3.62f3 batchmode 执行 `TestBench.IosLogFixture.Editor.IosFixtureBuild.BuildIos`，输出 Build/iOS；Xcode 按本机已有开发团队签名编译、安装到已授权测试机。签名身份/描述文件不入库。
5. 桌面验收包使用独立 Tauri identifier，前端构建设置 `VITE_ENABLE_IOS_BUSINESS_CANDIDATES=true VITE_IOS_PILOT_TARGET=fixture`。只有两个开关同时指定才绑定该固定测试包；默认构建仍绑定 Fruit，拒绝 fixture 会话。

## 场景操作

先在桌面选择“可控日志验证包”，精确采集并创建测试 Tab，再启动测试包。每次启动12秒后输出指定场景，同次启动只执行一次。每换一个场景先“重新开始测试”，避免旧命中影响结论。

```bash
xcrun devicectl device process launch --device <UDID> --terminate-existing \
  com.testbench.iosbusinessfixture -- --tb-business-scenario=baseline
```

| 参数值 | 预期业务状态 | 性质 |
|---|---|---|
| baseline | 四项异常均监控中 | 正常200响应、周期检查、重复升级保护，构造负样本 |
| network-code | 网络响应异常：有问题 | 构造result_code=500 |
| network-warn | 框架网络：疑似 | 构造单次请求失败 |
| network-exception | 框架网络：有问题 | 构造请求异常 |
| network-uninitialized | 框架网络：有问题 | 构造未初始化 |
| level-config | 关卡异常：有问题 | 构造配置请求异常 |
| level-up | 关卡异常：有问题 | 构造升级异常 |
| thread-real | 主线程违规：有问题（仅实际抛出时） | 在后台线程实际调用GameObject.Find并捕获；如果未抛出会输出thread_check_did_not_throw，不伪造异常 |

## 通道与结论

每条受控消息分别尝试 Unity Debug 与原生 NSLog 输出，标记为 `[TB.BusinessFixture] path=unity` / `path=nslog`。同一场景可能因此命中两条，要按来源分开核对，不能将两条当作真实业务执行两次。NSLog只证明原生通道；Unity Debug未采到时单独记账。主线程场景两个通道转发的是实际引擎异常。

验证采集、中文还原、匹配、疑似/有问题、原文证据及重置。构造业务消息不代表调用了真实网络或关卡模块，也不能据此把 Fruit 的真实异常分支标为已验收。完整结果见 `Docs/iOS/iOS业务测试用例适配清单.md`。

## 扩展业务候选验收（2026-11-18）

以下场景验证当前配置、平台及SDK候选的采集判定链路；均是独立测试包构造的日志，不调用真实SDK故障，不表示Fruit实际异常已验收。日志正文保留SDK/配置首行，受控标记`[TB.BusinessFixture] path=... scenario=... kind=...`放在同条消息第二行，避免为了测试而放宽正式规则前缀。旧场景仍使用原标记格式。

| 参数值 | 预期新增用例结果 |
|---|---|
| sdk-baseline | 正常初始化调用、上传回执、白名单及未纳入的自举字段均不命中；不以init调用判反作弊通过 |
| config-required | 配置必填、资产与国家组有问题 |
| config-optional | 可选配置疑似 |
| platform-errors | 广告/eCPM/云控/业务埋点/归因有问题 |
| platform-warnings | 广告/云控/归因疑似，不升级为有问题 |
| sdk-errors | 埋点桥接有问题、Beyla数据疑似、反作弊运行/初始化有问题 |
| sdk-warnings | 反作弊运行/初始化疑似 |
| sdk-ready | 反作弊初始化通过，运行异常仍监控中 |
| sdk-recovery | 先失败后迟到就绪保留两类证据，历史有问题不清除 |

每场景开始前重新开始测试；每条分别输出Unity与NSLog，但实际模块以设备采集结果为准，不能假称NSLog必为Foundation。旧用例对Foundation的拒收仍由逻辑回归及真实原生正常样本验证，新增规则Foundation异常命中只有实际采到时才记通过。精确分支数与验收结论见业务适配清单的本轮记录。
