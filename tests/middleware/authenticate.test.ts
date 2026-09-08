import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../../src/config/env';
import { authenticate, getAuthenticatedUserId } from '../../src/middleware/authenticate';
import { errorHandler } from '../../src/middleware/error-handler';
import { generateRefreshToken, signAccessToken } from '../../src/services/token.service';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../../src/utils/cookies';

const app = express();
app.use(cookieParser());
app.get('/protected', authenticate, (req, res) => {
  res.json({ userId: getAuthenticatedUserId(req) });
});
app.use(errorHandler);

const UNAUTHORIZED = { message: 'Unauthorized.' };

describe('authenticate', () => {
  it('admits a request carrying a valid access token cookie', async () => {
    const response = await request(app)
      .get('/protected')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${signAccessToken('user-123')}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'user-123' });
  });

  it('rejects a request with no cookie at all', async () => {
    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHORIZED);
  });

  it.each([
    ['an empty cookie', ''],
    ['a malformed token', 'not-a-jwt'],
    ['a token signed with the wrong secret', jwt.sign({ userId: 'x' }, 'some-other-secret-value')],
    [
      'an expired token',
      jwt.sign({ userId: 'x', exp: Math.floor(Date.now() / 1000) - 60 }, config.accessToken.secret),
    ],
  ])('rejects %s with an identical response', async (_label, token) => {
    const response = await request(app)
      .get('/protected')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${token}`);

    expect(response.status).toBe(401);
    // Same body every time — nothing reveals which check failed.
    expect(response.body).toEqual(UNAUTHORIZED);
  });

  it('does not accept a refresh token in place of an access token', async () => {
    // A real refresh token is opaque rather than a JWT, and only the refresh route may redeem it.
    const response = await request(app)
      .get('/protected')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${generateRefreshToken()}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHORIZED);
  });
});
