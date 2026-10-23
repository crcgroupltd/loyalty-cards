import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`Origin ${config.origin}, passkey RP ID ${config.rpId}`);
