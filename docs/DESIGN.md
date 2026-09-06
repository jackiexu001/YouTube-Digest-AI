# Design notes

Why this fork works the way it does. Every number below was measured, not estimated.

## AI captions

### Getting the audio is the hard part

The YouTube web client has moved to SABR. Its player response lists audio formats with
neither a direct URL nor a signature cipher, so the problem is not that URLs are
encrypted, it is that there are none. Reproduced from the page source:

```
web player response: 12 audio formats, 0 with url, 0 with cipher
serverAbrStreamingUrl: present
```

This rules out two approaches that look obvious. Watching the player's own media
requests does not work, because SABR requests carry no `mime=audio` parameter to filter
on. Porting ytdl-core's signature decryption does not work either, because there is no
signature to decrypt.

What does work is asking the same official endpoint as a different client. With the
page's anonymous `visitorData`, `VISIONOS` and `IOS` still return plain direct URLs and
need no signature decryption:

| Client | Result |
| --- | --- |
| VISIONOS | OK, 10 audio formats, 10 with URLs |
| IOS | OK, 10 audio formats, 10 with URLs |
| TVHTML5_SIMPLY_EMBEDDED_PLAYER | ERROR |
| WEB_EMBEDDED_PLAYER | ERROR |
| ANDROID_VR | LOGIN_REQUIRED |

That request must be issued from the page's own context (`world: "MAIN"`). Sent by the
extension it carries `Origin: chrome-extension://...`, which YouTube answers with 403,
and a browser will not let an extension forge Origin. No login cookie is used; the
anonymous visitorData is enough, so these requests are never tied to a YouTube account.

### Downloading must be parallel

Against the same URL:

| Method | Result |
| --- | --- |
| One sequential GET | 1.5 MB in three minutes (throttled) |
| Eight parallel ranged GETs | 8 MB in 2.7 seconds |

This is not an optimisation. Sequential download is unusable.

### Slicing needs no ffmpeg

itag 139 audio is a fragmented MP4: `ftyp -> moov -> sidx -> moof/mdat x N`. The sidx
gives each fragment's byte offset and duration, so the init segment plus any run of
consecutive fragments is a valid, decodable file. Verified against a real 14-minute
track:

```
index: 86 fragments, 856.073 s, 5,221,266 bytes - all exactly matching the player
slice at 10:00 for 10 minutes: 61 fragments, 3.54 MB, ffmpeg decodes with zero errors
timeline drift: 0.00 s
```

### WAV is mandatory, and it is the cheaper option

Sending an m4a slice to Groq fails with HTTP 500, every time. The full error explains why:

```
seconds of audio per hour (ASPH): Limit 7200, Used 5956, Requested 2336
```

That was a **30-second** slice, billed as **2336 seconds**, because Groq reads the
duration the container declares and the slice inherits the whole video's declaration.
The pipeline then crashes on a file holding 30 seconds of data.

| Format | Quota per chunk | 39-minute video |
| --- | --- | --- |
| m4a slice | 2336 s (whole video) | 8 x 2336 = 18,688 s |
| WAV | 300 s (real duration) | 2,336 s |

WAV declares the real duration, so it is the only correctly billed format. 16 kHz mono
is what Whisper resamples to internally, so the conversion costs no accuracy.

### Measured end to end

On a real 39-minute video, per 5-minute chunk:

| Stage | Time |
| --- | --- |
| Download audio (1.80 MB) | 0.15 s |
| Decode and convert to WAV (309.5 s of audio) | 0.93 s |
| Upload and transcribe | 5.26 s |
| **Per chunk** | **6.3 s** |

With two workers: first captions in about 6 seconds, whole video in about 25.

### Why three layers

1. **Native YouTube captions** - free, no quota, and almost every video stops here
2. **Supadata** - upstream's path, kept as a fallback for edge cases the first layer misses
3. **AI recognition** - offered only when neither has captions

When YouTube reports zero caption tracks, Supadata is skipped entirely: it runs in
native mode and reads the same source, so asking it would only burn a credit. When the
player request fails outright, Supadata decides instead, and if it also finds nothing
the AI button is **not** offered, because without player info there is no audio URL and
the button would be an action guaranteed to fail.

### Cross-context work

Three operations run in the page's context rather than the service worker:

- The player request and the caption download, because of the Origin restriction above
- Audio download, because googlevideo only allows CORS for a youtube.com origin
- Audio decoding, because a service worker has no AudioContext

Results come back as base64. This is the part unit tests cannot cover, and it was
validated by running the whole chain against a real video.

## Multiple AI providers

Upstream is fixed to DeepSeek and deliberately so: it removed custom provider support
and its tests assert that no provider selector exists. This fork goes the other way, so
those assertions are inverted. That is a deliberate divergence, not an oversight.

Three adapters cover every provider. DeepSeek, OpenAI, Zhipu GLM and any
OpenAI-compatible endpoint share one; Anthropic and Gemini each need their own because
their auth headers, request bodies and response shapes all differ.

Base URLs are stored complete. Providers disagree on the path prefix - Zhipu uses
`/api/paas/v4`, not `/v1` - so the code appends only the endpoint and never assembles
`/v1` itself, which is a common source of 404s.

Two provider-specific details that unit tests cannot catch, both found by checking the
official documentation:

- Anthropic rejects browser-originated requests unless
  `anthropic-dangerous-direct-browser-access` is set. Without it the entire provider is
  unusable in an extension.
- Default model names go stale fast. OpenAI moved from `gpt-5` to `gpt-5.6` within
  months. The defaults exist only to make the first call succeed; the **Fetch models**
  button pulls the live list.

Keys are stored per provider, so a key entered for one is never sent to another. That
safety property came from upstream's migration logic and is asserted explicitly here.

## Testing

Every module's logic is covered by unit tests, and the parts with real algorithmic risk
were also mutation tested: the implementation is deliberately broken to check the tests
notice. That found seven defects unit tests alone had passed over, including:

- Range splitting dropped trailing bytes when the range did not divide evenly
- Chunks arriving out of order produced out-of-order captions, which happens whenever
  two workers run
- The rate-limit guard only worked with a single worker, so in real use the remaining
  chunks would each hit 429 in turn
- Sorting audio formats by bitrate alone picks webm, which the sidx parser cannot slice.
  Opus is more efficient, so in real videos webm often *is* the lower bitrate. This
  would have broken the feature on most videos while passing every test.
