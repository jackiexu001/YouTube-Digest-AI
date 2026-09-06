const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("默认服务商是 DeepSeek，模型为 V4 Flash", () => {
  const normalized = settings.normalize({
    provider: "unexpected",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
    supadataApiKey: "  example-supadata  ",
  });

  assert.equal(normalized.provider, "deepseek");
  assert.equal(normalized.aiBaseUrl, "https://api.deepseek.com");
  // 服务商无效时模型名也回到默认，不留下跑不通的组合
  assert.equal(normalized.aiModel, "deepseek-v4-flash");
  assert.equal(normalized.supadataApiKey, "example-supadata");
});

test("为某个服务商填的密钥不会被发给另一个服务商", () => {
  // 这是原项目迁移逻辑背后的安全意图，改成多服务商后必须继续成立
  const normalized = settings.normalize({
    provider: "openai",
    aiApiKeys: { deepseek: "deepseek-secret", custom: "custom-secret" },
  });

  assert.equal(settings.activeApiKey(normalized), "");
  assert.equal(normalized.aiApiKeys.deepseek, "deepseek-secret");
  assert.equal(normalized.aiApiKeys.custom, "custom-secret");
});

test("老版本的单个密钥迁移后仍归属原服务商，且迁移是幂等的", () => {
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
  // 密钥留在 custom 名下，不会跟着跑到 DeepSeek 去
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

test("切换服务商时保留各自已填的密钥", () => {
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

test("未知服务商回落到 DeepSeek 默认值", () => {
  const normalized = settings.normalize({ provider: "不存在的服务商" });
  assert.equal(normalized.provider, "deepseek");
  assert.equal(normalized.aiModel, "deepseek-v4-flash");
});

test("没填模型名时自动用该服务商的默认模型", () => {
  const normalized = settings.normalize({ provider: "anthropic", aiModel: "" });
  assert.equal(normalized.aiModel, "claude-opus-5");
});

test("老配置里的单个密钥迁移到 DeepSeek 名下，不用重填", () => {
  const { settings: migrated, migrated: didMigrate } = settings.migrateLegacyCustom({
    provider: "deepseek",
    aiApiKey: "old-single-key",
    supadataApiKey: "sup",
  });

  assert.equal(migrated.aiApiKeys.deepseek, "old-single-key");
  assert.equal(migrated.supadataApiKey, "sup");
  assert.equal(didMigrate, true);
});

test("自定义服务商保留用户填写的接口地址，其他服务商用内置地址", () => {
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
  // 非自定义服务商不接受外部传入的地址，防止配置被污染
  assert.equal(openai.aiBaseUrl, "https://api.openai.com/v1");
});

test("activeApiKey 取出当前服务商对应的密钥", () => {
  const normalized = settings.normalize({
    provider: "openai",
    aiApiKeys: { deepseek: "d-key", openai: "o-key" },
  });
  assert.equal(settings.activeApiKey(normalized), "o-key");
});
