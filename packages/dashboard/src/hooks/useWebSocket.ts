import { useEffect, useState, useCallback, useRef } from 'react';
import { ws } from '../lib/ws';
import type { WSEvent, FeedItem } from '../lib/types';
import { nextFeedId, formatTime, countedDetail } from '../lib/utils';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';

const MAX_EVENTS = 50;

const STATUS_LABELS: Record<string, string> = {
  active: 'activo',
  paused: 'pausado',
  killed: 'revocado',
};

function translateReason(reason: string): string {
  return reason
    .replace(/Daily (\w+) limit reached for .+/i, 'Límite diario de $1 alcanzado')
    .replace(/Daily credits limit reached for .+/i, 'Límite diario de créditos alcanzado')
    .replace(/User is paused/i, 'Usuario pausado')
    .replace(/User is killed/i, 'Usuario revocado')
    .replace(/Outside allowed hours/i, 'Fuera del horario permitido')
    .replace(/Insufficient credits/i, 'Créditos insuficientes');
}

function wsEventToFeed(evt: WSEvent): FeedItem | null {
  switch (evt.type) {
    case 'user_check':
      return {
        id: nextFeedId(),
        type: 'check',
        user: evt.userName ?? 'Desconocido',
        detail: `Verificando ${evt.model ?? ''}`,
        time: evt.timestamp,
      };
    case 'user_blocked': {
      const rawReason = evt.reason ? evt.reason.split('\n')[0] : '';
      const reason = rawReason ? ': ' + translateReason(rawReason) : '';
      return {
        id: nextFeedId(),
        type: 'blocked',
        user: evt.userName ?? 'Desconocido',
        detail: `Bloqueado en ${evt.model ?? ''}${reason}`,
        time: evt.timestamp,
      };
    }
    case 'model_mismatch':
      return {
        id: nextFeedId(),
        type: 'blocked',
        user: evt.userName ?? 'Desconocido',
        detail: `Discrepancia de modelo: declaró ${evt.declared ?? '?'}, ejecutó ${evt.model ?? '?'}`,
        time: evt.timestamp,
      };
    case 'effort_exceeded':
      return {
        id: nextFeedId(),
        type: 'blocked',
        user: evt.userName ?? 'Desconocido',
        detail: `Effort ${evt.effort ?? '?'} sobre su tope (${evt.cap ?? '?'})`,
        time: evt.timestamp,
      };
    case 'user_counted':
      return {
        id: nextFeedId(),
        type: 'counted',
        user: evt.userName ?? 'Desconocido',
        detail: countedDetail(evt.model, evt.modelVersion, evt.creditCost, evt.inputTokens, evt.outputTokens),
        time: evt.timestamp,
      };
    case 'user_status_change':
    case 'user_killed': {
      const oldS = STATUS_LABELS[evt.oldStatus ?? ''] ?? evt.oldStatus ?? '?';
      const newS = STATUS_LABELS[evt.newStatus ?? ''] ?? evt.newStatus ?? '?';
      return {
        id: nextFeedId(),
        type: 'status',
        user: evt.userName ?? 'Desconocido',
        detail: `${oldS} → ${newS}`,
        time: evt.timestamp,
      };
    }
    case 'user_status':
      return {
        id: nextFeedId(),
        type: 'check',
        user: evt.userName ?? 'Desconocido',
        detail: `Inicio de sesión (${evt.model ?? ''})`,
        time: evt.timestamp,
      };
    default:
      return null;
  }
}

export function useWebSocket() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ws.isConnected() ? 'connected' : 'disconnected'
  );
  const [events, setEvents] = useState<FeedItem[]>([]);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);

  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    const unsubState = ws.onStateChange((state) => {
      setConnectionState(state);
    });

    const unsubEvent = ws.onEvent((event) => {
      setLastEvent(event);
      const feed = wsEventToFeed(event);
      if (feed) {
        setEvents((prev) => {
          const next = [feed, ...prev];
          if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
          return next;
        });
      }
    });

    return () => {
      unsubState();
      unsubEvent();
    };
  }, []);

  const connect = useCallback(() => ws.connect(), []);
  const disconnect = useCallback(() => ws.disconnect(), []);

  return {
    connectionState,
    events,
    lastEvent,
    connect,
    disconnect,
    setEvents,
  };
}

export { wsEventToFeed, formatTime };
