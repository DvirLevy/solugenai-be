import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app';
import { errorHandler } from '../../src/middleware/error-handler';
import { validate } from '../../src/middleware/validate';
import { ApiError } from '../../src/utils/api-error';

describe('unmatched routes', () => {
  const app = createApp();

  it('returns a 404 in the standard error shape', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(typeof response.body.message).toBe('string');
    expect(response.body.errors).toBeUndefined();
  });
});

describe('errorHandler', () => {
  /** Mounts a route that throws whatever the test needs, behind the real error handler. */
  function appThatThrows(error: unknown) {
    const app = express();
    app.get('/boom', () => {
      throw error;
    });
    app.use(errorHandler);
    return app;
  }

  it('uses the status and message of an ApiError', async () => {
    const response = await request(appThatThrows(ApiError.unauthorized())).get('/boom');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Unauthorized.' });
  });

  it('hides the details of an unexpected error behind a generic 500', async () => {
    const leaky = new Error('connect ECONNREFUSED 10.0.0.7:5432 — password=hunter2');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(appThatThrows(leaky)).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Something went wrong. Please try again later.' });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
    expect(response.body.stack).toBeUndefined();

    errorSpy.mockRestore();
  });
});

describe('validate', () => {
  const schema = z.object({
    email: z.email('Please enter a valid email address.'),
    age: z.coerce.number().int().min(18, 'Must be at least 18.'),
  });

  const app = express();
  app.use(express.json());
  app.post('/echo', validate(schema), (req, res) => {
    res.json(req.body);
  });
  app.use(errorHandler);

  it('reports each invalid field under `errors` for the frontend to render', async () => {
    const response = await request(app).post('/echo').send({ email: 'nope', age: 12 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed.');
    expect(response.body.errors).toEqual({
      email: 'Please enter a valid email address.',
      age: 'Must be at least 18.',
    });
  });

  it('replaces the body with the parsed and coerced result', async () => {
    const response = await request(app).post('/echo').send({ email: 'a@b.com', age: '30' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ email: 'a@b.com', age: 30 });
  });
});
