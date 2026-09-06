const test = require("node:test");
const assert = require("node:assert/strict");

const merge = require("../asr/merge.js");

test("给每段字幕加上它所属分块的时间偏移", () => {
  const shifted = merge.offsetSegments(
    [{ start: 0, end: 2, text: "第一句" }, { start: 2, end: 4, text: "第二句" }],
    300,
  );
  assert.deepEqual(shifted, [
    { start: 300, end: 302, text: "第一句" },
    { start: 302, end: 304, text: "第二句" },
  ]);
});

test("空白字幕会被丢掉，不留下占位的空行", () => {
  const shifted = merge.offsetSegments(
    [{ start: 0, end: 1, text: "  " }, { start: 1, end: 2, text: "有内容" }],
    0,
  );
  assert.equal(shifted.length, 1);
  assert.equal(shifted[0].text, "有内容");
});

test("按重叠区中点取舍，消掉切口处的重复", () => {
  // 两块在 100–110 秒重叠，同一句话被两边都识别到了
  const merged = merge.mergeChunks([
    { offset: 0, segments: [
      { start: 95, end: 99, text: "重叠前" },
      { start: 103, end: 106, text: "重叠里靠后" },
    ]},
    { offset: 100, segments: [
      { start: 2, end: 5, text: "重叠里靠前" },
      { start: 12, end: 15, text: "重叠后" },
    ]},
  ]);

  const texts = merged.map((s) => s.text);
  assert.deepEqual(texts, ["重叠前", "重叠里靠后", "重叠后"]);
});

test("合并后时间严格递增，不会倒退", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [{ start: 0, end: 5, text: "甲" }, { start: 290, end: 299, text: "乙" }] },
    { offset: 290, segments: [{ start: 0, end: 9, text: "乙重复" }, { start: 20, end: 25, text: "丙" }] },
  ]);

  for (let i = 1; i < merged.length; i++) {
    assert.ok(
      merged[i].start >= merged[i - 1].start,
      `第 ${i} 条字幕的时间比上一条早，播放器会跳来跳去`,
    );
  }
});

test("相邻且文字完全相同的字幕只保留一条", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [
      { start: 10, end: 12, text: "同一句话" },
      { start: 12, end: 14, text: "同一句话" },
    ]},
  ]);
  assert.equal(merged.length, 1);
});

test("只有一块时原样返回，不做多余处理", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [{ start: 1, end: 2, text: "甲" }, { start: 3, end: 4, text: "乙" }] },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].start, 1);
});

test("某一块识别失败时，相邻块不能把重叠区一起丢掉，否则会出现空洞", () => {
  // 偏移按 planChunks 的实际产出：后续块都往前多取 10 秒
  const merged = merge.mergeChunks([
    { offset: 0, segments: [{ start: 1, end: 2, text: "甲" }] },
    { offset: 290, segments: [] },
    { offset: 590, segments: [{ start: 1, end: 2, text: "丙" }] },
  ]);

  // 「丙」落在本该归上一块的重叠区里，但上一块是空的，
  // 若照常裁掉就没人认领这段话了
  assert.deepEqual(merged.map((s) => s.text), ["甲", "丙"]);
  assert.equal(merged[1].start, 591);
});

test("整段没有任何字幕时返回空数组，不抛错", () => {
  assert.deepEqual(merge.mergeChunks([]), []);
});

test("分块乱序传入时仍按时间排好序", () => {
  // 2 路并发下，后一块可能比前一块先完成
  const merged = merge.mergeChunks([
    { offset: 590, segments: [{ start: 1, end: 2, text: "后面的话" }] },
    { offset: 0, segments: [{ start: 1, end: 2, text: "前面的话" }] },
  ]);

  assert.deepEqual(merged.map((s) => s.text), ["前面的话", "后面的话"]);
  assert.ok(merged[0].start < merged[1].start);
});

test("单块内部字幕乱序时也会排好", () => {
  const merged = merge.mergeChunks([
    { offset: 0, segments: [
      { start: 10, end: 12, text: "第二" },
      { start: 1, end: 3, text: "第一" },
    ]},
  ]);
  assert.deepEqual(merged.map((s) => s.text), ["第一", "第二"]);
});
