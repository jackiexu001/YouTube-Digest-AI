const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("speech recognition settings are fully separate from the text model", () => {
  const normalized = settings.normalize({
    provider: "openai",
    aiApiKeys: { openai: "text-key" },
    asrProvider: "groq",
    asrApiKeys: { groq: "groq-key" },
  });

  assert.equal(normalized.provider, "openai");
  assert.equal(normalized.asrProvider, "groq");
  // The two key sets are independent: switching the text model to OpenAI
  // must not touch the Groq key used for recognition
  assert.equal(settings.activeApiKey(normalized), "text-key");
  assert.equal(settings.activeAsrApiKey(normalized), "groq-key");
});

test("speech recognition defaults to Groq", () => {
  const normalized = settings.normalize({});
  assert.equal(normalized.asrProvider, "groq");
  assert.equal(normalized.asrModel, "whisper-large-v3-turbo");
});

test("an unknown recognition provider falls back to Groq", () => {
  const normalized = settings.normalize({ asrProvider: "no-such-provider" });
  assert.equal(normalized.asrProvider, "groq");
});

test("choosing OpenAI Whisper uses its own default model", () => {
  const normalized = settings.normalize({ asrProvider: "openai" });
  assert.equal(normalized.asrModel, "whisper-1");
});

test("recognition keys are stored per provider and never cross over", () => {
  const normalized = settings.normalize({
    asrProvider: "openai",
    asrApiKeys: { groq: "  groq-key  ", openai: "openai-key" },
  });
  assert.equal(normalized.asrApiKeys.groq, "groq-key");
  assert.equal(settings.activeAsrApiKey(normalized), "openai-key");
});

test("the AI captions master switch is on by default and can be turned off", () => {
  assert.equal(settings.normalize({}).aiCaptionsEnabled, true);
  assert.equal(settings.normalize({ aiCaptionsEnabled: false }).aiCaptionsEnabled, false);
});

test("activeAsrApiKey returns an empty string, not undefined, when unset", () => {
  assert.equal(settings.activeAsrApiKey(settings.normalize({})), "");
  assert.equal(settings.activeAsrApiKey({}), "");
});

test("auto-start is off by default and must be turned on deliberately", () => {
  // This step costs real money; starting by default would make a spending
  // decision on the user's behalf
  assert.equal(settings.normalize({}).aiCaptionsAutoStart, false);
  assert.equal(settings.normalize({ aiCaptionsAutoStart: true }).aiCaptionsAutoStart, true);
});

test("auto-start must switch off with the master switch", () => {
  // Otherwise you get the contradictory state of captions off but still charging
  const off = settings.normalize({ aiCaptionsEnabled: false, aiCaptionsAutoStart: true });
  assert.equal(off.aiCaptionsAutoStart, false);
});
