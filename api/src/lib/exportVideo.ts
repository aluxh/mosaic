export function totalFrames({
  sequenceLength,
  slideMs,
  fps,
}: {
  sequenceLength: number;
  slideMs: number;
  fps: number;
}): number {
  if (sequenceLength <= 0) return 0;
  return Math.round((sequenceLength * slideMs) / 1000 * fps);
}

export function buildFfmpegArgs({
  width,
  height,
  fps,
  output,
}: {
  width: number;
  height: number;
  fps: number;
  output: string;
}): string[] {
  return [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-i', '-',
    '-vf', `scale=${width}:${height}:flags=lanczos`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-r', String(fps),
    '-an',
    output,
  ];
}
