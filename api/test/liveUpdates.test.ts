import { describe, expect, it } from 'vitest';
import { createLiveUpdateBus, type LiveUpdate } from '../src/lib/liveUpdates.js';

const update = (eventId: string, type: LiveUpdate['type'] = 'photo_created'): LiveUpdate => ({
  type,
  eventId,
  createdAt: 123,
});

describe('live update bus', () => {
  it('delivers updates only to subscribers for the matching event', () => {
    const bus = createLiveUpdateBus();
    const remembrance: LiveUpdate[] = [];
    const celebration: LiveUpdate[] = [];
    bus.subscribe('remembrance', (u) => remembrance.push(u));
    bus.subscribe('celebration', (u) => celebration.push(u));

    bus.publish(update('remembrance'));

    expect(remembrance).toEqual([update('remembrance')]);
    expect(celebration).toEqual([]);
  });

  it('unsubscribe prevents later delivery', () => {
    const bus = createLiveUpdateBus();
    const received: LiveUpdate[] = [];
    const unsubscribe = bus.subscribe('remembrance', (u) => received.push(u));

    unsubscribe();
    bus.publish(update('remembrance'));

    expect(received).toEqual([]);
  });

  it('one failing subscriber does not block another subscriber', () => {
    const bus = createLiveUpdateBus();
    const received: LiveUpdate[] = [];
    bus.subscribe('remembrance', () => {
      throw new Error('subscriber failed');
    });
    bus.subscribe('remembrance', (u) => received.push(u));

    expect(() => bus.publish(update('remembrance', 'message_created'))).not.toThrow();
    expect(received).toEqual([update('remembrance', 'message_created')]);
  });

  it('delivers admin mutation update types to subscribers', () => {
    const bus = createLiveUpdateBus();
    const received: string[] = [];
    bus.subscribe('e1', (u) => received.push(u.type));
    bus.publish({ type: 'photo_updated', eventId: 'e1', createdAt: 1 });
    bus.publish({ type: 'photo_deleted', eventId: 'e1', createdAt: 2 });
    bus.publish({ type: 'event_updated', eventId: 'e1', createdAt: 3 });
    expect(received).toEqual(['photo_updated', 'photo_deleted', 'event_updated']);
  });
});
