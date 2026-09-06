const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("../asr/youtube-source.js");

test("the client-swap request carries the anonymous session id and client declaration", () => {
  const request = source.buildPlayerRequest({ videoId: "abc12345678", visitorData: "VD", client: "VISIONOS" });

  assert.equal(request.url, "/youtubei/v1/player");
  assert.equal(request.headers["X-Goog-Visitor-Id"], "VD");
  assert.equal(request.headers["X-YouTube-Client-Name"], "101");
  assert.equal(request.body.videoId, "abc12345678");
  assert.equal(request.body.context.client.clientName, "VISIONOS");
  assert.equal(request.body.context.client.visitorData, "VD");
  // No login cookie: the anonymous id suffices, so requests are never tied to an account
  assert.equal(request.credentials, "omit");
});

test("IOS remains as a fallback when VISIONOS fails", () => {
  const clients = source.CLIENTS.map((c) => c.name);
  assert.deepEqual(clients, ["VISIONOS", "IOS"]);
});

test("picks the lowest-bitrate m4a from the player response", () => {
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

  // m4a carries a simple index allowing byte-level slicing; webm would need an EBML parser
  assert.equal(picked.url, "https://m4a-lo");
  assert.equal(picked.itag, 139);
  assert.equal(picked.contentLength, 123);
});

test("returns null when no format has a direct URL, so the caller can say why", () => {
  // The YouTube web client moved to SABR, so the list may carry no URLs at all
  assert.equal(
    source.pickAudioFormat({
      streamingData: { adaptiveFormats: [{ itag: 139, mimeType: "audio/mp4", bitrate: 5 }] },
    }),
    null,
  );
  assert.equal(source.pickAudioFormat(null), null);
});

test("webm alone is still usable rather than a dead end", () => {
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

test("reads the duration and the native caption track list", () => {
  const info = source.readVideoInfo({
    videoDetails: { lengthSeconds: "2336", title: "Title" },
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
  assert.equal(info.title, "Title");
  assert.equal(info.captionTracks.length, 2);
  assert.equal(info.captionTracks[0].languageCode, "zh");
  assert.equal(info.captionTracks[0].isAutomatic, false);
  assert.equal(info.captionTracks[1].isAutomatic, true);
});

test("no caption tracks returns an empty list, which is the signal to use AI", () => {
  const info = source.readVideoInfo({ videoDetails: { lengthSeconds: "60" } });
  assert.deepEqual(info.captionTracks, []);
});

test("native captions are requested in json3 format", () => {
  const url = source.captionUrl("https://www.youtube.com/api/timedtext?v=x&lang=zh");
  assert.match(url, /[?&]fmt=json3/);
});

test("converts json3 captions into the shared segment format", () => {
  const segments = source.parseCaptionJson({
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "first" }, { utf8: " line" }] },
      { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: "second line" }] },
      { tStartMs: 4000 },                                  // no text, should be skipped
      { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: "\n" }] },  // newline only, should be skipped
    ],
  });

  assert.deepEqual(segments, [
    { start: 0, end: 2, text: "first line" },
    { start: 2, end: 3.5, text: "second line" },
  ]);
});

test("an unexpected caption shape returns an empty array for the next layer", () => {
  assert.deepEqual(source.parseCaptionJson(null), []);
  assert.deepEqual(source.parseCaptionJson({ events: [] }), []);
});

test("m4a wins even at a higher bitrate, because only m4a can be sliced by time", () => {
  // Opus is more efficient, so in real videos webm often has the lower
  // bitrate. Sorting by bitrate alone would pick webm, which the sidx parser
  // cannot slice, breaking the whole feature.
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
