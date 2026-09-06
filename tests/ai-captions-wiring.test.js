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

test("所有 asr 模块都被 background.js 加载", () => {
  const background = read("background.js");
  for (const mod of ASR_MODULES) {
    assert.match(background, new RegExp(`importScripts\\("${mod.replace("/", "\\/")}"\\)`), `没有加载 ${mod}`);
  }
});

test("所有 asr 模块都在打包白名单里，否则打出来的包缺文件", () => {
  const script = read("scripts/check-release.sh");
  for (const mod of ASR_MODULES) {
    assert.ok(script.includes(mod), `白名单缺少 ${mod}`);
  }
});

test("打包出的清单包含全部 asr 模块", () => {
  // 白名单只是「允许」，还要确认文件真的存在，否则打包会失败
  for (const mod of ASR_MODULES) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", mod)), `${mod} 不存在`);
  }
});

/** 只取 background.js 里的纯函数来测，不加载整个 service worker */
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

test("剥掉播放器自己的分段与封装参数，保留签名参数", () => {
  const helpers = loadHelpers();
  const cleaned = helpers.stripPlayerParams(
    "https://x.googlevideo.com/videoplayback?id=1&range=0-100&ump=1&alr=yes&sig=KEEPME&mime=audio%2Fmp4",
  );
  for (const dropped of ["range=", "ump=", "alr="]) {
    assert.ok(!cleaned.includes(dropped), `${dropped} 没有被剥掉，会拿回错误的数据`);
  }
  // 签名和格式参数必须保留，否则地址失效
  assert.ok(cleaned.includes("sig=KEEPME"), "签名参数被误删了");
  assert.ok(cleaned.includes("id=1"));
});

test("字幕转成下游认识的形状，时间戳按分秒格式", () => {
  const helpers = loadHelpers();
  const shaped = helpers.toTranscriptShape([
    { start: 0, end: 2.4, text: "第一句" },
    { start: 65.2, end: 70, text: "第二句" },
  ]);

  assert.equal(shaped.transcript.length, 2);
  assert.equal(shaped.transcript[1].start, 65);
  assert.equal(shaped.transcriptText, "第一句 第二句");
  assert.match(shaped.transcriptTextTimestamped, /\[1:05\] 第二句/);
});

test("空字幕转形状时不产生空白内容", () => {
  const helpers = loadHelpers();
  const shaped = helpers.toTranscriptShape([]);
  assert.equal(shaped.transcript.length, 0);
  assert.equal(shaped.transcriptText, "");
});

test("manifest 声明了语音识别服务商的域名，否则请求会被 Chrome 拦下", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const hosts = manifest.host_permissions.join(" ");
  const asr = require("../asr/asr-providers.js");
  for (const provider of asr.listProviders()) {
    const domain = new URL(provider.baseUrl).hostname;
    assert.ok(
      hosts.includes(domain),
      `manifest 缺少 ${provider.label} 的域名 ${domain}，识别请求会失败`,
    );
  }
});
