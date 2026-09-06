const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panel = require("../asr/caption-prompt.js");
const read = (n) => fs.readFileSync(path.join(__dirname, "..", n), "utf8");

test("生成前的提示写明时长、费用和会用掉多少额度", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 2336,
    estimatedUsd: 0.0259,
    provider: "Groq",
    freeTier: { secondsPerHour: 7200 },
    hasKey: true,
  });

  assert.match(prompt.summary, /38 分 56 秒|38:56/);
  assert.match(prompt.summary, /\$0\.03/);
  // 免费额度是用户最容易踩到的坑，必须提前说
  assert.match(prompt.summary, /32%/);
  assert.equal(prompt.canStart, true);
});

test("没配识别密钥时按钮不可点，并指向设置页", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 600, estimatedUsd: 0.007, provider: "Groq",
    freeTier: { secondsPerHour: 7200 }, hasKey: false,
  });
  assert.equal(prompt.canStart, false);
  assert.match(prompt.action, /settings|设置/i);
});

test("视频超过单次额度上限时提前说明会分次完成", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 9000, estimatedUsd: 0.1, provider: "Groq",
    freeTier: { secondsPerHour: 7200 }, hasKey: true,
  });
  // 9000 秒超过每小时 7200 秒的上限
  assert.match(prompt.warning, /分.*次|two runs|exceeds/i);
  assert.equal(prompt.canStart, true, "超额度也应允许开始，只是要分次");
});

test("服务商没有公布免费额度时不显示百分比，也不编造", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 600, estimatedUsd: 0.06, provider: "OpenAI Whisper",
    freeTier: null, hasKey: true,
  });
  assert.doesNotMatch(prompt.summary, /%/);
  assert.match(prompt.summary, /\$0\.06/);
});

test("进度文案显示已完成的段数与已可阅读的时长", () => {
  const text = panel.buildProgress({ completed: 3, total: 8, chunkSeconds: 300 });
  assert.match(text, /3\s*\/\s*8/);
  assert.match(text, /15:00/);
});

test("撞限流时告诉用户已完成多少、还要等多久、可以继续", () => {
  const state = panel.buildRateLimited({
    completed: 12, total: 25, chunkSeconds: 300, retryAfterSeconds: 2046,
  });
  assert.match(state.message, /12\s*\/\s*25/);
  assert.match(state.message, /34/, "没有换算成分钟");
  assert.equal(state.canResume, true);
});

test("侧边栏有 AI 字幕的入口容器", () => {
  const html = read("sidepanel.html");
  assert.match(html, /id="aiCaptionPrompt"/);
  assert.match(html, /id="aiCaptionBtn"/);
  assert.match(html, /id="aiCaptionStatus"/);
});

test("侧边栏加载了它用到的 caption-prompt 模块", () => {
  const html = read("sidepanel.html");
  const modAt = html.indexOf('src="asr/caption-prompt.js"');
  const panelAt = html.indexOf('src="sidepanel.js"');
  assert.notEqual(modAt, -1, "sidepanel.html 没有加载 caption-prompt.js");
  assert.ok(modAt < panelAt, "模块必须排在 sidepanel.js 前面");
});

test("caption-prompt 在打包白名单里", () => {
  assert.match(read("scripts/check-release.sh"), /asr\/caption-prompt\.js/);
});

test("showState 认识 aiCaptions 这个状态，否则面板永远不显示", () => {
  assert.match(read("sidepanel.js"), /state === "aiCaptions"/);
});

test("取字幕时把 tabId 传给后台，否则三层逻辑退化成单层", () => {
  // 后台没有 tabId 就无法在页面环境里取播放器信息，会直接退回 Supadata
  assert.match(read("sidepanel.js"), /action: "fetchTranscript"[\s\S]{0,120}tabId/);
});

test("自动生成时仍先显示费用与额度，只是不用点确认", () => {
  const panelSource = read("sidepanel.js");
  // 自动开始的调用必须排在费用文案填好之后，否则用户永远看不到花了多少
  const summaryAt = panelSource.indexOf('getElementById("aiCaptionSummary")');
  const autoAt = panelSource.indexOf("info.autoStart");
  assert.notEqual(autoAt, -1, "没有实现自动开始");
  assert.ok(summaryAt < autoAt, "自动开始不能早于费用显示");
});

test("没配密钥时即使开了自动生成也不会启动", () => {
  const panelSource = read("sidepanel.js");
  assert.match(
    panelSource,
    /prompt\.canStart\s*&&\s*info\.autoStart/,
    "自动开始必须同时满足「能开始」，否则会反复触发一个必然失败的操作",
  );
});
