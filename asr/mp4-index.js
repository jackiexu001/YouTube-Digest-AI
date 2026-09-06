/**
 * Parses the sidx index of a fragmented MP4 to turn "at what second" into
 * "at what byte".
 *
 * YouTube's audio-only streams (itag 139 and friends) are fragmented MP4:
 * ftyp + moov + sidx up front, then a run of moof/mdat fragments. The sidx
 * gives every fragment's byte length and duration, so "init segment plus any
 * run of consecutive fragments" is already a valid, decodable audio file.
 *
 * That means slicing by time is byte concatenation. No ffmpeg required.
 */
var YTD_MP4_INDEX = (() => {
  function readBoxes(view, from, to) {
    const boxes = [];
    let offset = from;
    while (offset + 8 <= to) {
      let size = view.getUint32(offset);
      const type = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7),
      );
      if (size === 1) {
        if (offset + 16 > to) break;
        size = Number(view.getBigUint64(offset + 8));
      }
      if (size < 8) break;
      boxes.push({ type, offset, size });
      offset += size;
    }
    return boxes;
  }

  /**
   * @param {ArrayBuffer} buffer must cover ftyp, moov and the whole sidx
   * @returns {{fragments, timescale, totalSeconds, totalBytes, initLength}}
   */
  function parseInitSegment(buffer) {
    const view = new DataView(buffer);
    const boxes = readBoxes(view, 0, buffer.byteLength);
    const sidx = boxes.find((box) => box.type === "sidx");
    if (!sidx) {
      throw new Error("No sidx index found; this is not a fragmented MP4 audio stream.");
    }

    let p = sidx.offset + 8;
    const version = view.getUint8(p);
    p += 4; // version(1) + flags(3)
    p += 4; // reference_ID
    const timescale = view.getUint32(p);
    p += 4;

    let firstOffset;
    if (version === 0) {
      p += 4; // earliest_presentation_time
      firstOffset = view.getUint32(p);
      p += 4;
    } else {
      p += 8;
      firstOffset = Number(view.getBigUint64(p));
      p += 8;
    }
    p += 2; // reserved
    const count = view.getUint16(p);
    p += 2;

    const fragments = [];
    let byteCursor = sidx.offset + sidx.size + firstOffset;
    let timeCursor = 0;
    for (let i = 0; i < count; i++) {
      const referencedSize = view.getUint32(p) & 0x7fffffff;
      p += 4;
      const subsegmentDuration = view.getUint32(p);
      p += 4;
      p += 4; // SAP info, not needed for slicing

      fragments.push({
        start: byteCursor,
        end: byteCursor + referencedSize - 1,
        startTime: timeCursor / timescale,
        duration: subsegmentDuration / timescale,
      });
      byteCursor += referencedSize;
      timeCursor += subsegmentDuration;
    }

    return {
      fragments,
      timescale,
      totalSeconds: timeCursor / timescale,
      totalBytes: byteCursor,
      initLength: fragments.length ? fragments[0].start : 0,
    };
  }

  /**
   * Finds the byte range that covers a requested time window.
   *
   * A fragment is the smallest indivisible unit, so the range actually
   * returned is slightly wider than requested. Erring wide is deliberate:
   * coming up short would clip words at the seam.
   */
  function selectWindow(index, { startSeconds, durationSeconds }) {
    const endSeconds = startSeconds + durationSeconds;
    const picked = index.fragments.filter(
      (f) => f.startTime + f.duration > startSeconds && f.startTime < endSeconds,
    );
    if (!picked.length) {
      return { fragmentCount: 0, byteStart: 0, byteEnd: 0, startTime: 0, endTime: 0 };
    }
    const last = picked[picked.length - 1];
    return {
      fragmentCount: picked.length,
      byteStart: picked[0].start,
      byteEnd: last.end,
      startTime: picked[0].startTime,
      endTime: last.startTime + last.duration,
    };
  }

  /**
   * Splits the whole track into chunks that overlap slightly, so a sentence
   * at a seam appears in both neighbours. The merge step then picks a side
   * at the midpoint of the overlap.
   */
  function planChunks(index, { chunkSeconds, overlapSeconds }) {
    const chunks = [];
    let cursor = 0;
    while (cursor < index.totalSeconds) {
      const startSeconds = cursor === 0 ? 0 : Math.max(0, cursor - overlapSeconds);
      const window = selectWindow(index, {
        startSeconds,
        durationSeconds: cursor + chunkSeconds - startSeconds,
      });
      if (!window.fragmentCount) break;
      chunks.push({ ...window, requestedStart: cursor });
      cursor += chunkSeconds;
    }
    return chunks;
  }

  return { parseInitSegment, selectWindow, planChunks };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_MP4_INDEX;
}
