const test = require("node:test");
const assert = require("node:assert/strict");

const fetcher = require("../asr/fetcher.js");

test("a byte range splits into parts that meet end to end", () => {
  const parts = fetcher.splitRange(100, 999, 4);

  assert.equal(parts.length, 4);
  assert.equal(parts[0].start, 100);
  assert.equal(parts[parts.length - 1].end, 999);
  for (let i = 1; i < parts.length; i++) {
    assert.equal(parts[i].start, parts[i - 1].end + 1, `part ${i} leaves a gap after the previous one`);
  }
  const covered = parts.reduce((n, p) => n + (p.end - p.start + 1), 0);
  assert.equal(covered, 900, "covered byte count does not match the requested range");
});

test("a range smaller than the part count produces no empty parts", () => {
  const parts = fetcher.splitRange(0, 2, 8);
  assert.equal(parts.length, 3);
  for (const part of parts) {
    assert.ok(part.end >= part.start, "produced an empty or inverted range");
  }
});

test("a single-byte range works", () => {
  const parts = fetcher.splitRange(5, 5, 4);
  assert.deepEqual(parts, [{ start: 5, end: 5 }]);
});

test("ranged requests carry the correct Range header", async () => {
  const seen = [];
  await fetcher.fetchRange("https://example.com/a", 10, 20, {
    fetchImpl: async (url, init) => {
      seen.push(init.headers.Range);
      return { ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(11) };
    },
  });
  assert.deepEqual(seen, ["bytes=10-20"]);
});

test("parallel parts reassemble in order regardless of completion order", async () => {
  // Deliberately return later parts first to mimic real out-of-order completion
  const fetchImpl = async (url, init) => {
    const [start, end] = init.headers.Range.replace("bytes=", "").split("-").map(Number);
    const size = end - start + 1;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (start + i) % 251;
    const delay = start === 0 ? 20 : 0;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { ok: true, status: 206, arrayBuffer: async () => bytes.buffer };
  };

  const result = await fetcher.fetchRangeParallel("https://example.com/a", 0, 999, {
    concurrency: 4,
    fetchImpl,
  });

  assert.equal(result.byteLength, 1000);
  const bytes = new Uint8Array(result);
  for (let i = 0; i < 1000; i++) {
    assert.equal(bytes[i], i % 251, `byte ${i} is out of place`);
  }
});

test("any failed part fails the whole request rather than returning partial data", async () => {
  const fetchImpl = async (url, init) => {
    if (init.headers.Range.startsWith("bytes=500")) {
      return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(500) };
  };

  await assert.rejects(
    () => fetcher.fetchRangeParallel("https://example.com/a", 0, 999, { concurrency: 2, fetchImpl }),
    /503/,
  );
});

test("init segment and fragment bytes assemble into a decodable slice", () => {
  const init = new Uint8Array([1, 2, 3]);
  const body = new Uint8Array([4, 5]);
  const chunk = fetcher.assembleChunk(init, body);
  assert.deepEqual([...chunk], [1, 2, 3, 4, 5]);
});

test("concurrency is at least 1, so 0 or a negative value cannot loop forever", async () => {
  const result = await fetcher.fetchRangeParallel("https://x", 0, 9, {
    concurrency: 0,
    fetchImpl: async () => ({ ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(10) }),
  });
  assert.equal(result.byteLength, 10);
});

test("an indivisible range does not drop its trailing bytes", () => {
  // 1000 bytes over 3 parts does not divide evenly. Rounding down loses the
  // last byte, and audio missing one byte can fail to decode
  const parts = fetcher.splitRange(0, 999, 3);
  const covered = parts.reduce((n, p) => n + (p.end - p.start + 1), 0);
  assert.equal(covered, 1000, "covered fewer bytes than the requested range");
  assert.equal(parts[parts.length - 1].end, 999);
});

test("the last part never exceeds the requested range", () => {
  // An out-of-range request is refused, or returns data from another part
  for (const [start, end, n] of [[0, 999, 3], [0, 10, 4], [100, 217, 7], [0, 5, 4]]) {
    const parts = fetcher.splitRange(start, end, n);
    assert.equal(parts[parts.length - 1].end, end, `${start}-${end} over ${n} parts ends short or overruns`);
    assert.equal(parts[0].start, start);
    for (const part of parts) {
      assert.ok(part.end <= end, `part ${part.start}-${part.end} is out of range`);
    }
    // Part count must not exceed the requested concurrency, or more
    // requests go out than agreed
    assert.ok(parts.length <= n, `${start}-${end} over ${n} parts produced ${parts.length}`);
  }
});

test("a concurrency of 0, negative or non-numeric falls back to one part", () => {
  for (const bad of [0, -5, NaN, undefined, null]) {
    const parts = fetcher.splitRange(0, 99, bad);
    assert.ok(parts.length >= 1, `concurrency ${bad} produced no parts`);
    assert.equal(parts[0].start, 0);
    assert.equal(parts[parts.length - 1].end, 99);
  }
});
