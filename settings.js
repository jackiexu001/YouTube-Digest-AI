/**
 * 共享的非机密配置。
 *
 * API 密钥由 options.js 存进 chrome.storage.local，本文件只有默认值和校验，
 * 因此可以安全公开。
 */
var YTD_SETTINGS = (() => {
  const providersApi =
    typeof YTD_PROVIDERS !== "undefined"
      ? YTD_PROVIDERS
      : require("./providers.js");
  // 语音识别的服务商与文本模型完全分开：一个把声音变成文字，
  // 一个做概览和翻译，用的是不同的服务、不同的密钥。
  const asrApi =
    typeof YTD_ASR_PROVIDERS !== "undefined"
      ? YTD_ASR_PROVIDERS
      : require("./asr/asr-providers.js");

  const STORAGE_KEY = "ytd_settings";
  const DEFAULT_PROVIDER = "deepseek";
  const DEFAULT_ASR_PROVIDER = "groq";

  const DEFAULTS = Object.freeze({
    provider: DEFAULT_PROVIDER,
    aiModel: providersApi.getProvider(DEFAULT_PROVIDER).defaultModel,
    aiBaseUrl: providersApi.getProvider(DEFAULT_PROVIDER).baseUrl,
    aiApiKeys: Object.freeze({}),
    asrProvider: DEFAULT_ASR_PROVIDER,
    asrModel: asrApi.getProvider(DEFAULT_ASR_PROVIDER).defaultModel,
    asrApiKeys: Object.freeze({}),
    aiCaptionsEnabled: true,
    aiCaptionsAutoStart: false,
    supadataApiKey: "",
  });

  const KNOWN_PROVIDERS = new Set(providersApi.PROVIDERS.map((p) => p.id));
  const KNOWN_ASR_PROVIDERS = new Set(asrApi.PROVIDERS.map((p) => p.id));

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isLegacyCustom(input) {
    // 老版本把密钥存在顶层 aiApiKey，新版本按服务商分开存
    return !!input && typeof input.aiApiKey === "string" && !!input.aiApiKey.trim();
  }

  function pickKeys(source, known) {
    const keys = {};
    for (const id of known) {
      const value = text((source || {})[id]);
      if (value) keys[id] = value;
    }
    return keys;
  }

  function normalizeKeys(input) {
    return pickKeys(input && input.aiApiKeys, KNOWN_PROVIDERS);
  }

  function normalize(input = {}) {
    const requested = text(input.provider);
    const provider = KNOWN_PROVIDERS.has(requested) ? requested : DEFAULT_PROVIDER;
    const meta = providersApi.getProvider(provider);

    // 服务商无效时连模型名一起回到默认，避免留下一个跑不通的组合
    const model = KNOWN_PROVIDERS.has(requested)
      ? text(input.aiModel) || meta.defaultModel
      : meta.defaultModel;

    // 只有自定义服务商接受外部传入的地址。其余用内置地址，
    // 防止存储被污染后把请求和密钥发到别处。
    const baseUrl =
      provider === "custom" ? text(input.aiBaseUrl) : meta.baseUrl;

    const requestedAsr = text(input.asrProvider);
    const asrProvider = KNOWN_ASR_PROVIDERS.has(requestedAsr)
      ? requestedAsr
      : DEFAULT_ASR_PROVIDER;
    const asrMeta = asrApi.getProvider(asrProvider);

    return {
      provider,
      aiModel: model,
      aiBaseUrl: baseUrl,
      aiApiKeys: normalizeKeys(input),
      asrProvider: asrProvider,
      asrModel: text(input.asrModel) || asrMeta.defaultModel,
      asrApiKeys: pickKeys(input.asrApiKeys, KNOWN_ASR_PROVIDERS),
      // 没有明确关掉就算开着：这是本项目相对上游新增的核心能力
      aiCaptionsEnabled: input.aiCaptionsEnabled !== false,
      // 自动生成默认关闭：这一步会真实花钱，默认自动开始等于
      // 替用户做了花钱的决定。总开关关掉时它也必须跟着失效，
      // 否则会出现「AI 字幕已关闭却仍在自动扣费」这种自相矛盾的状态
      aiCaptionsAutoStart:
        input.aiCaptionsEnabled !== false && input.aiCaptionsAutoStart === true,
      supadataApiKey: text(input.supadataApiKey),
    };
  }

  function migrateLegacyCustom(input = {}) {
    const migrated = isLegacyCustom(input);
    if (!migrated) return { settings: normalize(input), migrated: false };

    const requested = text(input.provider);
    const target = KNOWN_PROVIDERS.has(requested) ? requested : DEFAULT_PROVIDER;
    return {
      settings: normalize({
        ...input,
        aiApiKeys: { ...(input.aiApiKeys || {}), [target]: input.aiApiKey },
      }),
      migrated: true,
    };
  }

  function activeApiKey(settings = {}) {
    return (settings.aiApiKeys || {})[settings.provider] || "";
  }

  function activeAsrApiKey(settings = {}) {
    return (settings.asrApiKeys || {})[settings.asrProvider] || "";
  }

  function canonicalYouTubeUrl(videoId) {
    const normalized = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(normalized)) {
      throw new Error("Invalid YouTube video ID.");
    }
    return `https://www.youtube.com/watch?v=${normalized}`;
  }

  return {
    STORAGE_KEY,
    DEFAULTS,
    isLegacyCustom,
    normalize,
    migrateLegacyCustom,
    activeApiKey,
    activeAsrApiKey,
    canonicalYouTubeUrl,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_SETTINGS;
}
