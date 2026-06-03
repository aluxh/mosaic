export type ExportJob =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; framesDone: number; totalFrames: number }
  | { status: 'done'; finishedAt: number; outputUrl: string }
  | { status: 'error'; error: string };

export interface RenderOpts {
  renderUrl: string;
  outDir: string;
  eventId: string;
}

export type RenderRunner = (
  opts: RenderOpts,
  onProgress: (framesDone: number, totalFrames: number) => void,
) => Promise<{ outputUrl: string }>;

export interface ExportJobManager {
  get(): ExportJob;
  start(opts: RenderOpts): { started: boolean; job: ExportJob };
}

export function createExportJobManager(runner: RenderRunner): ExportJobManager {
  let job: ExportJob = { status: 'idle' };

  return {
    get: () => job,
    start(opts) {
      if (job.status === 'running') return { started: false, job };
      job = { status: 'running', startedAt: Date.now(), framesDone: 0, totalFrames: 0 };
      runner(opts, (framesDone, totalFrames) => {
        if (job.status === 'running') job = { ...job, framesDone, totalFrames };
      })
        .then(({ outputUrl }) => {
          job = { status: 'done', finishedAt: Date.now(), outputUrl };
        })
        .catch((e) => {
          job = { status: 'error', error: e instanceof Error ? e.message : String(e) };
        });
      return { started: true, job };
    },
  };
}
