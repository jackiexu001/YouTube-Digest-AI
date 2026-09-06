const test = require("node:test");
const assert = require("node:assert/strict");

const fetcher = require("../asr/fetcher.js");

test("字节范围切成若干份，首尾相接不重不漏", () => {
  const parts = fetcher.splitRange(100, 999, 4);

  assert.equal(parts.length, 4);
  assert.equal(parts[0].start, 100);
  assert.equal(parts[parts.length - 1].end, 999);
  for (let i = 1; i < parts.length; i++) {
    assert.equal(parts[i].start, parts[i - 1].end + 1, `第 ${i} 份和上一份之间有缝`);
  }
  const covered = parts.reduce((n, p) => n + (p.end - p.start + 1), 0);
  assert.equal(covered, 900, "覆盖的字节总数与请求的范围不符");
});

test("范围比份数还小时不会产生空份", () => {
  const parts = fetcher.splitRange(0, 2, 8);
  assert.equal(parts.length, 3);
  for (const part of parts) {
    assert.ok(part.end >= part.start, "出现了空的或倒置的范围");
  }
});

test("单字节范围也能处理", () => {
  const parts = fetcher.splitRange(5, 5, 4);
  assert.deepEqual(parts, [{ start: 5, end: 5 }]);
});

test("分段请求带上正确的 Range 头", async () => {
  const seen = [];
  await fetcher.fetchRange("https://example.com/a", 10, 20, {
    fetchImpl: async (url, init) => {
      seen.push(init.headers.Range);
      return { ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(11) };
    },
  });
  assert.deepEqual(seen, ["bytes=10-20"]);
});

test("并行下载后按顺序拼回原样，不会因为完成顺序而错位", async () => {
  // 故意让后面的分片先返回，模拟真实的乱序完成
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
    assert.equal(bytes[i], i % 251, `第 ${i} 个字节错位了`);
  }
});

test("任何一份失败就整体失败，不返回残缺的数据", async () => {
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

test("init 段与片段字节拼成完整可解码的切片", () => {
  const init = new Uint8Array([1, 2, 3]);
  const body = new Uint8Array([4, 5]);
  const chunk = fetcher.assembleChunk(init, body);
  assert.deepEqual([...chunk], [1, 2, 3, 4, 5]);
});

test("并发数至少为 1，传 0 或负数不会导致死循环", async () => {
  const result = await fetcher.fetchRangeParallel("https://x", 0, 9, {
    concurrency: 0,
    fetchImpl: async () => ({ ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(10) }),
  });
  assert.equal(result.byteLength, 10);
});

test("范围不能整除时，尾部字节不会被漏掉", () => {
  // 1000 字节分 3 份除不尽。向下取整会漏掉最后一个字节，
  // 音频少一字节就可能解码失败
  const parts = fetcher.splitRange(0, 999, 3);
  const covered = parts.reduce((n, p) => n + (p.end - p.start + 1), 0);
  assert.equal(covered, 1000, "覆盖的字节数少于请求的范围");
  assert.equal(parts[parts.length - 1].end, 999);
});

test("最后一份不会超出请求的范围", () => {
  // 越界的 Range 请求会被服务器拒绝，或者拿回不属于本段的数据
  for (const [start, end, n] of [[0, 999, 3], [0, 10, 4], [100, 217, 7], [0, 5, 4]]) {
    const parts = fetcher.splitRange(start, end, n);
    assert.equal(parts[parts.length - 1].end, end, `${start}-${end} 分 ${n} 份时末尾越界或不足`);
    assert.equal(parts[0].start, start);
    for (const part of parts) {
      assert.ok(part.end <= end, `出现越界的分片 ${part.start}-${part.end}`);
    }
    // 分片数不能超过请求的并发数，否则实际发出的请求比约定的多
    assert.ok(parts.length <= n, `${start}-${end} 分 ${n} 份却切出了 ${parts.length} 份`);
  }
});

test("并发数为 0、负数或非数字时都退回到 1 份", () => {
  for (const bad of [0, -5, NaN, undefined, null]) {
    const parts = fetcher.splitRange(0, 99, bad);
    assert.ok(parts.length >= 1, `并发数 ${bad} 时没有产生分片`);
    assert.equal(parts[0].start, 0);
    assert.equal(parts[parts.length - 1].end, 99);
  }
});
