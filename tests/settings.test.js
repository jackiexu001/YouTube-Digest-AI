const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("the default provider is DeepSeek on V4 Flash", () => {
  const normalized = settings.normalize({
    provider: "unexpected",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
    supadataApiKey: "  example-supadata  ",
  });

  assert.equal(normalized.provider, "deepseek");
  assert.equal(normalized.aiBaseUrl, "https://api.deepseek.com");
  // An invalid provider resets the model too, leaving no unusable pair
  assert.equal(normalized.aiModel, "deepseek-v4-flash");
  assert.equal(normalized.supadataApiKey, "example-supadata");
});

test("a key entered for one provider is never sent to another", () => {
  // This was the safety intent behind upstream's migration and must survive
  // the move to multiple providers
  const normalized = settings.normalize({
    provider: "openai",
    aiApiKeys: { deepseek: "deepseek-secret", custom: "custom-secret" },
  });

  assert.equal(settings.activeApiKey(normalized), "");
  assert.equal(normalized.aiApiKeys.deepseek, "deepseek-secret");
  assert.equal(normalized.aiApiKeys.custom, "custom-secret");
});

test("a legacy key stays with its own provider after migration, which is idempotent", () => {
  const legacy = {
    provider: "custom",
    aiApiKey: "custom-secret",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
    supadataApiKey: " supadata-secret ",
  };
  const first = settings.migrateLegacyCustom(legacy);

  assert.equal(first.migrated, true);
  assert.equal(first.settings.provider, "custom");
  // The key stays under custom rather than following along to DeepSeek
  assert.equal(first.settings.aiApiKeys.custom, "custom-secret");
  assert.equal(first.settings.aiApiKeys.deepseek, undefined);
  assert.equal(first.settings.aiBaseUrl, "https://api.example.com/v1");
  assert.equal(first.settings.supadataApiKey, "supadata-secret");

  const second = settings.migrateLegacyCustom(first.settings);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.settings, first.settings);
});

test("Supadata receives a canonical YouTube URL", () => {
  assert.equal(
    settings.canonicalYouTubeUrl("ydTeb_I0b94"),
    "https://www.youtube.com/watch?v=ydTeb_I0b94",
  );
  assert.throws(
    () => settings.canonicalYouTubeUrl('"><script>'),
    /Invalid YouTube video ID/,
  );
});

test("switching providers keeps each provider's saved key", () => {
  const normalized = settings.normalize({
    provider: "openai",
    aiModel: "gpt-5",
    aiApiKeys: { deepseek: "  deepseek-key  ", openai: "openai-key" },
    supadataApiKey: "sup",
  });

  assert.equal(normalized.provider, "openai");
  assert.equal(normalized.aiModel, "gpt-5");
  assert.equal(normalized.aiApiKeys.deepseek, "deepseek-key");
  assert.equal(normalized.aiApiKeys.openai, "openai-key");
});

test("an unknown provider falls back to the DeepSeek defaults", () => {
  const normalized = settings.normalize({ provider: "no-such-provider" });
  assert.equal(normalized.provider, "deepseek");
  assert.equal(normalized.aiModel, "deepseek-v4-flash");
});

test("an empty model name uses that provider's default", () => {
  const normalized = settings.normalize({ provider: "anthropic", aiModel: "" });
  assert.equal(normalized.aiModel, "claude-opus-5");
});

test("a legacy single key migrates under DeepSeek so it need not be re-entered", () => {
  const { settings: migrated, migrated: didMigrate } = settings.migrateLegacyCustom({
    provider: "deepseek",
    aiApiKey: "old-single-key",
    supadataApiKey: "sup",
  });

  assert.equal(migrated.aiApiKeys.deepseek, "old-single-key");
  assert.equal(migrated.supadataApiKey, "sup");
  assert.equal(didMigrate, true);
});

test("custom keeps the URL the user typed; other providers use built-in ones", () => {
  const custom = settings.normalize({
    provider: "custom",
    aiBaseUrl: "  https://my-proxy.example.com/v1  ",
    aiModel: "my-model",
  });
  assert.equal(custom.aiBaseUrl, "https://my-proxy.example.com/v1");

  const openai = settings.normalize({
    provider: "openai",
    aiBaseUrl: "https://attacker.example.com",
  });
  // Non-custom providers reject externally supplied URLs, so config cannot be poisoned
  assert.equal(openai.aiBaseUrl, "https://api.openai.com/v1");
});

test("activeApiKey returns the key for the selected provider", () => {
  const normalized = settings.normalize({
    provider: "openai",
    aiApiKeys: { deepseek: "d-key", openai: "o-key" },
  });
  assert.equal(settings.activeApiKey(normalized), "o-key");
});
