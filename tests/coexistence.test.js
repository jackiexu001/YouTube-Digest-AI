const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (n) => fs.readFileSync(path.join(__dirname, "..", n), "utf8");

// Element ids upstream (zarazhangrui/youtube-digest) injects into the page.
// This fork must not reuse them.
//
// Both extensions watch document.body for mutations and both remove any
// button that is not the one they created. Sharing an id therefore makes them
// tear down and re-inject each other's buttons without end, which freezes the
// YouTube tab for anyone who has both installed.
const UPSTREAM_IDS = ["ytd-digest-button", "ytd-note-button", "ytd-note-toast"];

test("injected element ids do not collide with the upstream extension", () => {
  const content = read("content.js");
  for (const id of UPSTREAM_IDS) {
    assert.ok(
      !content.includes(`"${id}"`),
      `content.js still uses "${id}", which upstream also injects; ` +
        "with both extensions installed each keeps deleting the other's button",
    );
  }
});

test("our own injected ids are namespaced to this fork", () => {
  const content = read("content.js");
  const ids = [...content.matchAll(/getElementById\("([^"]+)"\)|\.id = "([^"]+)"|querySelectorAll\("#([^"]+)"\)/g)]
    .map((m) => m[1] || m[2] || m[3])
    .filter(Boolean);
  const injected = ids.filter((id) => id.startsWith("ytd") || id.includes("digest") || id.includes("note"));
  assert.ok(injected.length > 0, "no injected ids found, the check would be vacuous");
  for (const id of injected) {
    assert.match(
      id,
      /^ytda-/,
      `injected id "${id}" is not namespaced; use the ytda- prefix so both extensions can coexist`,
    );
  }
});

test("the keyboard shortcut does not silently fight upstream's", () => {
  const content = read("content.js");
  // Upstream binds "n" and calls preventDefault plus stopPropagation. With both
  // installed the shortcut fires twice and saves two notes, so ours must not
  // swallow the event for the other extension.
  const handler = content.slice(content.indexOf("function handleNoteKeyboardShortcut"));
  const body = handler.slice(0, handler.indexOf("\n}"));
  assert.match(
    body,
    /ytdaNoteShortcutGuard|dataset\.ytdaNoteHandled|__YTDA_NOTE_HANDLED__/,
    "the note shortcut has no guard against the same keypress being handled twice",
  );
});
