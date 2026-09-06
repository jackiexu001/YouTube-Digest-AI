/**
 * Speech recognition providers.
 *
 * Separate from the text model that writes overviews and translations: this
 * only turns audio into timestamped text. Groq and OpenAI both expose the
 * Whisper shape, so they share one request format.
 */
var YTD_ASR_PROVIDERS = (() => {
  const PROVIDERS = Object.freeze([
    {
      id: "groq",
      label: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "whisper-large-v3-turbo",
      keyUrl: "https://console.groq.com/keys",
      // Official pricing: about $0.04 per hour of audio
      usdPerAudioHour: 0.04,
      // Free-tier limits, used for warning up front (console.groq.com/docs/rate-limits)
      freeTier: { secondsPerHour: 7200, secondsPerDay: 28800 },
    },
    {
      id: "openai",
      label: "OpenAI Whisper",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "whisper-1",
      keyUrl: "https://platform.openai.com/api-keys",
      usdPerAudioHour: 0.36,
      freeTier: null,
    },
  ]);

  const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

  function listProviders() {
    return PROVIDERS.map((p) => ({ ...p }));
  }

  function getProvider(providerId) {
    return BY_ID[providerId] || BY_ID.groq;
  }

  /**
   * Builds a transcription request. Returns a description rather than a
   * FormData so the pure logic stays testable under Node; the caller
   * constructs the FormData.
   */
  function buildTranscriptionRequest({ providerId, apiKey, language, model, prompt }) {
    const provider = getProvider(providerId);
    const fields = {
      model: model || provider.defaultModel,
      response_format: "verbose_json",
      temperature: "0",
      // Without segment timestamps there is no way to align to the video
      "timestamp_granularities[]": "segment",
    };
    if (language && language !== "auto") fields.language = language;
    if (prompt) fields.prompt = prompt;

    return {
      url: `${provider.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`,
      headers: { Authorization: `Bearer ${apiKey}` },
      fields,
    };
  }

  function extractSegments(data) {
    const segments = data?.segments;
    if (Array.isArray(segments) && segments.length) {
      return segments
        .map((item) => ({
          start: Number(item?.start) || 0,
          end: Number(item?.end) || 0,
          text: String(item?.text ?? "").trim(),
        }))
        .filter((item) => item.text);
    }
    // Very short audio sometimes returns plain text only; one segment beats none
    const text = String(data?.text ?? "").trim();
    return text ? [{ start: 0, end: 0, text }] : [];
  }

  /** Reads the wait time out of a rate-limit error, from the body or the header. */
  function retryAfterSeconds(body, header) {
    const text = String(body || "");
    const minuteMatch = text.match(/try again in ([0-9.]+)m([0-9.]+)s/i);
    if (minuteMatch) {
      return Math.ceil(parseFloat(minuteMatch[1]) * 60 + parseFloat(minuteMatch[2]));
    }
    const secondMatch = text.match(/try again in ([0-9.]+)s/i);
    if (secondMatch) return Math.ceil(parseFloat(secondMatch[1]));

    const fromHeader = parseFloat(header);
    return Number.isFinite(fromHeader) ? Math.ceil(fromHeader) : null;
  }

  /** Reads the quota numbers out of a rate-limit error, to show what is left. */
  function parseQuota(message) {
    const match = String(message || "").match(
      /Limit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)/i,
    );
    if (!match) return null;
    return {
      limit: Number(match[1]),
      used: Number(match[2]),
      requested: Number(match[3]),
    };
  }

  function estimateCost({ providerId, seconds }) {
    const provider = getProvider(providerId);
    return (Number(seconds) || 0) / 3600 * provider.usdPerAudioHour;
  }

  return {
    PROVIDERS,
    listProviders,
    getProvider,
    buildTranscriptionRequest,
    extractSegments,
    retryAfterSeconds,
    parseQuota,
    estimateCost,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_ASR_PROVIDERS;
}
