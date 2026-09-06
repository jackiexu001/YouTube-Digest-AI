/**
 * 三层字幕获取的调度。
 *
 *   ① YouTube 原生字幕 —— 免费、无上限
 *   ② Supadata —— 原项目的路径，降为备胎，兜住第一层的边角情况
 *   ③ AI 识别 —— 前两层都没有时才提供，且必须用户点击才启动
 *
 * 依赖以函数形式注入，因此整套判断逻辑可以脱离网络测试。
 */
var YTD_TRANSCRIPT_SOURCE = (() => {
  /**
   * @param {Function} youtubeSource 取播放器信息（字幕轨清单 + 时长）
   * @param {Function} nativeCaptions 下载某条字幕轨
   * @param {Function} supadata 原项目的 Supadata 取字幕
   * @param {boolean} aiCaptionsEnabled AI 字幕总开关
   */
  async function resolve({
    videoId,
    youtubeSource,
    nativeCaptions,
    supadata,
    aiCaptionsEnabled = true,
  }) {
    let player = null;
    try {
      player = await youtubeSource(videoId);
    } catch (_error) {
      player = { ok: false };
    }

    // ---------- ① YouTube 原生字幕 ----------
    if (player?.ok && player.captionTracks?.length) {
      const track = pickTrack(player.captionTracks);
      try {
        const segments = await nativeCaptions(track);
        if (segments?.length) {
          return {
            source: "youtube",
            transcript: segments,
            language: track.languageCode || null,
            durationSeconds: player.durationSeconds || 0,
            needsAiCaptions: false,
          };
        }
      } catch (_error) {
        // 取不下来就交给下一层，不让用户看到一个技术错误
      }
    }

    // ---------- ② YouTube 明确说没有字幕轨 ----------
    // Supadata 用的是 native 模式，只读 YouTube 原生字幕。
    // YouTube 自己都说一条都没有，问它也是白花一个 credit。
    if (player?.ok && player.captionTracks && !player.captionTracks.length) {
      return {
        source: "none",
        transcript: [],
        durationSeconds: player.durationSeconds || 0,
        needsAiCaptions: aiCaptionsEnabled,
      };
    }

    // ---------- ③ Supadata 兜底 ----------
    const fallback = await supadata(videoId);
    if (fallback?.success) {
      return {
        source: "supadata",
        transcript: fallback.transcript,
        transcriptText: fallback.transcriptText,
        transcriptTextTimestamped: fallback.transcriptTextTimestamped,
        language: fallback.language || null,
        durationSeconds: player?.durationSeconds || 0,
        needsAiCaptions: false,
      };
    }

    // 走到这里说明播放器信息也没取到 —— 没有播放器信息就没有音频地址，
    // 给 AI 按钮等于给一个必然失败的操作
    return {
      source: "none",
      transcript: [],
      durationSeconds: 0,
      needsAiCaptions: false,
      audioUnavailable: true,
      error: fallback?.error || player?.error || "NO_TRANSCRIPT",
    };
  }

  /** 人工字幕通常比自动生成的准，优先选它。 */
  function pickTrack(tracks) {
    return tracks.find((track) => !track.isAutomatic) || tracks[0];
  }

  return { resolve, pickTrack };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_TRANSCRIPT_SOURCE;
}
