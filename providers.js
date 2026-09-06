/**
 * AI 服务商清单与请求适配器。
 *
 * 三个适配器覆盖全部服务商：
 *   openai   — DeepSeek / OpenAI / 智谱 GLM / 豆包 / 自定义（凡是兼容 OpenAI 格式的）
 *   anthropic — Claude 系列，鉴权头和响应结构都不同
 *   gemini    — Google，网址里带模型名，响应结构又不同
 *
 * 不含任何密钥。密钥由 options.js 存进 chrome.storage.local。
 */
var YTD_PROVIDERS = (() => {
  const ANTHROPIC_VERSION = "2023-06-01";

  // baseUrl 存的是完整前缀。各家路径不一致（智谱是 /api/paas/v4 而非 /v1），
  // 代码只负责在后面接具体端点，绝不自己拼 /v1。
  const PROVIDERS = Object.freeze([
    {
      id: "deepseek",
      label: "DeepSeek",
      adapter: "openai",
      baseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-v4-flash",
      keyUrl: "https://platform.deepseek.com/api_keys",
      // DeepSeek 专属：关掉推理轨迹以获得可预期的延迟。发给别家会报错。
      extraBody: { thinking: { type: "disabled" } },
    },
    {
      id: "openai",
      label: "OpenAI",
      adapter: "openai",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5",
      keyUrl: "https://platform.openai.com/api-keys",
    },
    {
      id: "glm",
      label: "智谱 GLM",
      adapter: "openai",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      defaultModel: "glm-4-plus",
      keyUrl: "https://bigmodel.cn/usercenter/apikeys",
    },
    {
      id: "doubao",
      label: "豆包",
      adapter: "openai",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      defaultModel: "doubao-pro-32k",
      keyUrl: "https://console.volcengine.com/ark",
      // 豆包用「接入点 ID」而非模型名，列表接口需要火山引擎签名认证，
      // 简单的 Bearer Key 拿不到，所以不提供自动获取。
      canListModels: false,
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
      defaultModel: "gemini-3-pro",
      keyUrl: "https://aistudio.google.com/apikey",
    },
    {
      id: "custom",
      label: "自定义（OpenAI 兼容）",
      adapter: "openai",
      baseUrl: "",
      defaultModel: "",
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

  // ---------- 适配器 ----------

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
        // Anthropic 把系统提示放在顶层，不混在对话里
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
            "anthropic-version": ANTHROPIC_VERSION,
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
          headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
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
          // 密钥走请求头。放进网址会被浏览器历史、日志和 Referer 带走。
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
        // Gemini 返回 "models/gemini-3-pro"，去掉前缀才能直接填进模型名
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
    return `${provider.label} 返回错误 ${httpStatus}`;
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
