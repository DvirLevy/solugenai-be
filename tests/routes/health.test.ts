import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('GET /api/health', () => {
  it('reports a healthy service and a reachable database', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      database: 'connected',
    });
    expect(typeof response.body.timestamp).toBe('string');
  });
});
