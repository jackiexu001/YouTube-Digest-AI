const test = require("node:test");
const assert = require("node:assert/strict");

const providers = require("../providers.js");

test("每个服务商都声明了适配器、基础地址和默认模型", () => {
  const ids = providers.listProviders().map((p) => p.id);
  // 只保留主流几家 + 自定义。智谱、豆包等仍可通过「自定义」接入，
  // 不必为每一家单独维护一条配置。
  assert.deepEqual(ids, ["deepseek", "openai", "glm", "anthropic", "gemini", "custom"]);
  for (const p of providers.listProviders()) {
    assert.ok(p.label, `${p.id} 缺少显示名`);
    assert.ok(p.adapter, `${p.id} 缺少适配器`);
    if (p.id !== "custom") {
      assert.match(p.baseUrl, /^https:\/\//, `${p.id} 基础地址不是 https`);
    }
    // 默认模型可以为空（豆包用接入点 ID），但那时必须给提示
    assert.ok(p.defaultModel || p.modelHint, `${p.id} 既没有默认模型也没有提示`);
  }
});

test("基础地址已包含各家自己的路径前缀，代码不再拼接 /v1", () => {
  const byId = Object.fromEntries(providers.listProviders().map((p) => [p.id, p]));
  assert.equal(byId.deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(byId.openai.baseUrl, "https://api.openai.com/v1");
  // 地址完整存储，代码不拼 /v1——否则接入智谱这类用 /api/paas/v4 的服务会 404
  // 智谱用 /api/paas/v4，硬拼 /v1 会 404
  assert.equal(byId.glm.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(byId.glm.defaultModel, "glm-5");
});

test("OpenAI 兼容适配器把请求发到 {base}/chat/completions", () => {
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

test("DeepSeek 专属的 thinking 字段不会出现在其他服务商的请求里", () => {
  const base = { model: "m", apiKey: "k", messages: [], maxTokens: 10 };

  const deepseek = providers.buildRequest({ providerId: "deepseek", baseUrl: "https://api.deepseek.com", ...base });
  assert.deepEqual(deepseek.body.thinking, { type: "disabled" });

  for (const id of ["openai", "glm", "anthropic", "gemini"]) {
    const req = providers.buildRequest({ providerId: id, baseUrl: "https://example.com", ...base });
    assert.equal(req.body.thinking, undefined, `${id} 不应带 thinking 字段`);
  }
});

test("Anthropic 适配器用自己的鉴权头和 max_tokens 结构", () => {
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
  assert.ok(req.headers["anthropic-version"], "缺少 anthropic-version 头");
  assert.equal(req.headers.Authorization, undefined, "Anthropic 不用 Bearer 鉴权");
  assert.equal(req.body.max_tokens, 100);
});

test("Gemini 适配器把密钥放在请求头而不是网址里", () => {
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
  // 密钥进网址会被日志、历史记录和 Referer 泄露
  assert.doesNotMatch(req.url, /test-key/);
});

test("各适配器从各自的响应结构里取出回答文字", () => {
  assert.equal(
    providers.extractText("openai", { choices: [{ message: { content: "答案" } }] }),
    "答案",
  );
  assert.equal(
    providers.extractText("anthropic", { content: [{ type: "text", text: "答案" }] }),
    "答案",
  );
  assert.equal(
    providers.extractText("gemini", { candidates: [{ content: { parts: [{ text: "答案" }] } }] }),
    "答案",
  );
});

test("各适配器从各自的错误结构里取出错误信息", () => {
  assert.match(providers.extractError("openai", { error: { message: "额度不足" } }, 429), /额度不足/);
  assert.match(providers.extractError("anthropic", { error: { message: "密钥无效" } }, 401), /密钥无效/);
  assert.match(providers.extractError("gemini", { error: { message: "模型不存在" } }, 404), /模型不存在/);
  // 响应体解析不出内容时也要给出可读信息，不能返回空
  assert.match(providers.extractError("openai", null, 500), /500/);
});

test("OpenAI 兼容服务商的模型列表请求指向 {base}/models", () => {
  const req = providers.listModelsRequest({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
  });

  assert.equal(req.url, "https://api.openai.com/v1/models");
  assert.equal(req.headers.Authorization, "Bearer test-key");
});

test("Anthropic 和 Gemini 的模型列表用各自的路径与鉴权", () => {
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

test("各适配器从各自的模型列表结构里取出模型名", () => {
  assert.deepEqual(
    providers.extractModels("openai", { data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] }),
    ["gpt-5", "gpt-5-mini"],
  );
  assert.deepEqual(
    providers.extractModels("anthropic", { data: [{ id: "claude-opus-5" }] }),
    ["claude-opus-5"],
  );
  // Gemini 返回 "models/xxx"，要去掉前缀才能直接用
  assert.deepEqual(
    providers.extractModels("gemini", { models: [{ name: "models/gemini-3-pro" }] }),
    ["gemini-3-pro"],
  );
});

test("模型列表结构不符合预期时返回空数组而不是抛错", () => {
  // 各家接口随时可能改结构，界面要能降级到手填而不是崩掉
  for (const id of ["openai", "glm", "anthropic", "gemini"]) {
    assert.deepEqual(providers.extractModels(id, null), []);
    assert.deepEqual(providers.extractModels(id, { unexpected: true }), []);
  }
});

test("自定义服务商用用户填写的地址，而不是任何内置地址", () => {
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

test("地址末尾多余的斜杠不会拼出双斜杠", () => {
  const req = providers.buildRequest({
    providerId: "custom",
    baseUrl: "https://example.com/v1/",
    model: "m", apiKey: "k", messages: [], maxTokens: 10,
  });
  assert.equal(req.url, "https://example.com/v1/chat/completions");
});

test("系统提示按各家的规矩摆放", () => {
  const messages = [
    { role: "system", content: "你是助手" },
    { role: "user", content: "你好" },
  ];

  // OpenAI 系：系统提示留在对话数组里
  const openai = providers.buildRequest({
    providerId: "openai", baseUrl: "https://x", model: "m", apiKey: "k", messages, maxTokens: 10,
  });
  assert.equal(openai.body.messages.length, 2);

  // Anthropic：系统提示必须提到顶层 system
  const anthropic = providers.buildRequest({
    providerId: "anthropic", baseUrl: "https://x", model: "m", apiKey: "k", messages, maxTokens: 10,
  });
  assert.equal(anthropic.body.system, "你是助手");
  assert.equal(anthropic.body.messages.length, 1);

  // Gemini：系统提示放 systemInstruction，且 assistant 要改叫 model
  const gemini = providers.buildRequest({
    providerId: "gemini", baseUrl: "https://x", model: "m", apiKey: "k",
    messages: [...messages, { role: "assistant", content: "在" }], maxTokens: 10,
  });
  assert.equal(gemini.body.systemInstruction.parts[0].text, "你是助手");
  assert.equal(gemini.body.contents.length, 2);
  assert.equal(gemini.body.contents[1].role, "model");
});

test("每个服务商都能给出获取密钥的官方页面地址", () => {
  for (const p of providers.listProviders()) {
    if (p.id === "custom") continue;
    assert.match(p.keyUrl, /^https:\/\//, `${p.id} 缺少获取密钥的链接`);
  }
});

test("每个用到 settings.js 的页面都先加载 providers.js", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (n) => fs.readFileSync(path.join(__dirname, "..", n), "utf8");

  for (const page of ["options.html", "sidepanel.html"]) {
    const html = read(page);
    const providersAt = html.indexOf('src="providers.js"');
    const settingsAt = html.indexOf('src="settings.js"');
    assert.notEqual(providersAt, -1, `${page} 没有加载 providers.js`);
    // settings.js 依赖 YTD_PROVIDERS，加载顺序反了会直接报错
    assert.ok(providersAt < settingsAt, `${page} 里 providers.js 必须排在 settings.js 前面`);
  }

  // service worker 同理
  const background = read("background.js");
  assert.ok(
    background.indexOf('importScripts("providers.js")') <
      background.indexOf('importScripts("settings.js")'),
    "background.js 里 providers.js 必须排在 settings.js 前面",
  );
});

test("Anthropic 请求带上浏览器直连所需的头，否则会被 CORS 拒绝", () => {
  // Anthropic 默认拒绝浏览器发起的请求，必须显式声明。
  // 少这一个头，整个 Anthropic 服务商在扩展里完全不可用，
  // 而这一点任何单元测试都测不出来——只有真实调用才会暴露。
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

test("获取 Anthropic 模型列表同样要带浏览器直连的头", () => {
  const req = providers.listModelsRequest({
    providerId: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "k",
  });
  assert.equal(req.headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("默认模型名与各家官方当前的模型 id 一致", () => {
  const byId = Object.fromEntries(providers.listProviders().map((p) => [p.id, p]));
  // 核对自官方文档（2026-09）。模型更新很快，所以界面提供「获取模型」按钮，
  // 这里的默认值只是让用户填了密钥就能直接跑通第一次。
  assert.equal(byId.anthropic.defaultModel, "claude-opus-5");
  assert.equal(byId.openai.defaultModel, "gpt-5.6");
  assert.equal(byId.gemini.defaultModel, "gemini-3.8-flash");
});

test("需要用户自己填模型名的服务商都带有提示文案", () => {
  for (const p of providers.listProviders()) {
    if (p.defaultModel) continue;
    assert.ok(p.modelHint, `${p.id} 没有默认模型却也没有提示，用户会不知道填什么`);
  }
});
