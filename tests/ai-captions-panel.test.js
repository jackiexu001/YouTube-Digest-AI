const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panel = require("../asr/caption-prompt.js");
const read = (n) => fs.readFileSync(path.join(__dirname, "..", n), "utf8");

test("the pre-run prompt states duration, cost and how much allowance it uses", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 2336,
    estimatedUsd: 0.0259,
    provider: "Groq",
    freeTier: { secondsPerHour: 7200 },
    hasKey: true,
  });

  assert.match(prompt.summary, /38 min 56 sec|38:56/);
  assert.match(prompt.summary, /\$0\.03/);
  // The free allowance is the easiest thing to trip over, so say it up front
  assert.match(prompt.summary, /32%/);
  assert.equal(prompt.canStart, true);
});

test("without a recognition key the button is inert and points at Settings", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 600, estimatedUsd: 0.007, provider: "Groq",
    freeTier: { secondsPerHour: 7200 }, hasKey: false,
  });
  assert.equal(prompt.canStart, false);
  assert.match(prompt.action, /settings/i);
});

test("a video over the per-window allowance is flagged as needing several runs", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 9000, estimatedUsd: 0.1, provider: "Groq",
    freeTier: { secondsPerHour: 7200 }, hasKey: true,
  });
  // 9000 seconds exceeds the 7200-second hourly ceiling
  assert.match(prompt.warning, /two or more runs|exceeds|longer than/i);
  assert.equal(prompt.canStart, true, "over-quota should still be allowed to start, just in stages");
});

test("no percentage is shown, or invented, when a provider publishes no allowance", () => {
  const prompt = panel.buildPrompt({
    durationSeconds: 600, estimatedUsd: 0.06, provider: "OpenAI Whisper",
    freeTier: null, hasKey: true,
  });
  assert.doesNotMatch(prompt.summary, /%/);
  assert.match(prompt.summary, /\$0\.06/);
});

test("progress copy shows chunks finished and how much is readable", () => {
  const text = panel.buildProgress({ completed: 3, total: 8, chunkSeconds: 300 });
  assert.match(text, /3\s*\/\s*8/);
  assert.match(text, /15:00/);
});

test("a rate limit reports progress, the wait, and that it can resume", () => {
  const state = panel.buildRateLimited({
    completed: 12, total: 25, chunkSeconds: 300, retryAfterSeconds: 2046,
  });
  assert.match(state.message, /12\s*\/\s*25/);
  assert.match(state.message, /34/, "was not converted to minutes");
  assert.equal(state.canResume, true);
});

test("the side panel has the AI captions entry point", () => {
  const html = read("sidepanel.html");
  assert.match(html, /id="aiCaptionPrompt"/);
  assert.match(html, /id="aiCaptionBtn"/);
  assert.match(html, /id="aiCaptionStatus"/);
});

test("the side panel loads the caption-prompt module it uses", () => {
  const html = read("sidepanel.html");
  const modAt = html.indexOf('src="asr/caption-prompt.js"');
  const panelAt = html.indexOf('src="sidepanel.js"');
  assert.notEqual(modAt, -1, "sidepanel.html does not load caption-prompt.js");
  assert.ok(modAt < panelAt, "the module must come before sidepanel.js");
});

test("caption-prompt is in the release allowlist", () => {
  assert.match(read("scripts/check-release.sh"), /asr\/caption-prompt\.js/);
});

test("showState knows the aiCaptions state, or the panel never appears", () => {
  assert.match(read("sidepanel.js"), /state === "aiCaptions"/);
});

test("fetchTranscript passes tabId, or the three layers collapse to one", () => {
  // Without a tabId the worker cannot read player info from the page and
  // falls straight back to Supadata
  assert.match(read("sidepanel.js"), /action: "fetchTranscript"[\s\S]{0,120}tabId/);
});

test("auto-start still shows cost and allowance first, it just skips the click", () => {
  const panelSource = read("sidepanel.js");
  // The auto-start call must come after the cost copy is written, or the
  // user never sees what it costs
  const summaryAt = panelSource.indexOf('getElementById("aiCaptionSummary")');
  const autoAt = panelSource.indexOf("info.autoStart");
  assert.notEqual(autoAt, -1, "auto-start is not implemented");
  assert.ok(summaryAt < autoAt, "auto-start must not run before the cost is shown");
});

test("auto-start does nothing when no key is configured", () => {
  const panelSource = read("sidepanel.js");
  assert.match(
    panelSource,
    /prompt\.canStart\s*&&\s*info\.autoStart/,
    "auto-start must also require canStart, or it repeatedly triggers a doomed action",
  );
});
