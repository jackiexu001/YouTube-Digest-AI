const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const options = require("../options.js");
const read = (f) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

test("selecting a provider fills the form with its default model, URL and key", () => {
  const state = options.providerFormState({
    providerId: "openai",
    apiKeys: { deepseek: "d-key", openai: "o-key" },
  });

  assert.equal(state.label, "OpenAI");
  assert.equal(state.model, "gpt-5.6");
  assert.equal(state.baseUrl, "https://api.openai.com/v1");
  assert.equal(state.apiKey, "o-key");
  assert.match(state.keyUrl, /^https:\/\//);
  // Built-in URLs are not editable, so requests and keys cannot be redirected
  assert.equal(state.baseUrlEditable, false);
});

test("a saved model name takes precedence over the default", () => {
  const state = options.providerFormState({
    providerId: "openai",
    savedModel: "gpt-5.6-mini",
    apiKeys: {},
  });
  assert.equal(state.model, "gpt-5.6-mini");
});

test("switching providers never crosses the saved keys", () => {
  const keys = { deepseek: "d-key", anthropic: "a-key" };
  assert.equal(options.providerFormState({ providerId: "deepseek", apiKeys: keys }).apiKey, "d-key");
  assert.equal(options.providerFormState({ providerId: "anthropic", apiKeys: keys }).apiKey, "a-key");
  // A provider never configured stays empty rather than borrowing another's key
  assert.equal(options.providerFormState({ providerId: "gemini", apiKeys: keys }).apiKey, "");
});

test("a custom provider makes the URL editable and restores the saved value", () => {
  const state = options.providerFormState({
    providerId: "custom",
    savedBaseUrl: "https://my-proxy.example.com/v1",
    apiKeys: { custom: "c-key" },
  });
  assert.equal(state.baseUrlEditable, true);
  assert.equal(state.baseUrl, "https://my-proxy.example.com/v1");
});

test("whether models can be fetched is marked per provider", () => {
  assert.equal(options.providerFormState({ providerId: "openai", apiKeys: {} }).canListModels, true);
  assert.equal(options.providerFormState({ providerId: "anthropic", apiKeys: {} }).canListModels, true);
});

test("a successful fetch returns the list of model names", async () => {
  const result = await options.fetchModelList({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "k",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] }),
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ["gpt-5", "gpt-5-mini"]);
});

test("a failed fetch returns a readable reason instead of throwing and breaking the page", async () => {
  const httpError = await options.fetchModelList({
    providerId: "openai", baseUrl: "https://x", apiKey: "k",
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid key" } }) }),
  });
  assert.equal(httpError.ok, false);
  assert.match(httpError.reason, /invalid key/);

  const networkError = await options.fetchModelList({
    providerId: "openai", baseUrl: "https://x", apiKey: "k",
    fetchImpl: async () => { throw new Error("network unreachable"); },
  });
  assert.equal(networkError.ok, false);
  assert.match(networkError.reason, /network unreachable/);
});

test("no fetch goes out when the key is empty", async () => {
  let called = false;
  const result = await options.fetchModelList({
    providerId: "openai", baseUrl: "https://x", apiKey: "",
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("the options page has the provider select, model input, fetch button and custom URL field", () => {
  const html = read("options.html");
  assert.match(html, /<select[^>]+id="provider"/);
  assert.match(html, /id="aiModel"/);
  assert.match(html, /id="fetchModelsBtn"/);
  assert.match(html, /id="aiBaseUrl"/);

  // Every provider needs an entry in the dropdown
  const providers = require("../providers.js");
  for (const p of providers.listProviders()) {
    assert.match(html, new RegExp(`value="${p.id}"`), `the dropdown is missing ${p.id}`);
  }
});

test("saving a custom provider first requests permission for that address", async () => {
  const asked = [];
  const result = await options.ensureEndpointPermission({
    providerId: "custom",
    baseUrl: "https://my-proxy.example.com/v1",
    permissionsApi: {
      contains: async () => false,
      request: async (req) => { asked.push(req); return true; },
    },
  });

  assert.equal(result.granted, true);
  assert.deepEqual(asked, [{ origins: ["https://my-proxy.example.com/*"] }]);
});

test("a declined prompt returns not-granted rather than storing a broken config", async () => {
  const result = await options.ensureEndpointPermission({
    providerId: "custom",
    baseUrl: "https://my-proxy.example.com/v1",
    permissionsApi: { contains: async () => false, request: async () => false },
  });
  assert.equal(result.granted, false);
});

test("an already-granted origin does not prompt again", async () => {
  let requested = false;
  const result = await options.ensureEndpointPermission({
    providerId: "custom",
    baseUrl: "https://my-proxy.example.com/v1",
    permissionsApi: {
      contains: async () => true,
      request: async () => { requested = true; return true; },
    },
  });
  assert.equal(result.granted, true);
  assert.equal(requested, false);
});

test("built-in providers need no runtime prompt; their hosts are in the manifest", async () => {
  let requested = false;
  const result = await options.ensureEndpointPermission({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    permissionsApi: {
      contains: async () => false,
      request: async () => { requested = true; return true; },
    },
  });
  assert.equal(result.granted, true);
  assert.equal(requested, false);
});

test("a custom provider with no URL fails without requesting permission", async () => {
  let requested = false;
  const result = await options.ensureEndpointPermission({
    providerId: "custom",
    baseUrl: "   ",
    permissionsApi: { contains: async () => false, request: async () => { requested = true; return true; } },
  });
  assert.equal(result.granted, false);
  assert.equal(result.reason, "baseUrlRequired");
  assert.equal(requested, false);
});

test("a non-https custom URL is rejected, so the key never travels in the clear", async () => {
  const result = await options.ensureEndpointPermission({
    providerId: "custom",
    baseUrl: "http://insecure.example.com/v1",
    permissionsApi: { contains: async () => false, request: async () => true },
  });
  assert.equal(result.granted, false);
});

test("the manifest declares each built-in host and allows adding a custom one at runtime", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const hosts = manifest.host_permissions.join(" ");
  for (const domain of [
    "api.deepseek.com", "api.openai.com", "open.bigmodel.cn",
    "api.anthropic.com", "generativelanguage.googleapis.com",
  ]) {
    assert.match(hosts, new RegExp(domain.replace(/\./g, "\\.")), `the manifest is missing ${domain}`);
  }
  assert.ok(
    Array.isArray(manifest.optional_host_permissions),
    "a custom URL is unknown ahead of time and needs optional_host_permissions",
  );
});

test("the {provider} placeholder is replaced with the provider name", () => {
  const en = options.translate("en", "aiApiKeyLabel", { provider: "OpenAI" });
  assert.equal(en, "OpenAI API key");
  assert.doesNotMatch(en, /\{provider\}/);

  const zh = options.translate("zh-CN", "privacyNote", { provider: "Anthropic Claude" });
  assert.match(zh, /Anthropic Claude/);
  assert.doesNotMatch(zh, /\{provider\}/);
});

test("the fetch-failure copy carries the specific reason", () => {
  const message = options.translate("zh-CN", "modelsFailed", { reason: "invalid key" });
  assert.match(message, /invalid key/);
  assert.doesNotMatch(message, /\{reason\}/);
});

test("the model input and fetch button have styles for their shared row", () => {
  assert.match(read("options.css"), /\.model-row\s*\{/);
});

test("page copy no longer claims DeepSeek is the only AI provider", () => {
  const options = require("../options.js");
  for (const lang of ["en", "zh-CN"]) {
    const lede = options.translate(lang, "lede");
    // With several providers, "sent only to Supadata and DeepSeek" is false
    assert.doesNotMatch(lede, /DeepSeek/, `${lang} lede still hardcodes DeepSeek`);
  }
});

test("the options page title carries AI, matching the extension name", () => {
  const options = require("../options.js");
  assert.match(options.translate("en", "pageTitle"), /YouTube Digest AI/);
  assert.match(options.translate("zh-CN", "pageTitle"), /YouTube Digest AI/);
});

test("the product name shown on the options page is YouTube Digest AI", () => {
  const html = read("options.html");
  assert.match(html, /class="eyebrow">YouTube Digest AI</);
  assert.match(html, /<title>YouTube Digest AI Settings<\/title>/);
});

test("Custom is descriptive and follows the UI language; brands are not translated", () => {
  const options = require("../options.js");
  assert.match(options.translate("en", "providerCustom"), /Custom/);
  assert.match(options.translate("zh-CN", "providerCustom"), /\u81ea\u5b9a\u4e49/);

  // Brand names are written the same in both languages
  const providers = require("../providers.js");
  const byId = Object.fromEntries(providers.listProviders().map((p) => [p.id, p]));
  assert.equal(byId.openai.label, "OpenAI");
  assert.equal(byId.anthropic.label, "Anthropic Claude");
  // The custom label is not display copy; providerCustom handles that
  assert.doesNotMatch(byId.custom.label, /Custom \(/);
});

test("the provider select shares one look with the inputs", () => {
  const css = read("options.css");
  // select must be styled alongside input, or it falls back to the browser default
  assert.match(css, /input,\s*\n\s*select,\s*\n\s*textarea\s*\{/);
  // Native appearance must be off before it can be styled
  assert.match(css, /appearance:\s*none/);
  // The hand-drawn dropdown arrow
  assert.match(css, /select\s*\{[^}]*background-image/s);
});

test("the focus ring uses the current theme colour, not a leftover one", () => {
  const css = read("options.css");
  // The old terracotta rgba(200, 103, 79, ...) should have moved with the theme
  assert.doesNotMatch(css, /rgba\(200,\s*103,\s*79/);
});

test("display names: brands untranslated, Custom follows the UI language", () => {
  const options = require("../options.js");
  assert.equal(options.providerDisplayLabel({ providerId: "openai", language: "en" }), "OpenAI");
  assert.equal(options.providerDisplayLabel({ providerId: "openai", language: "zh-CN" }), "OpenAI");
  assert.match(options.providerDisplayLabel({ providerId: "custom", language: "en" }), /^Custom/);
  assert.match(options.providerDisplayLabel({ providerId: "custom", language: "zh-CN" }), /^\u81ea\u5b9a\u4e49/);
});

test("provider-substituted copy leaves no placeholder in either language", () => {
  const options = require("../options.js");
  for (const language of ["en", "zh-CN"]) {
    for (const providerId of ["deepseek", "openai", "custom", "gemini"]) {
      const copy = options.providerCopy({ providerId, language });
      for (const [key, value] of Object.entries(copy)) {
        assert.doesNotMatch(value, /\{provider\}/, `${language}/${providerId} ${key} still has a placeholder`);
        assert.notEqual(value, "", `${language}/${providerId} ${key} is empty`);
      }
    }
  }
});

test("the English UI never shows the Chinese word for custom", () => {
  const options = require("../options.js");
  const copy = options.providerCopy({ providerId: "custom", language: "en" });
  for (const [key, value] of Object.entries(copy)) {
    assert.doesNotMatch(value, /[一-龥]/, `English copy for ${key} contains Chinese: ${value}`);
  }
});

test("provider-substituted copy uses its own marker so the generic refresh cannot wipe it", () => {
  const html = read("options.html");
  // These four need the provider substituted in and must stay out of the
  // generic data-i18n loop, which would refresh them to a literal {provider}
  for (const id of ["aiApiKeyLabel", "aiHelpText", "aiKeyLink", "privacyNote"]) {
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `element ${id} not found`);
    assert.doesNotMatch(tag[0], /\sdata-i18n="/, `${id} should not use the generic data-i18n`);
    assert.match(tag[0], /data-i18n-provider="/, `${id} should use data-i18n-provider`);
  }
});

test("a custom provider needs a typed model name, so it carries a hint", () => {
  const custom = options.providerFormState({ providerId: "custom", apiKeys: {} });
  assert.equal(custom.model, "");
  assert.ok(custom.modelHint, "a custom provider has no default model and must offer a hint");

  const openai = options.providerFormState({ providerId: "openai", apiKeys: {} });
  assert.equal(openai.modelHint, "", "a provider with a default model needs no hint");
});

test("no pre-rebrand terracotta remains anywhere", () => {
  // Two places are easiest to miss when changing the theme: inline styles
  // injected into the YouTube page, and shadows written as rgba. Both bypass
  // the CSS variables.
  const files = ["content.js", "sidepanel.js", "sidepanel.css", "options.js", "options.css"];
  const old = /#c8674f|#b25742|#ad523e|rgba\(\s*200,\s*103,\s*79/i;
  for (const file of files) {
    assert.doesNotMatch(read(file), old, `${file} still contains pre-rebrand terracotta`);
  }
});

test("buttons injected into the YouTube page use this project's orange", () => {
  const content = read("content.js");
  assert.match(content, /#ef6826/, "injected buttons do not use the theme accent");
  assert.match(content, /#d9530f/, "injected buttons have no hover colour");
});

test("shadows and scrims use neutral tones, not the pre-rebrand warm brown", () => {
  // Warm brown shadows look dirty over a neutral grey UI, and these values
  // bypass the CSS variables, so they are the easiest to miss
  const warm = /rgba\(\s*(46,\s*42,\s*36|50,\s*42,\s*32)|#60483f/i;
  for (const file of ["content.js", "sidepanel.css", "options.css"]) {
    assert.doesNotMatch(read(file), warm, `${file} still contains pre-rebrand warm brown`);
  }
});
