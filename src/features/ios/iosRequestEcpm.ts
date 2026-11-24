export const IOS_REQUEST_ECPM_CASE_ID = "ios_ie_ad_ecpm_fail";

export const IOS_AD_PRICE_REQUEST_PATTERN = String.raw`^[ \t]*\[?NetWorkLog:Request\]?[ \t]+Post[ \t]+(?:https?://[^/\s]+)?/merge/coin/report/ecpm/match/pos(?:\?[^ \t\r\n]*)?(?=[ \t\r\n]|$)`;

const adPriceRequest = new RegExp(IOS_AD_PRICE_REQUEST_PATTERN, "i");
const nextLineObject = /^[ \t]*\r?\n[ \t]*(?=\{)/;
const labeledRequestParams = /^[ \t]*\[?NetWorkLog:Request\b(?:[^\r\n"{]*?[ \t]+|[^\r\n"{]*\r?\n[ \t]*)JsonParams[ \t]*:[ \t\r\n]*(?=\{)/i;

function getUnlabeledParamsStart(message: string): number | null {
  const requestHeader = adPriceRequest.exec(message);
  if (!requestHeader) return null;
  const headerLength = requestHeader[0].length;
  const separator = nextLineObject.exec(message.slice(headerLength));
  return separator ? headerLength + separator[0].length : null;
}

export function hasZeroIosRequestEcpm(message: string): boolean {
  const labeledHeader = labeledRequestParams.exec(message);
  const start = labeledHeader?.[0].length ?? getUnlabeledParamsStart(message);
  if (start === null) return false;
  // 跳过 JSON 字符串，避免其中的花括号干扰对象边界。
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}]/g;
  tokens.lastIndex = start;
  let depth = 0;
  for (let token = tokens.exec(message); token; token = tokens.exec(message)) {
    if (token[0] === "{") depth += 1;
    else if (token[0] === "}") depth -= 1;
    if (depth !== 0) continue;

    try {
      const params = JSON.parse(message.slice(start, tokens.lastIndex));
      return Object.prototype.hasOwnProperty.call(params, "ecpm") && params.ecpm === 0;
    } catch {
      return false;
    }
  }
  return false;
}
