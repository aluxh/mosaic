import '@testing-library/jest-dom/vitest';

// jsdom 25 does not ship PointerEvent; polyfill it so fireEvent.pointerDown
// passes clientX/clientY through to React handlers.
if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEvent extends MouseEvent {
    pointerId: number;
    width: number;
    height: number;
    pressure: number;
    tiltX: number;
    tiltY: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0;
      this.tiltX = params.tiltX ?? 0;
      this.tiltY = params.tiltY ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  (window as unknown as Record<string, unknown>).PointerEvent = PointerEvent;
}
