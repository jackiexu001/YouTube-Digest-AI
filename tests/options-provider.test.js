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
  assert.equal(state.model, "gpt-5.6");
  assert.equal(state.baseUrl, "https://api.openai.com/v1");
  assert.equal(state.apiKey, "o-key");
  assert.match(state.keyUrl, /^https:\/\//);
  // 内置服务商的地址不给改，避免请求和密钥被指到别处
  assert.equal(state.baseUrlEditable, false);
});

test("已保存的模型名优先于默认模型", () => {
  const state = options.providerFormState({
    providerId: "openai",
    savedModel: "gpt-5.6-mini",
    apiKeys: {},
  });
  assert.equal(state.model, "gpt-5.6-mini");
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

test("能否自动获取模型列表按服务商标记", () => {
  assert.equal(options.providerFormState({ providerId: "openai", apiKeys: {} }).canListModels, true);
  assert.equal(options.providerFormState({ providerId: "anthropic", apiKeys: {} }).canListModels, true);
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
    "api.anthropic.com", "generativelanguage.googleapis.com",
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

test("页面文案不再写死 DeepSeek 是唯一的 AI 服务商", () => {
  const options = require("../options.js");
  for (const lang of ["en", "zh-CN"]) {
    const lede = options.translate(lang, "lede");
    // 支持七家之后，说「只发送给 Supadata 和 DeepSeek」就是错的
    assert.doesNotMatch(lede, /DeepSeek/, `${lang} 的开场白仍写死了 DeepSeek`);
  }
});

test("设置页标题带上 AI，与扩展名一致", () => {
  const options = require("../options.js");
  assert.match(options.translate("en", "pageTitle"), /YouTube Digest AI/);
  assert.match(options.translate("zh-CN", "pageTitle"), /YouTube Digest AI/);
});

test("设置页上显示的产品名是 YouTube Digest AI", () => {
  const html = read("options.html");
  assert.match(html, /class="eyebrow">YouTube Digest AI</);
  assert.match(html, /<title>YouTube Digest AI Settings<\/title>/);
});

test("「自定义」是描述性文字，要跟着界面语言走；品牌名不翻译", () => {
  const options = require("../options.js");
  assert.match(options.translate("en", "providerCustom"), /Custom/);
  assert.match(options.translate("zh-CN", "providerCustom"), /自定义/);

  // 品牌名在两种语言下都是同一个写法
  const providers = require("../providers.js");
  const byId = Object.fromEntries(providers.listProviders().map((p) => [p.id, p]));
  assert.equal(byId.openai.label, "OpenAI");
  assert.equal(byId.anthropic.label, "Anthropic Claude");
  // custom 的 label 不承载展示文案，展示交给 providerCustom
  assert.doesNotMatch(byId.custom.label, /自定义/);
});

test("服务商下拉与输入框共用同一套外观", () => {
  const css = read("options.css");
  // select 必须和 input 一起被样式覆盖，否则会退回浏览器默认外观
  assert.match(css, /input,\s*\n\s*select,\s*\n\s*textarea\s*\{/);
  // 关掉原生外观才能自定义样式
  assert.match(css, /appearance:\s*none/);
  // 自绘的下拉箭头
  assert.match(css, /select\s*\{[^}]*background-image/s);
});

test("聚焦光晕用的是当前主题色，不是遗留的旧配色", () => {
  const css = read("options.css");
  // 旧的赭红 rgba(200, 103, 79, ...) 应该已经跟着换色一起改掉
  assert.doesNotMatch(css, /rgba\(200,\s*103,\s*79/);
});

test("服务商显示名：品牌名不翻译，「自定义」跟界面语言走", () => {
  const options = require("../options.js");
  assert.equal(options.providerDisplayLabel({ providerId: "openai", language: "en" }), "OpenAI");
  assert.equal(options.providerDisplayLabel({ providerId: "openai", language: "zh-CN" }), "OpenAI");
  assert.match(options.providerDisplayLabel({ providerId: "custom", language: "en" }), /^Custom/);
  assert.match(options.providerDisplayLabel({ providerId: "custom", language: "zh-CN" }), /^自定义/);
});

test("带服务商名的文案在两种语言下都不会残留占位符", () => {
  const options = require("../options.js");
  for (const language of ["en", "zh-CN"]) {
    for (const providerId of ["deepseek", "openai", "custom", "gemini"]) {
      const copy = options.providerCopy({ providerId, language });
      for (const [key, value] of Object.entries(copy)) {
        assert.doesNotMatch(value, /\{provider\}/, `${language}/${providerId} 的 ${key} 残留占位符`);
        assert.notEqual(value, "", `${language}/${providerId} 的 ${key} 是空的`);
      }
    }
  }
});

test("英文界面下不会出现中文的「自定义」字样", () => {
  const options = require("../options.js");
  const copy = options.providerCopy({ providerId: "custom", language: "en" });
  for (const [key, value] of Object.entries(copy)) {
    assert.doesNotMatch(value, /[一-龥]/, `英文界面的 ${key} 里混进了中文：${value}`);
  }
});

test("带服务商名的文案用独立标记，不会被通用的语言刷新冲掉", () => {
  const html = read("options.html");
  // 这四处需要代入服务商名，不能走通用的 data-i18n 循环，
  // 否则切换语言时会被刷成字面的 {provider}
  for (const id of ["aiApiKeyLabel", "aiHelpText", "aiKeyLink", "privacyNote"]) {
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `找不到元素 ${id}`);
    assert.doesNotMatch(tag[0], /\sdata-i18n="/, `${id} 不应使用通用的 data-i18n`);
    assert.match(tag[0], /data-i18n-provider="/, `${id} 应使用 data-i18n-provider`);
  }
});

test("自定义服务商要用户自己填模型名，所以带出提示", () => {
  const custom = options.providerFormState({ providerId: "custom", apiKeys: {} });
  assert.equal(custom.model, "");
  assert.ok(custom.modelHint, "自定义服务商没有默认模型，必须给提示");

  const openai = options.providerFormState({ providerId: "openai", apiKeys: {} });
  assert.equal(openai.modelHint, "", "有默认模型的服务商不需要提示");
});
