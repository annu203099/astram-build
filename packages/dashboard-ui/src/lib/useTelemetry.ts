/**
 * WebSocket telemetry hook (CONTRACTS §5 /ws/telemetry).
 *
 * - URL: `${ws|wss}://${location.host}/ws/telemetry` — works in dev through
 *   the vite proxy and in prod where the daemon serves the dist from :3080.
 * - Auto-reconnect with a 2 s backoff; surfaces a 'reconnecting' state so the
 *   header can show it.
 */
import { useEffect, useRef, useState } from 'react';
import type { TelemetryEvent } from '@astram/types';

export type WsState = 'connecting' | 'open' | 'reconnecting';

const RECONNECT_DELAY_MS = 2000;

export function useTelemetry(onEvent: (event: TelemetryEvent) => void): WsState {
  const [state, setState] = useState<WsState>('connecting');
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | null = null;

    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/telemetry`;

    const connect = (): void => {
      socket = new WebSocket(url);
      socket.onopen = () => {
        if (!disposed) setState('open');
      };
      socket.onmessage = (msg: MessageEvent) => {
        if (disposed) return;
        try {
          const event = JSON.parse(String(msg.data)) as TelemetryEvent;
          if (event && typeof event.type === 'string') handlerRef.current(event);
        } catch {
          // malformed frame — ignore, never crash the dashboard
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        setState('reconnecting');
        timer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      // onerror: the socket also fires onclose, which schedules the retry.
    };

    connect();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return state;
}
