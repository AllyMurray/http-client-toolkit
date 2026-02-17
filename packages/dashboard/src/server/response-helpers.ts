import type { ServerResponse } from 'http';

export function sendJson(
  res: ServerResponse,
  data: unknown,
  status: number = 200,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(
  res: ServerResponse,
  message: string,
  status: number = 500,
): void {
  sendJson(res, { error: message }, status);
}

export function sendNotFound(res: ServerResponse): void {
  sendError(res, 'Not found', 404);
}

export function sendMethodNotAllowed(res: ServerResponse): void {
  sendError(res, 'Method not allowed', 405);
}
