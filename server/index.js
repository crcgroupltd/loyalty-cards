// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

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

// Common deployment mistakes. Both fail safe (requests from the real site are
// refused, or cookies lack Secure), but the cause is not obvious otherwise.
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.origin).hostname);
if (process.env.NODE_ENV === 'production' && config.originIsDefault) {
  app.log.warn('ORIGIN is not set. Set it to your public URL (e.g. https://cards.example.com) or sign-in and saving will fail.');
}
if (config.origin.startsWith('http://') && !isLocal) {
  app.log.warn('ORIGIN uses http://. Serve the app over HTTPS: passkeys, the camera and offline mode need it, and session cookies are not marked Secure.');
}
