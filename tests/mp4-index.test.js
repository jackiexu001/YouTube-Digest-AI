const test = require("node:test");
const assert = require("node:assert/strict");

const mp4 = require("../asr/mp4-index.js");
const fixture = require("./fixtures/audio-init-segment.js");

const initBytes = () => {
  const buf = fixture.initSegment();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

test("reads fragment count, duration and byte total from a real init segment", () => {
  const index = mp4.parseInitSegment(initBytes());

  assert.equal(index.fragments.length, fixture.EXPECTED.fragmentCount);
  assert.equal(index.timescale, fixture.EXPECTED.timescale);
  assert.equal(index.totalBytes, fixture.EXPECTED.totalBytes);
  assert.ok(
    Math.abs(index.totalSeconds - fixture.EXPECTED.totalSeconds) < 0.01,
    `duration ${index.totalSeconds} does not match the real ${fixture.EXPECTED.totalSeconds}`,
  );
});

test("the init segment length is where the first fragment starts", () => {
  const index = mp4.parseInitSegment(initBytes());
  assert.equal(index.initLength, fixture.EXPECTED.initLength);
  assert.equal(index.fragments[0].start, fixture.EXPECTED.initLength);
});

test("fragments meet end to end, with no gaps and no overlap", () => {
  const { fragments } = mp4.parseInitSegment(initBytes());
  for (let i = 1; i < fragments.length; i++) {
    assert.equal(
      fragments[i].start,
      fragments[i - 1].end + 1,
      `fragment ${i} does not start where the previous one ended`,
    );
    assert.ok(
      fragments[i].startTime > fragments[i - 1].startTime,
      `fragment ${i} does not advance in time`,
    );
  }
});

test("selects the byte range for a time window", () => {
  const index = mp4.parseInitSegment(initBytes());
  const window = mp4.selectWindow(index, { startSeconds: 60, durationSeconds: 120 });

  // The selected fragments must cover the requested window
  assert.ok(window.startTime <= 60, "window starts after the requested 60s, clipping the opening words");
  assert.ok(window.endTime >= 180, "window ends before the requested 180s, clipping the closing words");
  assert.ok(window.byteStart >= index.initLength, "the byte range should not reach into the init segment");
  assert.ok(window.byteEnd > window.byteStart);
  assert.ok(window.fragmentCount > 0);
});

test("a window past the end clamps to the last fragment instead of overrunning", () => {
  const index = mp4.parseInitSegment(initBytes());
  const window = mp4.selectWindow(index, { startSeconds: 850, durationSeconds: 300 });

  assert.equal(window.byteEnd, index.totalBytes - 1);
  assert.ok(window.endTime <= index.totalSeconds + 0.01);
});

test("a start beyond the video returns an empty window rather than throwing", () => {
  const index = mp4.parseInitSegment(initBytes());
  const window = mp4.selectWindow(index, { startSeconds: 9999, durationSeconds: 60 });
  assert.equal(window.fragmentCount, 0);
});

test("splits the whole video into fixed-length chunks that overlap", () => {
  const index = mp4.parseInitSegment(initBytes());
  const chunks = mp4.planChunks(index, { chunkSeconds: 300, overlapSeconds: 10 });

  // 856 seconds at 300 per chunk gives 3 chunks
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].startTime, 0);

  for (let i = 1; i < chunks.length; i++) {
    // Each chunk reaches back a little so words at the seam survive
    assert.ok(
      chunks[i].startTime < chunks[i - 1].endTime,
      `chunk ${i} does not overlap the previous one`,
    );
  }
  // The final chunk must reach the end of the video
  assert.ok(chunks[chunks.length - 1].endTime >= index.totalSeconds - 0.01);
});

test("a non-fragmented MP4 raises a clear error instead of an empty index that looks like success", () => {
  const notMp4 = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]).buffer;
  assert.throws(() => mp4.parseInitSegment(notMp4), /sidx|MP4/i);
});

/**
 * Builds a minimal init segment. In the real sample firstOffset happens to
 * be 0 and every reference_type bit happens to be 0, so those two branches
 * never execute; only a synthetic sample can cover them.
 */
function buildInitSegment({ firstOffset = 0, references }) {
  const refBytes = references.length * 12;
  const sidxSize = 32 + refBytes;
  const ftypSize = 16;
  const moovSize = 16;
  const total = ftypSize + moovSize + sidxSize;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const tag = (o, t) => { for (let i = 0; i < 4; i++) view.setUint8(o + i, t.charCodeAt(i)); };

  view.setUint32(0, ftypSize); tag(4, "ftyp");
  view.setUint32(ftypSize, moovSize); tag(ftypSize + 4, "moov");

  let p = ftypSize + moovSize;
  const sidxAt = p;
  view.setUint32(p, sidxSize); tag(p + 4, "sidx"); p += 8;
  view.setUint32(p, 0); p += 4;              // version 0 + flags
  view.setUint32(p, 1); p += 4;              // reference_ID
  view.setUint32(p, 1000); p += 4;           // timescale
  view.setUint32(p, 0); p += 4;              // earliest_presentation_time
  view.setUint32(p, firstOffset); p += 4;    // first_offset
  view.setUint16(p, 0); p += 2;              // reserved
  view.setUint16(p, references.length); p += 2;
  for (const ref of references) {
    // Top bit is reference_type: 1 points at another index, not media
    view.setUint32(p, ((ref.type || 0) << 31) | ref.size); p += 4;
    view.setUint32(p, ref.duration); p += 4;
    view.setUint32(p, 0); p += 4;            // SAP
  }
  return { buffer: buf, sidxEnd: sidxAt + sidxSize };
}

test("a non-zero first_offset shifts where fragments start", () => {
  const { buffer, sidxEnd } = buildInitSegment({
    firstOffset: 500,
    references: [{ size: 1000, duration: 2000 }],
  });
  const index = mp4.parseInitSegment(buffer);
  // start = end of sidx + first_offset; ignoring it shifts every byte range
  assert.equal(index.fragments[0].start, sidxEnd + 500);
});

test("the reference_type bit is not counted as part of the fragment size", () => {
  const { buffer } = buildInitSegment({
    references: [
      { size: 1000, duration: 1000 },
      { size: 2000, duration: 1000, type: 1 },
    ],
  });
  const index = mp4.parseInitSegment(buffer);
  // The top bit is a flag; unmasked the size becomes an absurd 2147485648
  assert.equal(index.fragments[1].end - index.fragments[1].start + 1, 2000);
  assert.ok(index.totalBytes < 10000, `total bytes ${index.totalBytes} is clearly wrong`);
});
