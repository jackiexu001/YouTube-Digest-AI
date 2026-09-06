/**
 * 语音识别服务商。
 *
 * 与做概览翻译的文本模型是两回事：这里只负责把音频变成带时间戳的文字。
 * Groq 和 OpenAI 的接口都是 Whisper 的那一套，共用同一个请求格式。
 */
var YTD_ASR_PROVIDERS = (() => {
  const PROVIDERS = Object.freeze([
    {
      id: "groq",
      label: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "whisper-large-v3-turbo",
      keyUrl: "https://console.groq.com/keys",
      // 官方定价：每小时音频约 0.04 美元
      usdPerAudioHour: 0.04,
      // 免费档限额，用于事前提示（官方文档 console.groq.com/docs/rate-limits）
      freeTier: { secondsPerHour: 7200, secondsPerDay: 28800 },
    },
    {
      id: "openai",
      label: "OpenAI Whisper",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "whisper-1",
      keyUrl: "https://platform.openai.com/api-keys",
      usdPerAudioHour: 0.36,
      freeTier: null,
    },
  ]);

  const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

  function listProviders() {
    return PROVIDERS.map((p) => ({ ...p }));
  }

  function getProvider(providerId) {
    return BY_ID[providerId] || BY_ID.groq;
  }

  /**
   * 组装识别请求。返回的是描述而不是 FormData，
   * 这样纯逻辑可以在 Node 里测试，构造 FormData 交给调用方。
   */
  function buildTranscriptionRequest({ providerId, apiKey, language, model, prompt }) {
    const provider = getProvider(providerId);
    const fields = {
      model: model || provider.defaultModel,
      response_format: "verbose_json",
      temperature: "0",
      // 没有分段时间戳就无法把字幕对到视频时间轴上
      "timestamp_granularities[]": "segment",
    };
    if (language && language !== "auto") fields.language = language;
    if (prompt) fields.prompt = prompt;

    return {
      url: `${provider.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`,
      headers: { Authorization: `Bearer ${apiKey}` },
      fields,
    };
  }

  function extractSegments(data) {
    const segments = data?.segments;
    if (Array.isArray(segments) && segments.length) {
      return segments
        .map((item) => ({
          start: Number(item?.start) || 0,
          end: Number(item?.end) || 0,
          text: String(item?.text ?? "").trim(),
        }))
        .filter((item) => item.text);
    }
    // 极短的音频有时只返回整段文字，退化成一条也好过丢掉
    const text = String(data?.text ?? "").trim();
    return text ? [{ start: 0, end: 0, text }] : [];
  }

  /** 从限流错误里解析出还要等多久。服务商会写在正文里，也可能只给响应头。 */
  function retryAfterSeconds(body, header) {
    const text = String(body || "");
    const minuteMatch = text.match(/try again in ([0-9.]+)m([0-9.]+)s/i);
    if (minuteMatch) {
      return Math.ceil(parseFloat(minuteMatch[1]) * 60 + parseFloat(minuteMatch[2]));
    }
    const secondMatch = text.match(/try again in ([0-9.]+)s/i);
    if (secondMatch) return Math.ceil(parseFloat(secondMatch[1]));

    const fromHeader = parseFloat(header);
    return Number.isFinite(fromHeader) ? Math.ceil(fromHeader) : null;
  }

  /** 从限流错误里读出额度数字，用来告诉用户还剩多少。 */
  function parseQuota(message) {
    const match = String(message || "").match(
      /Limit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)/i,
    );
    if (!match) return null;
    return {
      limit: Number(match[1]),
      used: Number(match[2]),
      requested: Number(match[3]),
    };
  }

  function estimateCost({ providerId, seconds }) {
    const provider = getProvider(providerId);
    return (Number(seconds) || 0) / 3600 * provider.usdPerAudioHour;
  }

  return {
    PROVIDERS,
    listProviders,
    getProvider,
    buildTranscriptionRequest,
    extractSegments,
    retryAfterSeconds,
    parseQuota,
    estimateCost,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_ASR_PROVIDERS;
}
