const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const options = require("../options.js");
const read = (f) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

test("选中某个服务商时，表单填入它的默认模型、地址和密钥", () => {
  const state = options.providerFormState({
    providerId: "openai",
    apiKeys: { deepseek: "d-key", openai: "o-key" },
  });

  assert.equal(state.label, "OpenAI");
  assert.equal(state.model, "gpt-5");
  assert.equal(state.baseUrl, "https://api.openai.com/v1");
  assert.equal(state.apiKey, "o-key");
  assert.match(state.keyUrl, /^https:\/\//);
  // 内置服务商的地址不给改，避免请求和密钥被指到别处
  assert.equal(state.baseUrlEditable, false);
});

test("已保存的模型名优先于默认模型", () => {
  const state = options.providerFormState({
    providerId: "openai",
    savedModel: "gpt-5-mini",
    apiKeys: {},
  });
  assert.equal(state.model, "gpt-5-mini");
});

test("切换服务商时各自的密钥不会互相串", () => {
  const keys = { deepseek: "d-key", anthropic: "a-key" };
  assert.equal(options.providerFormState({ providerId: "deepseek", apiKeys: keys }).apiKey, "d-key");
  assert.equal(options.providerFormState({ providerId: "anthropic", apiKeys: keys }).apiKey, "a-key");
  // 没填过的服务商是空的，不会借用别人的
  assert.equal(options.providerFormState({ providerId: "gemini", apiKeys: keys }).apiKey, "");
});

test("自定义服务商时地址框可编辑，并回填已保存的地址", () => {
  const state = options.providerFormState({
    providerId: "custom",
    savedBaseUrl: "https://my-proxy.example.com/v1",
    apiKeys: { custom: "c-key" },
  });
  assert.equal(state.baseUrlEditable, true);
  assert.equal(state.baseUrl, "https://my-proxy.example.com/v1");
});

test("豆包标记为不能自动获取模型列表", () => {
  assert.equal(options.providerFormState({ providerId: "doubao", apiKeys: {} }).canListModels, false);
  assert.equal(options.providerFormState({ providerId: "openai", apiKeys: {} }).canListModels, true);
});

test("获取模型成功时返回模型名列表", async () => {
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

test("获取模型失败时给出可读原因，而不是抛错让页面崩掉", async () => {
  const httpError = await options.fetchModelList({
    providerId: "openai", baseUrl: "https://x", apiKey: "k",
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "密钥无效" } }) }),
  });
  assert.equal(httpError.ok, false);
  assert.match(httpError.reason, /密钥无效/);

  const networkError = await options.fetchModelList({
    providerId: "openai", baseUrl: "https://x", apiKey: "k",
    fetchImpl: async () => { throw new Error("网络不通"); },
  });
  assert.equal(networkError.ok, false);
  assert.match(networkError.reason, /网络不通/);
});

test("不支持获取模型的服务商直接返回不支持，不发请求", async () => {
  let called = false;
  const result = await options.fetchModelList({
    providerId: "doubao", baseUrl: "https://x", apiKey: "k",
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.unsupported, true);
  assert.equal(called, false);
});

test("没填密钥时不发获取模型的请求", async () => {
  let called = false;
  const result = await options.fetchModelList({
    providerId: "openai", baseUrl: "https://x", apiKey: "",
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("设置页有服务商下拉、模型输入框、获取模型按钮和自定义地址框", () => {
  const html = read("options.html");
  assert.match(html, /<select[^>]+id="provider"/);
  assert.match(html, /id="aiModel"/);
  assert.match(html, /id="fetchModelsBtn"/);
  assert.match(html, /id="aiBaseUrl"/);

  // 每个服务商都要在下拉里有一项
  const providers = require("../providers.js");
  for (const p of providers.listProviders()) {
    assert.match(html, new RegExp(`value="${p.id}"`), `下拉里缺少 ${p.id}`);
  }
});

test("保存自定义服务商前会先申请访问该地址的权限", async () => {
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

test("用户拒绝授权时明确返回未授权，不留下跑不通的配置", async () => {
  const result = await options.ensureEndpointPermission({
    providerId: "custom",
    baseUrl: "https://my-proxy.example.com/v1",
    permissionsApi: { contains: async () => false, request: async () => false },
  });
  assert.equal(result.granted, false);
});

test("已经授权过就不再重复弹窗", async () => {
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

test("内置服务商不需要运行时授权，地址已写进 manifest", async () => {
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

test("自定义服务商没填地址时不通过，且不去申请权限", async () => {
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

test("拒绝非 https 的自定义地址，避免密钥明文上路", async () => {
  const result = await options.ensureEndpointPermission({
    providerId: "custom",
    baseUrl: "http://insecure.example.com/v1",
    permissionsApi: { contains: async () => false, request: async () => true },
  });
  assert.equal(result.granted, false);
});

test("manifest 声明了各内置服务商的访问权限，并允许运行时追加自定义地址", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const hosts = manifest.host_permissions.join(" ");
  for (const domain of [
    "api.deepseek.com", "api.openai.com", "open.bigmodel.cn",
    "ark.cn-beijing.volces.com", "api.anthropic.com",
    "generativelanguage.googleapis.com",
  ]) {
    assert.match(hosts, new RegExp(domain.replace(/\./g, "\\.")), `manifest 缺少 ${domain}`);
  }
  assert.ok(
    Array.isArray(manifest.optional_host_permissions),
    "自定义服务商的地址事先未知，必须用 optional_host_permissions 在运行时申请",
  );
});

test("文案里的 {provider} 占位会被替换成服务商名", () => {
  const en = options.translate("en", "aiApiKeyLabel", { provider: "OpenAI" });
  assert.equal(en, "OpenAI API key");
  assert.doesNotMatch(en, /\{provider\}/);

  const zh = options.translate("zh-CN", "privacyNote", { provider: "Anthropic Claude" });
  assert.match(zh, /Anthropic Claude/);
  assert.doesNotMatch(zh, /\{provider\}/);
});

test("获取模型失败的文案会带上具体原因", () => {
  const message = options.translate("zh-CN", "modelsFailed", { reason: "密钥无效" });
  assert.match(message, /密钥无效/);
  assert.doesNotMatch(message, /\{reason\}/);
});

test("模型输入框和获取按钮的横向排布有对应样式", () => {
  assert.match(read("options.css"), /\.model-row\s*\{/);
});
