const test = require("node:test");
const assert = require("node:assert/strict");

const asr = require("../asr/asr-providers.js");

test("Groq 与 OpenAI 都在清单里，各有默认模型和获取密钥的地址", () => {
  const ids = asr.listProviders().map((p) => p.id);
  assert.deepEqual(ids.sort(), ["groq", "openai"]);
  for (const p of asr.listProviders()) {
    assert.ok(p.label);
    assert.ok(p.defaultModel, `${p.id} 缺少默认模型`);
    assert.match(p.baseUrl, /^https:\/\//);
    assert.match(p.keyUrl, /^https:\/\//);
  }
});

test("识别请求带上密钥、模型，并要求返回分段时间戳", () => {
  const request = asr.buildTranscriptionRequest({
    providerId: "groq",
    apiKey: "test-key",
    language: "auto",
  });

  assert.match(request.url, /audio\/transcriptions$/);
  assert.equal(request.headers.Authorization, "Bearer test-key");
  assert.equal(request.fields.model, "whisper-large-v3-turbo");
  assert.equal(request.fields.response_format, "verbose_json");
  // 没有分段时间戳就没法把字幕对到视频时间轴上
  assert.equal(request.fields["timestamp_granularities[]"], "segment");
});

test("指定语种时传给服务商，自动识别时不传", () => {
  const zh = asr.buildTranscriptionRequest({ providerId: "groq", apiKey: "k", language: "zh" });
  assert.equal(zh.fields.language, "zh");

  const auto = asr.buildTranscriptionRequest({ providerId: "groq", apiKey: "k", language: "auto" });
  assert.equal(Object.hasOwn(auto.fields, "language"), false);
});

test("从响应里取出分段字幕", () => {
  const segments = asr.extractSegments({
    segments: [
      { start: 0, end: 2.5, text: " 第一句 " },
      { start: 2.5, end: 5, text: "第二句" },
    ],
  });
  assert.deepEqual(segments, [
    { start: 0, end: 2.5, text: "第一句" },
    { start: 2.5, end: 5, text: "第二句" },
  ]);
});

test("响应里没有分段但有整段文字时，退化成一条字幕而不是丢掉", () => {
  const segments = asr.extractSegments({ text: "整段文字" });
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "整段文字");
});

test("响应结构不符合预期时返回空数组，不抛错", () => {
  assert.deepEqual(asr.extractSegments(null), []);
  assert.deepEqual(asr.extractSegments({ unexpected: true }), []);
});

test("从限流错误里解析出还要等多久", () => {
  const body = JSON.stringify({
    error: {
      message:
        "Rate limit reached for model `whisper-large-v3-turbo` on seconds of audio per hour (ASPH): Limit 7200, Used 5956, Requested 2336. Please try again in 9m6s.",
    },
  });
  assert.equal(asr.retryAfterSeconds(body, null), 546);
  assert.equal(asr.retryAfterSeconds('{"error":{"message":"try again in 7.5s"}}', null), 8);
  // 没写在正文里就看响应头
  assert.equal(asr.retryAfterSeconds("{}", "30"), 30);
  // 都没有就返回 null，让调用方决定，而不是瞎猜一个等待时间
  assert.equal(asr.retryAfterSeconds("{}", null), null);
});

test("限流错误里能读出额度上限和本次请求量，用于提示用户", () => {
  const quota = asr.parseQuota(
    "on seconds of audio per hour (ASPH): Limit 7200, Used 5956, Requested 2336.",
  );
  assert.deepEqual(quota, { limit: 7200, used: 5956, requested: 2336 });
  assert.equal(asr.parseQuota("看不懂的错误"), null);
});

test("按音频时长估算费用", () => {
  // Groq whisper-large-v3-turbo 约 $0.04 每小时音频
  const cost = asr.estimateCost({ providerId: "groq", seconds: 3600 });
  assert.ok(Math.abs(cost - 0.04) < 0.001, `一小时算出 ${cost}，与官方价格不符`);
  assert.ok(asr.estimateCost({ providerId: "groq", seconds: 0 }) === 0);
});

test("静音段返回的空字幕会被丢掉，不留下空白行", () => {
  // 视频里有音乐或静音时，Whisper 常返回空文本或只有空白的分段
  const segments = asr.extractSegments({
    segments: [
      { start: 0, end: 2, text: "有内容" },
      { start: 2, end: 4, text: "   " },
      { start: 4, end: 6, text: "" },
      { start: 6, end: 8, text: "还有内容" },
    ],
  });
  assert.deepEqual(segments.map((s) => s.text), ["有内容", "还有内容"]);
});
