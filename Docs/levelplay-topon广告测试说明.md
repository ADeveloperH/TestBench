# FruitSliceRush LevelPlay + TopOn 广告测试说明

更新时间：2026-09-09

## 1. 用途

TestBench 已新增 `LevelPlay&TopOn 广告` 分组，目前只对
`com.fruit.slicerush` 生效。用例依据以下三层实际代码设计：

- ADPlugin：双平台串行加载、动态底价、实时加载、混插屏、统一请求与回调保护；
- IncentiveEngine：A/B 分组、PID 组装、业务入口、重试次数、H5 和业务回调；
- FruitSliceRush：当前广告 ID、Reward 缓存池、共享混插屏以及实际游戏入口。

TestBench 负责识别日志、聚合状态和定位命中行，不会替 QA 操作游戏或修改云控。带
`requirePass` 的用例在完整信号出现前显示“疑似”，表示流程尚未测完，不代表已经发现缺陷。

## 2. 测试前准备

1. 使用包含最新 IncentiveEngine 和 ADPlugin 的 FruitSliceRush 测试包。
2. 构建宏必须包含 `ENABLE_LOG`，否则不会输出这些中文流程日志。
3. 在 TestBench 选择应用 `FruitSliceRush (com.fruit.slicerush)`，开始测试后选择
   `LevelPlay&TopOn 广告` 分组。
4. 建议使用搜索收藏 `广告日志:` 查看完整广告链路。
5. 每轮记录应用版本、设备、实验组、portal 和 `[测试链路#数字]`。
6. 切换 A/B 组后必须彻底结束进程再冷启动；本次启动内实验方向按业务设计保持不变。

当前应用配置要点：

| 用途 | LevelPlay | TopOn | SDK 实际类型 |
|---|---|---|---|
| Splash 主广告位 | `7v6c2yy8ywv3myp2` | `n1hkfuho77gda4` | LevelPlay=Inter，TopOn=Splash |
| Reward 主广告位 | `lgw1jn7s2ov6w54y` | `n1hkfuho77gtr7` | Reward |
| Inter 主广告位 | `5bddi9vrukm8z69b` | `n1hkfuho77gluj` | Inter |
| Splash/Reward 共享混插屏 | `0v5kx7vn36fv4g7f` | `n1hkfuho77gp26` | Inter |
| Reward 缓存池 | `eqlv8p83we4n69mp` | `n1hkfuho77h1f6` | Reward |

Banner 两个平台的 PID 当前均为空，预期日志为 `【Banner预加载跳过】`，不作为接入失败。
后续修改广告 ID 或启用 Banner 时，必须同步更新 TestBench 的“应用广告位配置”用例。

## 3. 推荐测试顺序

### 第一轮：冷启动与自动预加载

1. TestBench 开始测试。
2. 强制结束应用进程并重新启动。
3. 等待初始化和预加载完成，不要立即切后台。
4. 检查以下用例：
   - 双平台初始化与实验分组；
   - 广告 eCPM 获取异常（正常流程应保持“监控中”）；
   - 广告配置异常（正常流程应保持“监控中”）；
   - LevelPlay/TopOn 价值回传（完成两个平台展示后检查）；
   - 应用广告位配置；
   - 串行预加载与动态底价。

串行成功链路必须使用同一个 `[测试链路#]`，人工确认顺序：

```text
【串行预加载开始】
【开始SDK请求】角色:首平台 ... 无动态底价
【SDK请求成功】角色:首平台
【动态底价计算完成】
【开始SDK请求】角色:第二平台 ... 原始eCPM ... 最终底价
【SDK请求成功】角色:第二平台
【串行预加载结束】结果:两个平台均可用
```

计算关系应为：

```text
换算eCPM = 首平台返回价格 × 1000
第二平台底价 = 换算eCPM + 加价值
```

分别准备 A、B 两次冷启动测试：

- A / `LevelPlayThenTopon`：首平台 LevelPlay，第二平台 TopOn；
- B / `ToponThenLevelPlay`：首平台 TopOn，第二平台 LevelPlay。

### 第二轮：Splash

1. 冷启动验证 `splash_startapp`。
2. 应用进入后台，满足热启动间隔后回前台，验证 `splash_backapp`。
3. 关闭广告后检查“Splash 冷/热启动展示闭环”。

重点确认：

- LevelPlay Splash 主位实际走 Inter 加载和展示；
- TopOn Splash 主位实际走 Splash；
- 共享混插屏在两个业务中都走 Inter；
- 业务层最终收到“开始展示”和“关闭”回调。

### 第三轮：Reward

从任务、提现、复活、气球或关卡宝箱入口完整观看一次激励广告。推荐使用最容易重复触发的关卡宝箱入口
`rv_levelbox`。

检查“Reward 展示与奖励闭环”，最终必须命中：

```text
【业务回调】广告类型:Reward ... 结果:关闭 是否获得奖励:True
```

如果实际展示的是共享混插屏，插件日志应显示“业务类型:Reward、实际广告类型:Inter”，但
IncentiveEngine 仍必须按 Reward 业务回调并正确发奖。

价值回传需要分别制造一次 LevelPlay 展示和一次 TopOn 展示。只有以下四条日志全部出现，
“LevelPlay/TopOn 价值回传”用例才通过：

```text
levelplay To Adjust suc
levelplay To Firebase suc
topon To Adjust suc
topon To Firebase suc
```

四条日志的预期 Tag 均为 `Android.revenueToMMP`。只展示一个平台时，另外两条尚未出现，
用例显示“疑似”属于测试未完成。

### 第四轮：Inter

可使用下一关、重玩、设置返回、提现返回或退出应用入口。FruitSliceRush 按返回键时，在游戏导流没有拦截且
`inter_exit_app` 云控开启的情况下会触发退出插屏。

检查“Inter 展示闭环”的策略、竞选、开始展示和关闭四个信号。普通 Inter 没有缓存时按现有业务不会实时请求，
会直接进入 H5 或加载失败流程。

### 第五轮：无缓存实时加载

清空应用数据或使用 SDK 调试能力确保候选都未就绪，然后立即触发 Splash 或 Reward。

检查“无缓存时实时加载”：

- 先出现“没有可展示广告”；
- 只请求当前实验首平台；
- 混合实时加载可以同时请求主位和混插屏，但两个请求都必须标记“实验首平台”；
- 不得出现角色为“第二平台”的实时 SDK 请求；
- 成功后只展示一次。

冷启动 Splash 通常最容易进入该分支。

### 第六轮：失败、重试和兜底

此轮需要可控失败/no-fill/延迟 PID 或 SDK 调试能力，普通线上广告结果不稳定时记录为“测试能力阻塞”。

1. 令首平台持续失败，验证“首平台失败后的串行兜底”。
2. 确认重试最多为配置次数加一次初始请求。
3. 首平台最终失败后，第二平台请求必须显示“无动态底价”。
4. 断网或令实时加载失败/超时，验证“实时加载失败与兜底”。
5. 实时失败只允许进入一次 H5 或一次业务失败回调，不得继续串行第二平台。

### 第七轮：请求保护专项

“请求去重、超时与回调保护监控”是异常事件监控，正常流程保持“监控中”即可。出现警告时展开命中日志，
按同一“平台 + 实际类型 + PID”和测试链路号核对：

- 预加载中又来预加载：第二次应被忽略；
- 预加载中来实时加载：实时回调接管，Android 只有一个真实请求；
- 实时加载中来预加载：预加载被忽略；
- SDK 重复或迟到回调：只处理第一个终态；
- 实时业务超时：解绑业务回调，底层迟到成功只形成缓存，不得再次展示；
- `【广告PID类型冲突，请求已拒绝】` 或
  `【旧实时流程静默结束异常】`：确定性失败，应提缺陷。

## 4. TestBench 能力边界

TestBench 当前按单条日志匹配，不能自动证明多条日志属于同一个 PID，也不能直接断言日志的精确顺序或
“同一请求只出现一次”。因此以下项目仍需 QA 点击命中日志人工复核：

- 串行流程的全部日志使用同一个 `[测试链路#]`；
- 第二平台请求发生在首平台终态之后；
- 动态底价计算值正确；
- 实时加载没有偷偷请求另一个聚合平台；
- 相同请求只有一个有效业务终态和一次展示；
- 失败、超时、H5、业务失败回调没有重复触发。

TestBench 的规则只把稳定、可单行判断的信号自动化；不使用跨链路的“缺失日志”规则，避免多个并发广告位互相
干扰造成误报。

`ad_mediation`、`levelplay_request_latency` 和 `topon_request_latency` 会经
`IAdDelegate.LogEvent()` 转交 GameAnalytics，但当前客户端没有稳定的“埋点服务端接收成功”日志，因此没有把
事件名出现当成通过条件。需要验收埋点时应在数据平台核对事件及参数，或等埋点 SDK 提供稳定回执日志后再补
TestBench 规则。

新分组不复用旧 AppLovin MAX 的 `max to adjust suc`，而是使用 LevelPlay/TopOn 各自的
Adjust 与 Firebase 成功日志。当前本地 Android 源码中还没有检索到这四个字符串；如果集成的 Android SDK
版本尚未包含对应日志，该用例会持续显示“疑似”，需要先更新 Android SDK。

## 5. 提交缺陷时附带信息

至少附上：

- 应用版本、IncentiveEngine/ADPlugin 版本、设备和系统；
- A/B 实验组与完整模式名；
- 广告类型、portal、平台和 PID；
- 对应的 `[测试链路#]`；
- 从 `【串行预加载开始】` 或 `【展示竞选开始】` 到最终结果的完整日志；
- TestBench 用例名称、命中规则和实际状态。
