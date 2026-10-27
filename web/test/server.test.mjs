import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from 'vite';
import { createDevSupport, settingsFromEnv } from '../server.mjs';

const secret = '0123456789abcdef0123456789abcdef';
const root = fileURLToPath(new URL('..', import.meta.url));

async function backend(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function devServer(t, env = {}, mode = 'mock') {
  const settings = settingsFromEnv(env, 'java-example', mode);
  const support = createDevSupport(settings, '/entry.js', '/assets');
  const server = await createServer({
    configFile: false, root, logLevel: 'silent',
    plugins: [{ name: 'test-dev-support', configureServer(server) { server.middlewares.use(support.middleware); } }],
    server: { host: '127.0.0.1', port: 0, proxy: support.proxy },
  });
  await server.listen();
  t.after(() => server.close());
  return `http://127.0.0.1:${server.httpServer.address().port}`;
}

test('pure frontend mode works without a secret or backend and limits mocked APIs', async (t) => {
  const base = await devServer(t, { JAVA_EXAMPLE_DEV_USER_ID: '42' });
  const config = await (await fetch(`${base}/__dev/config`)).json();
  assert.equal(config.mock, true);
  assert.equal(config.backendURL, null);
  assert.equal(config.apiBase, '/api/plugin-bridge/java-example/api/v1');
  const profile = await (await fetch(`${base}/__dev/profile`)).json();
  assert.equal(profile.user_id, 42);
  assert.equal(profile.module_admin, false);
  const self = await (await fetch(`${base}${config.apiBase}/self`)).json();
  assert.deepEqual(self.data, profile);
  assert.equal((await fetch(`${base}${config.apiBase}/other`)).status, 404);
  assert.equal((await fetch(`${base}/api/plugin-bridge/java-example/internal/manifest`)).status, 404);
  assert.equal((await fetch(`${base}/__dev/profile`, { method: 'POST' })).status, 405);
});

test('real backend profile uses service credentials only on the server', async (t) => {
  let received;
  const target = await backend(t, async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received = { path: request.url, headers: request.headers, body: JSON.parse(body) };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ user_id: 123, active: true, module_admin: false }));
  });
  const base = await devServer(t, {
    JAVA_EXAMPLE_HOST_SECRET: secret, JAVA_EXAMPLE_DEV_BACKEND_URL: target,
  }, 'development');
  const config = await (await fetch(`${base}/__dev/config`)).text();
  assert(!config.includes(secret));
  assert(!config.includes('secret'));
  const profile = await (await fetch(`${base}/__dev/profile`)).json();
  assert.equal(profile.user_id, 123);
  assert.equal(received.path, '/internal/profile');
  assert.equal(received.headers['x-aihub-plugin-secret'], secret);
  assert.deepEqual(received.body, { user_id: 123 });
});

test('proxy signs exact raw URI and method while replacing forged browser credentials', async (t) => {
  let received;
  const target = await backend(t, (request, response) => {
    received = { method: request.method, uri: request.url, headers: request.headers };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ success: true }));
  });
  const base = await devServer(t, {
    JAVA_EXAMPLE_HOST_SECRET: secret, JAVA_EXAMPLE_DEV_BACKEND_URL: target,
  }, 'development');
  const uri = '/api/v1/self?tag=a%2Fb&tag=two&space=a+b&user_id=999';
  const response = await fetch(`${base}/api/plugin-bridge/java-example${uri}`, {
    method: 'PATCH', headers: {
      Authorization: 'Bearer forged', Cookie: 'session=forged',
      'X-AIHub-Identity': 'forged', 'X-AIHub-Plugin-Secret': 'forged',
      'X-AIHub-Host-Authorization': 'forged',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(received.method, 'PATCH');
  assert.equal(received.uri, uri);
  for (const header of ['authorization', 'cookie', 'x-aihub-plugin-secret', 'x-aihub-host-authorization']) {
    assert.equal(received.headers[header], undefined, header);
  }
  const [payload, signature] = received.headers['x-aihub-identity'].split('.');
  assert.equal(signature, createHmac('sha256', secret).update(payload).digest('base64url'));
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.user_id, 123);
  assert.equal(claims.plugin_id, 'java-example');
  assert.equal(claims.method, received.method);
  assert.equal(claims.uri, received.uri);
  assert(claims.expires_at > Date.now() / 1000 && claims.expires_at <= Date.now() / 1000 + 30);
  assert(claims.request_id.startsWith('dev-'));
  assert.equal((await fetch(`${base}/api/plugin-bridge/java-example/internal/runtime`)).status, 404);
  assert.equal((await fetch(`${base}/api/plugin-bridge/java-example/api/v1/%2e%2e/internal`)).status, 404);
});

test('profile redirects and upstream errors never expose service credentials', async (t) => {
  let followed = false;
  const receiver = await backend(t, (_request, response) => { followed = true; response.end('unexpected'); });
  const target = await backend(t, (_request, response) => {
    response.writeHead(302, { Location: receiver });
    response.end(secret);
  });
  const base = await devServer(t, {
    JAVA_EXAMPLE_HOST_SECRET: secret, JAVA_EXAMPLE_DEV_BACKEND_URL: target,
  }, 'development');
  const response = await fetch(`${base}/__dev/profile`);
  assert.equal(response.status, 502);
  assert(!(await response.text()).includes(secret));
  assert.equal(followed, false);
});

test('live mode requires pairing, valid origins, a positive user ID and valid port', () => {
  assert.throws(() => settingsFromEnv({}, 'java-example', 'development'), /JAVA_EXAMPLE_HOST_SECRET/);
  for (const url of ['ftp://localhost', 'http://user:password@localhost', 'http://localhost/path', 'http://localhost?x=1']) {
    assert.throws(() => settingsFromEnv({ JAVA_EXAMPLE_DEV_BACKEND_URL: url }, 'java-example', 'mock'));
  }
  for (const id of ['0', '-1', '1.5', 'invalid', '9007199254740992']) {
    assert.throws(() => settingsFromEnv({ JAVA_EXAMPLE_DEV_USER_ID: id }, 'java-example', 'mock'));
  }
  assert.throws(() => settingsFromEnv({ JAVA_EXAMPLE_DEV_PORT: '70000' }, 'java-example', 'mock'));
});
