# iOS 剩余24项业务用例审核

更新：2026-11-17。任务IOS3-080-W00（只读审核基线）。本文保留审核时的24项，后续W01及4项SDK诊断已开发，当前尚未接入数量为19；最新实施进度见文末。本轮不实现规则、不改变23项候选/2条正向试点、不改Android/Unity插件/原生库，不提交配置。本文件承接[逐项适配清单](iOS业务测试用例适配清单.md)与[第二批方案](iOS第二批业务规则证据与适配方案.md)，细化尚未接入的24项。

## 审核口径与证据路径

原47项减去两批23项独立iOS候选，剩24项；部分覆盖的5项仍有V06～V08缺口，不计为新增加的未接入项。只有平台对应业务确实不存在时才标“不适用”；当前未确认不等于不适用，更不能自动通过。

本地源码快照仅说明当前实现，未核对手机安装包与源码/Pod锁定版本一致。读取如下目录，未修改外部仓库：

- E：`<unity-framework-src>`。
- P：`<unity-plugin-src>`。
- L：`<ios-library-src>`。
- U：`<native-sdk-src>`，仅作下游实现线索；不能假设它等于当前安装包Pod实际代码。
- H1：验收会话-19的537条UnityFramework提取记录；文件`<local-evidence-file>`。该子集不能证明其他模块无日志。
- H2：既有NLC原文72,092条，其中UnityFramework1,031条；`<weak-network-records>`。
- 使用当前getIosLogDisplay还原后仅检索首行；摘要`<local-evidence-file>`、补充上下文`<local-evidence-file>`。仅做证据检索，不是新规则回放或手机验收；临时文件可能清理，不提交业务原文或凭据。

H1有1条`[Config] levelConfig 未配置，关卡配置功能将不可用`，可作为可选配置warn样本；有6条AntiCheating相关正文，其中1条“已调用initWithOptions”和1条“设备指纹就绪”。H2有29条`[Analytics] 上传成功：…已收讫`，均为Foundation；只证明该库日志所描述的上传批次，不是29个业务事件通过，更不是Firebase/Adjust收入回执。H1中DirectSDK只是network_info内容，含ad_load_fail的首行是Startup gate的reason，均不能拿来代验原广告用例。

## 11项通用/SDK用例逐项结论

| ID / 目标 | iOS适用性、源码与日志证据 | 可行判据及阻塞 | 后续归类 |
|---|---|---|---|
| `ie_config_missing` 配置缺失 | E/IncentiveEngineManager.Config.cs有明确必填/可选/资产/国家文案；全部受ENABLE_LOG。H1有levelConfig可选缺失 | 可复用业务目的，按字段＋明确正文区分error/warn，不依赖Apple级别；资产与国家可精确匹配。adjustToken、反作弊C#凭据、MAX专有字段需核对iOS实际取值，不整体复制 | 可先开发共享明确分支，平台字段暂缓；W01 |
| `ie_ad_config_mismatch` 广告配置异常 | L/iOSAdLib/Sources/AdTrack.swift有ad_load_fail的error_code/error_msg；AdMaxService.swift、AdToponService.swift有SDK失败处理 | 原Android.Stats＋固定英文不通用；需确认iOS SDK的广告格式错误码、消息输出是否进入可采日志，不能把任何加载失败当格式不匹配 | 需SDK错误语义及受控样本；W05 |
| `ie_adjust_revenue_fail` MAX/TopOn价值回传 | L/iOSAdLib/Sources/AdAdjustRevenue.swift转到PromotionBridge；L/iOSPromotionLibrary/Sources/IOSPromotionKit.swift调用Adjust.trackAdRevenue。H2有收入调用日志 | 源码明确“已上报”只证明调用，无广告收入后端回执；当前该链路未提供原规则所需Firebase四路成功证据。不能要求未配置SDK输出，更不能删成一个pass冒称等价 | 确认适用聚合/MMP与成功层级，重写覆盖矩阵；W06 |
| `ie_max_topon_validation` MAX包TopOn验证 | H1有MAX/TopOn bridge、network_info含DirectSDK，但不是DirectSDK ad_show。P/adplugin及L/iOSAdLib是MAX/TopOn路径 | 需iOS MAX接入TopOn网络的配置、实际展示与收入证据；出现网络名字/价格不证明展示发生 | 需构建配置与展示样本；W05 |
| `ie_ua_adjust_event` UA埋点 | L/iOSAnalyticsLib/Sources/AnalyticsKit.swift有白名单匹配与“已转交Adjust事件”；L/iOSPromotionLibrary负责后续Adjust队列/回执语义 | 原Android AdjustCollector/onSpecialEvent无iOS等价。先确认哪些事件是UA及白名单；“转交”与SDK异步送达分开定义，不能以任意事件满足 | 需事件身份/白名单及实际回执样本；W06 |
| `plugin_analytics_fail` 原生埋点桥接 | P/analyticsplugin/Assets/Analytics/Runtime/IOSAnalytics.cs检查真实库链接；L/iOSAnalyticsLib/Sources/AnalyticsKit.swift有未初始化丢弃、空事件名、参数/白名单诊断。H1有bridge接入探针 | 可先做iOS未链接、明确丢弃事件等集成诊断；原Android已移除初始化文案不适用。Logger门控、原生Foundation来源和错误作用范围应单独处理，不按Apple error兜底 | 可先开发Unity可采探针；原生分支先W04来源适配；W02 |
| `sdk_beyla_data_fail` Beyla数据异常 | L/iOSAnalyticsLib/Sources/AnalyticsUploadReporter.swift已有打开/建表、落库、查询、压缩/加密及上传失败诊断；AnalyticsLog.swift负责前缀与限频。U/statistics/Beyla/BeylaCache.swift提供下游通知线索。H2已有29条上传成功 | 不能照搬Android count/BL_ParamErr/SQLite文案。已有iOS证据，无须先改库；须确认notification接线/依赖版本，区分调用/落库/上传。当前Foundation不入监测；按消息来源适配后才能接入 | W04＋W03；需要失败样本，不是笼统缺日志 |
| `sdk_config_storage_fail` 云控缓存异常 | L/iOSConfigLib/Sources/{UnityConfigContext,CloudConfigFlatLookup,CloudConfigABInfo}.swift是桥接层，实际缓存进一步进入U/config/{ConfigContext,ConfigService}.swift线索 | Android InterruptedException/loadAbInfoCache不可复用；本次未确认有稳定可采的iOS缓存读写失败事件。普通空配置/默认值不等于缓存损坏 | 核对实际Pod缓存实现及错误输出，必要时形成补日志需求；W07 |
| `anticheat_runtime_fail` 反作弊运行异常 | L/iOSAntiCheatingLib/Sources/IOSAntiCheatingKit.swift已有code失败、blackBox为空、通路失败、疑似降级值及同步获取异常；AntiCheatingLog.swift多路输出/限频。H1有就绪信号 | 可定义iOS通路失败/降级规则，不能照搬Android默认token。SDK码、迟到恢复、长度提示须分别定语义；长度26本身不能作为通用成功判据。原生来源需W04核实 | 有源码与正向实证，可开发明确诊断候选，失败样本待补；W02 |
| `anticheat_init` 反作弊初始化 | P/AntiCheatingPlugin/Assets/Plugins/iOS/AntiCheatingLaunchHook.mm自举；P的IOSAntiCheating.cs只是探针/取值。L的IOSAntiCheatingKit.swift区分调用初始化与异步就绪，原生单次尝试有4秒死线。H1两阶段各1条 | 以“设备指纹就绪”而非“initWithOptions已调用”作正向；不能照搬TD_JAVA锚点＋20秒。优先识别现成失败诊断；如要新增缺失计时须另定iOS锚点、原生时间与采集边界 | 可先正向/明确失败；计时与恢复语义需设计；W02 |
| `no_crash` 无崩溃 | 当前Syslog应用日志不是完整Crash/异常终止证据源；Android Java/Kotlin/libc条件均不适用 | 需iOS Crash报告/进程终止原因及会话关联方案。USB断线或采集退出不能当崩溃；未见异常不能证明无崩溃 | 独立能力前置，暂缓规则；W08 |

## 配置项专项：不能简单“未配置＝error”

当前E的ValidateConfig已有明确文案，可把资产不存在、国家非法、隐私/服务URL、网络与关卡配置中已核实的字段分支设计为iOS候选；可选对象缺失/默认值提示保持warn。识别来源应包含IncentiveEngineManager及[Config]与字段/句式，不能把任意“国家”都判错。

但当前部分校验仍无平台条件：C# adjustToken校验必填，而P/PromotionPlugin的iOS InitAdjust实际读取Info.plist；反作弊iOS也从Info.plist自举，C#凭据不转发；广告配置依赖实际启用聚合。不能因旧C#字段为空就认定iOS SDK必然配置错误。此类只登记，待核对打包注入与真实取值后再制定iOS规则，本轮不修改源库校验。

## 13项另一产品广告专项逐项结论

共同前置：原作用域`com.fruit.slicerush`与当前iOS Fruit `com.lucky.fruit.quest.master`不是已确认映射。当前看到的Android app_levelplay示例及iOS MAX/TopOn源码，不能证明已存在对应的LevelPlay/TopOn iOS产品。未找到足以确认的iOS Bundle＋SDK版本＋广告配置组合，故以下全部为“待确认对应产品”，不是永久不适用，也不提前新增13个空规则。

共同源码线索：P/adplugin/Assets/AD/Runtime/Strategy/*（共享策略）、Core/IOSAD.cs及IOSAdShowPayload.cs（平台回调），L/iOSAdLib/Sources/{IOSAdKit,AdMaxService,AdToponService,AdTrack}.swift。插件ADDependencies.xml当前声明iOSAdLibrary 0.6.6，不能视为手机已安装版本；InitAdStrategy当前是MAX/TopOn，并非原LevelPlay实验。

| ID | 需要的iOS适配与专属阻塞 | 证据边界/下一步 |
|---|---|---|
| `fruit_ad_dual_init` | 确认双平台确为LevelPlay/TopOn、实验分组及Key；当前MAX初始化不可冒充LevelPlay | 确认产品后采实验值与每个平台初始化，保留多pass及非法组error |
| `fruit_ad_ecpm_fail` | 共享展示前-1/请求0可作源码线索；SDK price无效值需按该产品平台核实 | 当前Fruit价格/请求不代验另一产品；依赖V07单位/无效值核实 |
| `fruit_ad_config_mismatch` | 广告格式错误码、消息、实际placement/format必须是该iOS SDK定义 | 依赖W05；不能拿所有ad_load_fail作确定配置错误 |
| `fruit_ad_value_revenue` | 每聚合×Adjust/Firebase是否接入及“成功”层级需确认 | 依赖W06；现有MAX调用日志不能充当LevelPlay/Firebase回传 |
| `fruit_ad_slot_config` | Splash/Reward/Inter/Banner及混插位、缓存池和PID必须来自该iOS包配置 | 不复制Android硬编码PID或Banner跳过断言；先配置清单 |
| `fruit_ad_serial_success` | 实验方向、首/次平台、动态底价算法与单位、请求关联需确认 | 共同出现多条日志不证明同轮串行或先后；现引擎无跨事件请求关联断言 |
| `fruit_ad_serial_failover` | 首平台重试耗尽→无底价第二平台→可用，需可控失败与关联ID | SDK无填充不等于实现故障；不能仅靠多pass证明链路 |
| `fruit_ad_splash_flow` | iOS冷/热启及Splash实际映射类型需确认，LevelPlay类型断言不通用于MAX | SDK开始＋业务开始＋关闭各自证据齐全，不能以关卡进入代替 |
| `fruit_ad_reward_flow` | 需同一次Reward竞选/展示/奖励关闭闭环，区分取消与完整观看 | 当前Fruit关卡/进度及OnReward字样不证明该产品发奖成功 |
| `fruit_ad_inter_flow` | iOS插屏策略、竞选、开始、关闭及平台映射 | 不拿Reward回调补Inter缺失；需该产品完整日志 |
| `fruit_ad_realtime_first_platform` | 无缓存前提、实验首平台实时请求、成功与禁止第二平台 | 原生真实请求计数和来源缺失时不能从“没有第二平台日志”推断没有请求 |
| `fruit_ad_realtime_failure` | 超时/断网/失败后H5或业务失败回调，取决于iOS是否实现H5兜底 | 本项预期就是失败场景，不能把SDK加载失败即判用例失败；流程须定向采样 |
| `fruit_ad_request_guard` | 去重、迟到回调、超时阈值、PID跨类型复用、旧流程静默结束均须核实iOS实现 | 不复制Android真实请求数或60秒常量；需关联和计数证据，部分为引擎能力前置 |

上述13项统一进入IOS3-080-W09：先确认产品与平台能力矩阵，再逐条决定可用/不适用/需独立实现；不是当前下一批开发范围。

## 后续可执行顺序与阻塞任务

| 任务号 | 工作 | 当前结论与进入开发条件 |
|---|---|---|
| IOS3-080-W00 | 审核剩余24项 | 本文完成。23项候选/24项未接入数量不变，不新增规则 |
| IOS3-080-W01 | iOS配置缺失的明确共享分支 | 优先可做：字段白名单/必填可选正文、资产及国家；iOS自举字段暂缓。ENABLE_LOG与真实负样本、受控失败样本分开验证 |
| IOS3-080-W02 | iOS集成诊断与反作弊两项 | 先做Unity可采未链接探针、反作弊就绪/明确失败；事件仅在原生模块时先W04。定义“本轮曾失败”的历史告警，不能伪装实时健康状态；迟到恢复不清历史错误，若产品要恢复状态须另设计 |
| IOS3-080-W03 | Beyla数据/上传iOS诊断 | 已有库输出，先核对依赖版本/接线及原生来源；不改库即可研究接入。Android原计数/大小/数据库规则按iOS证据重写，未覆盖部分明示 |
| IOS3-080-W04 | 规则级原生来源适配前置 | 对Foundation＋SDK稳定前缀逐规则授权，仍隔离应用/设备/会话，保留原文/时序；验证多路重复、受限正文及丢日志边界，不全局放开Foundation，不修改Android输入 |
| IOS3-080-W05 | 广告格式与MAX-TopOn验证证据 | 核实SDK错误码及配置，采实际展示/收入，不复用network_info字样 |
| IOS3-080-W06 | UA与收入的平台能力/成功层级矩阵 | 明确聚合/MMP、事件身份、是否只到SDK调用/异步回执；不要求不存在的Firebase或LevelPlay |
| IOS3-080-W07 | 云控缓存可观测性 | 定位安装包实际依赖缓存实现及稳定错误输出；存在日志先适配，没有才提出补日志需求 |
| IOS3-080-W08 | iOS崩溃证据来源 | 独立数据源与关联设计，先不开发“无日志＝无崩溃”规则 |
| IOS3-080-W09 | 另一产品13项前置确认 | Bundle/SDK/平台配置/实验/回调及关联能力逐项确认；未确认不认不适用 |

建议下一轮先W01，再W02中Unity来源可实现部分；并完成W04设计后再接W03和原生反作弊。W05～W09按证据推进，不一次凑齐24个无法验证的定义。所有开发继续独立iOS身份、默认停用、只读候选，与Android采集/过滤/用例配置隔离，不改原生库。

此前V08笼统“埋点上传结果待核对”现在细化为：iOSAnalyticsLibrary已有上传/落库结果诊断，H2也有成功回执；阻塞是版本与来源接入及异常样本，不是已确认需要改库。反作弊也已有明确结果探针；仍不能因当前源码有输出就宣布安装包全部路径已验。

## 本轮验证范围

只读审核规则/源码、历史正文线索及文档结构，不做新手机采集、规则执行或原生UI验收。本轮只新增本审核文档和文档入口，保留此前第二批未提交实现与文档，不提交代码、不发布配置。

校验结果：审核表24个ID与原47项减去已实现23项的集合完全一致，无遗漏/重复；iOS文档链接、配置校验、TypeScript、生产构建和git diff --check通过。构建保留已有500kB包体提示；未运行新业务规则验收。

## W01实施更新（2026-11-17）

W01明确共享分支已接入默认停用候选；24项审核基线中该项转为“部分覆盖，待集中验收”，因此当前剩23项未接入。具体覆盖、自测及原文回放见[业务适配清单](iOS业务测试用例适配清单.md)的W01收口。W01-P暂缓adjustToken、反作弊C#凭据和IAA内部字段，先核对iOS真实值源/适用性；不修改原生库。下一步仍为W02可采诊断及W04来源前置。

## 当前覆盖与阻塞台账（2026-11-17，W02～W04之后）

审核基线24项中，W01配置＋埋点桥接＋Beyla数据＋反作弊运行/初始化共5项已转为默认停用候选（独立iOS判据，部分覆盖），剩19项。已开发不等于完整业务/异常分支已验收。

| 分类 | 尚未接入业务 | 数量 | 下一步/不做空规则的原因 |
|---|---|---:|---|
| 缺SDK错误语义与真实配置/展示证据 | ie_ad_config_mismatch、ie_max_topon_validation | 2 | W05：确认iOS错误码、MAX下TopOn接入及实际展示；network_info包含网络名字不够 |
| 待确认平台能力及成功层级 | ie_adjust_revenue_fail、ie_ua_adjust_event | 2 | W06：确认聚合/MMP矩阵和UA事件身份；SDK调用/转交不是后端成功，不要求不存在的Firebase通路 |
| 缺稳定日志/安装包依赖证据 | sdk_config_storage_fail | 1 | W07：确认实际Pod缓存实现及稳定读写失败输出；默认值不作为失败。现状不是确认必须改库 |
| 缺数据源能力 | no_crash | 1 | W08：先有崩溃报告/终止原因和会话关联；普通Syslog无错误不能证明无崩溃 |
| 待确认对应产品 | 原13项fruit_ad_* | 13 | W09：确认iOS Bundle、SDK/配置和实验；当前Fruit不能代验另一产品 |
| 平台不适用的旧分支（不另计用例数量） | Android Referrer、Android缓存/Java异常、TD_JAVA锚点、Android广告/埋点Tag | — | 仅这些旧证据分支不适用于iOS；对应业务整体仍可能适用，不能标整个用例通过或永久不支持 |

## T01 提交后复核六项通用用例

当前 47 项 Android 内置用例中，28 项已有独立 iOS 定义，普通构建启用其中 27 项和两条 iOS 正向试点。T02 已有候选定义，仍停用。剩余 19 项尚未接入，本次只复核其中六项通用用例，另一款游戏的 13 项暂缓。

本轮对照 Android 内置规则及其原生日志调用点、iOS 公共库源码和 Fruit iOS 导出工程的依赖锁定文件。回放 59 个历史 Fruit 会话的 2,845,240 条记录，用现有中文还原逻辑检查采集正文。下表的日志条数含双通道副本，同一会话内的两条信号也不能据此归到同一次广告展示。导出工程锁定版本用于核对依赖范围，实际日志样本用于确认对应信号可采。

| 用例 | 结论 | 现有证据与接入边界 |
| --- | --- | --- |
| MAX 包 TopOn 验证 `ie_max_topon_validation` · W05 | 可适配两条正向判据 | `AdMaxService.handleDisplayed` 通过 `IOSAdKit` 生成 `[track] ad_show`，取 MAX 回调的 networkName 为 JSON `source`。`AdToponService.didRevenue` 在真实收入回调命中 GreenGame 去重时留痕。已有一个会话同时出现 `source=DirectSDK` 的展示和明确的 TopOn 收入去重，两类各两条。按应用和会话判定，仅用于已配置 MAX 套 TopOn 的包。验证正常 MAX 展示、只有 `network_info`、只有其中一个信号的对照。 |
| UA 埋点监控 `ie_ua_adjust_event` · W06 | 可适配 SDK 调用层 | Android `AdjustCollector` 在白名单映射命中且执行 `Adjust.trackEvent` 后打印 `onSpecialEvent()`，内置规则未指定某个事件名。iOS `AnalyticsKit` 执行对应白名单判定，`IOSPromotionKit.emitAdjustEvent` 在调用 `Adjust.trackEvent` 后打印「已转发 Adjust 事件」，两次历史会话中均能用同一 token 对上「已转交」与「已转发」。按同一层级接入时仅接受调用日志。另有「已转交」及后端回执，可用于区分桥接、调用和送达。如果产品要指定某个 UA 事件，需要按 iOS 生效白名单核对事件与 token 映射。 |
| MAX/TopOn 价值回传 `ie_adjust_revenue_fail` · W06 | Adjust 分支可先适配，四路判据待补 | 历史样本有 MAX 28 条、TopOn 12 条调用 `Adjust.trackAdRevenue` 的日志。`IOSPromotionKit.trackAdRevenue` 还对收入确定丢弃或构造对象失败留有明确诊断，回放未命中，需受控对照；正常等待、GreenGame 预期去重均不能判丢失。iOS 导出包含 Firebase 依赖，当前仍缺 MAX/TopOn 分别调用 Firebase 收入上报的可采证据。Adjust 的普通事件回执也不覆盖收入 API。可用独立 iOS 规则描述 Adjust 调用及明确丢弃，完整四路通过条件继续记账。 |
| 广告配置异常 `ie_ad_config_mismatch` · W05 | 记账，等 SDK 错误语义与样本 | `AdTrack.loadFail` 可带 SDK 失败码和正文，历史未见 Android 格式错配文案。`AdToponService` 的 `unsupported_format` 是库内不支持某广告形态的前置拦截。需要该 iOS SDK 对广告位与请求格式错配的明确诊断，以及正常、无填充等对照。 |
| 云控缓存异常 `sdk_config_storage_fail` · W07 | 记账，等稳定的存储异常信号 | `CloudConfigABInfo` 通过 UserDefaults 读取和异步保存 AB 缓存，空值或类型不符回落默认。公共 `ConfigService` 默认用 `StorageService.preferences`，读写接口未提供对应的可判定失败结果。需采到可区分缓存未命中、解码失败和持久化失败的证据；云控请求失败由现有网络/云控规则观察。 |
| 无崩溃 `no_crash` · W08 | 记账，先补数据源和会话关联 | 当前 TestBench 的 iOS 采集走 go-ios syslog。需验证 Crash 报告（如 `.ips`）或可靠异常退出原因的采集，按设备、应用、进程和时间关联会话，区分主动退出、断线与崩溃。缺少证据时维持未判定。 |

### W05/W06 接入结果

MAX 包 TopOn 验证和 UA 埋点监控已接入普通、内部构建。59 个历史 Fruit 会话回放中，MAX 包 TopOn 验证 1 个通过、58 个监控中；UA 埋点监控 2 个通过、57 个因缺少 SDK 调用日志显示疑似。「疑似」沿用 Android 的缺少正向证据状态。日志按进程内配额输出，一轮缺记录可能是未触发、采集开始过晚或配额用尽。

自动化验证覆盖两路日志、原文保留、单一信号、广告字段嵌套或错误聚合、JSON 不完整、跨会话、模块/进程不匹配、截断、仅桥接和仅后端回执。普通和内部构建、配置校验、类型检查通过。全量 393 项通过，2 项跳过。历史真机日志用于规则回放，本轮未重新触发实际广告或埋点。

### 其余四项逐项分析

| 用例 | 还缺的证据及可验证步骤 |
| --- | --- |
| MAX/TopOn 价值回传 · W06 | 可优先做单独的「Adjust 广告收入调用」监测。独立包驱动 MAX、TopOn 收入回调，分别断言调用、明确未上报和正常等待。用 GreenGame 的预期去重做反例。完整原用例还需查清该包的两路 Firebase 收入出口；通用 Firebase `LogEvent` 封装和库依赖、MAX 的普通 `ad_imp` 均不足以证明两路调用。确认真实出口后再对齐四路判定；Adjust 收入后端到账需后台证据。 |
| 广告配置异常 · W05 | 核过 Fruit 导出包的 MAX `MAErrorCode.h` 和 TopOn `ATAdErrorCode.h`。MAX `-5603` 包含无效、禁用、未关联当前包、新建未生效等情形；TopOn `1004` 表示广告位策略未找到，`1014` 表示输入无效，粒度不足。优先用测试包的有效 Reward 广告位发 Inter 请求，记录聚合、请求形态、SDK 错误码和正文，再对照正确形态、无填充和任意无效 ID。若仍只有通用错误，保留待办，后续考虑在已有广告位配置校验点补可采诊断。 |
| 云控缓存异常 · W07 | 下层 `StorageService.preferences` 也走 UserDefaults，`Storage.load` 的空值/解析返回无法在现有日志中消歧，`set` 没有磁盘写入失败回执。独立包可先区分首次无缓存、已存内容无法解码、正确缓存三种可观测状态；若业务确定需要监测，优先在解码失败点补稳定诊断，只记录阶段和原因，避免打印配置值。真实持久化失败需有明确结果的写入路径再谈覆盖。 |
| 无崩溃 · W08 | 本机使用现有 go-ios v1.3.2 检查了 `crash ls` 和 `crash cp`。两个设备记录中一个可成功列出报告，未匹配到 FruitQuest `.ips`；另一个读取失败。下一步用可控测试应用产生已知崩溃，验证 USB 只读采集和报告到达时序；通过采集起点和设备、应用标识、进程与时间匹配，排除旧报告和重复报告。主动结束应用或断线各做对照。报告为空时仍保留监控状态。 |

四项暂未接入。另一款游戏的 13 项继续暂缓。

### W06 Adjust 广告收入调用

iOS 单独定义 MAX 和 TopOn 各自调用 `Adjust.trackAdRevenue` 的正向证据，两条齐全后通过。归因库明确拒收、对象创建失败、缓存溢出明确丢弃时判有问题。等待归因 SDK 就绪、广告收入统计埋点和 GreenGame 预期去重各作对照。默认开关以独立 iOS 包真机采集和规则回放为准。

已使用现有开发签名，在 iOS 18 测试机 A 上安装临时原生验收包，采集 203 条记录。包内运行公共库实际的收入队列、来源映射、Objective-C 桥、`PromotionKit` 和日志输出。MAX、TopOn 收入输入由测试驱动注入，Adjust SDK 用进程内替身记录调用，无外部广告或归因请求。

| 真机场景 | SDK 替身收到的调用 | 规则回放 |
| --- | --- | --- |
| MAX、TopOn 分别在归因库未就绪时被明确丢弃 | 0、0 | 两轮均有问题 |
| 等待 SDK 就绪，收入暂存在广告队列 | 0 | 监控中，无告警 |
| SDK 就绪，刷新 MAX 和 TopOn 队列 | 各 1 次，核对收入比例、币种、次数、来源与广告位字段 | 两路证据齐全，通过 |
| 收入对象创建失败 | 0 | 有问题，识别 MAX 和 TopOn 两路 |
| 归因入口收到未知收入来源 | 0 | 有问题 |
| 队列上限触发，最旧一条被丢弃 | 0 | 有问题 |

七个场景均捕获完成标记及匹配所需的 Foundation 原文，普通构建和内部构建回放一致。另回放 59 个历史 Fruit 会话，3 个通过、56 个监控中，未命中丢弃告警。普通构建已默认启用该规则。配置校验、类型检查、普通与内部构建通过；全量自动化 395 项通过、2 项跳过。

Firebase 两路继续记账。需要分别确认 MAX、TopOn 的 Firebase 收入调用位置、稳定日志和可控真机样本。Adjust 分支只核对 SDK 调用层，收入报表到账另需后台证据。

### W05 广告配置异常真机预检

独立原生包链接 Fruit iOS 导出工程同版本的 MAX 13.6.0，已开发签名、安装并在 iOS 18 测试机 A 启动。测试程序准备了四个只加载的对照，分别是用激励广告位请求插屏、同一广告位请求激励、正常插屏广告位、无效 ID。首次运行的 SDK 初始化回调返回 `test_mode=0`，程序按预设结束，未发起广告加载，采集到 649 条进程日志。后续使用现有工作台配置发起真实加载的操作被自动审批拦截，因为会把广告位和设备标识发送给 AppLovin。

MAX 二进制含有 `Incorrect format (…) loaded for (…) ad` 诊断模板。还需确认真实错配时它是否出现在 TestBench 可采的 Syslog，或进入 MAX 回调的 `adLoadFailureInfo`。现行 iOS 广告库用 `code;adLoadFailureInfo` 构造 `ad_load_fail.error_msg`，另一字段 `MAError.message` 即使带清楚诊断，也需要确认产品采集出口。TopOn 的激励和插屏共用按广告位加载的 SDK 入口，切换这两个应用层请求类型不足以证明 SDK 收到不同的请求格式。

复核 59 个历史 Fruit 会话中的 2,845,240 条进程记录，22 条可解析的 `ad_load_fail` 均来自 TopOn，未发现明确错配正文。MAX `-5603`、TopOn `1004` 或 `1014` 仍不能单独用作错配判据。iOS 规则继续待证据，未启用。下一轮需用适用于独立包 Bundle ID 且获准发起网络请求的广告配置，在正确形态加载和无效 ID 对照下确认错配日志及采集来源。

### W05 现有工作台配置加载对照

用户授权后，在 iOS 18 测试机 A 上使用同一个独立包和现有工作台 MAX 广告位，执行两轮只加载的四组对照。第一轮带 SDK 测试设备参数，SDK 回报 `test_mode=1`；第二轮移除该参数，SDK 回报 `test_mode=0`。合计采到 3,330 条进程日志，并同时检查了 Xcode 控制台。两轮均未调用广告展示、点击或发奖能力。

| 加载场景 | 测试模式开启 | 测试模式关闭 |
| --- | --- | --- |
| 用激励广告位请求插屏 | 加载成功，回报 `INTER` | `-5603` |
| 同一广告位请求激励 | 加载成功，回报 `REWARDED` | `-5603` |
| 正常插屏广告位请求插屏 | 加载成功，回报 `INTER` | `-5603` |
| 无效广告位请求插屏 | 加载成功，回报 `INTER` | `-5603` |

四条非测试回调均显示广告位无效或禁用，`adLoadFailureInfo` 为空。Syslog 与 Xcode 控制台均未采到明确的格式错配诊断。工作台广告位登记在 Fruit 的 Bundle ID 下，独立验收包使用自己的 Bundle ID。当前可用的 OS18 已安装 Fruit，保留现有安装。可继续验证的前提是为独立包配置匹配的 MAX 广告位，或使用未安装 Fruit 的测试机运行同 Bundle ID 的独立验收包。仍需以正常加载对照成立、错配独有且可采为启用依据。

W05 广告配置异常记账，等待匹配广告位。

### W07 云控缓存异常真机对照

在 iOS 18 测试机 A 上运行独立包。业务缓存使用 Fruit 导出依赖的 `ConfigService.readConfig`、`Storage`、`UserDefaults` 和 HandyJSON 源码，AB 缓存使用公共库 `CloudConfigABInfo` 源码。测试仅写入夹具沙箱，网络入口由拒绝调用的替身保护。原版 148 条记录，临时诊断版 152 条，两轮返回值及回退行为一致。

| 场景 | 读取结果 | 原版云控日志 | 临时诊断版 |
| --- | --- | --- | --- |
| 首次无缓存 | 两类均返回空 | 无 | 无 |
| 正常缓存 | 两类均恢复，AB 同名服务端优先 | 无 | 无 |
| 已有缓存损坏 | 业务 JSON 与 AB 快照均回退为空 | 无 | 分别报告 `invalid_model` 与 `invalid_snapshot` |
| 合法空缓存 | 两类均返回空 | 无 | 无 |
| 业务缓存非法 UTF-8、AB 客户端域损坏 | 业务回退为空，保留 AB 有效服务端域 | 无 | 分别报告 `invalid_utf8` 与 `invalid_client` |

临时版的四条 `[CloudConfig] cache_decode_failed scope=… reason=…` 诊断均由 Syslog 从 Foundation 收到，无配置键值。现有原生库的空结果无法区分首次无缓存、合法空缓存与缓存损坏，因此 TestBench 正式用例保持未接入。需先将诊断引入对应 iOS 原生依赖并验证实际业务包，再以精确前缀、来源及失败原因启用告警。诊断只覆盖可证实的读取解码失败，UserDefaults 真实持久化失败继续记账。

W07 云控缓存异常记账，等待 iOS 原生依赖提供可采的正式诊断。

### W08 无崩溃

首轮仅验证 Apple `.ips` 应用崩溃报告中的 `EXC_CRASH / SIGABRT`。读取目标限于当前设备、应用 Bundle ID、可执行文件和测试轮次的时间边界。相同 Apple incident ID 在同轮计一次。正常退出、设备断线和读取失败不产生异常判定，缺少报告时保持监控中。正式启用以独立包真机验收为准。

iOS 18 测试机 A 独立包执行一次 `abort()`。约 6 秒后 go-ios 列表出现新的 Apple `bug_type=309` 报告，只读复制成功，原报告仍在设备上。报告的 Bundle ID、可执行文件与 PID 和本轮一致。新 Rust 读取器直接读取同一真机报告，重复轮询只保留一个 incident，换到更新的采集起点后排除旧报告。用实际报告回放 iOS 测试规则，当前轮判为「有问题」且命中一次，下一轮保持「监控中」。独立包正常退出后未新增 `.ips`。

补验实物 USB 断线时，macOS 观测到该设备离开 USB 枚举约 16 秒，go-ios Syslog 报 EOF，断线时报告列表查询失败。重连后查询恢复，相对拔线前没有新增 `.ips`。自动化验证确认，断线或停止状态不消费崩溃证据，后续采集不会认领旧报告。

新增读取仅用于精确应用采集下的 iOS 测试 Tab，通过 go-ios 查询正在运行的采集会话。原报告在临时目录解析，测试侧栏仅显示时间、应用、进程、PID 和 incident ID 摘要。读取发生在采集期间，采集停止后停止轮询。普通构建已默认启用经 macOS 真机验证的 `EXC_CRASH / SIGABRT` 分支。Windows 真机及其余崩溃类型仍待验证。

已实现项仍需补证：W01-P的自举/IAA内部字段；V06的IOSAD专有/ABI诊断；V07价格单位和无效值；V08-CF云控变更监听未实现；W02反作弊实际失败/恢复与凭据错误、W03建库/落库/上传失败样本；其他原生模块输出及安装包版本一致性。Beyla Android参数数量/大小分支未覆盖，插件现只覆盖明确集成错误，未把未知原生error纳入兜底。

### W02/W03/W04实施状态

- W02已实现候选：Unity/原生可采埋点未链接及明确丢弃、反作弊就绪/失败/降级；不新增Android计时。更广SDK/ABI及未知模块仍待补证。
- W03已实现候选：已核对的iOS事件库、上传前处理和未完成诊断；沿用数据异常warn，不以29条上传成功回执判整项通过。
- W04已实现有界来源适配：仅4个明确ID、UnityFramework/Foundation与各自SDK首行；原有全部规则保持UnityFramework。未做任意模块自动识别或全局原生放行。

新增78项SDK回归、总331项相关回归通过。H1设备指纹就绪pass1次，其他新3项pending；H2新4项pending，上传成功无误报。保留原文，次数为日志记录；本轮是逻辑测试与历史原文回放，没有新手机/原生界面验收，未修改Android、Unity或原生库。

2026-11-18集中真机验收完成一轮：OS18真实Fruit47,484条，初始化/进度正向、配置及云控warn和真实早期Beyla错误已核验；独立包9类场景共10轮、2,431条验证配置/平台/SDK诊断、重置与失败后恢复。候选仍默认停用，不等于28项业务分支全验收，剩19项不变。新增AC01启动早期Beyla待查；通关/广告闭环待补，详细范围见[本轮验收记录](iOS业务候选真机验收-20261118.md)。
