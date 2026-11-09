import { createApp } from './app';
import { loadConfig } from './config';
import { log } from './log';

try {
  const app = await createApp(loadConfig());
  const stop = (signal: string) => {
    log.info({ signal }, 'signal');
    app.stop().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
} catch (err) {
  log.fatal({ err: (err as Error).message }, 'startup failed');
  process.exit(1);
}
