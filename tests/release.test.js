const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("manifest uses minimized install-time permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(manifest.options_ui.page, "options.html");
  assert.ok(!manifest.permissions.includes("activeTab"));
  assert.ok(manifest.host_permissions.includes("https://api.deepseek.com/*"));
  // Install-time permissions must name concrete hosts, never a wildcard
  for (const host of manifest.host_permissions) {
    assert.doesNotMatch(host, /^https:\/\/\*/, `install-time permission must not use a wildcard host: ${host}`);
  }
  // A custom provider's URL is unknown ahead of time, so it can only be
  // requested at runtime through optional permissions. Upstream forbade this
  // entry because it had no custom provider; we support one, so the rule
  // becomes: https only, and nothing granted at install time.
  for (const host of manifest.optional_host_permissions || []) {
    assert.match(host, /^https:\/\//, `optional permission must be https: ${host}`);
  }
    // Two headline features over upstream: multiple providers and AI captions.
  // The version also separates this fork from upstream's numbering
  assert.equal(manifest.version, "2.0.1");
});

test("release copy documents current scope without em dashes", () => {
  const readme = read("README.md");
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));

  assert.doesNotMatch(readme, /—/);
  assert.match(readme, /^# YouTube Digest AI$/m);
  assert.match(
    readme,
    /Turn every YouTube video into a resource for deep learning\./,
  );
  assert.doesNotMatch(readme, /before deciding how much of it to watch/i);
  assert.match(readme, /^## Install with your coding agent$/m);
  assert.match(
    readme,
    /permanent folder I choose[\s\S]*tell me its exact full path[\s\S]*If I need a suggestion during this first installation[\s\S]*`~\/Documents\/youtube-digest`[\s\S]*`%USERPROFILE%\\Documents\\youtube-digest`[\s\S]*do not assume either path/,
  );
  assert.match(
    readme,
    /Moving or deleting the source folder breaks the unpacked extension until you load it again from the new location\./,
  );
  assert.match(
    readme,
    /selecting the exact project folder you chose in Chrome with \*\*Load unpacked\*\*/,
  );
  assert.match(
    readme,
    /Select the exact project folder you chose, which must contain `manifest\.json`/,
  );
  assert.match(readme, /upstream issues and pull requests are not accepted/i);
  assert.doesNotMatch(readme, /^## Contributing$/m);

  const optionsPage = read("options.html");
  const optionsStyles = read("options.css");
  const optionsScript = read("options.js");
  assert.match(optionsPage, /dash\.supadata\.ai\/auth\/sign-up/i);
  // The key-creation link now follows the selected provider instead of being
  // hardcoded in the page; providers.js supplies them and providers.test.js
  // asserts them.
  assert.doesNotMatch(optionsPage, /platform\.deepseek\.com\/api_keys/i);
  // Opposite product direction from upstream, which deliberately supported
  // one provider; we offer a selector
  assert.match(optionsPage, /<select[^>]+id="provider"/);
  assert.match(optionsPage, /id="aiBaseUrl"/);
  assert.match(optionsPage, /id="aiModel"/);
  assert.match(optionsStyles, /\.data-card\s*\{[^}]*margin-top:\s*36px;/);
  assert.match(optionsScript, /migration\.migrated[\s\S]*storage\.set/);

  assert.match(readme, /^## Remix it with your coding agent$/m);
  assert.match(readme, /more translation languages/i);
  assert.match(readme, /customized summary templates/i);
  assert.match(readme, /vocabulary notebook/i);
  assert.match(
    readme,
    /first open the exact YouTube Digest project folder that Chrome loaded through \*\*Load unpacked\*\* in your coding agent/,
  );

  const publishedDocs = [
    readme,
    read("PRIVACY.md"),
    read("SECURITY.md"),
  ].join("\n");
  // Opposite direction from upstream, whose docs deliberately never mention
  // switching providers. We support several, so the docs must say plainly
  // that data goes to whichever one the user picked.
  const privacy = read("PRIVACY.md");

  // The privacy doc can no longer claim DeepSeek is the only destination;
  // that is false and misleads the reader
  assert.doesNotMatch(
    privacy,
    /only AI provider/i,
    "the privacy doc still claims a single AI provider",
  );
  // Every provider that may receive data must be listed
  for (const name of ["OpenAI", "Anthropic", "Gemini", "DeepSeek"]) {
    assert.match(privacy, new RegExp(name), `the privacy doc does not mention ${name}`);
  }
  // A custom provider sends data to whatever address the user typed, which
  // has to be stated
  assert.match(privacy, /custom/i);
  // Runtime-requested optional permissions must be explained too
  assert.match(privacy, /optional_host_permissions|optional host/i);
  // The removed hand-it-to-a-coding-agent flow should be gone from the docs
  assert.doesNotMatch(privacy, /coding-agent prompt|coding agent prompt/i);

  // The README likewise must not claim a single provider, or tell the user
  // to edit code to switch models
  for (const [name, doc] of [["README.md", readme]]) {
    assert.doesNotMatch(doc, /only AI provider/i, `${name} still claims a single AI provider`);
    assert.doesNotMatch(doc, /supports DeepSeek V4 Flash as its only/, `${name} still claims DeepSeek-only support`);
    assert.doesNotMatch(
      doc,
      /require a local code adaptation/,
      `${name} still tells the user to edit code to switch providers`,
    );
    assert.doesNotMatch(
      doc,
      /no Base URL or Model fields/i,
      `${name} still says there is no model or URL to configure`,
    );
  }

  // SECURITY.md's list of network destinations must cover every provider,
  // or the security promise is wrong
  const security = read("SECURITY.md");
  assert.doesNotMatch(
    security,
    /YouTube, Supadata, and DeepSeek hosts/i,
    "SECURITY.md's destination list has not kept up with multiple providers",
  );
});

test("product UI contains no emoji or emoji-like pictographs", () => {
  const productUi = [
    read("sidepanel.html"),
    read("sidepanel.js"),
    read("content.js"),
    read("options.html"),
    read("options.js"),
  ].join("\n");

  assert.doesNotMatch(
    productUi,
    /\p{Extended_Pictographic}|[✓✕⧉▶]/u,
  );
  assert.doesNotMatch(productUi, /&#(?:9655|9888);/);
});

test("selection actions use two equal edge-to-edge hover areas", () => {
  const css = read("sidepanel.css");

  assert.match(
    css,
    /\.explain-tooltip\s*\{[^}]*padding:\s*0;[^}]*overflow:\s*hidden;/,
  );
  assert.match(
    css,
    /\.explain-btn,\s*\.selection-note-btn\s*\{[^}]*flex:\s*1 1 50%;[^}]*border-radius:\s*0;/,
  );
  assert.match(
    css,
    /\.explain-tooltip\s*\{[^}]*animation:\s*selectionToolbarIn/,
  );
  assert.match(
    css,
    /@keyframes selectionToolbarIn\s*\{[\s\S]*transform:\s*translate\(-50%, 4px\);[\s\S]*transform:\s*translate\(-50%, 0\);/,
  );
});

test("note delete is an accessible SVG action at the end of the action row", () => {
  const js = read("sidepanel.js");
  const css = read("sidepanel.css");

  assert.match(
    js,
    /<div class="note-actions">[\s\S]*class="[^"]*note-play[^"]*"[\s\S]*class="note-delete"[\s\S]*aria-label="Delete note"[\s\S]*<svg viewBox="0 0 24 24" aria-hidden="true">/,
  );
  assert.doesNotMatch(js, /class="note-delete"[^>]*>Delete<\/button>/);
  assert.match(
    css,
    /\.note-delete\s*\{[^}]*place-items:\s*center;[^}]*margin-left:\s*auto;/,
  );
  assert.match(css, /\.note-delete:focus-visible\s*\{[^}]*outline:/);
});

test("notes filters preserve selected contrast and expose pressed state", () => {
  const html = read("sidepanel.html");
  const css = read("sidepanel.css");
  const js = read("sidepanel.js");

  assert.match(
    html,
    /id="notesFilterThis"[\s\S]*?aria-pressed="true"[\s\S]*?>[\s\S]*?This Video/,
  );
  assert.match(
    html,
    /id="notesFilterAll"[\s\S]*?aria-pressed="false"[\s\S]*?>[\s\S]*?All Notes/,
  );
  assert.match(
    css,
    /\.notes-filter \.enhance-btn\.active:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--accent-hover\);[^}]*color:\s*white;/,
  );
  assert.match(
    css,
    /\.notes-filter \.enhance-btn:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-secondary\);/,
  );
  assert.match(css, /\.notes-filter \.enhance-btn:focus-visible\s*\{[^}]*outline:/);
  assert.match(js, /setNotesFilter\(false\)/);
  assert.match(js, /setNotesFilter\(true\)/);
  assert.match(js, /setAttribute\("aria-pressed", String\(!showAll\)\)/);
  assert.match(js, /setAttribute\("aria-pressed", String\(showAll\)\)/);
});

test("runtime has no source-file credential dependency or retired model", () => {
  const runtime = [
    "background.js",
    "content.js",
    "sidepanel.js",
    "options.js",
    "settings.js",
    "providers.js",
  ]
    .map(read)
    .join("\n");

  assert.doesNotMatch(runtime, /\bCONFIG\./);
  assert.doesNotMatch(runtime, /importScripts\(["']config\.js/);
  assert.doesNotMatch(runtime, /\bdeepseek-chat\b/);
  assert.match(runtime, /deepseek-v4-flash/);
});

test("background reconciles side-panel state after navigation commits", () => {
  const background = read("background.js");

  assert.match(
    background,
    /function getNavigationUrl\(changeInfo, tab\)[\s\S]*changeInfo\.status !== "loading"[\s\S]*changeInfo\.status !== "complete"[\s\S]*tab\.pendingUrl \|\| tab\.url/,
  );
  assert.match(
    background,
    /chrome\.tabs\.onUpdated\.addListener\(\(tabId, changeInfo, tab\)[\s\S]*getNavigationUrl\(changeInfo, tab\)[\s\S]*updatePanelForTab\(tabId, url, tab\.windowId\)/,
  );
  assert.match(
    background,
    /function closePanelForTab\(tabId, windowId\)[\s\S]*chrome\.sidePanel\.close\(\{ tabId \}\)[\s\S]*chrome\.sidePanel\.close\(\{ windowId \}\)/,
  );
  assert.match(
    background,
    /await closePanelForTab\(tabId, windowId\);[\s\S]*setOptions\(\{ tabId, enabled: false \}\)/,
  );
});

test("retired Remix and reader files are absent", () => {
  for (const file of [
    "reader.html",
    "reader.js",
    "remix-prompts.js",
    "config.example.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});

test("published prompt files contain runtime sections", () => {
  const expectedSections = {
    "prompts/analysis.md": ["System prompt", "User prompt"],
    "prompts/explain.md": ["System prompt", "User prompt"],
    "prompts/note-cleanup.md": ["System prompt", "User prompt"],
    "prompts/translation.md": [
      "Shared base rules",
      "Chinese rules",
      "Transcript batch translation",
    ],
  };

  for (const [file, sections] of Object.entries(expectedSections)) {
    const markdown = read(file);
    for (const section of sections) {
      assert.match(markdown, new RegExp(`^## ${section}$`, "m"));
    }
  }
});
