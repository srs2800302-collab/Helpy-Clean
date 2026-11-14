import type { HealthResponse } from '@helpy/contracts';

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: HealthResponse | { readonly error: 'not_found' | 'method_not_allowed' };
}

export function handleHttp(request: HttpRequest): HttpResponse {
  if (request.path !== '/health') {
    return { status: 404, body: { error: 'not_found' } };
  }
  if (request.method !== 'GET') {
    return { status: 405, body: { error: 'method_not_allowed' } };
  }
  return { status: 200, body: { status: 'ok', contractVersion: 1 } };
}
