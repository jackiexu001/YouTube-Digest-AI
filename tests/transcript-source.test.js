const test = require("node:test");
const assert = require("node:assert/strict");

const resolver = require("../asr/transcript-source.js");

/** Builds controllable dependencies that record which layer was called */
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
      return [{ start: 0, end: 2, text: "free caption" }];
    },
    supadata: async () => {
      calls.push("supadata");
      return { success: true, transcript: [{ start: 0, duration: 2, text: "paid caption" }] };
    },
    ...overrides,
  };
}

test("native captions are taken for free, leaving Supadata alone", async () => {
  const d = deps({
    youtubeSource: async () => ({
      ok: true,
      captionTracks: [{ languageCode: "zh", baseUrl: "https://t", isAutomatic: false }],
      durationSeconds: 600,
    }),
  });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "youtube");
  assert.equal(result.transcript[0].text, "free caption");
  assert.ok(!d.calls.includes("supadata"), "should not spend a Supadata credit");
});

test("when YouTube reports no caption tracks, Supadata is skipped for the AI branch", async () => {
  // Supadata runs in native mode; if YouTube says none exist, neither will it
  const d = deps();
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "none");
  assert.equal(result.needsAiCaptions, true);
  assert.equal(result.durationSeconds, 600);
  assert.ok(!d.calls.includes("supadata"), "wasted a credit");
});

test("a failed native download falls back to Supadata", async () => {
  const d = deps({
    youtubeSource: async () => ({
      ok: true,
      captionTracks: [{ languageCode: "zh", baseUrl: "https://t" }],
      durationSeconds: 600,
    }),
    nativeCaptions: async () => { throw new Error("timedtext is down"); },
  });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "supadata");
  assert.equal(result.transcript[0].text, "paid caption");
});

test("empty native captions also fall back to Supadata", async () => {
  const d = deps({
    youtubeSource: async () => ({
      ok: true, captionTracks: [{ languageCode: "zh", baseUrl: "https://t" }], durationSeconds: 600,
    }),
    nativeCaptions: async () => [],
  });
  const result = await resolver.resolve({ videoId: "v", ...d });
  assert.equal(result.source, "supadata");
});

test("unavailable player info defers to Supadata rather than declaring no captions", async () => {
  const d = deps({ youtubeSource: async () => ({ ok: false, error: "403" }) });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "supadata");
  assert.equal(result.transcript[0].text, "paid caption");
});

test("no player info and no Supadata captions means no AI option", async () => {
  // No player info means no audio URL, so a button here would be an action
  // guaranteed to fail
  const d = deps({
    youtubeSource: async () => ({ ok: false, error: "403" }),
    supadata: async () => ({ success: false, error: "NO_TRANSCRIPT" }),
  });
  const result = await resolver.resolve({ videoId: "v", ...d });

  assert.equal(result.source, "none");
  assert.equal(result.needsAiCaptions, false);
  assert.equal(result.audioUnavailable, true);
});

test("with the master switch off, no captions simply means no captions", async () => {
  const d = deps();
  const result = await resolver.resolve({ videoId: "v", aiCaptionsEnabled: false, ...d });
  assert.equal(result.needsAiCaptions, false);
});

test("human caption tracks are preferred over auto-generated ones", async () => {
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
  assert.equal(picked, "https://human", "auto-generated captions are worse than a human track");
});
