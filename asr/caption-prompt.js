/**
 * Copy for the AI captions prompt in the side panel.
 *
 * Kept as pure functions because this copy is about money: a wrong duration,
 * a miscalculated cost, or a missing quota warning means someone spends
 * without knowing, or a run dies halfway. That has to be assertable rather
 * than eyeballed in the UI.
 */
var YTD_CAPTION_PROMPT = (() => {
  function clock(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function humanDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m ? `${m} min ${s} sec` : `${s} sec`;
  }

  function money(usd) {
    // Anything under a cent still shows as $0.01 rather than $0.00,
    // which would read as free
    const value = Math.max(0.01, Number(usd) || 0);
    return `$${value.toFixed(2)}`;
  }

  function buildPrompt({ durationSeconds, estimatedUsd, provider, freeTier, hasKey }) {
    const parts = [humanDuration(durationSeconds), money(estimatedUsd)];

    let warning = "";
    if (freeTier?.secondsPerHour) {
      const share = Math.round((durationSeconds / freeTier.secondsPerHour) * 100);
      parts.push(`uses ${share}% of this hour\u0027s free ${provider} allowance`);
      if (durationSeconds > freeTier.secondsPerHour) {
        // Say it up front instead of letting the run hit the limit halfway
        warning = `This video is longer than one ${provider} free-tier window, so it will take two or more runs. Progress is saved, and you can resume once the allowance refills.`;
      }
    }

    return {
      summary: parts.join(" · "),
      warning,
      canStart: !!hasKey,
      action: hasKey ? "start" : "settings",
      actionLabel: hasKey ? "Generate AI captions" : `Add your ${provider} key in Settings`,
    };
  }

  function buildProgress({ completed, total, chunkSeconds }) {
    return `Transcribing ${completed}/${total} chunks - ${clock(completed * chunkSeconds)} done`;
  }

  function buildRateLimited({ completed, total, chunkSeconds, retryAfterSeconds }) {
    const minutes = Math.max(1, Math.round((retryAfterSeconds || 0) / 60));
    return {
      message:
        `${completed}/${total} chunks done (0:00-${clock(completed * chunkSeconds)} is readable now). ` +
        `The allowance refills in about ${minutes} min.`,
      canResume: true,
      retryAfterSeconds: retryAfterSeconds || null,
    };
  }

  return { buildPrompt, buildProgress, buildRateLimited, clock, humanDuration, money };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_CAPTION_PROMPT;
}
