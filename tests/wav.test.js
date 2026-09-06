const test = require("node:test");
const assert = require("node:assert/strict");

const wav = require("../asr/wav.js");

const ascii = (bytes, offset, length) =>
  Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString("latin1");
const u32 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
const u16 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(offset, true);

test("生成标准的 16kHz 单声道 16 位 WAV 头", () => {
  const samples = new Float32Array(16000); // 1 秒
  const bytes = wav.encodeWav(samples, 16000);

  assert.equal(ascii(bytes, 0, 4), "RIFF");
  assert.equal(ascii(bytes, 8, 4), "WAVE");
  assert.equal(ascii(bytes, 12, 4), "fmt ");
  assert.equal(ascii(bytes, 36, 4), "data");

  assert.equal(u32(bytes, 16), 16, "fmt 块长度应为 16");
  assert.equal(u16(bytes, 20), 1, "应为 PCM 格式");
  assert.equal(u16(bytes, 22), 1, "应为单声道");
  assert.equal(u32(bytes, 24), 16000, "采样率应为 16000");
  assert.equal(u16(bytes, 34), 16, "位深应为 16");
});

test("文件长度与声明的长度一致", () => {
  const samples = new Float32Array(1234);
  const bytes = wav.encodeWav(samples, 16000);

  assert.equal(bytes.byteLength, 44 + 1234 * 2);
  // RIFF 块长度不含开头 8 字节
  assert.equal(u32(bytes, 4), bytes.byteLength - 8);
  assert.equal(u32(bytes, 40), 1234 * 2, "data 块长度应等于采样数 × 2");
});

test("每秒字节数与采样率、位深自洽", () => {
  const bytes = wav.encodeWav(new Float32Array(10), 16000);
  assert.equal(u32(bytes, 28), 16000 * 2, "byteRate 应为 采样率 × 每样本字节数");
  assert.equal(u16(bytes, 32), 2, "blockAlign 应为 2");
});

test("采样值正确写入，正负都不失真", () => {
  const bytes = wav.encodeWav(new Float32Array([0, 0.5, -0.5]), 16000);
  const view = new DataView(bytes.buffer, bytes.byteOffset);

  assert.equal(view.getInt16(44, true), 0);
  assert.ok(Math.abs(view.getInt16(46, true) - 0.5 * 0x7fff) <= 1);
  assert.ok(Math.abs(view.getInt16(48, true) - -0.5 * 0x8000) <= 1);
});

test("超出范围的采样值被截断，而不是溢出成反向的噪音", () => {
  const bytes = wav.encodeWav(new Float32Array([2.5, -3.0]), 16000);
  const view = new DataView(bytes.buffer, bytes.byteOffset);

  // 不截断的话 2.5 会绕回成负数，听起来是刺耳的爆音
  assert.equal(view.getInt16(44, true), 0x7fff);
  assert.equal(view.getInt16(46, true), -0x8000);
});

test("空音频也能生成合法文件，不抛错", () => {
  const bytes = wav.encodeWav(new Float32Array(0), 16000);
  assert.equal(bytes.byteLength, 44);
  assert.equal(u32(bytes, 40), 0);
});

test("按时长估算 WAV 体积，用于提示上传量", () => {
  // 16kHz 单声道 16 位 = 每秒 32000 字节
  assert.equal(wav.estimateBytes(1), 44 + 32000);
  assert.equal(wav.estimateBytes(300), 44 + 300 * 32000);
});

test("给出在上传上限内的最大分段时长", () => {
  // Groq 免费档单次 25MB
  const seconds = wav.maxChunkSeconds(25 * 1024 * 1024);
  assert.ok(seconds > 700 && seconds < 900, `算出的上限 ${seconds} 秒不合理`);
  // 反过来验证：按这个时长生成的文件确实不超限
  assert.ok(wav.estimateBytes(seconds) <= 25 * 1024 * 1024);
});
