export {};

declare global {
  interface Window {
    __mosaicRender?: { fps: number; sequenceLength: number; slideMs: number };
    __mosaicDone?: boolean;
  }
}
