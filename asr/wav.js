/**
 * 把解码后的音频编码成 16kHz 单声道 16 位 WAV。
 *
 * 为什么必须转 WAV：Groq 按容器头部声明的时长计费和分配资源，
 * 而我们的分片切出来的 m4a 继承了整段视频的时长声明——
 * 传 30 秒的切片会被按整片时长处理，既崩溃又超额度。
 * WAV 声明的是真实时长，是唯一计费正确的格式。
 *
 * 为什么是 16kHz 单声道：Whisper 内部就按这个规格重采样，
 * 所以这么转不损失识别质量，同时把上传量压到最小。
 */
var YTD_WAV = (() => {
  const SAMPLE_RATE = 16000;
  const BYTES_PER_SAMPLE = 2;

  /**
   * @param {Float32Array} samples 取值范围 -1..1
   * @param {number} sampleRate
   * @returns {Uint8Array} 完整的 WAV 文件
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
    view.setUint32(16, 16, true);            // fmt 块长度
    view.setUint16(20, 1, true);             // PCM
    view.setUint16(22, 1, true);             // 单声道
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
    view.setUint16(32, BYTES_PER_SAMPLE, true);
    view.setUint16(34, 16, true);            // 位深

    ascii(36, "data");
    view.setUint32(40, dataBytes, true);

    for (let i = 0; i < samples.length; i++) {
      // 必须先截断：超出 -1..1 的值直接转换会绕回成反向的值，
      // 听起来是刺耳的爆音，也会让识别结果变差
      const value = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * BYTES_PER_SAMPLE, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    return new Uint8Array(view.buffer);
  }

  /** 按时长估算 WAV 体积，用来在界面上提示上传量。 */
  function estimateBytes(seconds) {
    return 44 + Math.round(seconds * SAMPLE_RATE * BYTES_PER_SAMPLE);
  }

  /** 在给定上传上限内，单段最长能放多少秒音频。 */
  function maxChunkSeconds(limitBytes) {
    return Math.floor((limitBytes - 44) / (SAMPLE_RATE * BYTES_PER_SAMPLE));
  }

  /**
   * 浏览器里把一段音频字节解码并重采样成 16kHz 单声道 WAV。
   *
   * 这一层依赖 AudioContext，无法在 Node 里测试，所以保持极薄：
   * 真正的编码逻辑都在上面的纯函数里。
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
    // 多声道接到单声道输出会自动混音，不需要手工合并
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
