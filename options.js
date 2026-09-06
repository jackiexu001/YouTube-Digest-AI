const YTD_OPTIONS = (() => {
  const providersApi =
    typeof YTD_PROVIDERS !== "undefined"
      ? YTD_PROVIDERS
      : require("./providers.js");

  const LANGUAGE_STORAGE_KEY = "ytd_options_language";
  const PREVIEW_STORAGE_PREFIX = "youtubeDigestPreview:";
  const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN"]);

  const COPY = {
    en: {
      pageTitle: "YouTube Digest AI Settings",
      languageGroupLabel: "Interface language",
      heading: "Bring your own API keys",
      lede:
        "Keys stay in this Chrome profile and are sent only to Supadata and the AI provider you choose. This open-source extension has no developer server or analytics.",
      transcriptProvider: "Transcript provider",
      supadataApiKeyLabel: "Supadata API key",
      supadataHelp: "Used to fetch timestamped YouTube subtitles. ",
      supadataLink: "Create a Supadata account and key",
      supadataHelpSuffix:
        ". Supadata generates the key during onboarding.",
      aiProvider: "AI provider",
      providerLabel: "Provider",
      providerCustom: "Custom (OpenAI-compatible)",
      modelLabel: "Model",
      fetchModels: "Fetch models",
      fetchingModels: "Fetching models…",
      modelsFetched: "Pick a model from the list, or keep typing your own.",
      modelsUnsupported:
        "This provider has no model list API. Type the model name yourself.",
      modelsNeedKey: "Enter the API key first, then fetch models.",
      modelsFailed: "Could not fetch models: {reason}. Type the model name yourself.",
      baseUrlLabel: "API endpoint",
      baseUrlHelp:
        "Any OpenAI-compatible endpoint. Chrome will ask for permission to reach this address when you save.",
      baseUrlRequired: "Enter the API endpoint for your custom provider.",
      permissionDenied:
        "Chrome permission for that endpoint was declined, so the settings were not saved.",
      aiApiKeyLabel: "{provider} API key",
      aiHelp:
        "YouTube Digest AI uses {provider} for overviews, explanations, translation, and note polishing.",
      aiKeyLinkLabel: "Create a {provider} API key",
      deepseekHelpSuffix: ".",
      privacyNote:
        "When you use AI features, {provider} receives the video transcript and relevant video context. Review that provider's terms and pricing before saving.",
      saveSettings: "Save settings",
      localData: "Local data",
      localDataHelp:
        "Digests, translations, and notes are stored only in this Chrome profile. You can remove them at any time.",
      clearCache: "Clear cached digests",
      deleteNotes: "Delete all notes",
      resetData: "Reset extension data",
      footer:
        'Read <a href="PRIVACY.md" target="_blank">PRIVACY.md</a> in the repository for the complete data-flow description.',
      migrationWarning:
        "Custom provider settings were removed safely. Your Supadata key was kept, but the AI key was cleared. Enter a DeepSeek API key to continue.",
      saving: "Saving…",
      addSupadataKey: "Add a Supadata API key.",
      addDeepseekKey: "Add a DeepSeek API key.",
      saved: "Saved. Reopen YouTube Digest to use these settings.",
      saveFailed: "Could not save settings. Please try again.",
      clearedDigests: ({ count }) =>
        `Cleared ${count} cached digest${count === 1 ? "" : "s"}.`,
      notesDeleted: "Deleted all saved notes.",
      resetConfirm:
        "Delete API keys, cached digests, translations, and saved notes from this Chrome profile?",
      allDataDeleted: "All YouTube Digest data was deleted.",
      settingsLoadFailed:
        "Could not load saved settings. You can still preview this page.",
    },
    "zh-CN": {
      pageTitle: "YouTube Digest AI 设置",
      languageGroupLabel: "界面语言",
      heading: "使用你自己的 API 密钥",
      lede:
        "密钥仅保存在当前 Chrome 个人资料中，只会发送给 Supadata 和你选择的 AI 服务商。本开源扩展没有开发者服务器，也不使用分析服务。",
      transcriptProvider: "字幕服务",
      supadataApiKeyLabel: "Supadata API 密钥",
      supadataHelp: "用于获取带时间戳的 YouTube 字幕。",
      supadataLink: "创建 Supadata 账号并获取密钥",
      supadataHelpSuffix: "。Supadata 会在引导流程中生成密钥。",
      aiProvider: "AI 服务",
      providerLabel: "服务商",
      providerCustom: "自定义（OpenAI 兼容）",
      modelLabel: "模型",
      fetchModels: "获取模型",
      fetchingModels: "正在获取模型……",
      modelsFetched: "可以从列表里挑一个，也可以继续自己填。",
      modelsUnsupported: "这家没有提供模型列表接口，请自己填写模型名。",
      modelsNeedKey: "请先填写 API 密钥，再获取模型。",
      modelsFailed: "获取模型失败：{reason}。请自己填写模型名。",
      baseUrlLabel: "接口地址",
      baseUrlHelp:
        "任何兼容 OpenAI 格式的接口地址。保存时 Chrome 会询问是否允许访问这个地址。",
      baseUrlRequired: "请填写自定义服务商的接口地址。",
      permissionDenied: "你拒绝了访问该地址的授权，设置没有保存。",
      aiApiKeyLabel: "{provider} API 密钥",
      aiHelp:
        "YouTube Digest AI 使用 {provider} 生成概览、解释内容、翻译字幕和润色笔记。",
      aiKeyLinkLabel: "创建 {provider} API 密钥",
      deepseekHelpSuffix: "。",
      privacyNote:
        "使用 AI 功能时，{provider} 会收到视频字幕及相关视频上下文。保存前请查看该服务商的服务条款和价格。",
      saveSettings: "保存设置",
      localData: "本地数据",
      localDataHelp:
        "摘要、翻译和笔记仅保存在当前 Chrome 个人资料中。你可以随时删除。",
      clearCache: "清除缓存的摘要",
      deleteNotes: "删除全部笔记",
      resetData: "重置扩展数据",
      footer:
        '完整数据流说明请参阅仓库中的 <a href="PRIVACY.md" target="_blank">PRIVACY.md</a>。',
      migrationWarning:
        "已安全移除自定义服务设置。Supadata 密钥已保留，AI 密钥已清除。请输入 DeepSeek API 密钥以继续使用。",
      saving: "正在保存…",
      addSupadataKey: "请添加 Supadata API 密钥。",
      addDeepseekKey: "请添加 DeepSeek API 密钥。",
      saved: "已保存。请重新打开 YouTube Digest 以使用这些设置。",
      saveFailed: "无法保存设置，请重试。",
      clearedDigests: ({ count }) => `已清除 ${count} 条缓存摘要。`,
      notesDeleted: "已删除全部已保存的笔记。",
      resetConfirm:
        "要从当前 Chrome 个人资料中删除 API 密钥、缓存摘要、翻译和已保存的笔记吗？",
      allDataDeleted: "已删除全部 YouTube Digest 数据。",
      settingsLoadFailed: "无法加载已保存的设置，但你仍可预览此页面。",
    },
  };

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.has(language) ? language : "en";
  }

  function translate(language, key, params = {}) {
    const normalizedLanguage = normalizeLanguage(language);
    const value = COPY[normalizedLanguage][key] ?? COPY.en[key] ?? "";
    if (typeof value === "function") return value(params);
    // 文案里用 {name} 标出可替换的部分，例如服务商名和错误原因
    return String(value).replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : match,
    );
  }

  function createStorageAdapter(chromeApi, fallbackStorage) {
    const chromeStorage = chromeApi?.storage?.local;
    const memoryStorage = new Map();

    function fallbackKeys() {
      const keys = [];
      if (!fallbackStorage) return keys;
      try {
        for (let index = 0; index < fallbackStorage.length; index += 1) {
          const key = fallbackStorage.key(index);
          if (key?.startsWith(PREVIEW_STORAGE_PREFIX)) keys.push(key);
        }
      } catch (_error) {
        return [];
      }
      return keys;
    }

    function readFallbackValue(key) {
      try {
        const rawValue = fallbackStorage?.getItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
        );
        if (rawValue !== null && rawValue !== undefined) {
          return JSON.parse(rawValue);
        }
      } catch (_error) {
        // Fall through to memory when localStorage is unavailable or malformed.
      }
      return memoryStorage.get(key);
    }

    function writeFallbackValue(key, value) {
      memoryStorage.set(key, value);
      try {
        fallbackStorage?.setItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
          JSON.stringify(value),
        );
      } catch (_error) {
        // The in-memory copy keeps a restricted preview functional.
      }
    }

    return {
      async get(keys) {
        if (chromeStorage) return chromeStorage.get(keys);

        const requestedKeys =
          keys === null
            ? [
                ...new Set([
                  ...memoryStorage.keys(),
                  ...fallbackKeys().map((key) =>
                    key.slice(PREVIEW_STORAGE_PREFIX.length),
                  ),
                ]),
              ]
            : Array.isArray(keys)
              ? keys
              : [keys];

        return Object.fromEntries(
          requestedKeys
            .map((key) => [key, readFallbackValue(key)])
            .filter(([, value]) => value !== undefined),
        );
      },

      async set(items) {
        if (chromeStorage) return chromeStorage.set(items);
        for (const [key, value] of Object.entries(items)) {
          writeFallbackValue(key, value);
        }
      },

      async remove(keys) {
        if (chromeStorage) return chromeStorage.remove(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          memoryStorage.delete(key);
          try {
            fallbackStorage?.removeItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
          } catch (_error) {
            // Memory removal is sufficient for this preview session.
          }
        }
      },

      async clear() {
        if (chromeStorage) return chromeStorage.clear();
        memoryStorage.clear();
        for (const key of fallbackKeys()) {
          try {
            fallbackStorage.removeItem(key);
          } catch (_error) {
            // Continue clearing any remaining preview keys.
          }
        }
      },
    };
  }

  async function readPreferredLanguage(storage) {
    const stored = await storage.get(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(stored[LANGUAGE_STORAGE_KEY]);
  }

  async function persistPreferredLanguage(storage, language) {
    const normalizedLanguage = normalizeLanguage(language);
    await storage.set({ [LANGUAGE_STORAGE_KEY]: normalizedLanguage });
    return normalizedLanguage;
  }

  function updateLanguageButtonState(buttons, language) {
    const normalizedLanguage = normalizeLanguage(language);
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.language === normalizedLanguage),
      );
    }
  }

  function getSafeLocalStorage(root) {
    try {
      return root.localStorage;
    } catch (_error) {
      return null;
    }
  }


  /**
   * 根据选中的服务商算出整个表单该显示什么。
   *
   * 做成纯函数是为了能直接测：切换服务商牵扯模型名、地址、密钥、
   * 帮助链接和按钮可用性五处联动，散在 DOM 操作里就没法验证了。
   */

  /** 服务商的显示名。品牌名照原样，「自定义」是描述性文字，跟界面语言走。 */
  function providerDisplayLabel({ providerId, language }) {
    if (providerId === "custom") return translate(language, "providerCustom");
    return providersApi.getProvider(providerId).label;
  }

  /**
   * 需要代入服务商名的那几条文案。
   *
   * 单独拿出来是因为它们和普通文案不同：普通文案只跟语言走，
   * 这几条还跟当前选中的服务商走。混在一起处理会导致切换语言时
   * 把服务商名冲掉，只剩字面的 {provider}。
   */
  function providerCopy({ providerId, language }) {
    const provider = providerDisplayLabel({ providerId, language });
    return {
      aiApiKeyLabel: translate(language, "aiApiKeyLabel", { provider }),
      aiHelp: translate(language, "aiHelp", { provider }),
      aiKeyLinkLabel: translate(language, "aiKeyLinkLabel", { provider }),
      privacyNote: translate(language, "privacyNote", { provider }),
    };
  }

  function providerFormState({
    providerId,
    apiKeys = {},
    savedModel = "",
    savedBaseUrl = "",
  } = {}) {
    const provider = providersApi.getProvider(providerId);
    const isCustom = provider.id === "custom";
    return {
      providerId: provider.id,
      label: provider.label,
      model: String(savedModel || "").trim() || provider.defaultModel,
      // 内置服务商的地址写死在代码里，不接受页面传入的值，
      // 否则存储被改动后请求和密钥会被发到别处
      baseUrl: isCustom ? String(savedBaseUrl || "").trim() : provider.baseUrl,
      baseUrlEditable: isCustom,
      keyUrl: provider.keyUrl,
      apiKey: String(apiKeys[provider.id] || ""),
      canListModels: providersApi.listModelsRequest({
        providerId: provider.id,
        baseUrl: provider.baseUrl || "https://placeholder.invalid",
        apiKey: "placeholder",
      }) !== null,
    };
  }

  /**
   * 向服务商查询可用模型。
   *
   * 各家接口随时可能改或下线，所以任何失败都返回可读原因而不是抛错——
   * 界面要能退回手填模型名，不能因为列表拿不到就用不了这个服务商。
   */
  async function fetchModelList({
    providerId,
    baseUrl,
    apiKey,
    fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  }) {
    if (!apiKey) return { ok: false, reason: "needsKey" };

    const request = providersApi.listModelsRequest({ providerId, baseUrl, apiKey });
    if (!request) return { ok: false, unsupported: true, reason: "unsupported" };

    try {
      const response = await fetchImpl(request.url, { headers: request.headers });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          reason: providersApi.extractError(providerId, data, response.status),
        };
      }
      const models = providersApi.extractModels(providerId, data);
      if (!models.length) return { ok: false, reason: "empty" };
      return { ok: true, models };
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) };
    }
  }


  /**
   * 自定义服务商的地址事先不知道，无法写进 manifest，
   * 只能在保存时向 Chrome 申请。内置服务商的地址已声明，直接放行。
   */
  async function ensureEndpointPermission({ providerId, baseUrl, permissionsApi }) {
    if (providerId !== "custom") return { granted: true };

    const trimmed = String(baseUrl || "").trim();
    if (!trimmed) return { granted: false, reason: "baseUrlRequired" };

    let origin;
    try {
      const parsed = new URL(trimmed);
      // 密钥会随请求发出，明文 http 会在链路上暴露
      if (parsed.protocol !== "https:") {
        return { granted: false, reason: "baseUrlRequired" };
      }
      origin = `${parsed.protocol}//${parsed.hostname}/*`;
    } catch (_error) {
      return { granted: false, reason: "baseUrlRequired" };
    }

    const request = { origins: [origin] };
    if (await permissionsApi.contains(request)) return { granted: true };
    const granted = await permissionsApi.request(request);
    return granted ? { granted: true } : { granted: false, reason: "permissionDenied" };
  }

  function initialize(root = globalThis) {
    const doc = root.document;
    const settingsApi = root.YTD_SETTINGS;
    if (!doc || !settingsApi) return;

    const storage = createStorageAdapter(
      root.chrome,
      getSafeLocalStorage(root),
    );
    const form = doc.getElementById("settingsForm");
    const aiApiKeyInput = doc.getElementById("aiApiKey");
    const supadataApiKeyInput = doc.getElementById("supadataApiKey");
    const providerSelect = doc.getElementById("provider");
    const aiModelInput = doc.getElementById("aiModel");
    const aiBaseUrlInput = doc.getElementById("aiBaseUrl");
    const baseUrlRow = doc.getElementById("baseUrlRow");
    const fetchModelsBtn = doc.getElementById("fetchModelsBtn");
    const modelStatus = doc.getElementById("modelStatus");
    const aiKeyLink = doc.getElementById("aiKeyLink");
    // 每个服务商的密钥单独记着，切换时不会互相覆盖
    const apiKeysByProvider = {};
    const saveStatus = doc.getElementById("saveStatus");
    const dataStatus = doc.getElementById("dataStatus");
    const languageButtons = [...doc.querySelectorAll("[data-language]")];
    const statusStates = new Map();
    let currentLanguage = "en";

    function renderStatus(element) {
      const state = statusStates.get(element);
      element.textContent = state
        ? translate(currentLanguage, state.key, state.params)
        : "";
    }

    function setStatus(element, key, params = {}) {
      if (key) statusStates.set(element, { key, params });
      else statusStates.delete(element);
      renderStatus(element);
    }

    function applyLanguage(language) {
      currentLanguage = normalizeLanguage(language);
      doc.documentElement.lang = currentLanguage;
      doc.title = translate(currentLanguage, "pageTitle");

      for (const element of doc.querySelectorAll("[data-i18n]")) {
        element.textContent = translate(
          currentLanguage,
          element.dataset.i18n,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-html]")) {
        element.innerHTML = translate(
          currentLanguage,
          element.dataset.i18nHtml,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute(
          "aria-label",
          translate(currentLanguage, element.dataset.i18nAriaLabel),
        );
      }

      // 通用循环刷不到带服务商名的文案，语言切换后要再补一次
      if (providerSelect) applyProviderCopy();
      updateLanguageButtonState(languageButtons, currentLanguage);
      for (const element of statusStates.keys()) renderStatus(element);
    }


    /** 把选中服务商的默认值铺进表单。切换服务商时先把当前输入存回去。 */
    function applyProvider(providerId, { savedModel = "", savedBaseUrl = "" } = {}) {
      const state = providerFormState({
        providerId,
        apiKeys: apiKeysByProvider,
        savedModel,
        savedBaseUrl,
      });
      providerSelect.value = state.providerId;
      aiModelInput.value = state.model;
      aiBaseUrlInput.value = state.baseUrl;
      aiApiKeyInput.value = state.apiKey;
      baseUrlRow.hidden = !state.baseUrlEditable;
      aiKeyLink.href = state.keyUrl || "#";
      aiKeyLink.hidden = !state.keyUrl;
      fetchModelsBtn.disabled = !state.canListModels;
      setStatus(modelStatus, state.canListModels ? null : "modelsUnsupported");
      applyProviderCopy();
    }

    /** 把带服务商名的文案填进带 data-i18n-provider 标记的元素。 */
    function applyProviderCopy() {
      const copy = providerCopy({
        providerId: providerSelect.value,
        language: currentLanguage,
      });
      for (const element of doc.querySelectorAll("[data-i18n-provider]")) {
        const value = copy[element.dataset.i18nProvider];
        if (typeof value === "string") element.textContent = value;
      }
    }

    function rememberCurrentKey() {
      apiKeysByProvider[providerSelect.value] = aiApiKeyInput.value.trim();
    }

    async function handleFetchModels() {
      rememberCurrentKey();
      setStatus(modelStatus, "fetchingModels");
      const result = await fetchModelList({
        providerId: providerSelect.value,
        baseUrl: aiBaseUrlInput.value || undefined,
        apiKey: aiApiKeyInput.value.trim(),
      });

      if (result.ok) {
        // 列表只作提示，输入框仍可手填 —— 新模型刚发布时列表往往还没有
        let list = doc.getElementById("modelOptions");
        if (!list) {
          list = doc.createElement("datalist");
          list.id = "modelOptions";
          aiModelInput.parentNode.appendChild(list);
          aiModelInput.setAttribute("list", "modelOptions");
        }
        list.innerHTML = "";
        for (const model of result.models) {
          const option = doc.createElement("option");
          option.value = model;
          list.appendChild(option);
        }
        setStatus(modelStatus, "modelsFetched");
        return;
      }

      if (result.unsupported) setStatus(modelStatus, "modelsUnsupported");
      else if (result.reason === "needsKey") setStatus(modelStatus, "modelsNeedKey");
      else setStatus(modelStatus, "modelsFailed", { reason: result.reason });
    }

    async function loadSettings() {
      try {
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        const migration = settingsApi.migrateLegacyCustom(
          stored[settingsApi.STORAGE_KEY],
        );
        const settings = migration.settings;

        Object.assign(apiKeysByProvider, settings.aiApiKeys || {});
        supadataApiKeyInput.value = settings.supadataApiKey;
        applyProvider(settings.provider, {
          savedModel: settings.aiModel,
          savedBaseUrl: settings.aiBaseUrl,
        });
        if (migration.migrated) {
          await storage.set({ [settingsApi.STORAGE_KEY]: settings });
          setStatus(saveStatus, "migrationWarning");
        }
      } catch (_error) {
        setStatus(saveStatus, "settingsLoadFailed");
      }
    }

    async function loadOptions() {
      try {
        applyLanguage(await readPreferredLanguage(storage));
      } catch (_error) {
        applyLanguage("en");
      }
      await loadSettings();
    }

    async function saveSettings(event) {
      event.preventDefault();
      setStatus(saveStatus, "saving");

      rememberCurrentKey();
      const settings = settingsApi.normalize({
        provider: providerSelect.value,
        aiModel: aiModelInput.value,
        aiBaseUrl: aiBaseUrlInput.value,
        aiApiKeys: apiKeysByProvider,
        supadataApiKey: supadataApiKeyInput.value,
      });

      if (!settings.supadataApiKey) {
        setStatus(saveStatus, "addSupadataKey");
        return;
      }
      if (!settingsApi.activeApiKey(settings)) {
        setStatus(saveStatus, "addDeepseekKey");
        return;
      }

      // 自定义服务商的地址不在 manifest 里，保存前要先拿到访问授权，
      // 否则会存下一个必定失败的配置
      const permission = await ensureEndpointPermission({
        providerId: settings.provider,
        baseUrl: settings.aiBaseUrl,
        permissionsApi: root.chrome?.permissions,
      });
      if (!permission.granted) {
        setStatus(saveStatus, permission.reason || "permissionDenied");
        return;
      }

      try {
        await storage.set({ [settingsApi.STORAGE_KEY]: settings });
        setStatus(saveStatus, "saved");
      } catch (_error) {
        setStatus(saveStatus, "saveFailed");
      }
    }

    async function clearCachedDigests() {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith("digest_"));
      if (keys.length) await storage.remove(keys);
      setStatus(dataStatus, "clearedDigests", { count: keys.length });
    }

    async function clearNotes() {
      await storage.remove("ytd_notes");
      setStatus(dataStatus, "notesDeleted");
    }

    async function resetAllData() {
      const confirmed = root.confirm(
        translate(currentLanguage, "resetConfirm"),
      );
      if (!confirmed) return;

      await storage.clear();
      await persistPreferredLanguage(storage, currentLanguage);
      await loadSettings();
      setStatus(dataStatus, "allDataDeleted");
    }

    form.addEventListener("submit", saveSettings);
    providerSelect.addEventListener("change", () => {
      rememberCurrentKey();
      applyProvider(providerSelect.value);
    });
    aiApiKeyInput.addEventListener("input", rememberCurrentKey);
    fetchModelsBtn.addEventListener("click", handleFetchModels);
    doc
      .getElementById("clearCacheBtn")
      .addEventListener("click", clearCachedDigests);
    doc.getElementById("clearNotesBtn").addEventListener("click", clearNotes);
    doc.getElementById("resetBtn").addEventListener("click", resetAllData);
    for (const button of languageButtons) {
      button.addEventListener("click", async () => {
        const language = button.dataset.language;
        applyLanguage(language);
        await persistPreferredLanguage(storage, language);
      });
    }

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", loadOptions, { once: true });
    } else {
      void loadOptions();
    }
  }

  return {
    COPY,
    LANGUAGE_STORAGE_KEY,
    createStorageAdapter,
    providerFormState,
    providerDisplayLabel,
    providerCopy,
    fetchModelList,
    ensureEndpointPermission,
    normalizeLanguage,
    persistPreferredLanguage,
    readPreferredLanguage,
    translate,
    updateLanguageButtonState,
    initialize,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_OPTIONS;
}

if (typeof document !== "undefined") {
  YTD_OPTIONS.initialize();
}
