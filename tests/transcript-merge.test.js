const test = require("node:test");
const assert = require("node:assert/strict");

const merge = require("../asr/merge.js");

test("applies each chunk's time offset to its segments", () => {
  const shifted = merge.offsetSegments(
    [{ start: 0, end: 2, text: "first line" }, { start: 2, end: 4, text: "second line" }],
    300,
  );
  assert.deepEqual(shifted, [
    { start: 300, end: 302, text: "first line" },
    { start: 302, end: 304, text: "second line" },
  ]);
});

test("blank segments are dropped instead of leaving empty lines", () => {
  const shifted = merge.offsetSegments(
    [{ start: 0, end: 1, text: "  " }, { start: 1, end: 2, text: "has content" }],
    0,
  );
  assert.equal(shifted.length, 1);
  assert.equal(shifted[0].text, "has content");
});

test("splits at the overlap midpoint to remove seam duplicates", () => {
  // The chunks overlap over 100-110s and both transcribed the same line
  const merged = merge.mergeChunks([
    { offset: 0, segments: [
      { start: 95, end: 99, text: "before overlap" },
      { start: 103, end: 106, text: "later in overlap" },
    ]},
    { offset: 100, segments: [
      { start: 2, end: 5, text: "earlier in overlap" },
      { start: 12, end: 15, text: "after overlap" },
    ]},
  ]);

  const texts = merged.map((s) => s.text);
  assert.deepEqual(texts, ["before overlap", "later in overlap", "after overlap"]);
});

test("merged timestamps increase strictly and never go backwards", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [{ start: 0, end: 5, text: "A" }, { start: 290, end: 299, text: "B" }] },
    { offset: 290, segments: [{ start: 0, end: 9, text: "B repeated" }, { start: 20, end: 25, text: "C" }] },
  ]);

  for (let i = 1; i < merged.length; i++) {
    assert.ok(
      merged[i].start >= merged[i - 1].start,
      `caption ${i} starts before the previous one, making the player jump`,
    );
  }
});

test("adjacent segments with identical text collapse to one", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [
      { start: 10, end: 12, text: "same line" },
      { start: 12, end: 14, text: "same line" },
    ]},
  ]);
  assert.equal(merged.length, 1);
});

test("a single chunk passes through unchanged", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [{ start: 1, end: 2, text: "A" }, { start: 3, end: 4, text: "B" }] },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].start, 1);
});

test("when a chunk fails, its neighbour must not discard the overlap and leave a hole", () => {
  // Offsets match what planChunks produces: later chunks reach back 10s
  const merged = merge.mergeChunks([
    { offset: 0, segments: [{ start: 1, end: 2, text: "A" }] },
    { offset: 290, segments: [] },
    { offset: 590, segments: [{ start: 1, end: 2, text: "C" }] },
  ]);

  // "C" sits in the overlap that the previous chunk would own, but that
  // chunk is empty, so trimming as usual would leave the line unclaimed
  assert.deepEqual(merged.map((s) => s.text), ["A", "C"]);
  assert.equal(merged[1].start, 591);
});

test("no segments at all returns an empty array rather than throwing", () => {
  assert.deepEqual(merge.mergeChunks([]), []);
});

test("chunks passed out of order still come back in time order", () => {
  // With two workers the later chunk can finish before the earlier one
  const merged = merge.mergeChunks([
    { offset: 590, segments: [{ start: 1, end: 2, text: "later line" }] },
    { offset: 0, segments: [{ start: 1, end: 2, text: "earlier line" }] },
  ]);

  assert.deepEqual(merged.map((s) => s.text), ["earlier line", "later line"]);
  assert.ok(merged[0].start < merged[1].start);
});

test("segments unordered within one chunk are sorted too", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [
      { start: 10, end: 12, text: "second" },
      { start: 1, end: 3, text: "first" },
    ]},
  ]);
  assert.deepEqual(merged.map((s) => s.text), ["first", "second"]);
});
