/**
 * 分段并行下载音频。
 *
 * 必须并行：实测同一个地址，单条顺序下载被 YouTube 限速到 3 分钟只下 1.5 MB，
 * 而 8 条并行分段请求 2.7 秒就下完 8 MB。这不是优化，是能不能用的问题。
 */
var YTD_FETCHER = (() => {
  const DEFAULT_CONCURRENCY = 8;

  /** 把一段字节范围均分成若干份，首尾相接不重不漏。 */
  function splitRange(start, end, concurrency) {
    const total = end - start + 1;
    const parts = Math.max(1, Math.min(Math.floor(concurrency) || 1, total));
    const size = Math.ceil(total / parts);
    const result = [];
    for (let offset = start; offset <= end; offset += size) {
      result.push({ start: offset, end: Math.min(offset + size - 1, end) });
    }
    return result;
  }

  async function fetchRange(url, start, end, { fetchImpl } = {}) {
    const doFetch = fetchImpl || fetch;
    const response = await doFetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (!response.ok) {
      throw new Error(`下载音频失败：HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * 并行取回一段字节范围，按原顺序拼好返回。
   *
   * 任何一份失败都整体失败：残缺的音频拼出来是坏文件，
   * 送去识别只会得到一段错乱的字幕，比明确报错更糟。
   */
  async function fetchRangeParallel(url, start, end, options = {}) {
    const { concurrency = DEFAULT_CONCURRENCY, fetchImpl } = options;
    const parts = splitRange(start, end, concurrency);

    // 按索引存放，而不是按完成顺序追加——并发完成顺序是乱的
    const chunks = await Promise.all(
      parts.map((part) => fetchRange(url, part.start, part.end, { fetchImpl })),
    );

    const total = chunks.reduce((n, chunk) => n + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }

  /** init 段 + 片段字节 = 一个可以直接解码的音频文件。 */
  function assembleChunk(initBytes, bodyBytes) {
    const merged = new Uint8Array(initBytes.byteLength + bodyBytes.byteLength);
    merged.set(initBytes, 0);
    merged.set(bodyBytes, initBytes.byteLength);
    return merged;
  }

  return { DEFAULT_CONCURRENCY, splitRange, fetchRange, fetchRangeParallel, assembleChunk };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_FETCHER;
}
