/**
 * AI 字幕在侧边栏里的提示文案。
 *
 * 做成纯函数是因为这些文案关系到钱：说错时长、算错费用、
 * 漏掉额度提示，用户就会在不知情的情况下花钱或跑到一半失败。
 * 这类东西必须能直接断言，而不是靠肉眼看界面。
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
    return m ? `${m} 分 ${s} 秒` : `${s} 秒`;
  }

  function money(usd) {
    // 低于一分钱的也要显示成 $0.01 而不是 $0.00，
    // 否则看起来像免费
    const value = Math.max(0.01, Number(usd) || 0);
    return `$${value.toFixed(2)}`;
  }

  function buildPrompt({ durationSeconds, estimatedUsd, provider, freeTier, hasKey }) {
    const parts = [humanDuration(durationSeconds), money(estimatedUsd)];

    let warning = "";
    if (freeTier?.secondsPerHour) {
      const share = Math.round((durationSeconds / freeTier.secondsPerHour) * 100);
      parts.push(`会用掉 ${provider} 本小时免费额度的 ${share}%`);
      if (durationSeconds > freeTier.secondsPerHour) {
        // 提前说清楚，而不是让用户跑到一半才撞限流
        warning = `这个视频超过 ${provider} 单次免费额度的上限，会分两次或多次完成。中途会保存进度，额度恢复后可以接着跑。`;
      }
    }

    return {
      summary: parts.join(" · "),
      warning,
      canStart: !!hasKey,
      action: hasKey ? "start" : "settings",
      actionLabel: hasKey ? "生成 AI 字幕" : `在设置中填写 ${provider} 密钥`,
    };
  }

  function buildProgress({ completed, total, chunkSeconds }) {
    return `正在识别 ${completed}/${total} 段 · 已完成 ${clock(completed * chunkSeconds)}`;
  }

  function buildRateLimited({ completed, total, chunkSeconds, retryAfterSeconds }) {
    const minutes = Math.max(1, Math.round((retryAfterSeconds || 0) / 60));
    return {
      message:
        `已完成 ${completed}/${total} 段（0:00–${clock(completed * chunkSeconds)} 已可阅读）。` +
        `额度约 ${minutes} 分钟后恢复。`,
      canResume: true,
      retryAfterSeconds: retryAfterSeconds || null,
    };
  }

  return { buildPrompt, buildProgress, buildRateLimited, clock, humanDuration, money };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_CAPTION_PROMPT;
}
