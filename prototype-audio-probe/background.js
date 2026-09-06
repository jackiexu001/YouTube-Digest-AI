// ============================================================
// 后台脚本：纯诊断用途
// ============================================================
// 原方案想"偷听"播放器的音频请求来拿地址。实测 YouTube 网页版已经切到
// SABR（服务端自适应码率），请求参数里不再有 mime=audio，所以偷听拿不到。
// 现在这个监听器只保留诊断价值：记录播放器到底发了什么样的媒体请求。

const statsByTab = new Map();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    let parsed;
    try { parsed = new URL(details.url); } catch (e) { return; }

    const stat = statsByTab.get(details.tabId) || { count: 0, method: "", sampleParams: "" };
    stat.count += 1;

    // 只记一次样本，挑几个能说明形态的参数
    if (!stat.sampleParams) {
      const interesting = ["mime", "itag", "sabr", "ump", "srfvp", "range", "alr"];
      stat.method = details.method;
      stat.sampleParams = interesting
        .filter((k) => parsed.searchParams.has(k))
        .map((k) => `${k}=${parsed.searchParams.get(k)}`)
        .join("&") || "(这几个参数一个都没有)";
    }
    statsByTab.set(details.tabId, stat);
  },
  { urls: ["*://*.googlevideo.com/videoplayback*"] }
);

chrome.tabs.onRemoved.addListener((tabId) => statsByTab.delete(tabId));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_CAPTURED_AUDIO_URL") {
    sendResponse(statsByTab.get(message.tabId) || null);
  }
  return false;
});
