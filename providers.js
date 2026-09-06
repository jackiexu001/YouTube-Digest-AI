/**
 * AI provider registry and request adapters.
 *
 * Three adapters cover every provider:
 *   openai    - DeepSeek / OpenAI / Zhipu GLM / custom, anything
 *               OpenAI-compatible
 *   anthropic - the Claude family, with different auth headers and a
 *               different response shape
 *   gemini    - Google, which puts the model in the URL and returns yet
 *               another shape
 *
 * Contains no keys. Those are stored in chrome.storage.local by options.js.
 */
var YTD_PROVIDERS = (() => {
  const ANTHROPIC_VERSION = "2023-06-01";
  // Anthropic rejects browser-originated requests unless this is declared.
  // The key here is the user's own and stored locally, so the usual risk of
  // exposing a developer key to visitors does not apply.
  const ANTHROPIC_BROWSER_HEADERS = {
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };

  // baseUrl stores the complete prefix. Providers disagree on the path
  // (Zhipu uses /api/paas/v4, not /v1), so the code only appends the
  // endpoint and never assembles /v1 itself.
  //
  // defaultModel values were checked against each provider's docs (2026-09).
  // Models move fast - OpenAI went from gpt-5 to gpt-5.6 within months - so
  // the UI offers a Fetch models button for the live list, and these
  // defaults exist only to make the first call succeed.
  const PROVIDERS = Object.freeze([
    {
      id: "deepseek",
      label: "DeepSeek",
      adapter: "openai",
      baseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-v4-flash",
      keyUrl: "https://platform.deepseek.com/api_keys",
      // DeepSeek-only: disables reasoning traces for predictable latency. Other providers reject it.
      extraBody: { thinking: { type: "disabled" } },
    },
    {
      id: "openai",
      label: "OpenAI",
      adapter: "openai",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.6",
      keyUrl: "https://platform.openai.com/api-keys",
    },
    {
      id: "glm",
      label: "Zhipu GLM",
      adapter: "openai",
      // Zhipu uses /api/paas/v4, not /v1. Tools that auto-append /v1 get a 404 here
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      defaultModel: "glm-5",
      keyUrl: "https://bigmodel.cn/usercenter/apikeys",
    },
    {
      id: "anthropic",
      label: "Anthropic Claude",
      adapter: "anthropic",
      baseUrl: "https://api.anthropic.com",
      defaultModel: "claude-opus-5",
      keyUrl: "https://console.anthropic.com/settings/keys",
    },
    {
      id: "gemini",
      label: "Google Gemini",
      adapter: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com",
      defaultModel: "gemini-3.8-flash",
      keyUrl: "https://aistudio.google.com/apikey",
    },
    {
      id: "custom",
      // The UI translates the display name (providerCustom); this is the internal id
      label: "Custom",
      adapter: "openai",
      baseUrl: "",
      defaultModel: "",
      modelHint: "Enter the model name from that provider\u0027s documentation",
      keyUrl: "",
    },
  ]);

  const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

  function listProviders() {
    return PROVIDERS.map((p) => ({ ...p }));
  }

  function getProvider(providerId) {
    return BY_ID[providerId] || BY_ID.deepseek;
  }

  function trimSlash(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  // ---------- Adapters ----------

  const ADAPTERS = {
    openai: {
      buildRequest({ baseUrl, model, apiKey, messages, maxTokens, temperature, responseFormat, extraBody }) {
        const body = { model, max_tokens: maxTokens, messages };
        if (typeof temperature === "number") body.temperature = temperature;
        if (responseFormat) body.response_format = responseFormat;
        Object.assign(body, extraBody || {});
        return {
          url: `${trimSlash(baseUrl)}/chat/completions`,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        };
      },
      extractText(data) {
        return data?.choices?.[0]?.message?.content;
      },
      extractError(data) {
        return data?.error?.message || data?.message;
      },
      listModelsRequest({ baseUrl, apiKey }) {
        return {
          url: `${trimSlash(baseUrl)}/models`,
          headers: { Authorization: `Bearer ${apiKey}` },
        };
      },
      extractModels(data) {
        return (data?.data || []).map((m) => m?.id).filter((id) => typeof id === "string");
      },
    },

    anthropic: {
      buildRequest({ baseUrl, model, apiKey, messages, maxTokens, temperature }) {
        // Anthropic takes the system prompt at the top level, not in messages
        const system = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");
        const body = {
          model,
          max_tokens: maxTokens,
          messages: messages
            .filter((m) => m.role !== "system")
            .map((m) => ({ role: m.role, content: m.content })),
        };
        if (system) body.system = system;
        if (typeof temperature === "number") body.temperature = temperature;
        return {
          url: `${trimSlash(baseUrl)}/v1/messages`,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            ...ANTHROPIC_BROWSER_HEADERS,
          },
          body,
        };
      },
      extractText(data) {
        const block = (data?.content || []).find((c) => c?.type === "text");
        return block?.text;
      },
      extractError(data) {
        return data?.error?.message || data?.message;
      },
      listModelsRequest({ baseUrl, apiKey }) {
        return {
          url: `${trimSlash(baseUrl)}/v1/models`,
          headers: { "x-api-key": apiKey, ...ANTHROPIC_BROWSER_HEADERS },
        };
      },
      extractModels(data) {
        return (data?.data || []).map((m) => m?.id).filter((id) => typeof id === "string");
      },
    },

    gemini: {
      buildRequest({ baseUrl, model, apiKey, messages, maxTokens, temperature }) {
        const system = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");
        const body = {
          contents: messages
            .filter((m) => m.role !== "system")
            .map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
          generationConfig: { maxOutputTokens: maxTokens },
        };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        if (typeof temperature === "number") body.generationConfig.temperature = temperature;
        return {
          // Key goes in a header. In the URL it leaks via history, logs and Referer.
          url: `${trimSlash(baseUrl)}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body,
        };
      },
      extractText(data) {
        return data?.candidates?.[0]?.content?.parts?.[0]?.text;
      },
      extractError(data) {
        return data?.error?.message || data?.message;
      },
      listModelsRequest({ baseUrl, apiKey }) {
        return {
          url: `${trimSlash(baseUrl)}/v1beta/models`,
          headers: { "x-goog-api-key": apiKey },
        };
      },
      extractModels(data) {
        // Gemini returns "models/gemini-3-pro"; strip the prefix to get a usable name
        return (data?.models || [])
          .map((m) => String(m?.name || "").replace(/^models\//, ""))
          .filter(Boolean);
      },
    },
  };

  function buildRequest({ providerId, baseUrl, model, apiKey, messages, maxTokens, temperature, responseFormat }) {
    const provider = getProvider(providerId);
    return ADAPTERS[provider.adapter].buildRequest({
      baseUrl: baseUrl || provider.baseUrl,
      model,
      apiKey,
      messages: messages || [],
      maxTokens,
      temperature,
      responseFormat,
      extraBody: provider.extraBody,
    });
  }

  function listModelsRequest({ providerId, baseUrl, apiKey }) {
    const provider = getProvider(providerId);
    if (provider.canListModels === false) return null;
    const adapter = ADAPTERS[provider.adapter];
    if (!adapter.listModelsRequest) return null;
    return adapter.listModelsRequest({ baseUrl: baseUrl || provider.baseUrl, apiKey });
  }

  function extractModels(providerId, data) {
    const adapter = ADAPTERS[getProvider(providerId).adapter];
    if (!adapter.extractModels) return [];
    try {
      return adapter.extractModels(data);
    } catch (_error) {
      return [];
    }
  }

  function extractText(providerId, data) {
    return ADAPTERS[getProvider(providerId).adapter].extractText(data);
  }

  function extractError(providerId, data, httpStatus) {
    const provider = getProvider(providerId);
    const message = ADAPTERS[provider.adapter].extractError(data);
    if (message) return message;
    return `${provider.label} returned error ${httpStatus}`;
  }

  return {
    PROVIDERS,
    listProviders,
    getProvider,
    buildRequest,
    listModelsRequest,
    extractModels,
    extractText,
    extractError,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_PROVIDERS;
}
