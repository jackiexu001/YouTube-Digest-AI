/**
 * Shared, non-secret configuration.
 *
 * API keys are written to chrome.storage.local by options.js. This file holds
 * defaults and validation only, so it is safe to publish.
 */
var YTD_SETTINGS = (() => {
  const providersApi =
    typeof YTD_PROVIDERS !== "undefined"
      ? YTD_PROVIDERS
      : require("./providers.js");
  // Speech recognition is kept entirely separate from the text model: one
  // turns audio into text, the other writes overviews and translations, and
  // they use different services with different keys.
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
    // Older versions stored one key at aiApiKey; keys are now per provider
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

    // An unknown provider resets the model too, so no unusable pair is stored
    const model = KNOWN_PROVIDERS.has(requested)
      ? text(input.aiModel) || meta.defaultModel
      : meta.defaultModel;

    // Only the custom provider accepts an externally supplied URL. The rest
    // use built-in addresses, so tampered storage cannot redirect requests
    // and keys elsewhere.
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
      // On unless explicitly disabled: this is the headline feature over upstream
      aiCaptionsEnabled: input.aiCaptionsEnabled !== false,
      // Auto-start is off by default because this step costs real money;
      // starting automatically would make a spending decision on the user's
      // behalf. It must also follow the master switch, or you get the
      // contradictory state of "AI captions off, still charging".
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
