const test = require("node:test");
const assert = require("node:assert/strict");

const resolver = require("../asr/transcript-source.js");

/** 造一套可控的依赖，记录每一层是否被调用 */
function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    youtubeSource: async () => {
      calls.push("youtube");
      return { ok: true, captionTracks: [], durationSeconds: 600 };
    },
    nativeCaptions: async () => {
      calls.push("native");
      return [{ start: 0, end: 2, text: "免费字幕" }];
    },
    supadata: async () => {
      calls.push("supadata");
      return { success: true, transcript: [{ start: 0, duration: 2, text: "付费字幕" }] };
    },
    ...overrides,
  };
}

test("有原生字幕时直接免费取，不动 Supadata", async () => {
  const d = deps({
    youtubeSource: async () => ({
      ok: true,
      captionTracks: [{ languageCode: "zh", baseUrl: "https://t", isAutomatic: false }],
      durationSeconds: 600,
    }),
  });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "youtube");
  assert.equal(result.transcript[0].text, "免费字幕");
  assert.ok(!d.calls.includes("supadata"), "不该动用 Supadata 的额度");
});

test("YouTube 说一条字幕轨都没有时，跳过 Supadata 直接进 AI 分支", async () => {
  // Supadata 用的是 native 模式，YouTube 自己都说没有，它也不可能有
  const d = deps();
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "none");
  assert.equal(result.needsAiCaptions, true);
  assert.equal(result.durationSeconds, 600);
  assert.ok(!d.calls.includes("supadata"), "白白花掉了一个 credit");
});

test("原生字幕下载失败时退回 Supadata 兜底", async () => {
  const d = deps({
    youtubeSource: async () => ({
      ok: true,
      captionTracks: [{ languageCode: "zh", baseUrl: "https://t" }],
      durationSeconds: 600,
    }),
    nativeCaptions: async () => { throw new Error("timedtext 挂了"); },
  });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "supadata");
  assert.equal(result.transcript[0].text, "付费字幕");
});

test("原生字幕返回空时也退回 Supadata", async () => {
  const d = deps({
    youtubeSource: async () => ({
      ok: true, captionTracks: [{ languageCode: "zh", baseUrl: "https://t" }], durationSeconds: 600,
    }),
    nativeCaptions: async () => [],
  });
  const result = await resolver.resolve({ videoId: "v", ...d });
  assert.equal(result.source, "supadata");
});

test("取不到播放器信息时交给 Supadata 判断，而不是直接说没字幕", async () => {
  const d = deps({ youtubeSource: async () => ({ ok: false, error: "403" }) });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "supadata");
  assert.equal(result.transcript[0].text, "付费字幕");
});

test("播放器信息取不到且 Supadata 也说没有时，不提供 AI 选项", async () => {
  // 拿不到播放器信息就等于拿不到音频地址，此时给按钮等于给一个必然失败的操作
  const d = deps({
    youtubeSource: async () => ({ ok: false, error: "403" }),
    supadata: async () => ({ success: false, error: "NO_TRANSCRIPT" }),
  });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "none");
  assert.equal(result.needsAiCaptions, false);
  assert.equal(result.audioUnavailable, true);
});

test("总开关关掉时，没字幕就是没字幕，不提供 AI 选项", async () => {
  const d = deps();
  const result = await resolver.resolve({ videoId: "v", aiCaptionsEnabled: false, ...d });
  assert.equal(result.needsAiCaptions, false);
});

test("原生字幕优先人工轨，其次自动生成轨", async () => {
  let picked = null;
  const d = deps({
    youtubeSource: async () => ({
      ok: true,
      captionTracks: [
        { languageCode: "en", baseUrl: "https://asr", isAutomatic: true },
        { languageCode: "zh", baseUrl: "https://human", isAutomatic: false },
      ],
      durationSeconds: 600,
    }),
    nativeCaptions: async (track) => {
      picked = track.baseUrl;
      return [{ start: 0, end: 1, text: "x" }];
    },
  });
  await resolver.resolve({ videoId: "v", ...d });
  assert.equal(picked, "https://human", "自动生成的字幕质量不如人工轨");
});
