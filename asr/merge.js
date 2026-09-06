/**
 * Stitches per-chunk recognition results back into one timeline.
 *
 * Neighbouring chunks overlap, so the same sentence can come back from both
 * sides. The rule is to split at the midpoint of the overlap: everything
 * before it belongs to the earlier chunk, everything after to the later one.
 * That way a sentence at a seam is complete on one side instead of being
 * half-recognised on both.
 *
 * The overlap is derived from the actual data rather than assumed from a
 * fixed overlap length. When a chunk fails, or when two chunks do not
 * actually touch, the fixed assumption deletes captions that should be kept.
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

    // With two workers the later chunk can finish first, so the incoming
    // order is not guaranteed. Overlap resolution depends on adjacency.
    const ordered = [...chunks].sort(
      (a, b) => (Number(a.offset) || 0) - (Number(b.offset) || 0),
    );
    const offsets = ordered.map((chunk) => Number(chunk.offset) || 0);
    const shifted = ordered.map((chunk, index) =>
      offsetSegments(chunk.segments, offsets[index]),
    );

    // Derive the boundary from real data instead of assuming a fixed overlap:
    // a failed chunk or a gap would otherwise delete captions wrongly.
    const boundaries = [];
    for (let i = 0; i + 1 < shifted.length; i++) {
      const previousEnd = shifted[i].length
        ? Math.max(...shifted[i].map((segment) => segment.end))
        : -Infinity;
      const nextStart = offsets[i + 1];
      // Only actual overlap needs resolving; otherwise keep both in full
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

    // Drop adjacent duplicates with identical text
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
