/**
 * 从 YouTube 取音频地址和原生字幕。
 *
 * 背景：YouTube 网页版已经转到 SABR，播放器响应里的格式列表既没有直连地址
 * 也没有加密串——问题不是地址被加密，是根本没有地址。所以「移植签名解密」
 * 这条常见路线已经失效。
 *
 * 可行的做法是换一个客户端身份去问官方接口：VISIONOS 和 IOS 这类客户端
 * 仍然返回普通直连地址，且不需要签名解密。前提是带上页面里的匿名 visitorData。
 *
 * 重要：这个请求必须在页面自己的环境里发（world: "MAIN"）。扩展自己发会带上
 * Origin: chrome-extension://...，YouTube 直接返回 403，而浏览器不允许扩展伪造 Origin。
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
      // 匿名 visitorData 已经够用，不需要用户的登录 Cookie，
      // 也就不必把这些请求和用户的 YouTube 账号绑在一起
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
   * 挑一个用来识别的音频流。
   *
   * 优先最低码率的 m4a：识别不需要高音质，而 m4a 的 sidx 索引表结构简单，
   * 纯字节拼接就能按时间切片。webm/opus 要另写 EBML 解析，所以放在后面。
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
        // kind === "asr" 表示是 YouTube 自动生成的，质量通常不如人工字幕
        isAutomatic: track?.kind === "asr",
      })),
    };
  }

  /** json3 是带时间戳的结构化格式，比默认的 XML 好解析。 */
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
