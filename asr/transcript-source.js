/**
 * Three-layer transcript resolution.
 *
 *   1. Native YouTube captions - free, no quota
 *   2. Supadata - the upstream path, demoted to a fallback for edge cases
 *   3. AI recognition - offered only when neither of the above has captions,
 *      and only started on an explicit click
 *
 * Dependencies are injected as functions, so the whole decision tree can be
 * tested without a network.
 */
var YTD_TRANSCRIPT_SOURCE = (() => {
  /**
   * @param {Function} youtubeSource reads player info (caption tracks + duration)
   * @param {Function} nativeCaptions downloads one caption track
   * @param {Function} supadata the upstream Supadata lookup
   * @param {boolean} aiCaptionsEnabled master switch for AI captions
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

    // ---------- 1. Native YouTube captions ----------
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
        // If it cannot be fetched, fall through rather than surface a technical error
      }
    }

    // ---------- 2. YouTube explicitly reports no caption tracks ----------
    // Supadata runs in native mode and reads only native YouTube captions.
    // If YouTube itself says there are none, asking Supadata just burns a credit.
    if (player?.ok && player.captionTracks && !player.captionTracks.length) {
      return {
        source: "none",
        transcript: [],
        durationSeconds: player.durationSeconds || 0,
        needsAiCaptions: aiCaptionsEnabled,
      };
    }

    // ---------- 3. Supadata fallback ----------
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

    // Reaching here means the player info was unavailable too. Without it
    // there is no audio URL, so offering the AI button would offer an action
    // that is guaranteed to fail
    return {
      source: "none",
      transcript: [],
      durationSeconds: 0,
      needsAiCaptions: false,
      audioUnavailable: true,
      error: fallback?.error || player?.error || "NO_TRANSCRIPT",
    };
  }

  /** Human captions are usually more accurate than auto-generated ones. */
  function pickTrack(tracks) {
    return tracks.find((track) => !track.isAutomatic) || tracks[0];
  }

  return { resolve, pickTrack };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_TRANSCRIPT_SOURCE;
}
