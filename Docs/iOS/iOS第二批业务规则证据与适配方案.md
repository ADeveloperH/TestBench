# iOS 第二批业务规则证据与适配方案

更新：2026-11-17。任务：IOS3-080-V01～V08。当前5项已按已核对分支完成独立iOS停用候选实现；不改Unity插件或原生库、不发布远程配置。第一批18项规则保持原状；合计23项停用候选＋2条正向试点。下文证据梳理保留设计依据，最新实施状态见文末。

## 接入原则

复用业务目标、effect及适用的正文条件；平台来源与原生SDK条件独立定义。不把Apple notice当Unity I/E/W，不把UnityFramework当Android Tag，不用“调用已发起”证明服务端成功。没有日志、SDK未安装、日志关闭及业务未触发不是同一种结果。

本地源码是当前工作目录的实现证据，不证明手机安装包包含同一版本。源码存在标为“源码可达候选”，历史样本采到标为“历史实证”；二者都不等于异常分支真机验收。以下5个iOS ID已注册为默认停用候选，不加入Android注册表或远程配置。

当前监测器仅消费精确Fruit进程、设备/会话内的UnityFramework记录。引入Foundation等原生来源前必须按规则建立模块＋稳定消息前缀的来源适配，并保留原文与序列；不可全局解除模块限制。Foundation是通用模块，单独模块名不构成SDK身份证据。同一事实经Unity与NSLog双路输出时，未有事件关联ID前不把条数当事件次数。

## 核查依据

- TestBench原规则：`src/features/testcases/engine.ts`中的`ie_ad_fail`、`ie_ad_ecpm_fail`、`ie_cloud_config_fail`、`ie_analytics_fail`、`plugin_promotion_fail`；定义与当前配置盘点一致。
- 源码根目录P：`<unity-plugin-src>`。
- 源码根目录E：`<unity-framework-src>`。
- H1：会话-19已提取的537条Fruit/UnityFramework记录，`<local-evidence-file>`。这是已筛选子集，不能据此判断其他模块没有日志。
- H2：既有NLC会话72,092条Fruit记录，其中UnityFramework 1,031条，`<weak-network-records>`。
- 本轮使用当前`getIosLogDisplay`还原中文，仅检索消息首行，避免堆栈方法名误当业务信号。统计是正文线索计数，不是运行引擎判定。摘要：`<local-evidence-file>`；临时文件可能被系统清理，不提交业务原文。

历史实证摘要：

| 信号 | H1 | H2 | 含义/限制 |
|---|---:|---:|---|
| `[IOSCloudConfig]` | 31 | 8 | 均在UnityFramework；H1明确“原生实现已接入”。不是31/8次错误 |
| `[Promotion]` | 4 | 3 | H1在UnityFramework，有桥接及Adjust初始化完成；H2在Foundation，是收入上报记录，不能当渠道归因成功 |
| `ADCoreManager` / `IOSAD` | 各1 | 0 | H1同一条“ADCoreManager Init. IOSAD”，只证明选择了iOS实现 |
| `UnityDispatcherTool` | 1 | 0 | H1是初始化完成，不是初始化失败 |
| `NetWorkLog:Request` | 6 | 26 | 首行含ecpm数值0的请求均0条；这里只是首行检索，不证明完整请求规则全量回放通过 |
| `UpdateEcpm` | 0 | 5 | H2均在Foundation：4条带正price的Analytics事件＋1条Adjust白名单提示，不能把5条算成5次价格错误 |
| 五项原规则涉及的明确失败短语 | 未观察到 | 未观察到 | 包括无聚合/策略无效、埋点四类错误、云控旧错误文案和渠道未初始化；未触发不是通过 |

## V01：广告插件异常（ie_ad_fail，7条原规则）

源码：P/adplugin/Assets/AD/Runtime下的ADManager.cs、Strategy/*AdStrategy.cs、Utils/UnityDispatcherTool.cs、Core/ADCoreManager.cs、Core/IOSAD.cs及ADLog.cs。ADCoreManager明确选择IOSAD；ADLog的三类输出受EnableLog开关控制，iOS侧级别仍不能用于还原原始Unity严重程度。

| 原分支 | iOS证据/差异 | 建议适配与状态 |
|---|---|---|
| AndroidAD＋failed → error | Android桥接专用，不可简单替换单词为IOSAD | 原分支不迁移；iOS专用诊断另列V06 |
| no mediation configured → error | InitAdStrategy.cs有完整共享文案，H1/H2未采到异常 | 保留精确短语＋广告消息来源；源码候选，待正负样本 |
| Reward/Splash/Inter/BannerAdStrategy invalid → error | 四类共享策略文件均有输出 | 保留原四类型正则，不扩为任意invalid；源码候选 |
| 初始化strategy空/无效、_adDelegate空 → error | ADManager.cs及InitAdStrategy.cs均有输出 | 保留三条原精确短语；源码候选 |
| UnityDispatcherTool初始化失败/任务空/回调空/出错 → error | 共享工具实现；H1只采到初始化完成 | 保留工具名＋原四类异常约束；初始化完成必须为负样本 |
| AndroidAdManager参数/初始化异常 → error | Android原生文案，不代表iOS参数错误 | 不迁移；不可让iOS应用长期等这些日志 |
| ADCoreManager＋is not init → warn | 共享Core有加载/展示/价格查询等日志 | 保留warn，不能因Debug.LogError调用就升为error；H1正常Init不得命中 |

建议身份`ios_ie_ad_fail`，描述明确“共享广告封装异常（覆盖原5/7条规则组）”。这是规则组覆盖率，不是所有异常路径完成。IOSAD已有事件派发异常、未知kind、未登记句柄、展示callback为空、非法mediation及功能不支持提示；严重度与去重/时序语义各异，不使用`IOSAD.*failed`或任意warning的兜底规则。

## V02：广告eCPM获取异常（ie_ad_ecpm_fail，2条原规则）

| 原分支 | iOS证据/差异 | 建议适配与状态 |
|---|---|---|
| Android.Stats UpdateEcpm price=-1 → error | H2在Foundation采到`[Analytics] 已上报事件 UpdateEcpm`，price为正值；还有无price的白名单提示。不是Android.Stats原统计日志 | 暂缓原生价格分支。需核对iOS价格单位、缺值/-1/0语义、SDK版本与输出路径，见V07 |
| Unity NetWorkLog:Request JsonParams ecpm=0 → error | 两段历史样本有请求首行，未观察到ecpm=0；沿用原规则可作为正文候选 | 建议`ios_ie_ad_ecpm_fail`仅接入请求参数分支。保留Request＋JsonParams对象＋数字零边界，不匹配0.1/0.001、响应或堆栈里的ecpm |

保留原“接口确实携带无效零值”的业务语义；不因字段缺失、日志截断、价格未返回就补出0。不把SDK单位收入与业务请求eCPM直接比较，换算关系必须先核实。

## V03：云控桥接异常（ie_cloud_config_fail，2条原规则）

源码：P/ConfigPlugin/Assets/Config/Runtime/{CloudConfigManager,IOSCloudConfig,AndroidDataConverter,DefaultCloudConfig}.cs；E/Common/CloudConfig/CloudConfigUtils.cs。

| 原分支/新证据 | 核查结论 | 建议适配与状态 |
|---|---|---|
| CloudConfig 未初始化 → error | 本轮未在上述当前封装找到该精确输出，H1/H2也未采到；不可据原Android规则假定iOS会打印 | 先登记未初始化可观测性缺口V08，不加入必需匹配条件 |
| 转换失败： → error | AndroidDataConverter.cs的Android转换输出 | 不迁移；iOS GetBizConfigs有“解析原生 JSON 失败：”的独立诊断 |
| DefaultCloudConfig → error | iOS选择IOSCloudConfig；原Android默认实现判据不等价 | 用明确“Init：原生实现【未接入】”候选识别兜底桩，不能匹配任意“默认值” |
| `[IOSCloudConfig] Init：原生实现已接入` | H1已实证；只证明桥接链接 | 正常负样本，不自动判云控拉取成功 |
| GetBizConfigs解析失败 / AB callback failed | 当前IOSCloudConfig明确输出，并经unity_config_log写入设备日志 | 建议独立iOS error分支，异常样本待补；消息前缀＋操作名＋失败短语同时限定 |
| 尚未实现，已降级返回默认值 / 数值解析回落 | 源码已有诊断；缺键、正常默认值也能合法发生 | 按具体能力及必需配置设计warn候选；不把所有NULL/空字典/回落默认都判error |

建议`ios_ie_cloud_config_fail`独立定义，属于同业务目标的平台重写，不宣称原2条规则原样等价。LogToDevice调用unity_config_log，不能由C#函数位置推断最终模块；H1/H2观察到的相关记录在UnityFramework，可先保持现有来源门禁。云控日常日志与ENABLE_LOG/CloudConfigManager日志开关相关，Init探针明确无条件输出；要逐分支确认开关，缺日志时不判业务缺失。

## V04：业务埋点异常（ie_analytics_fail，原1规则含4个正文分支）

源码：E/Common/Analytics/{GameAnalytics,FirebaseAnalyticsTracker}.cs、E/Common/Firebase/FirebaseInit.cs；P/analyticsplugin/Assets/Analytics/Runtime/IOSAnalytics.cs及Assets/Plugins/iOS/UnityAnalyticsBridge.mm。

| 原正文分支 | iOS源码/样本 | 建议适配与状态 |
|---|---|---|
| Beyla 埋点未初始化 | GameAnalytics检查_isInitBeyla后调用LogUtils.Error；共享路径，历史未命中 | 可保留精确正文error候选；这是Unity业务初始化标志，不证明原生Beyla上传状态 |
| Event ID cannot be null or empty | FirebaseAnalyticsTracker有入参检查；历史未命中 | 加FirebaseAnalyticsTracker前缀，避免其他SDK同文案误报 |
| Failed to log event | FirebaseAnalyticsTracker.LogEvent调用catch；受ENABLE_LOG控制，历史未命中 | 前缀＋精确失败短语→error；只能证明本次调用抛异常，不证明异步上传结果 |
| Could not resolve all Firebase dependencies | FirebaseInit检查依赖的失败分支存在，历史未命中 | FirebaseInit前缀＋完整短语→error；源码未排除iOS，仍须安装包验证 |

建议`ios_ie_analytics_fail`保留这4个共享正文子分支；所有LogUtils路径受ENABLE_LOG编译门控，不能以没输出判成功。IOSAnalytics及桥接另有真实实现/兜底桩探针，作为独立集成诊断候选，不把“已接入”当事件入库或服务端接收成功。H2的Adjust白名单未命中提示明确仍报业务埋点，不应作为“打点失败”。原生上传/入库失败补证列V08。

## V05：渠道归因异常（plugin_promotion_fail，2条原规则）

源码：P/PromotionPlugin/Assets/Promotion/Runtime/{PromotionManager,IOSPromotion}.cs及Assets/Plugins/iOS/UnityPromotionBridge.mm。

| 原分支/新证据 | iOS语义 | 建议适配与状态 |
|---|---|---|
| PromotionManager GetPromotionChannel not init / GetAdjustPromotionChannel not init → warn | 共享未初始化保护确有输出，LogW受插件日志开关；历史未命中 | 建议`ios_plugin_promotion_fail`保留warn，仅覆盖原共享分支 |
| Android.AndroidPromotio渠道/UTM/Install Referrer失败 → warn | iOS这里没有Google Play Referrer仲裁；两个渠道API最终委派Adjust | Android分支不适用，不移植UTM关键字 |
| iOS bridge is_linked=True及Adjust初始化完成 | H1有实证；不能证明归因值有效或渠道匹配预期 | 正常负样本，不将初始化完成当归因pass |
| iOS bridge is_linked=False / 未接入iOSPromotionLibrary | 现有源码已有明确兜底桩诊断 | 独立集成error候选，需确认该包预期接入；无需为此先改库 |
| 渠道返回none | 源码说明可为未初始化、回调未到；正常无归因也不能排除 | 不据none/organic判error；缺可区分的最终状态、适用前提、请求关联，列V08 |

IOSPromotion捕获初始化回调异常有诊断，可单独研究，不等同归因服务失败。H2收入上报记录不是渠道查询结果，不拿收入事件代验渠道归因。

## 缺口待办与实施顺序

以下“补证”先读当前实际iOS库实现、核对版本与已有日志，再决定是否需要补输出。源码已有诊断但未采到异常时，只需受控样本，不默认安排改库。所有待办本轮均未改库。

| 标号 | 待办 | 交付/判定前提 | 状态 |
|---|---|---|---|
| IOS3-080-V01 | 广告5个共享规则组设计 | 正负样本、EnableLog门控、每组分支/effect与覆盖范围明确 | 已实现停用候选；完整业务验收待补 |
| IOS3-080-V02 | eCPM请求参数分支设计 | 完整多行请求，0/0.0、正值、缺值及截断边界；保留原数字语义 | 已实现停用候选；完整业务验收待补 |
| IOS3-080-V03 | iOS云控独立规则设计 | 兜底桩/解析/回调错误与合法默认值分离；异常样本 | 已实现停用候选；完整业务验收待补 |
| IOS3-080-V04 | 埋点4个正文分支设计 | ENABLE_LOG生效，前缀与正常日志负样本，区分调用和上传 | 已实现停用候选；完整业务验收待补 |
| IOS3-080-V05 | 渠道共享保护与iOS探针设计 | 未初始化warn、未链接error各自适用前提；正常none不误报 | 已实现停用候选；完整业务验收待补 |
| IOS3-080-V06 | IOSAD专有错误补证 | 调用参数错误/回调异常/句柄及kind异常逐类审核，核对C ABI及SDK版本；确定error/warn，不套AndroidADManager | 待补证，无改库授权范围 |
| IOS3-080-V07 | 原生价格语义与来源补证 | iOS UpdateEcpm字段与单位、缺值/-1/0约定、消息前缀、模块、重复输出及回调证据；不能套Android.Stats | 待补证，不改库 |
| IOS3-080-V08 | 不可观测业务结果清单 | 云控实际初始化/拉取结果；埋点入库与上传结果；归因最终状态/失败/正常organic与等待状态。逐项确认现库是否已有可采日志；没有才形成封装/原生补日志需求 | 待核对；不凭空补success，不改库 |

后续开发建议先V01/V02/V04及V05共享部分，再V03与已有iOS探针；这5项均保持停用候选、独立iOS身份和只读范围。Foundation原生价格与最终业务结果在V06～V08补齐前暂缓，不为“凑齐原用例”扩大匹配。IOS3-080总体仍未验收完成；原47项中23项已有独立iOS候选（部分覆盖），24项未接入。

若后续确认日志确实缺失，优先在自有Unity封装/原生桥接真实回调上增加稳定event/result/error_code/sdk/request_id与版本信息。调用返回、SDK回调、服务端确认分阶段记录；不记录token或完整业务敏感参数，不把探针当业务完成。是否修改及修改哪个仓库届时单独确定，本轮只登记。

## 设计盘点阶段验证范围（历史记录）

只读核对TestBench规则、当前外部插件源码及两段历史真机原文；未启动新采集、未操作手机、未验证异常分支或原生UI。没有改TestBench实现、远程配置、Unity插件或任何原生库。文档与统计结果不能替代运行时验收。

文档变更检查：配置校验、TypeScript类型检查、生产构建及`git diff --check`通过（构建保留已有500kB包体提示）。本轮未改实现，未新增构造逻辑测试，不将这些检查写成业务验收。

## 第二批实现与自测收口（2026-11-17）

`src/features/ios/iosPlatformBusinessDefinitions.ts`新增5项独立定义，经原工厂接入现有测试Tab与侧栏。广告5组、请求eCPM零值、云控3个error/1个warn、埋点4个error、渠道1个warn/1个error；名称与原业务目标对齐，描述明确部分覆盖。新增规则的来源和错误标记限定消息首行，eCPM JsonParams保留多行请求匹配；命中证据仍保留完整展示正文及原始日志。两批共23项候选，普通构建默认停用，内部显式开关开启后与2条正向试点合计25项。

本批未修改共享匹配/计数引擎、缺失计时、采集或过滤实现；没有放开UnityFramework来源，没有改Android47项定义、远程配置、内置身份或Android界面。未新增原生价格或最终上传/归因结果断言，V06～V08继续待补。

逻辑回归213项通过，其中第二批新增67项，覆盖各错误/warn分支、多行与数字边界、正常默认值/none/白名单负样本、首行与调用栈区分、模块/进程/设备/会话/起始边界、重复消费、中文还原、默认停用及第一批/Android规则回归。配置校验、TypeScript与生产构建通过；diff检查通过，构建保留已有500kB包体提示。

当前引擎对H1的537条历史真实Unity原文回放：新云控warn命中2条，均为`[IOSCloudConfig] AddBizKVChangedListener 尚未实现，已降级返回默认值。`；保留为“疑似”，不是配置拉取失败或确定业务故障。其余4项pending，云控3个error分支均0命中。H2的72,092条原文回放，新5项均pending，Foundation收入/UpdateEcpm日志没有进入用例判定。正向未触发、异常未命中均不自动通过。本次只是历史原文离线回放，不注入真实会话，不是新一轮手机/界面验收。

### IOS3-080-V08-CF：云控变更监听降级（待办）

已有真实日志两次确认AddBizKVChangedListener报告未实现；当前IOSCloudConfig该方法调用ReportNotImplemented。需确认该安装包对应的原生库/插件版本，以及当前业务是否依赖运行时云控变更监听，再决定补桥接/回调还是接受降级。不能用“Init原生实现已接入”抵消此提示，也不能直接认定全部云控失效。本轮只记账，不改插件或原生库。

2026-11-17后续只读审核补充：iOSAnalyticsLibrary当前已有上传/落库结果诊断，既有H2中发现29条Foundation上传成功回执；V08不再笼统记作缺日志。详见[剩余24项审核](iOS剩余24项业务用例审核.md)的W03/W04，后续先核实版本/接线及规则级原生来源，再补失败样本；当前实现未接入这些原生记录。
