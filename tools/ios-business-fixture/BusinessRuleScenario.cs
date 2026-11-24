using System;
using System.Collections;
using System.Threading;
using System.Runtime.InteropServices;
using UnityEngine;

namespace TestBench.IosLogFixture
{
    // 独立验收用。业务错误是构造文案；thread-real 是实际后台 Unity API 调用。
    public sealed class BusinessRuleScenario : MonoBehaviour
    {
        private const string Marker = "[TB.BusinessFixture]";
        private string _scenario;
#if UNITY_IOS && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern IntPtr TB_BusinessScenarioArgument();
#endif
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Install()
        {
            var go = new GameObject(nameof(BusinessRuleScenario));
            DontDestroyOnLoad(go);
            go.AddComponent<BusinessRuleScenario>();
        }
        private IEnumerator Start()
        {
            _scenario = "baseline";
            foreach (var arg in Environment.GetCommandLineArgs())
                if (arg.StartsWith("--tb-business-scenario=")) _scenario = arg.Substring("--tb-business-scenario=".Length);
#if UNITY_IOS && !UNITY_EDITOR
            // IL2CPP/iOS 的 Environment.GetCommandLineArgs 可能不保留原生启动参数。
            var nativeScenario = Marshal.PtrToStringAnsi(TB_BusinessScenarioArgument());
            if (!string.IsNullOrEmpty(nativeScenario)) _scenario = nativeScenario;
#endif
            // 留出采集/测试会话开始的时间；同一次启动只执行一个场景。
            yield return new WaitForSecondsRealtime(12);
            Emit("begin", $"scenario={_scenario}");
            switch (_scenario)
            {
                case "sdk-baseline":
                    Exact("baseline", "[IOSCloudConfig] Init：原生实现已接入");
                    Exact("baseline", "[Promotion] iOS bridge is_linked = True");
                    Exact("baseline", "[Analytics] 📤 ✅ 上传成功：1 条事件已收讫（服务端 code=200）");
                    Exact("baseline", "[Analytics] 事件 UpdateEcpm 未命中 Adjust 白名单 ⇒ 只上报埋点、不转发 Adjust");
                    Exact("baseline", "[AntiCheating][probe] iOS bridge is_linked = True");
                    Exact("baseline", "[AntiCheating] iOSAntiCheatingLibrary 已接入，已调用 initWithOptions");
                    Exact("baseline", "[IncentiveEngineManager]: [Config] adjustToken 未配置（必填）");
                    Exact("baseline", "广告日志: ADCoreManager Init. IOSAD");
                    break;
                case "config-required":
                    Exact("config", "[IncentiveEngineManager]: [Config] privacyPolicyUrl 未配置（必填）", LogType.Error);
                    Exact("config", "[IncentiveEngineManager]: [Config] IncentiveEngineConfig not found at Resources/IncentiveEngineConfig，请先创建并配置该资产。", LogType.Error);
                    Exact("config", "[IncentiveEngineManager]: [Config] 国家配置未勾选任何支持国家，请至少勾选 Support ID / BR / MY / PH / TH / VN。运行时将兜底为 ID。", LogType.Error);
                    break;
                case "config-optional":
                    Exact("config", "[IncentiveEngineManager]: [Config] levelConfig 未配置，关卡配置功能将不可用", LogType.Warning);
                    break;
                case "platform-errors":
                    Exact("ad", "广告日志: InitAdStrategy invalid, no mediation configured", LogType.Error);
                    Exact("ad", "广告日志: RewardAdStrategy invalid, pid:fixture", LogType.Error);
                    Exact("ad", "广告日志: ADManager Init Invoke,strategy is null", LogType.Error);
                    Exact("ad", "UnityDispatcherTool.RunOnMainThread: 任务不能为空！", LogType.Error);
                    Exact("ecpm", "NetWorkLog:Request Post /controlled JsonParams: {\"ecpm\":0}", LogType.Error);
                    Exact("cloud", "[IOSCloudConfig] Init：原生实现【未接入】—— 走的是兜底桩", LogType.Error);
                    Exact("cloud", "[IOSCloudConfig] GetBizConfigs \"controlled\" → 解析原生 JSON 失败：fixture", LogType.Error);
                    Exact("cloud", "[IOSCloudConfig] AB callback failed: fixture", LogType.Error);
                    Exact("analytics", "Beyla 埋点未初始化，埋点无效。。。。", LogType.Error);
                    Exact("analytics", "[FirebaseAnalyticsTracker]: Event ID cannot be null or empty", LogType.Error);
                    Exact("analytics", "[FirebaseAnalyticsTracker]: Failed to log event fixture", LogType.Error);
                    Exact("analytics", "[FirebaseInit]: Could not resolve all Firebase dependencies: fixture", LogType.Error);
                    Exact("promotion", "[Promotion] iOS bridge is_linked = False", LogType.Error);
                    break;
                case "platform-warnings":
                    Exact("ad", "广告日志: ADCoreManager LoadReward failed. Max is not init.", LogType.Warning);
                    Exact("cloud", "[IOSCloudConfig] AddBizKVChangedListener 尚未实现，已降级返回默认值。", LogType.Warning);
                    Exact("promotion", "PromotionManager GetPromotionChannel not init", LogType.Warning);
                    break;
                case "sdk-errors":
                    Exact("analytics", "[IOSAnalytics] ⚠️ 未接入 iOSAnalyticsLibrary —— 本工程走的是兜底桩", LogType.Error);
                    Exact("analytics", "[Analytics] ⚠️ TrackEvent(\"fixture\") 在未初始化时被调用，事件已丢弃", LogType.Error);
                    Exact("analytics", "[Analytics] ⚠️ TrackEvent 收到空事件名，已丢弃", LogType.Error);
                    foreach (var text in new[] { "事件库打开/建表失败：fixture", "事件落库失败：fixture", "事件库查询失败：fixture", "上传前压缩失败", "上传前加密失败", "上传流程取到 0 条事件", "上传失败：服务端未确认", "上传未完成：网络不可达" })
                        Exact("beyla", "[Analytics] 📤 ❌ " + text, LogType.Error);
                    Exact("anti", "[AntiCheating] ⚠️ 未接入 iOSAntiCheatingLibrary —— 本工程走的是兜底桩", LogType.Error);
                    Exact("anti", "[AntiCheating] token 通路判为**失败**（非终态：迟到成功仍可恢复）：code=1005", LogType.Error);
                    Exact("anti", "[AntiCheating] 同步取值返回非 0 code=1005（fixture）", LogType.Error);
                    break;
                case "sdk-warnings":
                    Exact("anti", "[AntiCheating] 本次取到的设备指纹长度为 5000 ⇒ **疑似降级值**。", LogType.Warning);
                    Exact("anti", "[AntiCheating] 同步取值的 code=0 但 blackBox 指针为空 ⇒ 无值", LogType.Warning);
                    break;
                case "sdk-ready":
                    Exact("anti", "🔗 [AntiCheating] 设备指纹就绪（长度 26）⇒ 之后 copyToken 将每次现取；SDK 版本=fixture");
                    break;
                case "sdk-recovery":
                    Exact("anti", "[AntiCheating] token 通路判为**失败**（非终态：迟到成功仍可恢复）：code=1005", LogType.Error);
                    yield return new WaitForSecondsRealtime(2);
                    Exact("anti", "🔗 [AntiCheating] 设备指纹就绪（长度 26）⇒ 之后 copyToken 将每次现取；SDK 版本=fixture");
                    break;
                case "baseline":
                    Emit("baseline", "NetWorkLog:Response Post /controlled Status:200\n{\"result_code\":200}");
                    Emit("baseline", "[NetworkManager]: Periodic network check");
                    Emit("baseline", "[LevelUpHandler]: 升级流程正在处理中，忽略重复调用。");
                    break;
                case "network-code":
                    Emit("network-code", "NetWorkLog:Response Post /controlled Status:200\n{\"result_code\":500}");
                    break;
                case "network-warn":
                    Emit("network-warn", "[NetworkManager]: 请求失败: /controlled, Code:500, Msg:fixture", LogType.Warning);
                    break;
                case "network-exception":
                    Emit("network-exception", "[NetworkManager]: 请求异常: /controlled, Error:fixture", LogType.Error);
                    break;
                case "network-uninitialized":
                    Emit("network-uninitialized", "[NetworkManager]: NetworkManager未初始化", LogType.Error);
                    break;
                case "level-config":
                    Emit("level-config", "[LevelConfigManager]: 服务端关卡配置请求异常，使用本地配置: fixture", LogType.Error);
                    break;
                case "level-up":
                    Emit("level-up", "[LevelUpHandler]: 升级流程异常: fixture", LogType.Error);
                    break;
                case "thread-real":
                    new Thread(() =>
                    {
                        try
                        {
                            // Development Build 的实际引擎线程检查；未抛出时明确标记不成功，不伪造异常。
                            GameObject.Find("__TB_Background_Unity_API_Check__");
                            NativeLogBridge.EmitNSLog($"{Marker} path=nslog scenario=thread-real thread_check_did_not_throw");
                        }
                        catch (Exception error)
                        {
                            Debug.LogError($"{Marker} path=unity scenario=thread-real actual_exception={error}");
                            NativeLogBridge.EmitNSLog($"{Marker} path=nslog scenario=thread-real actual_exception={error}");
                        }
                    }).Start();
                    break;
                default: Emit("unknown", $"unknown_scenario={_scenario}"); break;
            }
            Emit("end", $"scenario={_scenario}");
        }
        // 保留SDK/配置首行契约，受控标记放在同条消息第二行，不伪造真实Fruit业务输出。
        private void Exact(string kind, string text, LogType type = LogType.Log)
        {
            string unity = text + $"\n{Marker} path=unity scenario={_scenario} kind={kind}";
            if (type == LogType.Error) Debug.LogError(unity);
            else if (type == LogType.Warning) Debug.LogWarning(unity);
            else Debug.Log(unity);
            NativeLogBridge.EmitNSLog(text + $"\n{Marker} path=nslog scenario={_scenario} kind={kind}");
        }
        private void Emit(string kind, string text, LogType type = LogType.Log)
        {
            var unity = $"{Marker} path=unity scenario={_scenario} kind={kind} {text}";
            if (type == LogType.Error) Debug.LogError(unity);
            else if (type == LogType.Warning) Debug.LogWarning(unity);
            else Debug.Log(unity);
            NativeLogBridge.EmitNSLog($"{Marker} path=nslog scenario={_scenario} kind={kind} {text}");
        }
    }
}
