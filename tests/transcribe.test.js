const test = require("node:test");
const assert = require("node:assert/strict");

const transcribe = require("../asr/transcribe.js");

/** Builds a chunk plan the way planChunks would */
const plan = (count) =>
  Array.from({ length: count }, (_, i) => ({
    requestedStart: i * 300,
    startTime: i === 0 ? 0 : i * 300 - 10,
    endTime: (i + 1) * 300,
    byteStart: i * 1000,
    byteEnd: (i + 1) * 1000 - 1,
    fragmentCount: 10,
  }));

/** A fake transcriber that records call order and peak concurrency */
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
      if (failOn.includes(index)) throw new Error("transcription failed");
      return [{ start: 1, end: 2, text: `chunk ${index}` }];
    },
  };
}

test("transcribes each planned chunk and offsets the results", async () => {
  const rec = recorder();
  const result = await transcribe.run({
    chunks: plan(3),
    transcribeChunk: rec.run,
    concurrency: 2,
  });

  assert.equal(result.completed, 3);
  assert.equal(result.segments.length, 3);
  assert.equal(result.segments[0].start, 1);
  assert.equal(result.segments[1].start, 291, "the second chunk's offset was not applied");
});

test("concurrency stays within the limit, to avoid provider rate limits", async () => {
  const rec = recorder();
  await transcribe.run({ chunks: plan(6), transcribeChunk: rec.run, concurrency: 2 });
  assert.ok(rec.peakConcurrency <= 2, `peak concurrency reached ${rec.peakConcurrency}`);
});

test("one callback per finished chunk, so the UI can show live progress", async () => {
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

test("one failed chunk does not stop the rest, and the failure is reported", async () => {
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

test("hitting a rate limit stops and reports both the wait and the progress", async () => {
  const result = await transcribe.run({
    chunks: plan(4),
    transcribeChunk: recorder({ rateLimitOn: [2] }).run,
    concurrency: 1,
  });

  assert.equal(result.rateLimited, true);
  assert.equal(result.retryAfterSeconds, 546);
  // Finished work must survive; a later rate limit should not discard it
  assert.ok(result.completed >= 2, `only ${result.completed} chunks finished`);
});

test("resuming skips finished chunks so they are not paid for twice", async () => {
  const rec = recorder();
  const result = await transcribe.run({
    chunks: plan(4),
    transcribeChunk: rec.run,
    concurrency: 2,
    doneChunks: { 0: [{ start: 1, end: 2, text: "done earlier" }], 1: [] },
  });

  assert.deepEqual(rec.calls.sort(), [2, 3], "already finished chunks were transcribed again");
  assert.equal(result.completed, 4);
  assert.ok(result.segments.some((s) => s.text === "done earlier"));
});

test("a checkpoint is saved per chunk, so quitting midway loses nothing", async () => {
  const saved = [];
  await transcribe.run({
    chunks: plan(3),
    transcribeChunk: recorder().run,
    concurrency: 1,
    onCheckpoint: (state) => saved.push(Object.keys(state.doneChunks).length),
  });
  assert.deepEqual(saved, [1, 2, 3], "checkpoints are not saved once per chunk");
});

test("when every chunk fails it reports failure rather than empty captions", async () => {
  const result = await transcribe.run({
    chunks: plan(2),
    transcribeChunk: recorder({ failOn: [0, 1] }).run,
    concurrency: 2,
  });
  assert.equal(result.completed, 0);
  assert.equal(result.segments.length, 0);
  assert.equal(result.failed.length, 2);
});

test("cancelling stops immediately and starts no further work", async () => {
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

  assert.ok(result.cancelled, "did not report cancellation");
  assert.ok(rec.calls.length < 6, `kept going and finished ${rec.calls.length} chunks after cancelling`);
});

test("with several workers, one rate limit stops the others immediately", async () => {
  // With one worker the failing path returns on its own, so this guard only
  // matters with several. Without it the remaining chunks hit 429 one after
  // another, wasting quota and time.
  const rec = recorder({ rateLimitOn: [0] });
  const result = await transcribe.run({
    chunks: plan(8),
    transcribeChunk: rec.run,
    concurrency: 2,
  });

  assert.equal(result.rateLimited, true);
  assert.ok(
    rec.calls.length <= 2,
    `started ${rec.calls.length - 2} more requests after the rate limit`,
  );
});
