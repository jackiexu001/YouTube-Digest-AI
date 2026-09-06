const test = require("node:test");
const assert = require("node:assert/strict");

const wav = require("../asr/wav.js");

const ascii = (bytes, offset, length) =>
  Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString("latin1");
const u32 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
const u16 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(offset, true);

test("writes a standard 16 kHz mono 16-bit WAV header", () => {
  const samples = new Float32Array(16000); // one second
  const bytes = wav.encodeWav(samples, 16000);

  assert.equal(ascii(bytes, 0, 4), "RIFF");
  assert.equal(ascii(bytes, 8, 4), "WAVE");
  assert.equal(ascii(bytes, 12, 4), "fmt ");
  assert.equal(ascii(bytes, 36, 4), "data");

  assert.equal(u32(bytes, 16), 16, "fmt chunk size should be 16");
  assert.equal(u16(bytes, 20), 1, "format should be PCM");
  assert.equal(u16(bytes, 22), 1, "should be mono");
  assert.equal(u32(bytes, 24), 16000, "sample rate should be 16000");
  assert.equal(u16(bytes, 34), 16, "bit depth should be 16");
});

test("the file length matches the length it declares", () => {
  const samples = new Float32Array(1234);
  const bytes = wav.encodeWav(samples, 16000);

  assert.equal(bytes.byteLength, 44 + 1234 * 2);
  // The RIFF size excludes the leading 8 bytes
  assert.equal(u32(bytes, 4), bytes.byteLength - 8);
  assert.equal(u32(bytes, 40), 1234 * 2, "data chunk size should equal sample count times 2");
});

test("byte rate is consistent with sample rate and bit depth", () => {
  const bytes = wav.encodeWav(new Float32Array(10), 16000);
  assert.equal(u32(bytes, 28), 16000 * 2, "byteRate should be sample rate times bytes per sample");
  assert.equal(u16(bytes, 32), 2, "blockAlign should be 2");
});

test("sample values are written correctly for both signs", () => {
  const bytes = wav.encodeWav(new Float32Array([0, 0.5, -0.5]), 16000);
  const view = new DataView(bytes.buffer, bytes.byteOffset);

  assert.equal(view.getInt16(44, true), 0);
  assert.ok(Math.abs(view.getInt16(46, true) - 0.5 * 0x7fff) <= 1);
  assert.ok(Math.abs(view.getInt16(48, true) - -0.5 * 0x8000) <= 1);
});

test("out-of-range samples clamp instead of wrapping into inverted noise", () => {
  const bytes = wav.encodeWav(new Float32Array([2.5, -3.0]), 16000);
  const view = new DataView(bytes.buffer, bytes.byteOffset);

  // Without clamping, 2.5 wraps to a negative value and clicks harshly
  assert.equal(view.getInt16(44, true), 0x7fff);
  assert.equal(view.getInt16(46, true), -0x8000);
});

test("empty audio still produces a valid file rather than throwing", () => {
  const bytes = wav.encodeWav(new Float32Array(0), 16000);
  assert.equal(bytes.byteLength, 44);
  assert.equal(u32(bytes, 40), 0);
});

test("estimates WAV size from duration, for showing upload size", () => {
  // 16 kHz mono 16-bit is 32000 bytes per second
  assert.equal(wav.estimateBytes(1), 44 + 32000);
  assert.equal(wav.estimateBytes(300), 44 + 300 * 32000);
});

test("reports the longest chunk that fits an upload limit", () => {
  // Groq free tier allows 25 MB per request
  const seconds = wav.maxChunkSeconds(25 * 1024 * 1024);
  assert.ok(seconds > 700 && seconds < 900, `computed limit of ${seconds}s is implausible`);
  // Check the other way: a file of that length really does fit
  assert.ok(wav.estimateBytes(seconds) <= 25 * 1024 * 1024);
});
