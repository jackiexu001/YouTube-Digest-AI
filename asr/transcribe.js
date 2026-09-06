/**
 * AI 字幕的调度层：控制并发、保存断点、处理限流。
 *
 * 不负责下载和识别本身——那两件事由调用方以函数形式传进来，
 * 这样调度逻辑可以脱离网络单独测试。
 */
var YTD_TRANSCRIBE = (() => {
  const mergeApi =
    typeof YTD_MERGE !== "undefined" ? YTD_MERGE : require("./merge.js");

  /**
   * @param {Object[]} chunks planChunks 的产出
   * @param {Function} transcribeChunk (chunk, index) => segments，由调用方提供
   * @param {number} concurrency 同时进行的块数
   * @param {Object} doneChunks 断点：已完成的块 { index: segments }
   * @param {Function} onChunkDone 每块完成后的回调，用于边跑边显示
   * @param {Function} onCheckpoint 每块完成后保存断点
   * @param {Function} shouldStop 返回 true 则停止发起新的识别
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

    // 断点里已有的块直接跳过，不重复花钱
    const pending = chunks
      .map((chunk, index) => ({ chunk, index }))
      .filter((item) => !Object.hasOwn(results, item.index));

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        // 撞到限流后不再发起新的识别：继续发只会拿到更多的 429
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

    // 把各块结果按块的实际起始时间拼回一条时间轴
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
