const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const options = require("../options.js");
const read = (f) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

test("the options page has an AI captions section: provider, model, key, master switch", () => {
  const html = read("options.html");
  assert.match(html, /<select[^>]+id="asrProvider"/);
  assert.match(html, /id="asrModel"/);
  assert.match(html, /id="asrApiKey"/);
  assert.match(html, /id="aiCaptionsEnabled"/);
  for (const id of ["groq", "openai"]) {
    assert.match(html, new RegExp(`value="${id}"[^>]*>\\s*(Groq|OpenAI)`), `the dropdown is missing ${id}`);
  }
});

test("selecting a recognition provider fills in its default model and key", () => {
  const state = options.asrFormState({
    providerId: "groq",
    apiKeys: { groq: "groq-key", openai: "openai-key" },
  });

  assert.equal(state.label, "Groq");
  assert.equal(state.model, "whisper-large-v3-turbo");
  assert.equal(state.apiKey, "groq-key");
  assert.match(state.keyUrl, /^https:\/\//);
});

test("switching recognition providers never crosses the two keys", () => {
  const keys = { groq: "g", openai: "o" };
  assert.equal(options.asrFormState({ providerId: "groq", apiKeys: keys }).apiKey, "g");
  assert.equal(options.asrFormState({ providerId: "openai", apiKeys: keys }).apiKey, "o");
});

test("a saved model name takes precedence over the default", () => {
  const state = options.asrFormState({
    providerId: "groq",
    savedModel: "whisper-large-v3",
    apiKeys: {},
  });
  assert.equal(state.model, "whisper-large-v3");
});

test("the UI can read cost and free allowance for the up-front warning", () => {
  const groq = options.asrFormState({ providerId: "groq", apiKeys: {} });
  assert.ok(groq.usdPerAudioHour > 0);
  // The free tier has a hard limit, so long videos must be flagged early
  assert.equal(groq.freeTier.secondsPerHour, 7200);

  const openai = options.asrFormState({ providerId: "openai", apiKeys: {} });
  assert.equal(openai.freeTier, null, "OpenAI publishes no free-tier limit, so none should be invented");
});

test("AI captions copy exists in both languages with no leftover placeholders", () => {
  const keys = [
    "aiCaptions", "aiCaptionsHelp", "asrProviderLabel", "asrModelLabel",
    "asrApiKeyLabel", "asrKeyLinkLabel", "aiCaptionsToggle", "aiCaptionsNote",
  ];
  for (const language of ["en", "zh-CN"]) {
    for (const key of keys) {
      const value = options.translate(language, key, { provider: "Groq" });
      assert.ok(value, `${language} is missing copy for ${key}`);
      assert.doesNotMatch(value, /\{\w+\}/, `${language} ${key} still contains a placeholder`);
    }
  }
});

test("the recognition key label follows the selected provider", () => {
  assert.match(
    options.translate("zh-CN", "asrApiKeyLabel", { provider: "Groq" }),
    /Groq/,
  );
  assert.match(
    options.translate("en", "asrApiKeyLabel", { provider: "OpenAI Whisper" }),
    /OpenAI Whisper/,
  );
});

test("the options page loads the recognition provider module, or it throws on open", () => {
  const html = read("options.html");
  const asrAt = html.indexOf('src="asr/asr-providers.js"');
  const optionsAt = html.indexOf('src="options.js"');
  assert.notEqual(asrAt, -1, "options.html does not load asr/asr-providers.js");
  assert.ok(asrAt < optionsAt, "asr-providers.js must come before options.js");
});

test("the recognition module settings.js depends on is loaded everywhere", () => {
  // settings.js uses it to derive the default model, so it must load first everywhere
  const background = read("background.js");
  assert.ok(
    background.indexOf('importScripts("asr/asr-providers.js")') <
      background.indexOf('importScripts("settings.js")'),
    "in background.js the recognition module must come before settings.js",
  );
  for (const page of ["options.html", "sidepanel.html"]) {
    const html = read(page);
    assert.ok(
      html.indexOf('src="asr/asr-providers.js"') < html.indexOf('src="settings.js"'),
      `in ${page} the recognition module must come before settings.js`,
    );
  }
});

test("the asr module is in the release allowlist, or the package ships incomplete", () => {
  const script = read("scripts/check-release.sh");
  assert.match(script, /asr\/asr-providers\.js/, "the release allowlist is missing the recognition module");
});

test("text-model and recognition copy keys never collide, or the two overwrite each other", () => {
  // Both share the data-i18n-provider marker and only stay apart because
  // the key names differ. That is an implicit contract: a collision throws
  // nothing, it just renders the other section's copy.
  const textKeys = Object.keys(
    options.providerCopy({ providerId: "openai", language: "en" }),
  );
  const asrKeys = ["asrApiKeyLabel", "asrKeyLinkLabel"];
  for (const key of asrKeys) {
    assert.ok(!textKeys.includes(key), `${key} collides between the two sections`);
  }
});

test("checkboxes use the theme colour, not the browser default blue", () => {
  assert.match(read("options.css"), /accent-color:\s*var\(--accent\)/);
});

test("the options page has an auto-start switch, unchecked by default", () => {
  const html = read("options.html");
  const tag = html.match(/<input[^>]*id="aiCaptionsAutoStart"[^>]*>/);
  assert.ok(tag, "auto-start switch not found");
  assert.doesNotMatch(tag[0], /\schecked/, "auto-start should not be checked by default");
});

test("the auto-start copy makes clear that it skips confirmation", () => {
  for (const language of ["en", "zh-CN"]) {
    const value = options.translate(language, "aiCaptionsAutoToggle");
    assert.ok(value, `${language} is missing auto-start copy`);
    assert.match(value, /confirm|询问|确认|ask/i, `${language} copy does not say it skips confirmation`);
  }
});
