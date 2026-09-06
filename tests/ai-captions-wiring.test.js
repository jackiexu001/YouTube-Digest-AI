const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (n) => fs.readFileSync(path.join(__dirname, "..", n), "utf8");

const ASR_MODULES = [
  "asr/asr-providers.js", "asr/youtube-source.js", "asr/transcript-source.js",
  "asr/mp4-index.js", "asr/fetcher.js", "asr/wav.js", "asr/merge.js", "asr/transcribe.js",
];

test("background.js loads every asr module", () => {
  const background = read("background.js");
  for (const mod of ASR_MODULES) {
    assert.match(background, new RegExp(`importScripts\\("${mod.replace("/", "\\/")}"\\)`), `does not load ${mod}`);
  }
});

test("every asr module is in the release allowlist, or the package ships incomplete", () => {
  const script = read("scripts/check-release.sh");
  for (const mod of ASR_MODULES) {
    assert.ok(script.includes(mod), `allowlist is missing ${mod}`);
  }
});

test("the packaged file list covers every asr module", () => {
  // The allowlist only permits; the files must also exist or packaging fails
  for (const mod of ASR_MODULES) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", mod)), `${mod} does not exist`);
  }
});

/** Loads only background.js's pure helpers, not the whole service worker */
function loadHelpers() {
  const sandbox = {
    console, URL, TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout,
    importScripts() {},
    YTD_PROVIDERS: require("../providers.js"),
    YTD_ASR_PROVIDERS: require("../asr/asr-providers.js"),
    YTD_YOUTUBE_SOURCE: require("../asr/youtube-source.js"),
    YTD_TRANSCRIPT_SOURCE: require("../asr/transcript-source.js"),
    YTD_MP4_INDEX: require("../asr/mp4-index.js"),
    YTD_FETCHER: require("../asr/fetcher.js"),
    YTD_WAV: require("../asr/wav.js"),
    YTD_MERGE: require("../asr/merge.js"),
    YTD_TRANSCRIBE: require("../asr/transcribe.js"),
    YTD_SETTINGS: require("../settings.js"),
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    chrome: {
      storage: { local: { setAccessLevel: () => Promise.resolve(), get: async () => ({}), set: async () => {}, remove: async () => {} } },
      action: { onClicked: { addListener() {} } },
      sidePanel: { setPanelBehavior() {}, close: async () => {}, setOptions: async () => {} },
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} }, openOptionsPage() {}, getURL: (p) => p, sendMessage: () => Promise.resolve({}) },
      tabs: { onUpdated: { addListener() {} }, onActivated: { addListener() {} } },
      scripting: { executeScript: async () => [{ result: null }] },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("background.js"), sandbox);
  return sandbox.__YTD_TRANSLATION_TESTING__;
}

test("strips the player's own range and framing params while keeping the signature", () => {
  const helpers = loadHelpers();
  const cleaned = helpers.stripPlayerParams(
    "https://x.googlevideo.com/videoplayback?id=1&range=0-100&ump=1&alr=yes&sig=KEEPME&mime=audio%2Fmp4",
  );
  for (const dropped of ["range=", "ump=", "alr="]) {
    assert.ok(!cleaned.includes(dropped), `${dropped} was not stripped, which returns the wrong data`);
  }
  // Signature and format params must survive, or the URL stops working
  assert.ok(cleaned.includes("sig=KEEPME"), "the signature parameter was removed by mistake");
  assert.ok(cleaned.includes("id=1"));
});

test("captions convert to the downstream shape with minute:second timestamps", () => {
  const helpers = loadHelpers();
  const shaped = helpers.toTranscriptShape([
    { start: 0, end: 2.4, text: "first line" },
    { start: 65.2, end: 70, text: "second line" },
  ]);

  assert.equal(shaped.transcript.length, 2);
  assert.equal(shaped.transcript[1].start, 65);
  assert.equal(shaped.transcriptText, "first line second line");
  assert.match(shaped.transcriptTextTimestamped, /\[1:05\] second line/);
});

test("converting empty captions produces no blank content", () => {
  const helpers = loadHelpers();
  const shaped = helpers.toTranscriptShape([]);
  assert.equal(shaped.transcript.length, 0);
  assert.equal(shaped.transcriptText, "");
});

test("the manifest declares each recognition provider's host, or Chrome blocks the request", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const hosts = manifest.host_permissions.join(" ");
  const asr = require("../asr/asr-providers.js");
  for (const provider of asr.listProviders()) {
    const domain = new URL(provider.baseUrl).hostname;
    assert.ok(
      hosts.includes(domain),
      `manifest is missing ${provider.label}'s host ${domain}; recognition will fail`,
    );
  }
});

test("chunk audio is downloaded in parallel ranges, not one sequential request", () => {
  const background = read("background.js");
  const fn = background.slice(background.indexOf("async function transcribeOneChunk"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  // A single sequential GET against googlevideo is throttled hard: measured at
  // 1.5 MB in three minutes, versus 8 MB in 2.7 seconds across eight ranges.
  // Downloading a chunk in one request can therefore stall for minutes.
  assert.match(
    body,
    /fetchAudioRangeParallel\(tabId, audioUrl, chunk\.byteStart/,
    "chunk audio is fetched in a single ranged request, which YouTube throttles",
  );

  // And that helper must genuinely split the range rather than just be named for it
  const helper = background.slice(background.indexOf("async function fetchAudioRangeParallel"));
  assert.match(
    helper.slice(0, helper.indexOf("\n}\n")),
    /splitRange[\s\S]*Promise\.all/,
    "fetchAudioRangeParallel does not actually split the range",
  );
});
