import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as faceapi from 'face-api.js';
import { Canvas, Image, ImageData, loadImage } from 'canvas';
import sharp from 'sharp';

faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

export interface FocalPoint {
  focal_x: number;
  focal_y: number;
}

interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Detector = (buf: Buffer) => Promise<FaceBox[]>;

export const CENTER_FOCAL_POINT: FocalPoint = { focal_x: 0.5, focal_y: 0.5 };
const DETECTION_MAX_SIZE = 800;
const DETECTION_CONCURRENCY = 2;

const here = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.join(here, 'faceModels');

let modelPromise: Promise<void> | null = null;
let active = 0;
const queue: {
  run: () => Promise<FocalPoint>;
  resolve: (value: FocalPoint) => void;
  reject: (reason: unknown) => void;
}[] = [];
let detector: Detector = detectFacesWithFaceApi;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function toFaceBox(detection: faceapi.FaceDetection): FaceBox {
  const box = detection.box;
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

async function loadModel(): Promise<void> {
  if (!modelPromise) {
    modelPromise = (async () => {
      await faceapi.tf.setBackend('cpu');
      await faceapi.tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromDisk(modelDir);
    })();
  }
  return modelPromise;
}

async function prepareDetectionBuffer(buf: Buffer): Promise<{ buf: Buffer; width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) return { buf, width, height };

  const largest = Math.max(width, height);
  if (largest <= DETECTION_MAX_SIZE) return { buf, width, height };

  const scale = DETECTION_MAX_SIZE / largest;
  const resized = await sharp(buf)
    .resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  return { buf: resized, width: resizedMeta.width ?? 0, height: resizedMeta.height ?? 0 };
}

async function detectFacesWithFaceApi(buf: Buffer): Promise<FaceBox[]> {
  await loadModel();
  const { buf: detectionBuf } = await prepareDetectionBuffer(buf);
  const img = await loadImage(detectionBuf);
  const detections = await faceapi.detectAllFaces(
    img,
    new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }),
  );
  return detections.map(toFaceBox);
}

export function focalPointFromFaces(width: number, height: number, faces: FaceBox[]): FocalPoint {
  if (width <= 0 || height <= 0 || faces.length === 0) return CENTER_FOCAL_POINT;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const face of faces) {
    minX = Math.min(minX, face.x);
    minY = Math.min(minY, face.y);
    maxX = Math.max(maxX, face.x + face.width);
    maxY = Math.max(maxY, face.y + face.height);
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return CENTER_FOCAL_POINT;
  return {
    focal_x: clamp01(((minX + maxX) / 2) / width),
    focal_y: clamp01(((minY + maxY) / 2) / height),
  };
}

function pumpQueue(): void {
  while (active < DETECTION_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    active += 1;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        pumpQueue();
      });
  }
}

function enqueue(run: () => Promise<FocalPoint>): Promise<FocalPoint> {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    pumpQueue();
  });
}

export async function detectFocalPoint(buf: Buffer): Promise<FocalPoint> {
  return enqueue(async () => {
    try {
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) return CENTER_FOCAL_POINT;
      const prepared = await prepareDetectionBuffer(buf);
      if (!prepared.width || !prepared.height) return CENTER_FOCAL_POINT;
      const faces = await detector(prepared.buf);
      return focalPointFromFaces(prepared.width, prepared.height, faces);
    } catch (err) {
      console.warn(`[focal] falling back to center: ${err instanceof Error ? err.message : String(err)}`);
      return CENTER_FOCAL_POINT;
    }
  });
}

export function __setFocalPointDetectorForTest(next: Detector): void {
  detector = next;
}

export function __resetFocalPointForTest(): void {
  detector = detectFacesWithFaceApi;
  modelPromise = null;
  active = 0;
  queue.length = 0;
}
