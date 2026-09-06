/**
 * Downloads audio in parallel byte ranges.
 *
 * Parallel is mandatory, not an optimisation. Measured against the same URL:
 * a single sequential GET was throttled to 1.5 MB in three minutes, while
 * eight parallel ranged requests fetched 8 MB in 2.7 seconds.
 */
var YTD_FETCHER = (() => {
  const DEFAULT_CONCURRENCY = 8;

  /** Splits a byte range into parts that meet end to end, no gaps or overlap. */
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
      throw new Error(`Audio download failed: HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Fetches a byte range in parallel and reassembles it in order.
   *
   * Any failed part fails the whole thing. A partial download assembles into
   * a broken file, and sending that for recognition yields scrambled
   * captions, which is worse than a clear error.
   */
  async function fetchRangeParallel(url, start, end, options = {}) {
    const { concurrency = DEFAULT_CONCURRENCY, fetchImpl } = options;
    const parts = splitRange(start, end, concurrency);

    // Keyed by index rather than appended on completion: parallel requests
    // finish out of order
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

  /** init segment + fragment bytes = a directly decodable audio file. */
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
