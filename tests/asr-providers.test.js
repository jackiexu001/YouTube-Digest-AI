const test = require("node:test");
const assert = require("node:assert/strict");

const asr = require("../asr/asr-providers.js");

test("Groq and OpenAI are both listed, each with a default model and key page", () => {
  const ids = asr.listProviders().map((p) => p.id);
  assert.deepEqual(ids.sort(), ["groq", "openai"]);
  for (const p of asr.listProviders()) {
    assert.ok(p.label);
    assert.ok(p.defaultModel, `${p.id} has no default model`);
    assert.match(p.baseUrl, /^https:\/\//);
    assert.match(p.keyUrl, /^https:\/\//);
  }
});

test("a transcription request carries the key and model and asks for segment timestamps", () => {
  const request = asr.buildTranscriptionRequest({
    providerId: "groq",
    apiKey: "test-key",
    language: "auto",
  });

  assert.match(request.url, /audio\/transcriptions$/);
  assert.equal(request.headers.Authorization, "Bearer test-key");
  assert.equal(request.fields.model, "whisper-large-v3-turbo");
  assert.equal(request.fields.response_format, "verbose_json");
  // Without segment timestamps there is no way to align to the video timeline
  assert.equal(request.fields["timestamp_granularities[]"], "segment");
});

test("an explicit language is sent, auto-detect sends nothing", () => {
  const zh = asr.buildTranscriptionRequest({ providerId: "groq", apiKey: "k", language: "zh" });
  assert.equal(zh.fields.language, "zh");

  const auto = asr.buildTranscriptionRequest({ providerId: "groq", apiKey: "k", language: "auto" });
  assert.equal(Object.hasOwn(auto.fields, "language"), false);
});

test("extracts segments from a response", () => {
  const segments = asr.extractSegments({
    segments: [
      { start: 0, end: 2.5, text: " first line " },
      { start: 2.5, end: 5, text: "second line" },
    ],
  });
  assert.deepEqual(segments, [
    { start: 0, end: 2.5, text: "first line" },
    { start: 2.5, end: 5, text: "second line" },
  ]);
});

test("a response with text but no segments degrades to one caption instead of nothing", () => {
  const segments = asr.extractSegments({ text: "whole text" });
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "whole text");
});

test("an unexpected response shape returns an empty array rather than throwing", () => {
  assert.deepEqual(asr.extractSegments(null), []);
  assert.deepEqual(asr.extractSegments({ unexpected: true }), []);
});

test("reads the wait time out of a rate-limit error", () => {
  const body = JSON.stringify({
    error: {
      message:
        "Rate limit reached for model `whisper-large-v3-turbo` on seconds of audio per hour (ASPH): Limit 7200, Used 5956, Requested 2336. Please try again in 9m6s.",
    },
  });
  assert.equal(asr.retryAfterSeconds(body, null), 546);
  assert.equal(asr.retryAfterSeconds('{"error":{"message":"try again in 7.5s"}}', null), 8);
  // Falls back to the header when the body does not say
  assert.equal(asr.retryAfterSeconds("{}", "30"), 30);
  // With neither, return null and let the caller decide rather than guessing
  assert.equal(asr.retryAfterSeconds("{}", null), null);
});

test("the quota limit and requested amount are readable, for warning the user", () => {
  const quota = asr.parseQuota(
    "on seconds of audio per hour (ASPH): Limit 7200, Used 5956, Requested 2336.",
  );
  assert.deepEqual(quota, { limit: 7200, used: 5956, requested: 2336 });
  assert.equal(asr.parseQuota("an unparseable error"), null);
});

test("estimates cost from audio duration", () => {
  // Groq whisper-large-v3-turbo is about $0.04 per hour of audio
  const cost = asr.estimateCost({ providerId: "groq", seconds: 3600 });
  assert.ok(Math.abs(cost - 0.04) < 0.001, `one hour computed as ${cost}, which does not match official pricing`);
  assert.ok(asr.estimateCost({ providerId: "groq", seconds: 0 }) === 0);
});

test("empty captions from silence are dropped instead of leaving blank lines", () => {
  // Over music or silence Whisper often returns empty or whitespace-only segments
  const segments = asr.extractSegments({
    segments: [
      { start: 0, end: 2, text: "has content" },
      { start: 2, end: 4, text: "   " },
      { start: 4, end: 6, text: "" },
      { start: 6, end: 8, text: "more content" },
    ],
  });
  assert.deepEqual(segments.map((s) => s.text), ["has content", "more content"]);
});
