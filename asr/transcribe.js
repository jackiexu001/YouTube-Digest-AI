/**
 * Scheduling layer for AI captions: concurrency, checkpoints, rate limits.
 *
 * It does not download or recognise anything itself. Those are passed in as
 * functions, which lets the scheduling logic be tested without a network.
 */
var YTD_TRANSCRIBE = (() => {
  const mergeApi =
    typeof YTD_MERGE !== "undefined" ? YTD_MERGE : require("./merge.js");

  /**
   * @param {Object[]} chunks output of planChunks
   * @param {Function} transcribeChunk (chunk, index) => segments, supplied by the caller
   * @param {number} concurrency how many chunks run at once
   * @param {Object} doneChunks checkpoint of finished chunks, { index: segments }
   * @param {Function} onChunkDone called per finished chunk, for live progress
   * @param {Function} onCheckpoint persists the checkpoint after each chunk
   * @param {Function} shouldStop return true to stop starting new work
   */
  async function run({
    chunks,
    transcribeChunk,
    concurrency = 2,
    doneChunks = {},
    onChunkDone,
    onCheckpoint,
    shouldStop,
  }) {
    const results = { ...doneChunks };
    const failed = [];
    let rateLimited = false;
    let retryAfterSeconds = null;
    let cancelled = false;

    // Chunks already in the checkpoint are skipped so they are not paid for twice
    const pending = chunks
      .map((chunk, index) => ({ chunk, index }))
      .filter((item) => !Object.hasOwn(results, item.index));

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        // After a rate limit, stop starting new work: more requests only earn more 429s
        if (rateLimited || cancelled) return;
        if (shouldStop && shouldStop()) {
          cancelled = true;
          return;
        }
        const item = pending[cursor];
        cursor += 1;

        try {
          results[item.index] = await transcribeChunk(item.chunk, item.index);
        } catch (error) {
          if (error && error.status === 429) {
            rateLimited = true;
            retryAfterSeconds = error.retryAfter ?? null;
            return;
          }
          failed.push({ index: item.index, message: String(error?.message || error) });
          continue;
        }

        const completed = Object.keys(results).length;
        if (onCheckpoint) onCheckpoint({ doneChunks: results });
        if (onChunkDone) {
          onChunkDone({ index: item.index, completed, total: chunks.length });
        }
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, pending.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // Stitch the per-chunk results back into one timeline by real start time
    const merged = mergeApi.mergeChunks(
      Object.entries(results).map(([index, segments]) => ({
        offset: chunks[Number(index)]?.startTime ?? 0,
        segments,
      })),
    );

    return {
      segments: merged,
      completed: Object.keys(results).length,
      total: chunks.length,
      failed,
      rateLimited,
      retryAfterSeconds,
      cancelled,
      doneChunks: results,
    };
  }

  return { run };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_TRANSCRIBE;
}
