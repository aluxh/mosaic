import { describe, it, expect, vi } from 'vitest';
import { createExportJobManager, type RenderRunner } from '../src/lib/exportJob.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const opts = { renderUrl: 'http://web', outDir: '/data', eventId: 'remembrance' };

describe('createExportJobManager', () => {
  it('starts idle', () => {
    const m = createExportJobManager(vi.fn());
    expect(m.get()).toEqual({ status: 'idle' });
  });

  it('start() transitions to running and invokes the runner with opts', () => {
    const runner = vi.fn<RenderRunner>(() => new Promise(() => {})); // never resolves
    const m = createExportJobManager(runner);
    const res = m.start(opts);
    expect(res.started).toBe(true);
    expect(m.get().status).toBe('running');
    expect(runner).toHaveBeenCalledWith(opts, expect.any(Function));
  });

  it('a second start() while running returns started:false with the running job', () => {
    const m = createExportJobManager(() => new Promise(() => {}));
    m.start(opts);
    const second = m.start(opts);
    expect(second.started).toBe(false);
    expect(second.job.status).toBe('running');
  });

  it('onProgress updates framesDone/totalFrames', () => {
    let report!: (d: number, t: number) => void;
    const m = createExportJobManager((_o, onProgress) => {
      report = onProgress;
      return new Promise(() => {});
    });
    m.start(opts);
    report(5, 10);
    expect(m.get()).toMatchObject({ status: 'running', framesDone: 5, totalFrames: 10 });
  });

  it('resolves to done with the output url', async () => {
    const m = createExportJobManager(async () => ({ outputUrl: '/data/exports/x.mp4' }));
    m.start(opts);
    await flush();
    expect(m.get()).toMatchObject({ status: 'done', outputUrl: '/data/exports/x.mp4' });
  });

  it('rejects to error with the message', async () => {
    const m = createExportJobManager(async () => {
      throw new Error('boom');
    });
    m.start(opts);
    await flush();
    expect(m.get()).toEqual({ status: 'error', error: 'boom' });
  });

  it('allows a new run after one finished', async () => {
    const m = createExportJobManager(async () => ({ outputUrl: '/data/exports/x.mp4' }));
    m.start(opts);
    await flush();
    const again = m.start(opts);
    expect(again.started).toBe(true);
  });
});
