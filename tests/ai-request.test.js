const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const providers = require("../providers.js");
const settingsApi = require("../settings.js");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

/** 用真实的 providers.js 和 settings.js 加载 background.js，只把网络换成假的。 */
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

test("选中 OpenAI 时请求发往 OpenAI，并用 OpenAI 的密钥", async () => {
  const { api, calls } = loadBackground({
    storedSettings: {
      provider: "openai",
      aiModel: "gpt-5",
      aiApiKeys: { deepseek: "deepseek-key", openai: "openai-key" },
    },
    respondWith: { body: { choices: [{ message: { content: "答案" } }] } },
  });

  const result = await api.requestAiCompletion(ask);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer openai-key");
  assert.equal(JSON.parse(calls[0].init.body).model, "gpt-5");
  assert.equal(result.text, "答案");
});

test("DeepSeek 专属字段不会被发给 OpenAI", async () => {
  const { api, calls } = loadBackground({
    storedSettings: { provider: "openai", aiModel: "gpt-5", aiApiKeys: { openai: "k" } },
    respondWith: { body: { choices: [{ message: { content: "x" } }] } },
  });
  await api.requestAiCompletion(ask);
  assert.equal(JSON.parse(calls[0].init.body).thinking, undefined);
});

test("选中 Anthropic 时用 x-api-key 而不是 Bearer", async () => {
  const { api, calls } = loadBackground({
    storedSettings: {
      provider: "anthropic",
      aiModel: "claude-opus-5",
      aiApiKeys: { anthropic: "claude-key" },
    },
    respondWith: { body: { content: [{ type: "text", text: "答案" }] } },
  });

  const result = await api.requestAiCompletion(ask);

  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], "claude-key");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(result.text, "答案");
});

test("选中 Gemini 时能取出回答，且密钥不进网址", async () => {
  const { api, calls } = loadBackground({
    storedSettings: {
      provider: "gemini",
      aiModel: "gemini-3-pro",
      aiApiKeys: { gemini: "gemini-key" },
    },
    respondWith: { body: { candidates: [{ content: { parts: [{ text: "答案" }] } }] } },
  });

  const result = await api.requestAiCompletion(ask);

  assert.doesNotMatch(calls[0].url, /gemini-key/);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "gemini-key");
  assert.equal(result.text, "答案");
});

test("没填当前服务商的密钥时报错，且错误信息说的是当前服务商", async () => {
  const { api, calls } = loadBackground({
    // 有 DeepSeek 的密钥，但当前选的是 OpenAI
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
  assert.equal(calls.length, 0, "缺密钥时不应发出任何请求");
});

test("服务商返回错误时，错误信息带上服务商名和它自己的说明", async () => {
  const { api } = loadBackground({
    storedSettings: { provider: "anthropic", aiApiKeys: { anthropic: "k" } },
    respondWith: { status: 429, body: { error: { message: "配额已用尽" } } },
  });

  await assert.rejects(
    () => api.requestAiCompletion(ask),
    (error) => {
      assert.equal(error.status, 429);
      assert.match(error.message, /配额已用尽/);
      return true;
    },
  );
});

test("回答为空时报 EMPTY_AI_RESPONSE，不把空串当成答案", async () => {
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
