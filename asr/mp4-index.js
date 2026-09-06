/**
 * 解析分片 MP4 的 sidx 索引表，把「第几秒」换算成「第几个字节」。
 *
 * YouTube 的纯音频流（itag 139 一类）是分片 MP4：开头是 ftyp + moov + sidx，
 * 后面跟着一串 moof/mdat 片段。sidx 给出每个片段的字节长度和时长，
 * 于是「init 段 + 任意连续片段」就是一个可以直接解码的合法音频文件。
 *
 * 这意味着按时间切片只需要字节拼接，不需要 ffmpeg。
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
   * @param {ArrayBuffer} buffer 至少要包含 ftyp、moov 和完整的 sidx
   * @returns {{fragments, timescale, totalSeconds, totalBytes, initLength}}
   */
  function parseInitSegment(buffer) {
    const view = new DataView(buffer);
    const boxes = readBoxes(view, 0, buffer.byteLength);
    const sidx = boxes.find((box) => box.type === "sidx");
    if (!sidx) {
      throw new Error("找不到 sidx 索引表，这不是分片 MP4 音频流。");
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
      p += 4; // SAP 信息，切片用不到

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
   * 找出覆盖指定时间窗所需的字节范围。
   *
   * 片段是不可分割的最小单位，所以实际取到的时间范围会略宽于请求的范围，
   * 宁可多取也不能少取——少取意味着切口处的字被切掉。
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
   * 把整段音频切成若干块。相邻块之间重叠一小段，
   * 让切口处的话在两块里都出现，合并时再按重叠区中点取舍。
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
