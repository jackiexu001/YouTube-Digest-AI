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

  const STORAGE_KEY = "ytd_settings";
  const DEFAULT_PROVIDER = "deepseek";

  const DEFAULTS = Object.freeze({
    provider: DEFAULT_PROVIDER,
    aiModel: providersApi.getProvider(DEFAULT_PROVIDER).defaultModel,
    aiBaseUrl: providersApi.getProvider(DEFAULT_PROVIDER).baseUrl,
    aiApiKeys: Object.freeze({}),
    supadataApiKey: "",
  });

  const KNOWN_PROVIDERS = new Set(providersApi.PROVIDERS.map((p) => p.id));

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isLegacyCustom(input) {
    // 老版本把密钥存在顶层 aiApiKey，新版本按服务商分开存
    return !!input && typeof input.aiApiKey === "string" && !!input.aiApiKey.trim();
  }

  function normalizeKeys(input) {
    const source = input && typeof input.aiApiKeys === "object" ? input.aiApiKeys : {};
    const keys = {};
    for (const id of KNOWN_PROVIDERS) {
      const value = text(source[id]);
      if (value) keys[id] = value;
    }
    return keys;
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

    return {
      provider,
      aiModel: model,
      aiBaseUrl: baseUrl,
      aiApiKeys: normalizeKeys(input),
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
    canonicalYouTubeUrl,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_SETTINGS;
}
