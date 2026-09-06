const test = require("node:test");
const assert = require("node:assert/strict");

const mp4 = require("../asr/mp4-index.js");
const fixture = require("./fixtures/audio-init-segment.js");

const initBytes = () => {
  const buf = fixture.initSegment();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

test("从真实音频的 init 段读出片段总数、总时长和总字节", () => {
  const index = mp4.parseInitSegment(initBytes());

  assert.equal(index.fragments.length, fixture.EXPECTED.fragmentCount);
  assert.equal(index.timescale, fixture.EXPECTED.timescale);
  assert.equal(index.totalBytes, fixture.EXPECTED.totalBytes);
  assert.ok(
    Math.abs(index.totalSeconds - fixture.EXPECTED.totalSeconds) < 0.01,
    `总时长 ${index.totalSeconds} 与真实值 ${fixture.EXPECTED.totalSeconds} 不符`,
  );
});

test("init 段的长度就是第一个片段的起始字节", () => {
  const index = mp4.parseInitSegment(initBytes());
  assert.equal(index.initLength, fixture.EXPECTED.initLength);
  assert.equal(index.fragments[0].start, fixture.EXPECTED.initLength);
});

test("片段首尾相接，没有空洞也没有重叠", () => {
  const { fragments } = mp4.parseInitSegment(initBytes());
  for (let i = 1; i < fragments.length; i++) {
    assert.equal(
      fragments[i].start,
      fragments[i - 1].end + 1,
      `第 ${i} 个片段的起点和上一个的终点对不上`,
    );
    assert.ok(
      fragments[i].startTime > fragments[i - 1].startTime,
      `第 ${i} 个片段的时间没有递增`,
    );
  }
});

test("按时间窗口挑出对应的字节范围", () => {
  const index = mp4.parseInitSegment(initBytes());
  const window = mp4.selectWindow(index, { startSeconds: 60, durationSeconds: 120 });

  // 命中的片段必须覆盖住请求的时间窗
  assert.ok(window.startTime <= 60, "窗口起点晚于请求的 60 秒，开头会丢字");
  assert.ok(window.endTime >= 180, "窗口终点早于请求的 180 秒，结尾会丢字");
  assert.ok(window.byteStart >= index.initLength, "字节范围不该落进 init 段");
  assert.ok(window.byteEnd > window.byteStart);
  assert.ok(window.fragmentCount > 0);
});

test("窗口超出视频末尾时收敛到最后一个片段，不越界", () => {
  const index = mp4.parseInitSegment(initBytes());
  const window = mp4.selectWindow(index, { startSeconds: 850, durationSeconds: 300 });

  assert.equal(window.byteEnd, index.totalBytes - 1);
  assert.ok(window.endTime <= index.totalSeconds + 0.01);
});

test("起点超过视频长度时返回空窗口，而不是抛错", () => {
  const index = mp4.parseInitSegment(initBytes());
  const window = mp4.selectWindow(index, { startSeconds: 9999, durationSeconds: 60 });
  assert.equal(window.fragmentCount, 0);
});

test("按固定时长切分整个视频，段间带重叠", () => {
  const index = mp4.parseInitSegment(initBytes());
  const chunks = mp4.planChunks(index, { chunkSeconds: 300, overlapSeconds: 10 });

  // 856 秒按 300 秒切 → 3 段
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].startTime, 0);

  for (let i = 1; i < chunks.length; i++) {
    // 后一段要往前多取一点，避免切口处的字被切碎
    assert.ok(
      chunks[i].startTime < chunks[i - 1].endTime,
      `第 ${i} 段与上一段之间没有重叠`,
    );
  }
  // 最后一段必须盖到视频结尾
  assert.ok(chunks[chunks.length - 1].endTime >= index.totalSeconds - 0.01);
});

test("不是分片 MP4 时明确报错，而不是返回一个空索引让上层误以为成功", () => {
  const notMp4 = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]).buffer;
  assert.throws(() => mp4.parseInitSegment(notMp4), /sidx|MP4/i);
});

/**
 * 造一个最小的 init 段。真实样本里 firstOffset 恰好是 0、
 * reference_type 位恰好都是 0，这两条分支从没被执行过，
 * 只能用合成样本覆盖。
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
    // 最高位是 reference_type：1 表示这条指向另一个索引而非媒体
    view.setUint32(p, ((ref.type || 0) << 31) | ref.size); p += 4;
    view.setUint32(p, ref.duration); p += 4;
    view.setUint32(p, 0); p += 4;            // SAP
  }
  return { buffer: buf, sidxEnd: sidxAt + sidxSize };
}

test("first_offset 不为 0 时，片段起点要跟着往后挪", () => {
  const { buffer, sidxEnd } = buildInitSegment({
    firstOffset: 500,
    references: [{ size: 1000, duration: 2000 }],
  });
  const index = mp4.parseInitSegment(buffer);
  // 起点 = sidx 结束位置 + first_offset，忽略 first_offset 会让所有字节范围偏移
  assert.equal(index.fragments[0].start, sidxEnd + 500);
});

test("reference_type 位不会被算进片段长度里", () => {
  const { buffer } = buildInitSegment({
    references: [
      { size: 1000, duration: 1000 },
      { size: 2000, duration: 1000, type: 1 },
    ],
  });
  const index = mp4.parseInitSegment(buffer);
  // 最高位是标志位，不掩掉的话长度会变成 2147485648 这种荒唐的数
  assert.equal(index.fragments[1].end - index.fragments[1].start + 1, 2000);
  assert.ok(index.totalBytes < 10000, `总字节 ${index.totalBytes} 明显不合理`);
});
