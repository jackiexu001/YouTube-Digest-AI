// ============================================================
// 音频探针 —— 一次性验证脚本
// ============================================================
// 目的：证明（或证伪）以下这条链路能在真实 Chrome 扩展里跑通：
//   拿到音频地址 → 分段下载 → 按时间切片 → 送去识别 → 得到带时间戳的字幕

const logEl = document.getElementById("log");
const runBtn = document.getElementById("run");
const keyEl = document.getElementById("key");

let firstWrite = true;
function say(text, cls = "") {
  if (firstWrite) { logEl.textContent = ""; logEl.className = ""; firstWrite = false; }
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text + "\n";
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}
const head = (t) => { const s = document.createElement("span"); s.className = "head"; s.textContent = t; logEl.appendChild(s); };
const ok = (t) => say("  ✅ " + t, "ok");
const bad = (t) => say("  ❌ " + t, "bad");
const warn = (t) => say("  ⚠️  " + t, "warn");
const dim = (t) => say("  " + t, "dim");

// ------------------------------------------------------------
// 地址清洗：播放器发出的地址带着它自己的分段参数和封装开关，
// 要剥掉，否则拿回来的不是裸音频。
// ------------------------------------------------------------
const STRIP_PARAMS = ["range", "rn", "rbuf", "ump", "srfvp", "sabr", "alr", "cmo"];
function cleanUrl(rawUrl) {
  const u = new URL(rawUrl);
  const removed = [];
  for (const p of STRIP_PARAMS) {
    if (u.searchParams.has(p)) { removed.push(p + "=" + u.searchParams.get(p)); u.searchParams.delete(p); }
  }
  return { url: u.toString(), removed };
}

// ------------------------------------------------------------
// 分段下载：一次要一段字节
// ------------------------------------------------------------
// 设为标签页 id 后，所有下载改从网页环境走（Origin 是 youtube.com）
let PAGE_FETCH_TAB = null;

async function fetchRange(url, start, end) {
  if (PAGE_FETCH_TAB !== null) return fetchRangeViaPage(PAGE_FETCH_TAB, url, start, end);
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return { buf, status: res.status };
}

// 兜底：在网页环境里下载，再用 base64 把字节搬回弹窗
async function fetchRangeViaPage(tabId, url, start, end) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [url, start, end],
    func: async (u, st, en) => {
      try {
        const r = await fetch(u, { headers: { Range: `bytes=${st}-${en}` }, credentials: "omit" });
        if (!r.ok) return { error: `HTTP ${r.status}` };
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return { status: r.status, b64: btoa(bin) };
      } catch (err) {
        return { error: String((err && err.message) || err) };
      }
    },
  });
  if (!result || result.error) throw new Error(result?.error || "网页环境取数失败");
  const bin = atob(result.b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { buf: out.buffer, status: result.status };
}

// ------------------------------------------------------------
// 解析 MP4 顶层盒子结构
// ------------------------------------------------------------
function parseBoxes(buf) {
  const dv = new DataView(buf);
  const boxes = [];
  let off = 0;
  while (off + 8 <= buf.byteLength) {
    let size = dv.getUint32(off);
    const type = String.fromCharCode(dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7));
    if (size === 1) {
      if (off + 16 > buf.byteLength) break;
      size = Number(dv.getBigUint64(off + 8));
    }
    if (size < 8) break;
    boxes.push({ type, offset: off, size });
    off += size;
  }
  return boxes;
}

// ------------------------------------------------------------
// 解析 sidx 索引表 —— 这张表告诉我们"第几秒在第几个字节"
// ------------------------------------------------------------
function parseSidx(buf, sidxOffset, sidxSize) {
  const dv = new DataView(buf);
  let p = sidxOffset + 8;
  const version = dv.getUint8(p);
  p += 4;                       // version(1) + flags(3)
  p += 4;                       // reference_ID
  const timescale = dv.getUint32(p); p += 4;
  let firstOffset;
  if (version === 0) {
    p += 4;                     // earliest_presentation_time
    firstOffset = dv.getUint32(p); p += 4;
  } else {
    p += 8;
    firstOffset = Number(dv.getBigUint64(p)); p += 8;
  }
  p += 2;                       // reserved
  const count = dv.getUint16(p); p += 2;

  const refs = [];
  let byteCursor = sidxOffset + sidxSize + firstOffset;
  let timeCursor = 0;
  for (let i = 0; i < count; i++) {
    const refSize = dv.getUint32(p) & 0x7fffffff; p += 4;
    const dur = dv.getUint32(p); p += 4;
    p += 4;                     // SAP 信息，用不上
    refs.push({
      start: byteCursor,
      end: byteCursor + refSize - 1,
      startTime: timeCursor / timescale,
      duration: dur / timescale,
    });
    byteCursor += refSize;
    timeCursor += dur;
  }
  return { timescale, refs, totalSeconds: timeCursor / timescale, totalBytes: byteCursor };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const mb = (b) => (b / 1048576).toFixed(2) + " MB";

// 把 init 段里的 sidx 索引表剔掉。索引表描述的是整个视频的全部片段，
// 但切片只包含其中一部分，解码器照着它找会读到文件外面。
function stripSidx(bytes) {
  const boxes = parseBoxes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const sidx = boxes.find((b) => b.type === "sidx");
  if (!sidx) return bytes;
  const out = new Uint8Array(bytes.byteLength - sidx.size);
  out.set(bytes.subarray(0, sidx.offset), 0);
  out.set(bytes.subarray(sidx.offset + sidx.size), sidx.offset);
  return out;
}

// 解码后重新编码成 16kHz 单声道 WAV。
// Whisper 内部就是 16kHz 单声道，所以这样不损失识别质量，
// 而且 WAV 格式最简单，不存在容器元数据对不上的问题。
async function toWav16kMono(bytes) {
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } finally {
    ctx.close();
  }
  const RATE = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);

  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const ascii = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  ascii(0, "RIFF");  out.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");  ascii(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, RATE, true); out.setUint32(28, RATE * 2, true);
  out.setUint16(32, 2, true);  out.setUint16(34, 16, true);
  ascii(36, "data"); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return { bytes: new Uint8Array(out.buffer), seconds: decoded.duration };
}

const apiKeyNow = () => keyEl.value.trim();

// 并行分段下载整个文件，返回拼好的字节
async function fetchAllParallel(url, totalBytes, conc = 8) {
  const sliceSize = Math.ceil(totalBytes / conc);
  const parts = await Promise.all(
    Array.from({ length: conc }, (_, i) => {
      const st = i * sliceSize;
      const en = Math.min(st + sliceSize - 1, totalBytes - 1);
      return st > en ? Promise.resolve({ buf: new ArrayBuffer(0) }) : fetchRange(url, st, en);
    })
  );
  const total = parts.reduce((n, x) => n + x.buf.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of parts) { out.set(new Uint8Array(x.buf), o); o += x.buf.byteLength; }
  return out;
}

// 把一段音频送去 Groq，打印前几条字幕
// Groq 撞限流时会在错误信息里写明还要等多久，解析出来
function retrySeconds(body, header) {
  const m = String(body).match(/try again in ([0-9.]+)m([0-9.]+)s/i)
        || String(body).match(/try again in ([0-9.]+)s/i);
  if (m) return m.length === 3 ? Math.ceil(parseFloat(m[1]) * 60 + parseFloat(m[2])) : Math.ceil(parseFloat(m[1]));
  const h = parseFloat(header);
  return Number.isFinite(h) ? Math.ceil(h) : null;
}

async function sendToGroq(bytes, mimeType, filename, apiKey, timeOffset = 0) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mimeType }), filename);
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "segment");
  fd.append("temperature", "0");

  const t = performance.now();
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: "Bearer " + apiKey }, body: fd,
  });
  const secs = ((performance.now() - t) / 1000).toFixed(1);
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, http: res.status, detail: `HTTP ${res.status} ${body.slice(0, 400)}`,
             retryAfter: retrySeconds(body, res.headers.get("retry-after")) };
  }
  const data = await res.json();
  const segs = data.segments || [];
  return { ok: true, secs, segs, language: data.language || "未知", timeOffset };
}

// webm/opus 分支：不做切片，整段下载后直接识别
async function webmFallback(url, apiKey) {
  head("步骤 3（webm 分支）· 整段下载测速");
  let totalBytes = null;
  try {
    const probe = await fetch(url, { headers: { Range: "bytes=0-1" } });
    const cr = probe.headers.get("content-range");
    if (cr) totalBytes = Number(cr.split("/")[1]);
  } catch (e) { /* 下面会兜底 */ }
  if (!totalBytes) { bad("拿不到文件总大小，无法分段下载。"); return; }
  ok(`音频总大小 ${mb(totalBytes)}`);

  const t0 = performance.now();
  const bytes = await fetchAllParallel(url, totalBytes, 8);
  const el = (performance.now() - t0) / 1000;
  ok(`8 条并行，${el.toFixed(2)} 秒下完 ${mb(bytes.byteLength)}（约 ${(bytes.byteLength / 1048576 / el).toFixed(1)} MB/秒）`);

  head("步骤 4（webm 分支）· 送去 Groq 识别");
  if (!apiKey) { dim("   没填 Key，跳过。"); say("\n下载链路已验证通过。", "ok"); return; }
  if (bytes.byteLength > 24 * 1048576) { warn(`${mb(bytes.byteLength)} 超过 Groq 单次 25MB 上限，跳过。`); return; }
  const r = await sendToGroq(bytes, "audio/webm", "audio.webm", apiKey, 0);
  if (!r.ok) { bad("失败：" + r.detail); return; }
  ok(`识别成功：${r.secs} 秒返回 ${r.segs.length} 段字幕，语种 ${r.language}`);
  for (const sg of r.segs.slice(0, 5)) say(`  [${mmss(sg.start)}] ${sg.text.trim()}`);
  say("\n全链路验证通过（webm 整段模式）。", "ok");
}

// ============================================================
// 主流程
// ============================================================
async function run() {
  runBtn.disabled = true;
  PAGE_FETCH_TAB = null;
  logEl.textContent = "";
  logEl.className = "";
  firstWrite = false;

  try {
    // ---------- 步骤 0：确认在 YouTube 视频页 ----------
    head("步骤 0 · 确认当前页面");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/(www\.)?youtube\.com\/watch/.test(tab.url || "")) {
      bad("当前标签页不是 YouTube 视频页。请先打开一个 youtube.com/watch?v=... 页面。");
      return;
    }
    const videoId = new URL(tab.url).searchParams.get("v");
    ok(`视频 ID：${videoId}`);

    // ---------- 步骤 1：从页面读匿名会话标识 ----------
    // YouTube 网页版现在走 SABR，格式里不再带地址。但换一个客户端身份去问
    // 官方接口，仍然会给直连地址 —— 前提是带上页面里的 visitorData。
    head("步骤 1 · 从页面读取匿名会话标识 visitorData");
    let pageInfo;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => {
          const cfg = window.ytcfg;
          let vd =
            cfg?.get?.("INNERTUBE_CONTEXT")?.client?.visitorData ||
            cfg?.data_?.INNERTUBE_CONTEXT?.client?.visitorData || null;
          if (!vd) {
            const m = document.documentElement.innerHTML.match(/"visitorData":"([^"]+)"/);
            if (m) { try { vd = JSON.parse('"' + m[1] + '"'); } catch (e) { vd = m[1]; } }
          }
          const pr = document.getElementById("movie_player")?.getPlayerResponse?.();
          const sd = pr?.streamingData;
          const aud = (sd?.adaptiveFormats || []).filter((f) => String(f.mimeType || "").startsWith("audio"));
          return {
            visitorData: vd,
            durationSeconds: Number(pr?.videoDetails?.lengthSeconds) || null,
            captionTracks: (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).map((t) => t.languageCode),
            webAudioCount: aud.length,
            webAudioWithUrl: aud.filter((f) => f.url).length,
            hasServerAbr: !!sd?.serverAbrStreamingUrl,
          };
        },
      });
      pageInfo = result;
    } catch (e) {
      bad("读页面失败：" + e.message);
      return;
    }
    if (!pageInfo?.visitorData) { bad("页面里读不到 visitorData，无法继续。"); return; }
    ok(`拿到 visitorData（${pageInfo.visitorData.length} 字符）`);
    dim(`   视频时长 ${mmss(pageInfo.durationSeconds || 0)}，自带字幕轨 ${pageInfo.captionTracks.length ? pageInfo.captionTracks.join("/") : "无"}`);
    dim(`   网页版自己的格式：${pageInfo.webAudioCount} 个音频，其中带地址 ${pageInfo.webAudioWithUrl} 个，SABR 地址 ${pageInfo.hasServerAbr ? "存在" : "不存在"}`);

    // ---------- 步骤 1.5：换客户端身份去要直连地址 ----------
    head("步骤 1.5 · 换客户端身份向 YouTube 官方接口要直连地址");
    // 关键：这个请求必须在【网页自己的环境里】发出。
    // 扩展直接发会带上 Origin: chrome-extension://...，YouTube 直接 403。
    // 放进页面 MAIN world 发，Origin 就是 https://www.youtube.com，和网页自己的请求一样。
    dim("   在网页环境内发起请求（扩展自己发会被 403 拒绝）");

    let attempt;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [videoId, pageInfo.visitorData],
        func: async (vid, visitorData) => {
          const CLIENTS = [
            { name: "VISIONOS", version: "1.02", num: 101,
              extra: { deviceMake: "Apple", deviceModel: "RealityDevice17,1", osName: "visionOS", osVersion: "26.5.23O471" } },
            { name: "IOS", version: "20.10.4", num: 5,
              extra: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" } },
          ];
          const tried = [];
          for (const c of CLIENTS) {
            try {
              const res = await fetch("/youtubei/v1/player", {
                method: "POST",
                // 同源请求，Origin 正确；同时不带登录 Cookie
                credentials: "omit",
                headers: {
                  "Content-Type": "application/json",
                  "X-YouTube-Client-Name": String(c.num),
                  "X-YouTube-Client-Version": c.version,
                  "X-Goog-Visitor-Id": visitorData,
                },
                body: JSON.stringify({
                  context: { client: { clientName: c.name, clientVersion: c.version, hl: "en", gl: "US",
                                       visitorData, ...c.extra } },
                  videoId: vid, contentCheckOk: true, racyCheckOk: true,
                }),
              });
              if (!res.ok) {
                tried.push({ name: c.name, http: res.status, body: (await res.text()).slice(0, 200) });
                continue;
              }
              const data = await res.json();
              const status = data?.playabilityStatus?.status;
              const audio = (data?.streamingData?.adaptiveFormats || [])
                .filter((f) => String(f.mimeType || "").startsWith("audio"));
              const withUrl = audio.filter((f) => f.url);
              tried.push({ name: c.name, http: 200, status, audio: audio.length, withUrl: withUrl.length,
                           reason: data?.playabilityStatus?.reason || "" });
              if (!withUrl.length) continue;

              const byBitrate = (x, y) => (x.bitrate || 9e9) - (y.bitrate || 9e9);
              const m4a = withUrl.filter((f) => f.mimeType.includes("mp4")).sort(byBitrate);
              const pick = m4a[0] || withUrl.sort(byBitrate)[0];
              return { ok: true, client: c.name, tried,
                       fmt: { itag: pick.itag, mimeType: pick.mimeType, bitrate: pick.bitrate,
                              contentLength: pick.contentLength, url: pick.url } };
            } catch (e) {
              tried.push({ name: c.name, error: String(e && e.message || e) });
            }
          }
          return { ok: false, tried };
        },
      });
      attempt = result;
    } catch (e) {
      bad("在网页环境内执行失败：" + e.message);
      return;
    }

    for (const t of attempt?.tried || []) {
      if (t.error) warn(`${t.name}：出错 ${t.error}`);
      else if (t.http !== 200) { warn(`${t.name}：HTTP ${t.http}`); if (t.body) dim(`   ${t.body}`); }
      else say(`  ${t.name}：${t.status}，音频 ${t.audio} 个，带直连地址 ${t.withUrl} 个${t.reason ? "（" + t.reason + "）" : ""}`,
               t.withUrl ? "ok" : "warn");
    }
    if (!attempt?.ok) { bad("所有客户端身份都拿不到直连地址，这条路走不通。"); return; }

    const chosen = { client: attempt.client, fmt: attempt.fmt };
    const f = chosen.fmt;
    ok(`采用 ${chosen.client} 的 itag=${f.itag}，${Math.round((f.bitrate || 0) / 1000)}kbps ${f.mimeType.split(";")[0]}，${mb(Number(f.contentLength || 0))}`);
    const { url, removed } = cleanUrl(f.url);
    if (removed.length) dim(`   已剥掉的参数：${removed.join("  ")}`);

    // 附带诊断：偷听到的播放器请求长什么样（帮我了解 SABR 的形态）
    const captured = await chrome.runtime.sendMessage({ type: "GET_CAPTURED_AUDIO_URL", tabId: tab.id });
    if (captured) dim(`   [诊断] 偷听到播放器请求 ${captured.count} 条，示例：${captured.method} ...&${captured.sampleParams}`);
    else dim("   [诊断] 没偷听到播放器的媒体请求");

    // ---------- 步骤 2：抓文件头 ----------
    head("步骤 2 · 下载文件头，确认拿到的是裸音频");
    let headBuf;
    try {
      const r = await fetchRange(url, 0, 8191);
      headBuf = r.buf;
      ok(`扩展直接下载成功：HTTP ${r.status}，收到 ${r.buf.byteLength} 字节`);
    } catch (e) {
      warn("扩展直接下载失败：" + e.message);
      dim("   自动改从网页环境下载重试…");
      PAGE_FETCH_TAB = tab.id;
      try {
        const r2 = await fetchRange(url, 0, 8191);
        headBuf = r2.buf;
        ok(`网页环境下载成功：HTTP ${r2.status}，收到 ${r2.buf.byteLength} 字节`);
        dim("   （说明正式版的下载必须走网页环境，不能由扩展直接发）");
      } catch (e2) {
        bad("两种下载方式都失败：" + e2.message);
        return;
      }
    }

    const boxes = parseBoxes(headBuf);
    const types = boxes.map((b) => b.type);
    const isWebm = new DataView(headBuf).getUint32(0) === 0x1a45dfa3; // EBML 魔数
    if (isWebm) {
      warn("这是 webm/opus 容器，不是 mp4。分段下载本身没问题，但按时间切片需要另写 EBML 解析。");
      await webmFallback(url, apiKeyNow());
      return;
    }
    if (!types.includes("ftyp")) {
      bad(`开头既不是 MP4 也不是 webm（前 4 字节：${[...new Uint8Array(headBuf, 0, 4)].map((b) => b.toString(16)).join(" ")}）。`);
      bad("很可能被 UMP/SABR 封装了 —— 这是本次验证最需要知道的结论，请把这一行告诉我。");
      return;
    }
    ok(`确认是裸 MP4 音频，顶层结构：${types.join(" → ")}`);

    const sidxBox = boxes.find((b) => b.type === "sidx");
    if (!sidxBox) {
      bad("没找到 sidx 索引表，无法按时间精确切片。");
      return;
    }

    // ---------- 步骤 3：解析索引表 ----------
    head("步骤 3 · 解析 sidx 索引表（时间 → 字节的对照表）");
    const idx = parseSidx(headBuf, sidxBox.offset, sidxBox.size);
    const initEnd = idx.refs[0].start - 1;
    ok(`索引表读出 ${idx.refs.length} 个片段，总时长 ${mmss(idx.totalSeconds)}，总大小 ${mb(idx.totalBytes)}`);
    dim(`   文件头（init 段）= 前 ${initEnd + 1} 字节；每个片段约 ${(idx.refs[0].duration).toFixed(1)} 秒`);

    // ---------- 步骤 4：并行分段下载测速 ----------
    head("步骤 4 · 并行分段下载测速");
    const CONC = 8;
    const cap = PAGE_FETCH_TAB === null ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
    if (PAGE_FETCH_TAB !== null) dim("   走网页环境，样本缩小到 2MB（base64 搬运开销大，速度不代表正式版）");
    const testBytes = Math.min(idx.totalBytes, cap);
    const sliceSize = Math.ceil(testBytes / CONC);
    const t0 = performance.now();
    const parts = await Promise.all(
      Array.from({ length: CONC }, (_, i) => {
        const s = i * sliceSize;
        const e = Math.min(s + sliceSize - 1, testBytes - 1);
        return s > e ? Promise.resolve({ buf: new ArrayBuffer(0) }) : fetchRange(url, s, e);
      })
    );
    const elapsed = (performance.now() - t0) / 1000;
    const got = parts.reduce((n, p) => n + p.buf.byteLength, 0);
    ok(`${CONC} 条并行，${elapsed.toFixed(2)} 秒下载 ${mb(got)}（约 ${(got / 1048576 / elapsed).toFixed(1)} MB/秒）`);
    const estFull = (idx.totalBytes / (got / elapsed)).toFixed(1);
    dim(`   照这个速度，整段音频约 ${estFull} 秒下完`);

    // ---------- 步骤 5：按时间切一段出来 ----------
    head("步骤 5 · 按时间切片（不用 ffmpeg，纯字节拼接）");
    const WANT_START = Math.min(60, Math.max(0, idx.totalSeconds - 120));
    const WANT_LEN = Math.min(120, idx.totalSeconds - WANT_START);
    const picked = idx.refs.filter((r) => r.startTime + r.duration > WANT_START && r.startTime < WANT_START + WANT_LEN);
    if (!picked.length) { bad("按时间挑不出片段。"); return; }
    const byteStart = picked[0].start;
    const byteEnd = picked[picked.length - 1].end;
    dim(`   想要 ${mmss(WANT_START)} 起 ${WANT_LEN.toFixed(0)} 秒 → 命中 ${picked.length} 个片段 → 字节 ${byteStart}-${byteEnd}`);

    const [initPart, bodyPart] = await Promise.all([fetchRange(url, 0, initEnd), fetchRange(url, byteStart, byteEnd)]);
    const chunk = new Uint8Array(initPart.buf.byteLength + bodyPart.buf.byteLength);
    chunk.set(new Uint8Array(initPart.buf), 0);
    chunk.set(new Uint8Array(bodyPart.buf), initPart.buf.byteLength);
    ok(`拼出切片：文件头 ${initPart.buf.byteLength} 字节 + 音频数据 ${bodyPart.buf.byteLength} 字节 = ${mb(chunk.byteLength)}`);

    // ---------- 步骤 6：验证切片真的能解码 ----------
    head("步骤 6 · 验证这个切片是不是真的能放出声音");
    try {
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(chunk.buffer.slice(0));
      ok(`解码成功：${decoded.duration.toFixed(1)} 秒真实音频，${decoded.sampleRate}Hz，${decoded.numberOfChannels} 声道`);
      const drift = Math.abs(decoded.duration - picked.reduce((n, r) => n + r.duration, 0));
      if (drift < 1.5) ok(`时长和索引表对得上（误差 ${drift.toFixed(2)} 秒）—— 时间轴可以精确对齐`);
      else warn(`时长和索引表差 ${drift.toFixed(2)} 秒，时间轴对齐需要额外校正`);
      ctx.close();
    } catch (e) {
      warn("Chrome 内置解码器不接受这个切片：" + e.message);
      dim("   注意：这不代表切片无效。Chrome 的解码器比较挑剔，而 Whisper 用的是 ffmpeg。");
      dim("   下一步的 Groq 识别才是决定性证据。");
    }

    // ---------- 步骤 7：真实 5 分钟分段的端到端计时 ----------
    const apiKey = keyEl.value.trim();
    head("步骤 7 · 真实 5 分钟分段的端到端计时");
    if (!apiKey) {
      dim("   没填 Key，跳过计时。（前 6 步已经证明音频链路通了）");
      say("\n音频链路验证完成。", "ok");
      return;
    }

    // 用正式版打算采用的参数：5 分钟一段
    const CHUNK_SECONDS = 300;
    const chunkStart = Math.min(300, Math.max(0, idx.totalSeconds - CHUNK_SECONDS));
    const seg = idx.refs.filter((r) => r.startTime + r.duration > chunkStart && r.startTime < chunkStart + CHUNK_SECONDS);
    dim(`   取 ${mmss(chunkStart)} 起 5 分钟，共 ${seg.length} 个片段`);

    const timing = {};

    // ① 下载
    let t = performance.now();
    const [ip, bp] = await Promise.all([
      fetchRange(url, 0, initEnd),
      fetchRange(url, seg[0].start, seg[seg.length - 1].end),
    ]);
    const raw = new Uint8Array(ip.buf.byteLength + bp.buf.byteLength);
    raw.set(new Uint8Array(ip.buf), 0);
    raw.set(new Uint8Array(bp.buf), ip.buf.byteLength);
    timing.download = (performance.now() - t) / 1000;
    ok(`① 下载音频：${timing.download.toFixed(2)} 秒（${mb(raw.byteLength)}）`);

    // ② 解码 + 转 WAV（这一步是 CPU 活，之前从没单独计过时）
    t = performance.now();
    let wav;
    try {
      wav = await toWav16kMono(raw);
    } catch (e) {
      bad("转 WAV 失败：" + e.message);
      return;
    }
    timing.transcode = (performance.now() - t) / 1000;
    ok(`② 解码 + 转 WAV：${timing.transcode.toFixed(2)} 秒（${mb(wav.bytes.byteLength)}，${wav.seconds.toFixed(1)} 秒音频）`);

    // ③ 上传 + 识别
    t = performance.now();
    let r;
    try {
      r = await sendToGroq(wav.bytes, "audio/wav", "chunk.wav", apiKey, seg[0].startTime);
    } catch (e) {
      r = { ok: false, detail: e.message };
    }
    if (!r.ok && r.http === 429 && r.retryAfter && r.retryAfter <= 120) {
      warn(`撞到限流，等 ${r.retryAfter} 秒后自动重试…`);
      await new Promise((res) => setTimeout(res, (r.retryAfter + 1) * 1000));
      t = performance.now();
      try { r = await sendToGroq(wav.bytes, "audio/wav", "chunk.wav", apiKey, seg[0].startTime); }
      catch (e) { r = { ok: false, detail: e.message }; }
    }
    if (!r.ok) { bad(`③ 上传 + 识别失败：${r.detail}`); return; }
    timing.upload_asr = (performance.now() - t) / 1000;
    ok(`③ 上传 + 识别：${timing.upload_asr.toFixed(2)} 秒（返回 ${r.segs.length} 段字幕）`);

    // ---------- 算总账 ----------
    const one = timing.download + timing.transcode + timing.upload_asr;
    const chunks = Math.ceil(idx.totalSeconds / CHUNK_SECONDS);
    head("推算整个视频");
    say(`  单段耗时：${one.toFixed(1)} 秒  =  下载 ${timing.download.toFixed(1)} + 转码 ${timing.transcode.toFixed(1)} + 上传识别 ${timing.upload_asr.toFixed(1)}`);
    say(`  视频 ${mmss(idx.totalSeconds)} → 共 ${chunks} 段，2 路并发`);
    ok(`  第一段字幕出现：约 ${one.toFixed(0)} 秒`);
    ok(`  全部完成：约 ${(one * Math.ceil(chunks / 2)).toFixed(0)} 秒`);

    const slowest = Object.entries(timing).sort((x, y) => y[1] - x[1])[0];
    const nameMap = { download: "下载音频", transcode: "解码转码", upload_asr: "上传 + 识别" };
    dim(`  最慢的环节是「${nameMap[slowest[0]]}」，占单段的 ${((slowest[1] / one) * 100).toFixed(0)}%`);

    head("字幕预览");
    for (const sg of r.segs.slice(0, 5)) say(`  [${mmss(sg.start + r.timeOffset)}] ${sg.text.trim()}`);
    say("\n计时完成。", "ok");
  } catch (e) {
    bad("意外错误：" + (e && e.stack ? e.stack : e));
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", run);
