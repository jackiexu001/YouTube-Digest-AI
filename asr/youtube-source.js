/**
 * Gets audio URLs and native captions from YouTube.
 *
 * Background: the YouTube web client has moved to SABR. Its player response
 * lists audio formats with neither a direct URL nor a signature cipher, so
 * the problem is not that URLs are encrypted, it is that there are no URLs.
 * That makes the usual "port ytdl-core's signature decryption" route dead.
 *
 * What does work is asking the official endpoint as a different client:
 * VISIONOS and IOS still return plain direct URLs and need no signature
 * decryption, as long as the page's anonymous visitorData comes along.
 *
 * Important: this request must be issued from the page's own context
 * (world: "MAIN"). Sent by the extension it carries
 * Origin: chrome-extension://..., which YouTube answers with 403, and a
 * browser will not let an extension forge Origin.
 */
var YTD_YOUTUBE_SOURCE = (() => {
  const CLIENTS = Object.freeze([
    {
      name: "VISIONOS",
      version: "1.02",
      number: "101",
      extra: {
        deviceMake: "Apple",
        deviceModel: "RealityDevice17,1",
        osName: "visionOS",
        osVersion: "26.5.23O471",
      },
    },
    {
      name: "IOS",
      version: "20.10.4",
      number: "5",
      extra: {
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        osName: "iPhone",
        osVersion: "18.3.2.22D82",
      },
    },
  ]);

  const BY_NAME = Object.fromEntries(CLIENTS.map((c) => [c.name, c]));

  function buildPlayerRequest({ videoId, visitorData, client }) {
    const spec = BY_NAME[client] || CLIENTS[0];
    return {
      url: "/youtubei/v1/player",
      method: "POST",
      // Anonymous visitorData is enough, so no login cookie is needed and
      // these requests are never tied to the user's YouTube account
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": spec.number,
        "X-YouTube-Client-Version": spec.version,
        "X-Goog-Visitor-Id": visitorData,
      },
      body: {
        context: {
          client: {
            clientName: spec.name,
            clientVersion: spec.version,
            hl: "en",
            gl: "US",
            visitorData,
            ...spec.extra,
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
    };
  }

  /**
   * Picks an audio stream for recognition.
   *
   * Prefers the lowest-bitrate m4a: recognition does not need fidelity, and
   * m4a carries a simple sidx index that allows time-based slicing by plain
   * byte concatenation. webm/opus would need a separate EBML parser, so it
   * ranks lower even when its bitrate is smaller.
   */
  function pickAudioFormat(playerResponse) {
    const formats = playerResponse?.streamingData?.adaptiveFormats;
    if (!Array.isArray(formats)) return null;

    const audio = formats
      .filter((f) => String(f?.mimeType || "").startsWith("audio") && f?.url)
      .map((f) => ({
        itag: Number(f.itag),
        url: String(f.url),
        mimeType: String(f.mimeType),
        container: String(f.mimeType).includes("mp4") ? "mp4" : "webm",
        bitrate: Number(f.bitrate) || Number.MAX_SAFE_INTEGER,
        contentLength: Number(f.contentLength) || 0,
      }));
    if (!audio.length) return null;

    audio.sort((a, b) => {
      if (a.container !== b.container) return a.container === "mp4" ? -1 : 1;
      return a.bitrate - b.bitrate;
    });
    return audio[0];
  }

  function readVideoInfo(playerResponse) {
    const details = playerResponse?.videoDetails || {};
    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return {
      title: String(details.title || ""),
      durationSeconds: Number(details.lengthSeconds) || 0,
      captionTracks: tracks.map((track) => ({
        languageCode: String(track?.languageCode || ""),
        baseUrl: String(track?.baseUrl || ""),
        // kind === "asr" means auto-generated, usually worse than a human track
        isAutomatic: track?.kind === "asr",
      })),
    };
  }

  /** json3 is the timestamped structured format, easier than the default XML. */
  function captionUrl(baseUrl) {
    const separator = String(baseUrl).includes("?") ? "&" : "?";
    return `${baseUrl}${separator}fmt=json3`;
  }

  function parseCaptionJson(data) {
    const events = data?.events;
    if (!Array.isArray(events)) return [];

    const segments = [];
    for (const event of events) {
      const text = (event?.segs || [])
        .map((seg) => String(seg?.utf8 ?? ""))
        .join("")
        .trim();
      if (!text) continue;
      const start = (Number(event.tStartMs) || 0) / 1000;
      const duration = (Number(event.dDurationMs) || 0) / 1000;
      segments.push({
        start: Math.round(start * 1000) / 1000,
        end: Math.round((start + duration) * 1000) / 1000,
        text,
      });
    }
    return segments;
  }

  return {
    CLIENTS,
    buildPlayerRequest,
    pickAudioFormat,
    readVideoInfo,
    captionUrl,
    parseCaptionJson,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_YOUTUBE_SOURCE;
}
