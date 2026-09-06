/**
 * 把分块识别的结果拼回一条完整的时间轴。
 *
 * 分块识别时相邻两块会重叠一小段，同一句话可能被两边都识别到。
 * 合并的规则是按重叠区的中点取舍：中点之前的归前一块，之后的归后一块。
 * 这样切口处的话总有一边是完整的，而不会两边都只识别到半句。
 *
 * 重叠区是从实际数据算出来的，不是按固定的重叠秒数假设。
 * 某块识别失败或两块之间有缺口时，固定假设会把本该保留的字幕误删。
 *
 * 算法沿用 jackiexu001/youtube-transcript 里已经验证过的做法。
 */
var YTD_MERGE = (() => {
  function offsetSegments(segments, offsetSeconds) {
    const result = [];
    for (const segment of segments || []) {
      const text = String(segment?.text ?? "").trim();
      if (!text) continue;
      result.push({
        start: round(Number(segment.start || 0) + offsetSeconds),
        end: round(Number(segment.end || 0) + offsetSeconds),
        text,
      });
    }
    return result;
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  function mergeChunks(chunks) {
    if (!chunks || !chunks.length) return [];

    // 2 路并发时后一块可能先完成，传进来的顺序不保证。
    // 重叠区的取舍依赖前后关系，先按时间排好。
    const ordered = [...chunks].sort(
      (a, b) => (Number(a.offset) || 0) - (Number(b.offset) || 0),
    );
    const offsets = ordered.map((chunk) => Number(chunk.offset) || 0);
    const shifted = ordered.map((chunk, index) =>
      offsetSegments(chunk.segments, offsets[index]),
    );

    // 边界从实际数据推断，而不是假设相邻块一定按固定重叠量衔接：
    // 某块识别失败、或两块之间有缺口时，那个假设会误删本该保留的字幕。
    const boundaries = [];
    for (let i = 0; i + 1 < shifted.length; i++) {
      const previousEnd = shifted[i].length
        ? Math.max(...shifted[i].map((segment) => segment.end))
        : -Infinity;
      const nextStart = offsets[i + 1];
      // 只有真的重叠才需要取舍；否则两块各自完整保留
      boundaries.push(nextStart < previousEnd ? (nextStart + previousEnd) / 2 : null);
    }

    const merged = [];
    shifted.forEach((segments, index) => {
      const lower = index > 0 ? boundaries[index - 1] : null;
      const upper = index + 1 < shifted.length ? boundaries[index] : null;
      for (const segment of segments) {
        if (lower !== null && segment.start <= lower) continue;
        if (upper !== null && segment.start > upper) continue;
        merged.push(segment);
      }
    });

    merged.sort((a, b) => a.start - b.start);

    // 去掉紧挨着且文字完全相同的重复
    const deduped = [];
    for (const segment of merged) {
      const previous = deduped[deduped.length - 1];
      if (previous && previous.text === segment.text) continue;
      deduped.push(segment);
    }
    return deduped;
  }

  return { offsetSegments, mergeChunks };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_MERGE;
}
