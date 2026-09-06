const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const providers = require("../providers.js");
const settingsApi = require("../settings.js");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

/** Loads background.js with the real providers.js and settings.js, faking only the network. */
function loadBackground({ storedSettings, respondWith }) {
  const calls = [];
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    setTimeout,
    clearTimeout,
    importScripts() {},
    YTD_PROVIDERS: providers,
    YTD_SETTINGS: settingsApi,
    async fetch(url, init) {
      calls.push({ url, init });
      const { status = 200, body = {} } = respondWith || {};
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => "application/json" },
        body: null,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async (key) => ({ [key]: storedSettings }),
          set: async () => {},
          remove: async () => {},
        },
      },
      action: { onClicked: listeners },
      sidePanel: { setPanelBehavior() {}, close: async () => {}, setOptions: async () => {} },
      runtime: {
        onInstalled: listeners, onMessage: listeners, openOptionsPage() {},
        getURL: (p) => `chrome-extension://test/${p}`,
        sendMessage: () => Promise.resolve({ success: true }),
      },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("background.js"), sandbox);
  return { api: sandbox.__YTD_TRANSLATION_TESTING__, calls };
}

const ask = { messages: [{ role: "user", content: "hi" }], maxTokens: 64 };

test("selecting OpenAI sends the request to OpenAI with the OpenAI key", async () => {
  const { api, calls } = loadBackground({
    storedSettings: {
      provider: "openai",
      aiModel: "gpt-5",
      aiApiKeys: { deepseek: "deepseek-key", openai: "openai-key" },
    },
    respondWith: { body: { choices: [{ message: { content: "the answer" } }] } },
  });

  const result = await api.requestAiCompletion(ask);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer openai-key");
  assert.equal(JSON.parse(calls[0].init.body).model, "gpt-5");
  assert.equal(result.text, "the answer");
});

test("the DeepSeek-only field is never sent to OpenAI", async () => {
  const { api, calls } = loadBackground({
    storedSettings: { provider: "openai", aiModel: "gpt-5", aiApiKeys: { openai: "k" } },
    respondWith: { body: { choices: [{ message: { content: "x" } }] } },
  });
  await api.requestAiCompletion(ask);
  assert.equal(JSON.parse(calls[0].init.body).thinking, undefined);
});

test("selecting Anthropic uses x-api-key rather than Bearer", async () => {
  const { api, calls } = loadBackground({
    storedSettings: {
      provider: "anthropic",
      aiModel: "claude-opus-5",
      aiApiKeys: { anthropic: "claude-key" },
    },
    respondWith: { body: { content: [{ type: "text", text: "the answer" }] } },
  });

  const result = await api.requestAiCompletion(ask);

  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], "claude-key");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(result.text, "the answer");
});

test("selecting Gemini extracts the answer and keeps the key out of the URL", async () => {
  const { api, calls } = loadBackground({
    storedSettings: {
      provider: "gemini",
      aiModel: "gemini-3-pro",
      aiApiKeys: { gemini: "gemini-key" },
    },
    respondWith: { body: { candidates: [{ content: { parts: [{ text: "the answer" }] } }] } },
  });

  const result = await api.requestAiCompletion(ask);

  assert.doesNotMatch(calls[0].url, /gemini-key/);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "gemini-key");
  assert.equal(result.text, "the answer");
});

test("a missing key for the selected provider errors, naming that provider", async () => {
  const { api, calls } = loadBackground({
    // A DeepSeek key exists, but OpenAI is selected
    storedSettings: { provider: "openai", aiApiKeys: { deepseek: "deepseek-key" } },
  });

  await assert.rejects(
    () => api.requestAiCompletion(ask),
    (error) => {
      assert.equal(error.code, "NO_AI_KEY");
      assert.match(error.message, /OpenAI/);
      assert.doesNotMatch(error.message, /DeepSeek/);
      return true;
    },
  );
  assert.equal(calls.length, 0, "no request should go out when the key is missing");
});

test("a provider error surfaces both the provider and its own message", async () => {
  const { api } = loadBackground({
    storedSettings: { provider: "anthropic", aiApiKeys: { anthropic: "k" } },
    respondWith: { status: 429, body: { error: { message: "quota exhausted" } } },
  });

  await assert.rejects(
    () => api.requestAiCompletion(ask),
    (error) => {
      assert.equal(error.status, 429);
      assert.match(error.message, /quota exhausted/);
      return true;
    },
  );
});

test("an empty answer raises EMPTY_AI_RESPONSE rather than passing a blank string", async () => {
  const { api } = loadBackground({
    storedSettings: { provider: "openai", aiApiKeys: { openai: "k" } },
    respondWith: { body: { choices: [{ message: { content: "   " } }] } },
  });

  await assert.rejects(
    () => api.requestAiCompletion(ask),
    (error) => {
      assert.equal(error.code, "EMPTY_AI_RESPONSE");
      return true;
    },
  );
});
