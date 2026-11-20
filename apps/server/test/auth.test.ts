import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp } from './helpers';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

describe('registration', () => {
  it('makes the first user admin and later users plain users', async () => {
    ({ app } = await makeApp());
    const status = await client(app).get('/api/auth/status');
    expect(status.json()).toEqual({ needsSetup: true, registrationOpen: true, providers: [] });

    const first = await client(app).register('alice');
    expect(first.statusCode).toBe(201);
    expect(first.json().role).toBe('admin');

    const second = await client(app).register('bob');
    expect(second.json().role).toBe('user');
    expect((await client(app).get('/api/auth/status')).json().needsSetup).toBe(false);
  });

  it('with ALLOW_REGISTRATION=false only the very first account can register', async () => {
    ({ app } = await makeApp({ ALLOW_REGISTRATION: 'false' }));
    expect((await client(app).get('/api/auth/status')).json()).toEqual({ needsSetup: true, registrationOpen: true, providers: [] });

    expect((await client(app).register('alice')).statusCode).toBe(201);
    expect((await client(app).get('/api/auth/status')).json().registrationOpen).toBe(false);

    const res = await client(app).register('bob');
    expect(res.statusCode).toBe(403);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    ({ app } = await makeApp());
    await client(app).register('alice');
    expect((await client(app).register('ALICE')).statusCode).toBe(409);
  });

  it('validates input', async () => {
    ({ app } = await makeApp());
    const res = await client(app).register('a', 'short');
    expect(res.statusCode).toBe(400);
  });
});

describe('sessions', () => {
  it('logs in, reads /api/me, logs out', async () => {
    ({ app } = await makeApp());
    await client(app).register('alice');

    const c = client(app);
    expect((await c.get('/api/me')).statusCode).toBe(401);
    expect((await c.login('alice', 'wrong-password')).statusCode).toBe(401);
    expect((await c.login('Alice')).statusCode).toBe(200);
    expect((await c.get('/api/me')).json().username).toBe('alice');

    expect((await c.post('/api/auth/logout')).statusCode).toBe(204);
    expect((await c.get('/api/me')).statusCode).toBe(401);
  });

  it('rejects mutating requests without the CSRF header', async () => {
    ({ app } = await makeApp());
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', password: 'password123' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('saves user preferences', async () => {
    ({ app } = await makeApp());
    const c = client(app);
    await c.register('alice');
    expect((await c.get('/api/me')).json().prefs).toEqual({ theme: 'system', unlockMinutes: 10 });
    const res = await c.patch('/api/me/prefs', { theme: 'dark' });
    expect(res.json().prefs).toEqual({ theme: 'dark', unlockMinutes: 10 });
    // Changing one preference keeps the others.
    expect((await c.patch('/api/me/prefs', { unlockMinutes: 7 })).json().prefs).toEqual({ theme: 'dark', unlockMinutes: 7 });
    expect((await c.patch('/api/me/prefs', { theme: 'light' })).json().prefs).toEqual({ theme: 'light', unlockMinutes: 7 });
  });

  it('changing the password logs out other sessions but keeps the current one', async () => {
    ({ app } = await makeApp());
    const a = client(app);
    const b = client(app);
    await a.register('alice');
    await b.login('alice');

    const res = await a.post('/api/me/password', { currentPassword: 'password123', newPassword: 'newpassword1' });
    expect(res.statusCode).toBe(204);
    expect((await a.get('/api/me')).statusCode).toBe(200);
    expect((await b.get('/api/me')).statusCode).toBe(401);
    expect((await client(app).login('alice', 'newpassword1')).statusCode).toBe(200);
  });
});

describe('admin user management', () => {
  it('admin can promote a user; the last admin cannot be demoted or deleted', async () => {
    ({ app } = await makeApp());
    const admin = client(app);
    const aliceId = (await admin.register('alice')).json().id;
    const user = client(app);
    const bobId = (await user.register('bob')).json().id;

    // Plain users have no access to admin routes.
    expect((await user.get('/api/admin/users')).statusCode).toBe(403);

    // Alice is the only admin: demoting her must fail.
    expect((await admin.patch(`/api/admin/users/${aliceId}`, { role: 'user' })).statusCode).toBe(409);

    // Promote Bob; now Alice can be demoted (by Bob), but then Bob is the last admin.
    expect((await admin.patch(`/api/admin/users/${bobId}`, { role: 'admin' })).json().role).toBe('admin');
    expect((await user.patch(`/api/admin/users/${aliceId}`, { role: 'user' })).json().role).toBe('user');
    expect((await user.patch(`/api/admin/users/${bobId}`, { role: 'user' })).statusCode).toBe(409);

    // Alice (now a user) lost admin access.
    expect((await admin.get('/api/admin/users')).statusCode).toBe(403);
  });

  it('admin can create users even when registration is closed, and delete them', async () => {
    ({ app } = await makeApp({ ALLOW_REGISTRATION: 'false' }));
    const admin = client(app);
    const aliceId = (await admin.register('alice')).json().id;

    const created = await admin.post('/api/admin/users', { username: 'carol', password: 'password123' });
    expect(created.statusCode).toBe(201);
    expect(created.json().role).toBe('user');
    expect((await client(app).login('carol')).statusCode).toBe(200);

    expect((await admin.delete(`/api/admin/users/${aliceId}`)).statusCode).toBe(403); // not yourself
    expect((await admin.delete(`/api/admin/users/${created.json().id}`)).statusCode).toBe(204);
    expect((await admin.get('/api/admin/users')).json()).toHaveLength(1);
  });

  it('password reset by admin logs the user out', async () => {
    ({ app } = await makeApp());
    const admin = client(app);
    await admin.register('alice');
    const bob = client(app);
    const bobId = (await bob.register('bob')).json().id;

    await admin.patch(`/api/admin/users/${bobId}`, { password: 'resetpassword' });
    expect((await bob.get('/api/me')).statusCode).toBe(401);
    expect((await client(app).login('bob', 'resetpassword')).statusCode).toBe(200);
  });
});
