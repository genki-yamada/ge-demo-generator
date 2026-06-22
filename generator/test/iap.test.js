import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { iapAuth } from '../src/auth/iap.js';

function appWith(middleware) {
  const app = express();
  app.use('/api', middleware);
  app.get('/api/ping', (req, res) => res.json({ email: req.user?.email ?? null }));
  return app;
}

describe('iapAuth middleware', () => {
  it('rejects with 401 when assertion header missing and no dev fallback', async () => {
    const app = appWith(iapAuth({ audience: 'aud' }));
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(401);
  });

  it('uses dev fallback email when header missing and devUserEmail set', async () => {
    const app = appWith(iapAuth({ audience: 'aud', devUserEmail: 'dev@example.com' }));
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('dev@example.com');
  });

  it('sets req.user from the verified payload', async () => {
    const verify = async (token, audience) => {
      expect(token).toBe('tok');
      expect(audience).toBe('aud');
      return { email: 'real@example.com', sub: '123' };
    };
    const app = appWith(iapAuth({ audience: 'aud', verify }));
    const res = await request(app).get('/api/ping').set('x-goog-iap-jwt-assertion', 'tok');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('real@example.com');
  });

  it('rejects with 401 when verification throws', async () => {
    const verify = async () => {
      throw new Error('bad token');
    };
    const app = appWith(iapAuth({ audience: 'aud', verify }));
    const res = await request(app).get('/api/ping').set('x-goog-iap-jwt-assertion', 'tok');
    expect(res.status).toBe(401);
  });
});
