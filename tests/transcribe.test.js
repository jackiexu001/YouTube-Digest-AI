const test = require("node:test");
const assert = require("node:assert/strict");

const transcribe = require("../asr/transcribe.js");

/** 造一份分块计划，模拟 planChunks 的产出 */
const plan = (count) =>
  Array.from({ length: count }, (_, i) => ({
    requestedStart: i * 300,
    startTime: i === 0 ? 0 : i * 300 - 10,
    endTime: (i + 1) * 300,
    byteStart: i * 1000,
    byteEnd: (i + 1) * 1000 - 1,
    fragmentCount: 10,
  }));

/** 一个总是成功的假识别器，记录调用顺序与并发峰值 */
function recorder({ failOn = [], rateLimitOn = [] } = {}) {
  const calls = [];
  let active = 0;
  let peak = 0;
  return {
    calls,
    get peakConcurrency() { return peak; },
    async run(chunk, index) {
      active += 1;
      peak = Math.max(peak, active);
      calls.push(index);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (rateLimitOn.includes(index)) {
        const error = new Error("Rate limit reached. Please try again in 9m6s.");
        error.status = 429;
        error.retryAfter = 546;
        throw error;
      }
      if (failOn.includes(index)) throw new Error("识别失败");
      return [{ start: 1, end: 2, text: `第${index}块` }];
    },
  };
}

test("按计划逐块识别，结果带上各自的时间偏移", async () => {
  const rec = recorder();
  const result = await transcribe.run({
    chunks: plan(3),
    transcribeChunk: rec.run,
    concurrency: 2,
  });

  assert.equal(result.completed, 3);
  assert.equal(result.segments.length, 3);
  assert.equal(result.segments[0].start, 1);
  assert.equal(result.segments[1].start, 291, "第二块的偏移没加对");
});

test("并发不超过设定值，避免撞服务商限流", async () => {
  const rec = recorder();
  await transcribe.run({ chunks: plan(6), transcribeChunk: rec.run, concurrency: 2 });
  assert.ok(rec.peakConcurrency <= 2, `并发峰值到了 ${rec.peakConcurrency}`);
});

test("每块完成就回调一次，界面可以边跑边显示", async () => {
  const progress = [];
  await transcribe.run({
    chunks: plan(3),
    transcribeChunk: recorder().run,
    concurrency: 2,
    onChunkDone: (info) => progress.push({ index: info.index, done: info.completed }),
  });

  assert.equal(progress.length, 3);
  assert.deepEqual(progress.map((p) => p.done).sort((a, b) => a - b), [1, 2, 3]);
});

test("单块失败不影响其余块，失败信息如实报告", async () => {
  const result = await transcribe.run({
    chunks: plan(3),
    transcribeChunk: recorder({ failOn: [1] }).run,
    concurrency: 2,
  });

  assert.equal(result.completed, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].index, 1);
  assert.equal(result.segments.length, 2);
});

test("撞到限流时停下来，明确报告还要等多久与已完成的进度", async () => {
  const result = await transcribe.run({
    chunks: plan(4),
    transcribeChunk: recorder({ rateLimitOn: [2] }).run,
    concurrency: 1,
  });

  assert.equal(result.rateLimited, true);
  assert.equal(result.retryAfterSeconds, 546);
  // 已完成的必须保留，不能因为后面撞限流就把前面的成果丢掉
  assert.ok(result.completed >= 2, `只完成了 ${result.completed} 块`);
});

test("从断点继续时跳过已完成的块，不重复花钱", async () => {
  const rec = recorder();
  const result = await transcribe.run({
    chunks: plan(4),
    transcribeChunk: rec.run,
    concurrency: 2,
    doneChunks: { 0: [{ start: 1, end: 2, text: "之前完成的" }], 1: [] },
  });

  assert.deepEqual(rec.calls.sort(), [2, 3], "已完成的块被重复识别了");
  assert.equal(result.completed, 4);
  assert.ok(result.segments.some((s) => s.text === "之前完成的"));
});

test("每完成一块就保存断点，中途退出不会前功尽弃", async () => {
  const saved = [];
  await transcribe.run({
    chunks: plan(3),
    transcribeChunk: recorder().run,
    concurrency: 1,
    onCheckpoint: (state) => saved.push(Object.keys(state.doneChunks).length),
  });
  assert.deepEqual(saved, [1, 2, 3], "断点不是每块保存一次");
});

test("全部块都失败时明确返回失败，而不是给出一份空字幕", async () => {
  const result = await transcribe.run({
    chunks: plan(2),
    transcribeChunk: recorder({ failOn: [0, 1] }).run,
    concurrency: 2,
  });
  assert.equal(result.completed, 0);
  assert.equal(result.segments.length, 0);
  assert.equal(result.failed.length, 2);
});

test("被调用方取消时立刻停下，不再发起新的识别", async () => {
  const rec = recorder();
  const controller = { cancelled: false };
  const promise = transcribe.run({
    chunks: plan(6),
    transcribeChunk: rec.run,
    concurrency: 1,
    shouldStop: () => controller.cancelled,
  });
  setTimeout(() => { controller.cancelled = true; }, 8);
  const result = await promise;

  assert.ok(result.cancelled, "没有报告已取消");
  assert.ok(rec.calls.length < 6, `取消后仍然跑完了 ${rec.calls.length} 块`);
});

test("多并发下一旦撞限流，另一路也要立刻停手", async () => {
  // 并发 1 时撞限流的那一路自己就退出了，这条保护只在多并发下才起作用。
  // 不停手的话，剩下的块会一个接一个撞 429，白白消耗额度和时间。
  const rec = recorder({ rateLimitOn: [0] });
  const result = await transcribe.run({
    chunks: plan(8),
    transcribeChunk: rec.run,
    concurrency: 2,
  });

  assert.equal(result.rateLimited, true);
  assert.ok(
    rec.calls.length <= 2,
    `撞限流后又发起了 ${rec.calls.length - 2} 次识别`,
  );
});
