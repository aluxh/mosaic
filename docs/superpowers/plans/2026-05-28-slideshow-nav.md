# v0.1.3 Slideshow Navigation Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add prev/next slide navigation via keyboard (ArrowLeft/ArrowRight) and on-screen buttons flanking the existing pause button, without changing pause semantics.

**Architecture:** Wall exposes a `{ prev(); next() }` imperative ref handle via `useImperativeHandle`; App holds `wallRef` and wires it to both `useKeyboardShortcuts` and a new `NavButton` component. The nav buttons are hidden (opacity 0, pointer-events none) when the wall is unpaused and chrome is idle, matching the existing chrome-fade pattern.

**Tech Stack:** React 18 (forwardRef, useImperativeHandle, useRef), Vitest + Testing Library, Tailwind CSS (inline styles for opacity/pointer-events transitions).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `web/src/components/NavButton.tsx` | Single chevron button matching PauseButton pill style; `hidden` prop controls opacity/pointer-events |
| Create | `web/src/test/NavButton.test.tsx` | Unit tests for NavButton rendering and click behavior |
| Modify | `web/src/components/Wall.tsx` | Wrap in `forwardRef`, export `WallHandle`, add `useImperativeHandle` |
| Modify | `web/src/test/Wall.test.tsx` | Extend with prev/next/wrap tests using the new ref |
| Modify | `web/src/hooks/useKeyboardShortcuts.ts` | Add `onPrev` and `onNext` to `Handlers`; map ArrowLeft/ArrowRight |
| Modify | `web/src/App.tsx` | Add `wallRef`, wire nav functions, render `<NavButton>` around `<PauseButton>` |
| Modify | `web/src/test/App.test.tsx` | Extend with ArrowLeft/ArrowRight tests |

---

## Task 1: NavButton component (TDD)

**Files:**
- Create: `web/src/test/NavButton.test.tsx`
- Create: `web/src/components/NavButton.tsx`

### Step 1.1: Write the failing tests

Create `web/src/test/NavButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavButton } from '../components/NavButton';

describe('NavButton', () => {
  it('prev direction renders aria-label "Previous slide"', () => {
    render(<NavButton direction="prev" onClick={() => {}} hidden={false} />);
    expect(screen.getByLabelText('Previous slide')).toBeInTheDocument();
  });

  it('next direction renders aria-label "Next slide"', () => {
    render(<NavButton direction="next" onClick={() => {}} hidden={false} />);
    expect(screen.getByLabelText('Next slide')).toBeInTheDocument();
  });

  it('clicking the button calls onClick', () => {
    const onClick = vi.fn();
    render(<NavButton direction="next" onClick={onClick} hidden={false} />);
    fireEvent.click(screen.getByLabelText('Next slide'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('hidden=true sets opacity 0 and pointerEvents none', () => {
    render(<NavButton direction="prev" onClick={() => {}} hidden={true} />);
    const btn = screen.getByLabelText('Previous slide');
    expect(btn.style.opacity).toBe('0');
    expect(btn.style.pointerEvents).toBe('none');
  });

  it('hidden=false sets opacity 1 and pointerEvents auto', () => {
    render(<NavButton direction="prev" onClick={() => {}} hidden={false} />);
    const btn = screen.getByLabelText('Previous slide');
    expect(btn.style.opacity).toBe('1');
    expect(btn.style.pointerEvents).toBe('auto');
  });
});
```

### Step 1.2: Run tests to verify they fail

```bash
cd web && npx vitest run src/test/NavButton.test.tsx
```

Expected: FAIL — "Cannot find module '../components/NavButton'"

### Step 1.3: Implement NavButton

Create `web/src/components/NavButton.tsx`:

```tsx
interface Props {
  direction: 'prev' | 'next';
  onClick: () => void;
  hidden: boolean;
}

export function NavButton({ direction, onClick, hidden }: Props) {
  return (
    <button
      onClick={onClick}
      className="w-11 h-11 rounded-full backdrop-blur-md flex items-center justify-center text-white hover:scale-105"
      style={{
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.22)',
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 450ms cubic-bezier(0.22, 1, 0.36, 1), transform 250ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      aria-label={direction === 'prev' ? 'Previous slide' : 'Next slide'}
    >
      {direction === 'prev' ? (
        <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
          <path d="M9.5 1.5 L4 7 L9.5 12.5 L9.5 11 L5.5 7 L9.5 3 Z" />
        </svg>
      ) : (
        <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
          <path d="M2.5 1.5 L8 7 L2.5 12.5 L2.5 11 L6.5 7 L2.5 3 Z" />
        </svg>
      )}
    </button>
  );
}
```

### Step 1.4: Run tests to verify they pass

```bash
cd web && npx vitest run src/test/NavButton.test.tsx
```

Expected: 5 tests PASS

### Step 1.5: Commit

```bash
git add web/src/components/NavButton.tsx web/src/test/NavButton.test.tsx
git commit -m "feat: add NavButton component with hidden/visible state"
```

---

## Task 2: Wall forwardRef + WallHandle (TDD)

**Files:**
- Modify: `web/src/test/Wall.test.tsx` (add 4 tests at the end)
- Modify: `web/src/components/Wall.tsx` (forwardRef, useImperativeHandle)

### Step 2.1: Add failing Wall ref tests

Add to the **end** of `web/src/test/Wall.test.tsx` (after all existing tests):

```tsx
import { createRef, act } from 'react';
import { render, screen } from '@testing-library/react';
import { Wall, type WallHandle } from '../components/Wall';
import { buildSequence } from '../lib/buildSequence';
```

Also add this import block at the top of the file alongside the existing imports. Then add the describe block at the end:

```tsx
const p1: Photo = {
  id: 'p1',
  eventId: 'remembrance',
  source: 'seed',
  url: '/p1.jpg',
  credit: '',
  createdAt: 0,
};
const p2: Photo = { ...p1, id: 'p2', url: '/p2.jpg' };
const p3: Photo = { ...p1, id: 'p3', url: '/p3.jpg' };
const navPhotos = [p1, p2, p3];

describe('WallHandle ref navigation', () => {
  it('next() advances to the next slide', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    expect(container.textContent).toContain('01 /');
    act(() => {
      ref.current!.next();
    });
    expect(container.textContent).toContain('02 /');
  });

  it('prev() goes back, and prev() at idx 0 wraps to last', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    expect(container.textContent).toContain('01 /');
    act(() => {
      ref.current!.prev();
    });
    // Wrapped to last — no longer at 01
    expect(container.textContent).not.toContain('01 /');
  });

  it('next() at the last index wraps to index 0', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    const total = buildSequence(navPhotos, [], 'remembrance', seedEvent).length;
    // Advance to last slide
    for (let i = 0; i < total - 1; i++) {
      act(() => {
        ref.current!.next();
      });
    }
    expect(container.textContent).toContain(
      `${String(total).padStart(2, '0')} /`,
    );
    // Wrap
    act(() => {
      ref.current!.next();
    });
    expect(container.textContent).toContain('01 /');
  });

  it('prev() at last index goes to second-to-last', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    const total = buildSequence(navPhotos, [], 'remembrance', seedEvent).length;
    // Go to last slide
    for (let i = 0; i < total - 1; i++) {
      act(() => { ref.current!.next(); });
    }
    const lastLabel = `${String(total).padStart(2, '0')} /`;
    expect(container.textContent).toContain(lastLabel);
    // Prev from last
    act(() => { ref.current!.prev(); });
    const penultLabel = `${String(total - 1).padStart(2, '0')} /`;
    expect(container.textContent).toContain(penultLabel);
  });
});
```

### Step 2.2: Run tests to verify they fail

```bash
cd web && npx vitest run src/test/Wall.test.tsx
```

Expected: FAIL — "WallHandle" not exported, Wall doesn't accept a ref.

### Step 2.3: Implement forwardRef in Wall.tsx

In `web/src/components/Wall.tsx`, make these changes:

**1.** Change the import line from:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
```
to:
```tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
```

**2.** Export `WallHandle` interface. Add this after the existing imports:
```tsx
export interface WallHandle {
  prev(): void;
  next(): void;
}
```

**3.** Change the Wall function signature and export from:
```tsx
export function Wall({ photos, messages, mode, paused, event }: WallProps) {
```
to:
```tsx
export const Wall = forwardRef<WallHandle, WallProps>(function Wall(
  { photos, messages, mode, paused, event }: WallProps,
  ref,
) {
```
And close the `forwardRef` call at the end of the function by changing the final `}` to `});`.

**4.** Add `useImperativeHandle` after the existing `useEffect` that handles `sequence.length`/`idx` correction (after line 103 in the original file). Insert:

```tsx
  useImperativeHandle(
    ref,
    () => ({
      prev() {
        if (sequence.length === 0) return;
        setIdx((i) => (i - 1 + sequence.length) % sequence.length);
      },
      next() {
        if (sequence.length === 0) return;
        setIdx((i) => (i + 1) % sequence.length);
      },
    }),
    [sequence.length],
  );
```

The full resulting Wall function opening and closing looks like:
```tsx
export const Wall = forwardRef<WallHandle, WallProps>(function Wall(
  { photos, messages, mode, paused, event }: WallProps,
  ref,
) {
  const sequence = useMemo(
    () => buildSequence(photos, messages, mode, event),
    [photos, messages, mode, event],
  );
  const [idx, setIdx] = useState(0);
  // ... (all existing code unchanged) ...
  useImperativeHandle(
    ref,
    () => ({
      prev() {
        if (sequence.length === 0) return;
        setIdx((i) => (i - 1 + sequence.length) % sequence.length);
      },
      next() {
        if (sequence.length === 0) return;
        setIdx((i) => (i + 1) % sequence.length);
      },
    }),
    [sequence.length],
  );

  if (sequence.length === 0) return null;
  // ... rest of JSX unchanged ...
});
```

### Step 2.4: Run tests to verify they pass

```bash
cd web && npx vitest run src/test/Wall.test.tsx
```

Expected: All tests PASS (existing CSS regression tests + 4 new nav tests).

### Step 2.5: Commit

```bash
git add web/src/components/Wall.tsx web/src/test/Wall.test.tsx
git commit -m "feat: expose WallHandle ref with prev/next via forwardRef"
```

---

## Task 3: App arrow navigation (TDD)

**Files:**
- Modify: `web/src/test/App.test.tsx` (add arrow nav describe block)
- Modify: `web/src/hooks/useKeyboardShortcuts.ts` (add onPrev/onNext)
- Modify: `web/src/App.tsx` (wallRef, wire nav, render NavButton cluster)

### Step 3.1: Add failing App arrow tests

Add to **end** of `web/src/test/App.test.tsx`:

```tsx
const navPhoto: Photo = {
  id: 'p1',
  eventId: 'remembrance',
  source: 'seed' as const,
  url: '/p1.jpg',
  credit: '',
  createdAt: 0,
};
```

Wait — App.test.tsx doesn't import `Photo`. Add this import to the top of App.test.tsx:

```tsx
import type { Event, Photo } from '../types';
```

(The existing import is `import type { Event } from '../types';` — extend it.)

Then add at the end of the file:

```tsx
const navPhotos: Photo[] = [
  { id: 'p1', eventId: 'remembrance', source: 'seed', url: '/p1.jpg', credit: '', createdAt: 0 },
  { id: 'p2', eventId: 'remembrance', source: 'seed', url: '/p2.jpg', credit: '', createdAt: 0 },
  { id: 'p3', eventId: 'remembrance', source: 'seed', url: '/p3.jpg', credit: '', createdAt: 0 },
];

describe('App arrow key navigation', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchPhotos').mockResolvedValue(navPhotos);
  });

  it('ArrowRight advances the slide index', async () => {
    const { container } = await renderApp();
    expect(container.textContent).toContain('01 /');
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(container.textContent).toContain('02 /');
  });

  it('ArrowLeft from slide 0 wraps to the last slide', async () => {
    const { container } = await renderApp();
    expect(container.textContent).toContain('01 /');
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    expect(container.textContent).not.toContain('01 /');
  });

  it('ArrowRight does not toggle paused', async () => {
    await renderApp();
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('ArrowRight ignored when an input is focused', async () => {
    const { container } = await renderApp();
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    const input = screen.getByPlaceholderText(/e\.g\. eleanor/i);
    input.focus();
    const textBefore = container.textContent;
    fireEvent.keyDown(input, { key: 'ArrowRight', target: input });
    expect(container.textContent).toBe(textBefore);
  });
});
```

### Step 3.2: Run tests to verify they fail

```bash
cd web && npx vitest run src/test/App.test.tsx
```

Expected: The 4 new arrow tests FAIL — wall ref not wired, no ArrowLeft/Right handlers.

### Step 3.3: Update useKeyboardShortcuts

Replace the entire contents of `web/src/hooks/useKeyboardShortcuts.ts`:

```ts
import { useEffect } from 'react';

interface Handlers {
  onTogglePause: () => void;
  onOpenContribute: () => void;
  onCloseContribute: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function useKeyboardShortcuts(handlers: Handlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches?.('input, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlers.onTogglePause();
      } else if (e.key === 'ArrowLeft') {
        handlers.onPrev();
      } else if (e.key === 'ArrowRight') {
        handlers.onNext();
      } else if (e.key === 'c' || e.key === 'C') {
        handlers.onOpenContribute();
      } else if (e.key === 'Escape') {
        handlers.onCloseContribute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
```

### Step 3.4: Update App.tsx

Make these changes to `web/src/App.tsx`:

**1.** Change the React import to add `useRef`:
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

**2.** Change the Wall import to also import `WallHandle`:
```tsx
import { Wall, type WallHandle } from './components/Wall';
```

**3.** Add the NavButton import after the PauseButton import:
```tsx
import { NavButton } from './components/NavButton';
```

**4.** Inside the `App()` function body, after `const chromeAwake = useIdleChrome();`, add:
```tsx
  const wallRef = useRef<WallHandle>(null);
```

**5.** Replace the `useKeyboardShortcuts` call (the existing one at line ~49):
```tsx
  useKeyboardShortcuts({
    onTogglePause: () => setPaused((p) => !p),
    onOpenContribute: () => setContributeOpen(true),
    onCloseContribute: () => setContributeOpen(false),
    onPrev: () => wallRef.current?.prev(),
    onNext: () => wallRef.current?.next(),
  });
```

**6.** Pass `ref={wallRef}` to the `<Wall>` component:
```tsx
      <Wall ref={wallRef} photos={photos} messages={messages} mode={mode} paused={paused} event={event} />
```

**7.** Add `const navHidden = !paused && !chromeAwake;` before the `chromeStyle` declaration:
```tsx
  const navHidden = !paused && !chromeAwake;
```

**8.** Replace the pause button cluster `<div>` (the `fixed right-7 bottom-20` div near the end):

From:
```tsx
      <div className="fixed right-7 bottom-20 z-30 flex items-center gap-3" style={chromeStyle}>
        <PauseButton paused={paused} onToggle={() => setPaused((p) => !p)} />
      </div>
```

To:
```tsx
      <div className="fixed right-7 bottom-20 z-30 flex items-center gap-3" style={chromeStyle}>
        <NavButton direction="prev" onClick={() => wallRef.current?.prev()} hidden={navHidden} />
        <PauseButton paused={paused} onToggle={() => setPaused((p) => !p)} />
        <NavButton direction="next" onClick={() => wallRef.current?.next()} hidden={navHidden} />
      </div>
```

### Step 3.5: Run all tests

```bash
cd web && npx vitest run
```

Expected: All tests PASS — existing tests unbroken, all 4 arrow nav tests pass.

### Step 3.6: Commit

```bash
git add web/src/hooks/useKeyboardShortcuts.ts web/src/App.tsx web/src/test/App.test.tsx
git commit -m "feat: wire arrow key and button nav to Wall ref (v0.1.3)"
```

---

## Task 4: Full test suite + TypeScript check

**Files:** None changed — verification only.

### Step 4.1: Run the full test suite from repo root

```bash
npm test
```

Expected: All test suites pass (frontend — backend unchanged).

### Step 4.2: TypeScript check

```bash
cd web && npx tsc --noEmit
```

Expected: No errors.

### Step 4.3: Tag the release

```bash
git tag v0.1.3 && git push --tags
```

---

## Self-review against spec

**Spec coverage check:**

| Requirement | Task covering it |
|---|---|
| ArrowLeft → prev, ArrowRight → next | Task 3 (useKeyboardShortcuts) |
| Wrap-around at both ends | Task 2 (Wall tests) |
| Nav buttons hidden when unpaused + chrome idle | Task 3 (App.tsx `navHidden`) |
| Nav buttons visible on mouse activity | Task 3 (App.tsx `navHidden = !paused && !chromeAwake`) |
| No pause side-effect from nav | Task 3 (App test) |
| Input-focus guard for arrows | Task 3 (useKeyboardShortcuts + App test) |
| NavButton matches PauseButton pill style | Task 1 (NavButton.tsx) |
| `[‹] [pause] [›]` cluster order | Task 3 (App.tsx render order) |
| WallHandle type exported | Task 2 (Wall.tsx) |
| Vitest: NavButton.test.tsx | Task 1 |
| Vitest: Wall.test.tsx extensions | Task 2 |
| Vitest: App.test.tsx extensions | Task 3 |

**Placeholder scan:** No TBD or "similar to" references found.

**Type consistency:** `WallHandle` defined once in Task 2, imported in Task 3. `NavButton` props defined once in Task 1, used in Task 3. `onPrev`/`onNext` defined in `Handlers` (Task 3 step 3.3) and consumed in App.tsx (Task 3 step 3.4). All consistent.
