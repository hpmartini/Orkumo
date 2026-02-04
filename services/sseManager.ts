/**
 * Singleton SSE Manager
 *
 * Manages single SSE connections shared across all tabs/components.
 * This prevents connection explosion when multiple tabs are mounted simultaneously.
 *
 * Key features:
 * - Single /api/events connection for process status and log events
 * - Single /api/apps/stats/stream connection for stats updates
 * - Reference counting for connection lifecycle management
 * - Multiple subscribers can receive events from a single connection
 * - Automatic reconnection with exponential backoff
 */

import { API_BASE_URL } from '../utils/apiConfig';

const API_BASE = API_BASE_URL;

// Reconnection constants
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

type EventCallback = (data: unknown) => void;
type ConnectionCallback = (connected: boolean) => void;

interface Subscriber {
  id: string;
  onData: EventCallback;
  onConnection?: ConnectionCallback;
}

interface SSEConnection {
  eventSource: EventSource | null;
  subscribers: Map<string, Subscriber>;
  reconnectAttempts: number;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  isClosing: boolean;
  isConnected: boolean;
}

// Singleton state
const connections: {
  events: SSEConnection;
  stats: SSEConnection;
} = {
  events: {
    eventSource: null,
    subscribers: new Map(),
    reconnectAttempts: 0,
    reconnectTimeout: null,
    isClosing: false,
    isConnected: false,
  },
  stats: {
    eventSource: null,
    subscribers: new Map(),
    reconnectAttempts: 0,
    reconnectTimeout: null,
    isClosing: false,
    isConnected: false,
  },
};

// Generate unique subscriber ID
let subscriberCounter = 0;
function generateSubscriberId(): string {
  return `sub_${++subscriberCounter}_${Date.now()}`;
}

function getReconnectDelay(attempts: number): number {
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, attempts),
    MAX_RECONNECT_DELAY
  );
  return delay + Math.random() * 1000;
}

// ============================================
// Events SSE Connection (process-status, process-log)
// ============================================

interface ProcessStatusEvent {
  appId: string;
  status: string;
}

interface ProcessLogEvent {
  appId: string;
  type: string;
  message: string;
}

type EventsData =
  | { type: 'status'; data: ProcessStatusEvent }
  | { type: 'log'; data: ProcessLogEvent };

function connectEventsSSE() {
  const conn = connections.events;

  if (conn.isClosing || conn.eventSource) return;

  const eventSource = new EventSource(`${API_BASE}/events`);
  conn.eventSource = eventSource;

  eventSource.addEventListener('connected', () => {
    conn.reconnectAttempts = 0;
    conn.isConnected = true;
    // Notify all subscribers
    conn.subscribers.forEach(sub => sub.onConnection?.(true));
  });

  eventSource.addEventListener('heartbeat', () => {
    // Heartbeat received, connection is healthy
  });

  eventSource.addEventListener('process-status', (event) => {
    try {
      const data = JSON.parse(event.data) as ProcessStatusEvent;
      // Notify all subscribers
      conn.subscribers.forEach(sub => {
        sub.onData({ type: 'status', data });
      });
    } catch (err) {
      console.error('[SSEManager] Failed to parse process-status event:', err);
    }
  });

  eventSource.addEventListener('process-log', (event) => {
    try {
      const data = JSON.parse(event.data) as ProcessLogEvent;
      // Notify all subscribers
      conn.subscribers.forEach(sub => {
        sub.onData({ type: 'log', data });
      });
    } catch (err) {
      console.error('[SSEManager] Failed to parse process-log event:', err);
    }
  });

  eventSource.onerror = () => {
    conn.isConnected = false;
    // Notify all subscribers
    conn.subscribers.forEach(sub => sub.onConnection?.(false));

    eventSource.close();
    conn.eventSource = null;

    if (conn.reconnectTimeout) {
      clearTimeout(conn.reconnectTimeout);
      conn.reconnectTimeout = null;
    }

    // Only reconnect if we have subscribers and haven't exceeded attempts
    if (!conn.isClosing && conn.subscribers.size > 0 && conn.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = getReconnectDelay(conn.reconnectAttempts);
      console.warn(`[SSEManager] Events connection error, reconnecting in ${Math.round(delay / 1000)}s (attempt ${conn.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
      conn.reconnectTimeout = setTimeout(() => {
        conn.reconnectAttempts++;
        connectEventsSSE();
      }, delay);
    } else if (conn.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[SSEManager] Events connection max reconnection attempts reached');
    }
  };
}

/**
 * Subscribe to process events (status changes and logs).
 * Returns unsubscribe function.
 */
export function subscribeToEventsShared(
  onStatusChange: (data: ProcessStatusEvent) => void,
  onLog: (data: ProcessLogEvent) => void,
  onConnectionChange?: (connected: boolean) => void
): () => void {
  const conn = connections.events;
  const subscriberId = generateSubscriberId();

  const subscriber: Subscriber = {
    id: subscriberId,
    onData: (event) => {
      const typedEvent = event as EventsData;
      if (typedEvent.type === 'status') {
        onStatusChange(typedEvent.data);
      } else if (typedEvent.type === 'log') {
        onLog(typedEvent.data);
      }
    },
    onConnection: onConnectionChange,
  };

  conn.subscribers.set(subscriberId, subscriber);

  // Start connection if this is the first subscriber
  if (conn.subscribers.size === 1) {
    conn.isClosing = false;
    connectEventsSSE();
  } else if (conn.isConnected) {
    // Connection already exists, notify new subscriber immediately
    onConnectionChange?.(true);
  }

  // Return unsubscribe function
  return () => {
    conn.subscribers.delete(subscriberId);

    // Close connection if no more subscribers
    if (conn.subscribers.size === 0) {
      conn.isClosing = true;
      if (conn.reconnectTimeout) {
        clearTimeout(conn.reconnectTimeout);
        conn.reconnectTimeout = null;
      }
      if (conn.eventSource) {
        conn.eventSource.close();
        conn.eventSource = null;
      }
      conn.isConnected = false;
      conn.reconnectAttempts = 0;
    }
  };
}

// ============================================
// Stats SSE Connection
// ============================================

export interface StatsUpdate {
  appId: string;
  cpu: number;
  memory: number;
}

function connectStatsSSE() {
  const conn = connections.stats;

  if (conn.isClosing || conn.eventSource) return;

  const eventSource = new EventSource(`${API_BASE}/apps/stats/stream`);
  conn.eventSource = eventSource;

  eventSource.addEventListener('connected', () => {
    conn.reconnectAttempts = 0;
    conn.isConnected = true;
    // Notify all subscribers
    conn.subscribers.forEach(sub => sub.onConnection?.(true));
  });

  eventSource.addEventListener('heartbeat', () => {
    // Heartbeat received, connection is healthy
  });

  eventSource.addEventListener('stats', (event) => {
    try {
      const data = JSON.parse(event.data) as StatsUpdate;
      // Notify all subscribers
      conn.subscribers.forEach(sub => {
        sub.onData(data);
      });
    } catch (err) {
      console.error('[SSEManager] Failed to parse stats event:', err);
    }
  });

  eventSource.onerror = () => {
    conn.isConnected = false;
    // Notify all subscribers
    conn.subscribers.forEach(sub => sub.onConnection?.(false));

    eventSource.close();
    conn.eventSource = null;

    if (conn.reconnectTimeout) {
      clearTimeout(conn.reconnectTimeout);
      conn.reconnectTimeout = null;
    }

    // Only reconnect if we have subscribers and haven't exceeded attempts
    if (!conn.isClosing && conn.subscribers.size > 0 && conn.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = getReconnectDelay(conn.reconnectAttempts);
      console.warn(`[SSEManager] Stats connection error, reconnecting in ${Math.round(delay / 1000)}s (attempt ${conn.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
      conn.reconnectTimeout = setTimeout(() => {
        conn.reconnectAttempts++;
        connectStatsSSE();
      }, delay);
    } else if (conn.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[SSEManager] Stats connection max reconnection attempts reached');
    }
  };
}

/**
 * Subscribe to stats updates.
 * Returns unsubscribe function.
 */
export function subscribeToStatsShared(
  onStats: (data: StatsUpdate) => void,
  onConnectionChange?: (connected: boolean) => void
): () => void {
  const conn = connections.stats;
  const subscriberId = generateSubscriberId();

  const subscriber: Subscriber = {
    id: subscriberId,
    onData: onStats as EventCallback,
    onConnection: onConnectionChange,
  };

  conn.subscribers.set(subscriberId, subscriber);

  // Start connection if this is the first subscriber
  if (conn.subscribers.size === 1) {
    conn.isClosing = false;
    connectStatsSSE();
  } else if (conn.isConnected) {
    // Connection already exists, notify new subscriber immediately
    onConnectionChange?.(true);
  }

  // Return unsubscribe function
  return () => {
    conn.subscribers.delete(subscriberId);

    // Close connection if no more subscribers
    if (conn.subscribers.size === 0) {
      conn.isClosing = true;
      if (conn.reconnectTimeout) {
        clearTimeout(conn.reconnectTimeout);
        conn.reconnectTimeout = null;
      }
      if (conn.eventSource) {
        conn.eventSource.close();
        conn.eventSource = null;
      }
      conn.isConnected = false;
      conn.reconnectAttempts = 0;
    }
  };
}

// ============================================
// Debug / Status functions
// ============================================

/**
 * Get current connection status for debugging
 */
export function getSSEManagerStatus(): {
  events: { connected: boolean; subscriberCount: number };
  stats: { connected: boolean; subscriberCount: number };
} {
  return {
    events: {
      connected: connections.events.isConnected,
      subscriberCount: connections.events.subscribers.size,
    },
    stats: {
      connected: connections.stats.isConnected,
      subscriberCount: connections.stats.subscribers.size,
    },
  };
}

// Clean up on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Close events connection
    if (connections.events.eventSource) {
      connections.events.eventSource.close();
      connections.events.eventSource = null;
    }
    if (connections.events.reconnectTimeout) {
      clearTimeout(connections.events.reconnectTimeout);
    }

    // Close stats connection
    if (connections.stats.eventSource) {
      connections.stats.eventSource.close();
      connections.stats.eventSource = null;
    }
    if (connections.stats.reconnectTimeout) {
      clearTimeout(connections.stats.reconnectTimeout);
    }
  });
}
