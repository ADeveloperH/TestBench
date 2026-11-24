import { all, any, cond } from "../testcases/engine";
import type { IosBusinessDefinition } from "./iosBusinessDefinition";

// 固定消息来源与首行，避免把调用栈、其他模块或配置正文引用当作诊断。
const configLine = (body: string) => cond("message", "regex",
  `^\\[IncentiveEngineManager\\]\\s*:\\s*\\[Config\\] ${body}(?:\\r?\\n|$)`);

const missingLevelConfig = configLine("levelConfig 未配置，关卡配置功能将不可用");

/** W01部分覆盖：明确的共享配置诊断，不套用Android字母级别及iOS自举凭据字段。 */
export const IOS_CONFIG_BUSINESS_DEFINITION: IosBusinessDefinition = {
  id: "ios_ie_config_missing", name: "激励框架配置缺失", group: "iOS · 初始化",
  description: "部分覆盖：按明确字段及正文区分必填/可选、资产和国家配置；依赖ENABLE_LOG。Adjust/反作弊自举字段与IAA内部字段待核实，不据未输出判断配置完整。",
  rules: [
    { effect: "error", description: "已确认的必填配置缺失或无效", expr: any(
      configLine("(?:privacyPolicyUrl|termsOfServiceUrl|cloudConfigHost|networkConfig\\.(?:prodBaseUrl|activityCodePrefix)|levelConfig\\.serverConfigKey) 未配置（必填）"),
      configLine("(?:cloudConfigTestHost|networkConfig\\.testBaseUrl) 未配置（TEST 构建必填，或由 TestEnvInjector 注入）"),
      configLine("levelConfig\\.loopMinLevel 未配置或无效（必填，需 > 0）"),
      configLine("uiConfig\\.popupPathOverrides\\[[^\\]\\r\\n]+\\] 的 prefabPath 未配置（必填）"),
    ) },
    { effect: "warn", description: "可选配置缺失，已关闭功能或使用默认值",
      ordinary: { description: "缺少 levelConfig，关卡配置功能不可用", expr: missingLevelConfig },
      expr: any(
      configLine("iaaConfig 未配置，广告功能将不可用"),
      configLine("networkConfig 未配置，网络请求将使用默认地址"),
      configLine("audioConfig 未配置，音效功能将静默跳过"),
      missingLevelConfig,
      configLine("levelConfig\\.localConfigAsset 未配置，将无本地兜底数据"),
    ) },
    { effect: "error", description: "IncentiveEngineConfig资产缺失", expr:
      configLine("IncentiveEngineConfig not found at Resources/IncentiveEngineConfig，请先创建并配置该资产。") },
    { effect: "error", description: "国家配置未支持或默认国家非法", expr: all(
      cond("message", "regex", "^\\[IncentiveEngineManager\\]\\s*:\\s*\\[Config\\] "),
      any(
        configLine("国家配置未勾选任何支持国家，请至少勾选 Support ID / BR / MY / PH / TH / VN。运行时将兜底为 ID。"),
        configLine("defaultCountry=[^\\r\\n]* 不在支持列表内，请配置为 ID / BR / MY / PH / TH / VN。运行时将回落到已勾选国家。"),
        configLine("defaultCountry=[^\\r\\n]*，但 Support [A-Z]{2} 未勾选。请勾选 Support [A-Z]{2}，或将 defaultCountry 改为已勾选国家。运行时将回落到已勾选国家。"),
      ),
    ) },
  ],
};
