export type LiveUpdateType =
  | 'photo_created'
  | 'message_created'
  | 'photo_updated'
  | 'photo_deleted'
  | 'message_updated'
  | 'message_deleted'
  | 'event_updated';

export interface LiveUpdate {
  type: LiveUpdateType;
  eventId: string;
  createdAt: number;
}

export type LiveUpdateSender = (update: LiveUpdate) => void;

export interface LiveUpdateBus {
  subscribe(eventId: string, send: LiveUpdateSender): () => void;
  publish(update: LiveUpdate): void;
  subscriberCount(eventId: string): number;
}

export function createLiveUpdateBus(): LiveUpdateBus {
  const subscribers = new Map<string, Set<LiveUpdateSender>>();

  return {
    subscribe(eventId, send) {
      const eventSubscribers = subscribers.get(eventId) ?? new Set<LiveUpdateSender>();
      eventSubscribers.add(send);
      subscribers.set(eventId, eventSubscribers);

      return () => {
        eventSubscribers.delete(send);
        if (eventSubscribers.size === 0) subscribers.delete(eventId);
      };
    },

    publish(update) {
      const eventSubscribers = subscribers.get(update.eventId);
      if (!eventSubscribers) return;
      for (const send of eventSubscribers) {
        try {
          send(update);
        } catch {
          // A broken client must not prevent other displays from updating.
        }
      }
    },

    subscriberCount(eventId) {
      return subscribers.get(eventId)?.size ?? 0;
    },
  };
}
