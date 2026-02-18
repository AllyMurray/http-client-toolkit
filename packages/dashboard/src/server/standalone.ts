import { createServer, type Server } from 'http';
import {
  validateStandaloneOptions,
  type StandaloneDashboardOptions,
} from '../config.js';
import { createDashboard } from './middleware.js';

export interface StandaloneDashboardServer {
  server: Server;
  close(): Promise<void>;
}

export async function startDashboard(
  options: StandaloneDashboardOptions,
): Promise<StandaloneDashboardServer> {
  const opts = validateStandaloneOptions(options);

  const middleware = createDashboard(options);

  const server = createServer((req, res) => {
    middleware(req, res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);

    server.listen(opts.port, opts.host, () => {
      const addr = server.address();
      /* v8 ignore next 2 -- addr is string only for Unix sockets */
      const url =
        typeof addr === 'string' ? addr : `http://${opts.host}:${opts.port}`;

      console.log(`Dashboard running at ${url}`);

      resolve({
        server,
        async close() {
          return new Promise<void>((res, rej) => {
            server.close((err) => {
              if (err) rej(err);
              else res();
            });
          });
        },
      });
    });
  });
}
