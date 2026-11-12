import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { JsonStore } from './store.js';
import { SecretBox } from './security/secret-box.js';
import { DriverManager } from './driver-manager.js';
import { createApplication } from './app.js';

export async function startServer(overrides = {}) {
  const config = loadConfig(overrides);
  const store = await new JsonStore(config.stateFile).init();
  const secretBox = await SecretBox.create({
    keyFile: config.secretFile,
    secret: process.env.APP_SECRET || ''
  });
  const driverManager = new DriverManager({
    oracleThickMode: config.oracleThickMode,
    oracleClientLibDir: config.oracleClientLibDir
  });
  const app = createApplication({ config, store, secretBox, driverManager });
  const server = http.createServer(app.handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  const displayHost = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
  console.log(`Node Magic API Studio: http://${displayHost}:${config.port}`);
  console.log(`Generated APIs:       http://${displayHost}:${config.port}${config.openapiPath}`);
  return { server, config, store, secretBox, driverManager, app };
}

async function shutdown(runtime) {
  await runtime.driverManager.dispose();
  await new Promise((resolve) => runtime.server.close(resolve));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startServer()
    .then((runtime) => {
      let closing = false;
      const close = async () => {
        if (closing) return;
        closing = true;
        await shutdown(runtime);
        process.exit(0);
      };
      process.on('SIGINT', close);
      process.on('SIGTERM', close);
      process.on('unhandledRejection', (error) => console.error(error));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
