const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const options = require("../options.js");
const read = (f) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

test("设置页有 AI 字幕区块：服务商、模型、密钥、总开关", () => {
  const html = read("options.html");
  assert.match(html, /<select[^>]+id="asrProvider"/);
  assert.match(html, /id="asrModel"/);
  assert.match(html, /id="asrApiKey"/);
  assert.match(html, /id="aiCaptionsEnabled"/);
  for (const id of ["groq", "openai"]) {
    assert.match(html, new RegExp(`value="${id}"[^>]*>\\s*(Groq|OpenAI)`), `下拉里缺少 ${id}`);
  }
});

test("选中识别服务商时填入它的默认模型与密钥", () => {
  const state = options.asrFormState({
    providerId: "groq",
    apiKeys: { groq: "groq-key", openai: "openai-key" },
  });

  assert.equal(state.label, "Groq");
  assert.equal(state.model, "whisper-large-v3-turbo");
  assert.equal(state.apiKey, "groq-key");
  assert.match(state.keyUrl, /^https:\/\//);
});

test("切换识别服务商时两家的密钥不会互相串", () => {
  const keys = { groq: "g", openai: "o" };
  assert.equal(options.asrFormState({ providerId: "groq", apiKeys: keys }).apiKey, "g");
  assert.equal(options.asrFormState({ providerId: "openai", apiKeys: keys }).apiKey, "o");
});

test("已保存的模型名优先于默认值", () => {
  const state = options.asrFormState({
    providerId: "groq",
    savedModel: "whisper-large-v3",
    apiKeys: {},
  });
  assert.equal(state.model, "whisper-large-v3");
});

test("界面能拿到费用与免费额度，用于事前提示", () => {
  const groq = options.asrFormState({ providerId: "groq", apiKeys: {} });
  assert.ok(groq.usdPerAudioHour > 0);
  // 免费档有明确限额，超长视频要提前告知用户
  assert.equal(groq.freeTier.secondsPerHour, 7200);

  const openai = options.asrFormState({ providerId: "openai", apiKeys: {} });
  assert.equal(openai.freeTier, null, "OpenAI 没有公布免费档限额，不该编一个");
});

test("AI 字幕相关文案中英齐全，且不残留占位符", () => {
  const keys = [
    "aiCaptions", "aiCaptionsHelp", "asrProviderLabel", "asrModelLabel",
    "asrApiKeyLabel", "asrKeyLinkLabel", "aiCaptionsToggle", "aiCaptionsNote",
  ];
  for (const language of ["en", "zh-CN"]) {
    for (const key of keys) {
      const value = options.translate(language, key, { provider: "Groq" });
      assert.ok(value, `${language} 缺少文案 ${key}`);
      assert.doesNotMatch(value, /\{\w+\}/, `${language} 的 ${key} 残留占位符`);
    }
  }
});

test("识别服务商的密钥标签也随选择变化", () => {
  assert.match(
    options.translate("zh-CN", "asrApiKeyLabel", { provider: "Groq" }),
    /Groq/,
  );
  assert.match(
    options.translate("en", "asrApiKeyLabel", { provider: "OpenAI Whisper" }),
    /OpenAI Whisper/,
  );
});

test("设置页加载了识别服务商模块，否则打开就报错", () => {
  const html = read("options.html");
  const asrAt = html.indexOf('src="asr/asr-providers.js"');
  const optionsAt = html.indexOf('src="options.js"');
  assert.notEqual(asrAt, -1, "options.html 没有加载 asr/asr-providers.js");
  assert.ok(asrAt < optionsAt, "asr-providers.js 必须排在 options.js 前面");
});

test("settings.js 依赖的识别模块在各处都被加载", () => {
  // settings.js 用它算默认模型，所以凡是加载 settings.js 的地方都要有它
  const background = read("background.js");
  assert.ok(
    background.indexOf('importScripts("asr/asr-providers.js")') <
      background.indexOf('importScripts("settings.js")'),
    "background.js 里识别模块必须排在 settings.js 前面",
  );
  for (const page of ["options.html", "sidepanel.html"]) {
    const html = read(page);
    assert.ok(
      html.indexOf('src="asr/asr-providers.js"') < html.indexOf('src="settings.js"'),
      `${page} 里识别模块必须排在 settings.js 前面`,
    );
  }
});

test("asr 模块进了打包白名单，否则打出来的包缺文件", () => {
  const script = read("scripts/check-release.sh");
  assert.match(script, /asr\/asr-providers\.js/, "打包白名单里没有识别模块");
});

test("文本模型与语音识别的文案键不重名，否则两块会互相覆盖", () => {
  // 两块共用 data-i18n-provider 标记，靠键名不重复才不打架。
  // 这是隐式约定，重名了不会报错，只会显示成另一块的文案。
  const textKeys = Object.keys(
    options.providerCopy({ providerId: "openai", language: "en" }),
  );
  const asrKeys = ["asrApiKeyLabel", "asrKeyLinkLabel"];
  for (const key of asrKeys) {
    assert.ok(!textKeys.includes(key), `${key} 在两块里重名了`);
  }
});

test("复选框用主题色而不是浏览器默认的蓝", () => {
  assert.match(read("options.css"), /accent-color:\s*var\(--accent\)/);
});

test("设置页有自动生成开关，且默认不勾选", () => {
  const html = read("options.html");
  const tag = html.match(/<input[^>]*id="aiCaptionsAutoStart"[^>]*>/);
  assert.ok(tag, "找不到自动生成开关");
  assert.doesNotMatch(tag[0], /\schecked/, "自动生成不该默认勾选");
});

test("自动生成的文案说清了它会绕过确认", () => {
  for (const language of ["en", "zh-CN"]) {
    const value = options.translate(language, "aiCaptionsAutoToggle");
    assert.ok(value, `${language} 缺少自动生成的文案`);
    assert.match(value, /confirm|询问|确认|ask/i, `${language} 的文案没说清会跳过确认`);
  }
});
