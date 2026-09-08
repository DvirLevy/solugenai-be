import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { parse } from 'yaml';
import { createApp } from '../../src/app';

const app = createApp();

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
}

const specification = parse(
  fs.readFileSync(path.resolve(__dirname, '../../openapi.yaml'), 'utf8'),
) as OpenApiDocument;

/** Every route the API actually exposes, as `METHOD /path` relative to the /api base. */
const IMPLEMENTED_ENDPOINTS = [
  'get /health',
  'post /auth/register',
  'post /auth/login',
  'post /auth/refresh',
  'post /auth/logout',
  'get /auth/me',
  'post /auth/forgot-password',
  'post /auth/change-password',
];

describe('GET /api/docs', () => {
  it('serves the Swagger UI page', async () => {
    const response = await request(app).get('/api/docs/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('Solugen Authentication API');
  });
});

describe('openapi.yaml', () => {
  it('documents every implemented endpoint', () => {
    const documented = Object.entries(specification.paths).flatMap(([route, methods]) =>
      Object.keys(methods).map((method) => `${method} ${route}`),
    );

    expect(documented.sort()).toEqual(IMPLEMENTED_ENDPOINTS.sort());
  });

  it('describes both authentication cookies', () => {
    expect(Object.keys(specification.components.securitySchemes).sort()).toEqual([
      'accessTokenCookie',
      'refreshTokenCookie',
    ]);
  });

  it('gives every endpoint both a success and a failure response', () => {
    for (const [route, methods] of Object.entries(specification.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const codes = Object.keys((operation as { responses: Record<string, unknown> }).responses);

        expect({ endpoint: `${method} ${route}`, hasSuccess: codes.some((c) => c[0] === '2') }) //
          .toEqual({ endpoint: `${method} ${route}`, hasSuccess: true });
        expect({ endpoint: `${method} ${route}`, hasFailure: codes.some((c) => c[0] !== '2') }) //
          .toEqual({ endpoint: `${method} ${route}`, hasFailure: true });
      }
    }
  });
});
