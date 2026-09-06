const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("../asr/youtube-source.js");

test("换客户端身份的请求带上匿名会话标识与客户端声明", () => {
  const request = source.buildPlayerRequest({ videoId: "abc12345678", visitorData: "VD", client: "VISIONOS" });

  assert.equal(request.url, "/youtubei/v1/player");
  assert.equal(request.headers["X-Goog-Visitor-Id"], "VD");
  assert.equal(request.headers["X-YouTube-Client-Name"], "101");
  assert.equal(request.body.videoId, "abc12345678");
  assert.equal(request.body.context.client.clientName, "VISIONOS");
  assert.equal(request.body.context.client.visitorData, "VD");
  // 不带用户的登录 Cookie：匿名标识已经够用，没必要把请求和账号绑定
  assert.equal(request.credentials, "omit");
});

test("VISIONOS 失败时还有 IOS 可以退", () => {
  const clients = source.CLIENTS.map((c) => c.name);
  assert.deepEqual(clients, ["VISIONOS", "IOS"]);
});

test("从播放器响应里挑出码率最低的 m4a", () => {
  const picked = source.pickAudioFormat({
    streamingData: {
      adaptiveFormats: [
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130000, url: "https://webm" },
        { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, url: "https://m4a-hi" },
        { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 50000, url: "https://m4a-lo", contentLength: "123" },
        { itag: 999, mimeType: "video/mp4", bitrate: 10, url: "https://video" },
      ],
    },
  });

  // m4a 的索引表结构简单，能纯字节切片；webm 需要另写 EBML 解析
  assert.equal(picked.url, "https://m4a-lo");
  assert.equal(picked.itag, 139);
  assert.equal(picked.contentLength, 123);
});

test("没有带直连地址的音频格式时返回 null，让调用方给出明确提示", () => {
  // YouTube 网页版已转 SABR，格式列表里可能一个地址都没有
  assert.equal(
    source.pickAudioFormat({
      streamingData: { adaptiveFormats: [{ itag: 139, mimeType: "audio/mp4", bitrate: 5 }] },
    }),
    null,
  );
  assert.equal(source.pickAudioFormat(null), null);
});

test("只有 webm 时也要能用，而不是直接放弃", () => {
  const picked = source.pickAudioFormat({
    streamingData: {
      adaptiveFormats: [
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130000, url: "https://webm" },
      ],
    },
  });
  assert.equal(picked.itag, 251);
  assert.equal(picked.container, "webm");
});

test("读出视频时长与自带字幕轨清单", () => {
  const info = source.readVideoInfo({
    videoDetails: { lengthSeconds: "2336", title: "标题" },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: "zh", baseUrl: "https://timedtext-zh", kind: undefined },
          { languageCode: "en", baseUrl: "https://timedtext-en", kind: "asr" },
        ],
      },
    },
  });

  assert.equal(info.durationSeconds, 2336);
  assert.equal(info.title, "标题");
  assert.equal(info.captionTracks.length, 2);
  assert.equal(info.captionTracks[0].languageCode, "zh");
  assert.equal(info.captionTracks[0].isAutomatic, false);
  assert.equal(info.captionTracks[1].isAutomatic, true);
});

test("没有字幕轨时返回空清单，这正是该走 AI 识别的信号", () => {
  const info = source.readVideoInfo({ videoDetails: { lengthSeconds: "60" } });
  assert.deepEqual(info.captionTracks, []);
});

test("下载原生字幕时请求 json3 格式", () => {
  const url = source.captionUrl("https://www.youtube.com/api/timedtext?v=x&lang=zh");
  assert.match(url, /[?&]fmt=json3/);
});

test("把 json3 字幕转成统一的分段格式", () => {
  const segments = source.parseCaptionJson({
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "第一" }, { utf8: "句" }] },
      { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: "第二句" }] },
      { tStartMs: 4000 },                                  // 没有文字，应跳过
      { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: "\n" }] },  // 只有换行，应跳过
    ],
  });

  assert.deepEqual(segments, [
    { start: 0, end: 2, text: "第一句" },
    { start: 2, end: 3.5, text: "第二句" },
  ]);
});

test("字幕结构不符合预期时返回空数组，交给下一层兜底", () => {
  assert.deepEqual(source.parseCaptionJson(null), []);
  assert.deepEqual(source.parseCaptionJson({ events: [] }), []);
});

test("即使 webm 码率更低也要选 m4a，因为只有 m4a 能按时间切片", () => {
  // opus 编码效率高，真实视频里 webm 的码率常常比 m4a 低。
  // 若只按码率排序会选中 webm，而我们的 sidx 解析切不了 webm，整个功能就废了。
  const picked = source.pickAudioFormat({
    streamingData: {
      adaptiveFormats: [
        { itag: 249, mimeType: 'audio/webm; codecs="opus"', bitrate: 32000, url: "https://webm-lo" },
        { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 50000, url: "https://m4a" },
      ],
    },
  });
  assert.equal(picked.container, "mp4");
  assert.equal(picked.itag, 139);
});
