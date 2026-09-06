/**
 * Encodes decoded audio as 16 kHz mono 16-bit WAV.
 *
 * Why WAV is mandatory: Groq bills and allocates against the duration the
 * container declares, and a slice cut out of a fragmented m4a inherits the
 * whole video's declared duration. A 30-second slice therefore gets treated
 * as the full video: it both crashes their pipeline and blows the quota.
 * WAV declares the real duration, so it is the only correctly billed format.
 *
 * Why 16 kHz mono: Whisper resamples to exactly that internally, so the
 * conversion costs no accuracy while keeping the upload as small as possible.
 */
var YTD_WAV = (() => {
  const SAMPLE_RATE = 16000;
  const BYTES_PER_SAMPLE = 2;

  /**
   * @param {Float32Array} samples in the range -1..1
   * @param {number} sampleRate
   * @returns {Uint8Array} a complete WAV file
   */
  function encodeWav(samples, sampleRate = SAMPLE_RATE) {
    const dataBytes = samples.length * BYTES_PER_SAMPLE;
    const view = new DataView(new ArrayBuffer(44 + dataBytes));
    const ascii = (offset, text) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };

    ascii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, "WAVE");

    ascii(12, "fmt ");
    view.setUint32(16, 16, true);            // fmt chunk size
    view.setUint16(20, 1, true);             // PCM
    view.setUint16(22, 1, true);             // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
    view.setUint16(32, BYTES_PER_SAMPLE, true);
    view.setUint16(34, 16, true);            // bit depth

    ascii(36, "data");
    view.setUint32(40, dataBytes, true);

    for (let i = 0; i < samples.length; i++) {
      // Clamp first: a value outside -1..1 wraps around to the opposite
      // sign, which sounds like a harsh click and degrades recognition
      const value = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * BYTES_PER_SAMPLE, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    return new Uint8Array(view.buffer);
  }

  /** Estimates WAV size from duration, for showing the upload size. */
  function estimateBytes(seconds) {
    return 44 + Math.round(seconds * SAMPLE_RATE * BYTES_PER_SAMPLE);
  }

  /** How many seconds fit in one chunk under a given upload limit. */
  function maxChunkSeconds(limitBytes) {
    return Math.floor((limitBytes - 44) / (SAMPLE_RATE * BYTES_PER_SAMPLE));
  }

  /**
   * Decodes audio bytes in the browser and resamples them to 16 kHz mono WAV.
   *
   * This layer needs AudioContext and cannot be tested under Node, so it is
   * kept as thin as possible; the real encoding lives in the pure function
   * above.
   */
  async function toWavFromAudioBytes(bytes, audioContextFactory) {
    const makeContext = audioContextFactory || (() => new AudioContext());
    const context = makeContext();
    let decoded;
    try {
      decoded = await context.decodeAudioData(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
    } finally {
      if (typeof context.close === "function") context.close();
    }

    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    // Connecting a multi-channel buffer to a mono destination downmixes
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    return {
      bytes: encodeWav(rendered.getChannelData(0), SAMPLE_RATE),
      seconds: decoded.duration,
    };
  }

  return { SAMPLE_RATE, encodeWav, estimateBytes, maxChunkSeconds, toWavFromAudioBytes };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_WAV;
}
