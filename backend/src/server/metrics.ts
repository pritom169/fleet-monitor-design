import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const ingestMessages = new client.Counter({
  name: 'ingest_messages_total',
  help: 'MQTT messages by result',
  labelNames: ['result'] as const,
  registers: [registry],
});
export const ingestDropped = new client.Counter({
  name: 'ingest_dropped_total',
  help: 'Samples dropped because the persistence queue was full',
  labelNames: ['queue'] as const,
  registers: [registry],
});
export const ingestQueueDepth = new client.Gauge({
  name: 'ingest_queue_depth',
  help: 'Items waiting in the persistence queue',
  labelNames: ['queue'] as const,
  registers: [registry],
});
export const ingestLag = new client.Histogram({
  name: 'ingest_lag_seconds',
  help: 'received_at − robot_ts. Includes robot clock skew.',
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});
export const dbBatchWrite = new client.Histogram({
  name: 'db_batch_write_seconds',
  help: 'Duration of each batch write',
  labelNames: ['queue'] as const,
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});
export const robotsByStatus = new client.Gauge({
  name: 'robots_by_status',
  help: 'Current robot count per status',
  labelNames: ['status'] as const,
  registers: [registry],
});
export const wsClients = new client.Gauge({ name: 'ws_clients', help: 'Open browser WebSockets', registers: [registry] });
export const wsDisconnects = new client.Counter({
  name: 'ws_disconnects_total',
  help: 'Browser WebSocket disconnects by reason',
  labelNames: ['reason'] as const,
  registers: [registry],
});
export const mqttConnected = new client.Gauge({ name: 'mqtt_connected', help: '1 when connected to the broker', registers: [registry] });
export const mqttLwt = new client.Counter({ name: 'mqtt_lwt_total', help: 'Last-will "offline" messages received', registers: [registry] });
