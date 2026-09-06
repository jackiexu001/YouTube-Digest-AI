const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("语音识别的设置与文本模型完全分开", () => {
  const normalized = settings.normalize({
    provider: "openai",
    aiApiKeys: { openai: "text-key" },
    asrProvider: "groq",
    asrApiKeys: { groq: "groq-key" },
  });

  assert.equal(normalized.provider, "openai");
  assert.equal(normalized.asrProvider, "groq");
  // 两套密钥互不影响：文本模型换成 OpenAI 不该动到识别用的 Groq 密钥
  assert.equal(settings.activeApiKey(normalized), "text-key");
  assert.equal(settings.activeAsrApiKey(normalized), "groq-key");
});

test("语音识别默认用 Groq", () => {
  const normalized = settings.normalize({});
  assert.equal(normalized.asrProvider, "groq");
  assert.equal(normalized.asrModel, "whisper-large-v3-turbo");
});

test("未知的识别服务商回落到 Groq", () => {
  const normalized = settings.normalize({ asrProvider: "不存在的" });
  assert.equal(normalized.asrProvider, "groq");
});

test("选择 OpenAI Whisper 时用它自己的默认模型", () => {
  const normalized = settings.normalize({ asrProvider: "openai" });
  assert.equal(normalized.asrModel, "whisper-1");
});

test("识别密钥按服务商分开存，切换不会串", () => {
  const normalized = settings.normalize({
    asrProvider: "openai",
    asrApiKeys: { groq: "  groq-key  ", openai: "openai-key" },
  });
  assert.equal(normalized.asrApiKeys.groq, "groq-key");
  assert.equal(settings.activeAsrApiKey(normalized), "openai-key");
});

test("AI 字幕总开关默认打开，可以关掉", () => {
  assert.equal(settings.normalize({}).aiCaptionsEnabled, true);
  assert.equal(settings.normalize({ aiCaptionsEnabled: false }).aiCaptionsEnabled, false);
});

test("没配识别密钥时 activeAsrApiKey 返回空串而不是 undefined", () => {
  assert.equal(settings.activeAsrApiKey(settings.normalize({})), "");
  assert.equal(settings.activeAsrApiKey({}), "");
});

test("自动生成默认关闭，必须用户主动打开", () => {
  // 这一步会真实花钱，默认自动开始等于替用户做了花钱的决定
  assert.equal(settings.normalize({}).aiCaptionsAutoStart, false);
  assert.equal(settings.normalize({ aiCaptionsAutoStart: true }).aiCaptionsAutoStart, true);
});

test("总开关关掉时，自动生成也必须跟着失效", () => {
  // 否则会出现「AI 字幕已关闭，却仍然自动扣费」这种自相矛盾的状态
  const off = settings.normalize({ aiCaptionsEnabled: false, aiCaptionsAutoStart: true });
  assert.equal(off.aiCaptionsAutoStart, false);
});
