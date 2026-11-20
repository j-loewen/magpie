import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { LiveEvent } from '@notes/shared';
import { TAB_ID } from './api';
import { meKey } from './auth';
import { invalidateTree, keys } from './data';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/** Refetch everything that may have changed (after reconnecting, events may have been missed). */
function refreshAll(qc: QueryClient) {
  invalidateTree(qc);
  void qc.invalidateQueries({ queryKey: ['note'] });
  void qc.invalidateQueries({ queryKey: ['shares'] });
}

function handle(qc: QueryClient, event: LiveEvent) {
  switch (event.kind) {
    case 'tree':
      invalidateTree(qc);
      void qc.invalidateQueries({ queryKey: ['shares'] });
      // An open note may have been moved, trashed or unshared.
      void qc.invalidateQueries({ queryKey: ['note'] });
      break;
    case 'note': {
      const cached = qc.getQueryData<{ version: number }>(keys.note(event.id));
      // Newer content, or the same version with new server data (e.g. a finished link preview).
      if (!cached || cached.version <= event.version) void qc.invalidateQueries({ queryKey: keys.note(event.id) });
      for (const key of [['notes'], ['search'], ['shared']]) void qc.invalidateQueries({ queryKey: key });
      break;
    }
    case 'me':
      void qc.invalidateQueries({ queryKey: meKey });
      void qc.invalidateQueries({ queryKey: ['folder-view'] });
      break;
  }
}

/**
 * Keeps this tab up to date with changes made elsewhere (other people, other devices), over a
 * Server-Sent Events stream. Hidden tabs disconnect (browsers allow only a few connections per
 * server) and catch up when they are shown again.
 */
export function useLiveUpdates(enabled: boolean): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let connectedBefore = false;

    const connect = () => {
      if (source) return;
      source = new EventSource(`/api/events?tab=${encodeURIComponent(TAB_ID)}`);
      source.onopen = () => {
        setStatus('live');
        if (connectedBefore) refreshAll(qc);
        connectedBefore = true;
      };
      source.onmessage = (msg) => {
        try {
          handle(qc, JSON.parse(msg.data as string) as LiveEvent);
        } catch {
          // Ignore malformed events.
        }
      };
      // The browser reconnects by itself; a closed source (e.g. logged out) stays closed.
      source.onerror = () => setStatus(source?.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    };
    const disconnect = () => {
      source?.close();
      source = null;
    };
    const onVisibility = () => {
      if (document.hidden) disconnect();
      else connect();
    };

    if (!document.hidden) connect();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      disconnect();
    };
  }, [enabled, qc]);

  return status;
}
