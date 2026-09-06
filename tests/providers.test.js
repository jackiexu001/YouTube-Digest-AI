const test = require("node:test");
const assert = require("node:assert/strict");

const providers = require("../providers.js");

test("every provider declares an adapter, base URL and default model", () => {
  const ids = providers.listProviders().map((p) => p.id);
  // Only the mainstream few plus custom. Anything else reaches the same
  // adapter through "custom" without a dedicated entry to maintain.
  assert.deepEqual(ids, ["deepseek", "openai", "glm", "anthropic", "gemini", "custom"]);
  for (const p of providers.listProviders()) {
    assert.ok(p.label, `${p.id} has no label`);
    assert.ok(p.adapter, `${p.id} has no adapter`);
    if (p.id !== "custom") {
      assert.match(p.baseUrl, /^https:\/\//, `${p.id} base URL is not https`);
    }
    // A default model may be empty, but then a hint is required
    assert.ok(p.defaultModel || p.modelHint, `${p.id} has neither a default model nor a hint`);
  }
});

test("base URLs already include each provider's path prefix, no /v1 appended", () => {
  const byId = Object.fromEntries(providers.listProviders().map((p) => [p.id, p]));
  assert.equal(byId.deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(byId.openai.baseUrl, "https://api.openai.com/v1");
  // URLs are stored complete; the code never appends /v1, which would 404
  // against providers like Zhipu that use /api/paas/v4
  // Zhipu uses /api/paas/v4; appending /v1 gives a 404
  assert.equal(byId.glm.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(byId.glm.defaultModel, "glm-5");
});

test("the OpenAI-compatible adapter posts to {base}/chat/completions", () => {
  const req = providers.buildRequest({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5",
    apiKey: "test-key",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 100,
  });

  assert.equal(req.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(req.headers.Authorization, "Bearer test-key");
  assert.equal(req.body.model, "gpt-5");
  assert.equal(req.body.max_tokens, 100);
  assert.deepEqual(req.body.messages, [{ role: "user", content: "hi" }]);
});

test("the DeepSeek-only thinking field never reaches other providers", () => {
  const base = { model: "m", apiKey: "k", messages: [], maxTokens: 10 };

  const deepseek = providers.buildRequest({ providerId: "deepseek", baseUrl: "https://api.deepseek.com", ...base });
  assert.deepEqual(deepseek.body.thinking, { type: "disabled" });

  for (const id of ["openai", "glm", "anthropic", "gemini"]) {
    const req = providers.buildRequest({ providerId: id, baseUrl: "https://example.com", ...base });
    assert.equal(req.body.thinking, undefined, `${id} should not carry a thinking field`);
  }
});

test("the Anthropic adapter uses its own auth header and max_tokens shape", () => {
  const req = providers.buildRequest({
    providerId: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-opus-5",
    apiKey: "test-key",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 100,
  });

  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  assert.equal(req.headers["x-api-key"], "test-key");
  assert.ok(req.headers["anthropic-version"], "missing anthropic-version header");
  assert.equal(req.headers.Authorization, undefined, "Anthropic does not use Bearer auth");
  assert.equal(req.body.max_tokens, 100);
});

test("the Gemini adapter puts the key in a header, not the URL", () => {
  const req = providers.buildRequest({
    providerId: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-3-pro",
    apiKey: "test-key",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 100,
  });

  assert.match(req.url, /gemini-3-pro/);
  assert.equal(req.headers["x-goog-api-key"], "test-key");
  // A key in the URL leaks through logs, history and Referer
  assert.doesNotMatch(req.url, /test-key/);
});

test("each adapter extracts the answer text from its own response shape", () => {
  assert.equal(
    providers.extractText("openai", { choices: [{ message: { content: "the answer" } }] }),
    "the answer",
  );
  assert.equal(
    providers.extractText("anthropic", { content: [{ type: "text", text: "the answer" }] }),
    "the answer",
  );
  assert.equal(
    providers.extractText("gemini", { candidates: [{ content: { parts: [{ text: "the answer" }] } }] }),
    "the answer",
  );
});

test("each adapter extracts the error message from its own error shape", () => {
  assert.match(providers.extractError("openai", { error: { message: "quota exhausted" } }, 429), /quota exhausted/);
  assert.match(providers.extractError("anthropic", { error: { message: "invalid key" } }, 401), /invalid key/);
  assert.match(providers.extractError("gemini", { error: { message: "no such model" } }, 404), /no such model/);
  // An unparseable body must still yield something readable, never empty
  assert.match(providers.extractError("openai", null, 500), /500/);
});

test("OpenAI-compatible providers list models at {base}/models", () => {
  const req = providers.listModelsRequest({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
  });

  assert.equal(req.url, "https://api.openai.com/v1/models");
  assert.equal(req.headers.Authorization, "Bearer test-key");
});

test("Anthropic and Gemini list models with their own paths and auth", () => {
  const anthropic = providers.listModelsRequest({
    providerId: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-key",
  });
  assert.equal(anthropic.url, "https://api.anthropic.com/v1/models");
  assert.equal(anthropic.headers["x-api-key"], "test-key");

  const gemini = providers.listModelsRequest({
    providerId: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "test-key",
  });
  assert.equal(gemini.url, "https://generativelanguage.googleapis.com/v1beta/models");
  assert.equal(gemini.headers["x-goog-api-key"], "test-key");
  assert.doesNotMatch(gemini.url, /test-key/);
});

test("each adapter extracts model names from its own list shape", () => {
  assert.deepEqual(
    providers.extractModels("openai", { data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] }),
    ["gpt-5", "gpt-5-mini"],
  );
  assert.deepEqual(
    providers.extractModels("anthropic", { data: [{ id: "claude-opus-5" }] }),
    ["claude-opus-5"],
  );
  // Gemini returns "models/xxx"; the prefix has to go for the name to be usable
  assert.deepEqual(
    providers.extractModels("gemini", { models: [{ name: "models/gemini-3-pro" }] }),
    ["gemini-3-pro"],
  );
});

test("an unexpected model-list shape returns an empty array instead of throwing", () => {
  // These shapes can change at any time; the UI must fall back to typing, not crash
  for (const id of ["openai", "glm", "anthropic", "gemini"]) {
    assert.deepEqual(providers.extractModels(id, null), []);
    assert.deepEqual(providers.extractModels(id, { unexpected: true }), []);
  }
});

test("a custom provider uses the URL the user entered, not a built-in one", () => {
  const req = providers.buildRequest({
    providerId: "custom",
    baseUrl: "https://my-proxy.example.com/v1",
    model: "my-model",
    apiKey: "k",
    messages: [],
    maxTokens: 10,
  });
  assert.equal(req.url, "https://my-proxy.example.com/v1/chat/completions");
});

test("a trailing slash in the URL does not produce a double slash", () => {
  const req = providers.buildRequest({
    providerId: "custom",
    baseUrl: "https://example.com/v1/",
    model: "m", apiKey: "k", messages: [], maxTokens: 10,
  });
  assert.equal(req.url, "https://example.com/v1/chat/completions");
});

test("the system prompt goes where each provider expects it", () => {
  const messages = [
    { role: "system", content: "You are an assistant" },
    { role: "user", content: "hello" },
  ];

  // OpenAI family: the system prompt stays in the messages array
  const openai = providers.buildRequest({
    providerId: "openai", baseUrl: "https://x", model: "m", apiKey: "k", messages, maxTokens: 10,
  });
  assert.equal(openai.body.messages.length, 2);

  // Anthropic: the system prompt must move to a top-level field
  const anthropic = providers.buildRequest({
    providerId: "anthropic", baseUrl: "https://x", model: "m", apiKey: "k", messages, maxTokens: 10,
  });
  assert.equal(anthropic.body.system, "You are an assistant");
  assert.equal(anthropic.body.messages.length, 1);

  // Gemini: system prompt goes to systemInstruction and assistant becomes model
  const gemini = providers.buildRequest({
    providerId: "gemini", baseUrl: "https://x", model: "m", apiKey: "k",
    messages: [...messages, { role: "assistant", content: "here" }], maxTokens: 10,
  });
  assert.equal(gemini.body.systemInstruction.parts[0].text, "You are an assistant");
  assert.equal(gemini.body.contents.length, 2);
  assert.equal(gemini.body.contents[1].role, "model");
});

test("every provider links to its official key page", () => {
  for (const p of providers.listProviders()) {
    if (p.id === "custom") continue;
    assert.match(p.keyUrl, /^https:\/\//, `${p.id} has no key-creation link`);
  }
});

test("every page that uses settings.js loads providers.js first", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (n) => fs.readFileSync(path.join(__dirname, "..", n), "utf8");

  for (const page of ["options.html", "sidepanel.html"]) {
    const html = read(page);
    const providersAt = html.indexOf('src="providers.js"');
    const settingsAt = html.indexOf('src="settings.js"');
    assert.notEqual(providersAt, -1, `${page} does not load providers.js`);
    // settings.js depends on YTD_PROVIDERS; the wrong order throws immediately
    assert.ok(providersAt < settingsAt, `${page} : providers.js must come before settings.js`);
  }

  // Same for the service worker
  const background = read("background.js");
  assert.ok(
    background.indexOf('importScripts("providers.js")') <
      background.indexOf('importScripts("settings.js")'),
    "background.js : providers.js must come before settings.js",
  );
});

test("Anthropic requests carry the browser-access header, or CORS rejects them", () => {
  // Anthropic rejects browser-originated requests unless this is declared.
  // Without this header the whole Anthropic provider is unusable in the
  // extension, and no unit test can catch it; only a real call reveals it.
  const req = providers.buildRequest({
    providerId: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-opus-5",
    apiKey: "k",
    messages: [],
    maxTokens: 10,
  });
  assert.equal(req.headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("listing Anthropic models also needs the browser-access header", () => {
  const req = providers.listModelsRequest({
    providerId: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "k",
  });
  assert.equal(req.headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("default model names match each provider's current official model id", () => {
  const byId = Object.fromEntries(providers.listProviders().map((p) => [p.id, p]));
  // Checked against official docs (2026-09). Models move fast, which is why
  // the UI offers Fetch models; these defaults only need to make the first
  // call work once a key is saved.
  assert.equal(byId.anthropic.defaultModel, "claude-opus-5");
  assert.equal(byId.openai.defaultModel, "gpt-5.6");
  assert.equal(byId.gemini.defaultModel, "gemini-3.8-flash");
});

test("providers without a default model carry a hint", () => {
  for (const p of providers.listProviders()) {
    if (p.defaultModel) continue;
    assert.ok(p.modelHint, `${p.id} has no default model and no hint, leaving the user with nothing to type`);
  }
});
