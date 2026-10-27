import { createHmac, randomUUID } from 'node:crypto';

export function settingsFromEnv(env, pluginID, mode) {
  const mock = mode === 'mock';
  const userID = Number(env.JAVA_EXAMPLE_DEV_USER_ID || 123);
  const port = Number(env.JAVA_EXAMPLE_DEV_PORT || 5173);
  const backendPort = Number(env.JAVA_EXAMPLE_DEV_BACKEND_PORT || 3014);
  const backendURL = env.JAVA_EXAMPLE_DEV_BACKEND_URL || `http://127.0.0.1:${backendPort}`;
  const secret = env.JAVA_EXAMPLE_HOST_SECRET || '';
  const origin = new URL(backendURL);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('JAVA_EXAMPLE_DEV_BACKEND_URL 必须为 HTTP/HTTPS origin');
  }
  if (!Number.isSafeInteger(userID) || userID <= 0) {
    throw new Error('JAVA_EXAMPLE_DEV_USER_ID 必须为正整数');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('JAVA_EXAMPLE_DEV_PORT 必须为有效端口');
  }
  if (!mock && secret.length < 32) {
    throw new Error('请在插件根目录 .env 设置至少 32 字符的 JAVA_EXAMPLE_HOST_SECRET；仅调界面可运行 npm run dev:mock');
  }
  return { mock, pluginID, userID, port, backendURL: origin.origin, secret };
}

export function createDevSupport(settings, entryURL, assetBase) {
  const pageBase = `/plugins/${settings.pluginID}`;
  const bridgeBase = `/api/plugin-bridge/${settings.pluginID}`;
  const apiBase = `${bridgeBase}/api/v1`;
  const mockProfile = {
    user_id: settings.userID, active: true, module_admin: false,
    demo_role: 'member', source: 'spring-boot',
  };
  // Explicit allowlist: the shared secret never belongs in browser configuration.
  const browserConfig = {
    mock: settings.mock, pluginID: settings.pluginID, userID: settings.userID,
    backendURL: settings.mock ? null : settings.backendURL, pageBase, apiBase, assetBase, entryURL,
  };

  function send(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  }

  async function middleware(request, response, next) {
    const pathname = request.url.split('?')[0];
    if (pathname === '/__dev/config') {
      send(response, 200, browserConfig);
      return;
    }
    if (pathname === '/__dev/profile') {
      if (request.method !== 'GET') {
        send(response, 405, { success: false, message: '只支持 GET' });
        return;
      }
      if (settings.mock) {
        send(response, 200, mockProfile);
        return;
      }
      try {
        const upstream = await fetch(`${settings.backendURL}/internal/profile`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
          headers: { 'Content-Type': 'application/json', 'X-AIHub-Plugin-Secret': settings.secret },
          body: JSON.stringify({ user_id: settings.userID }),
        });
        if (!upstream.ok) throw new Error('profile_unavailable');
        const profile = await upstream.json();
        if (profile?.user_id !== settings.userID || typeof profile.active !== 'boolean') {
          throw new Error('invalid_profile');
        }
        send(response, 200, profile);
      } catch {
        send(response, 502, { success: false, message: '无法读取插件资料，请检查后端是否启动、地址和配对密钥是否一致' });
      }
      return;
    }
    if (pathname.startsWith(bridgeBase)) {
      const allowed = pathname.startsWith(`${apiBase}/`) && !/[%;\\]/.test(pathname)
        && !pathname.split('/').some((part) => part === '.' || part === '..') && !pathname.includes('//');
      if (!allowed) {
        send(response, 404, { success: false, message: '调试代理仅开放本插件 /api/v1/*' });
        return;
      }
      if (settings.mock) {
        if (pathname === `${apiBase}/self` && request.method === 'GET') {
          send(response, 200, { success: true, message: '', data: mockProfile });
        } else {
          send(response, 404, { success: false, message: '纯前端模式只模拟 GET /self；业务接口请使用 npm run dev 联调' });
        }
        return;
      }
    }
    next();
  }

  const proxy = {
    [apiBase]: {
      target: settings.backendURL,
      changeOrigin: true,
      rewrite: (path) => path.slice(bridgeBase.length),
      configure(server) {
        server.on('proxyReq', (request) => {
          for (const header of Object.keys(request.getHeaders())) {
            if (header === 'cookie' || header === 'authorization' || header.startsWith('x-aihub-')) {
              request.removeHeader(header);
            }
          }
          const claims = {
            user_id: settings.userID, plugin_id: settings.pluginID, method: request.method,
            uri: request.path, request_id: `dev-${randomUUID()}`, expires_at: Math.floor(Date.now() / 1000) + 30,
          };
          const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
          const signature = createHmac('sha256', settings.secret).update(body).digest('base64url');
          request.setHeader('X-AIHub-Identity', `${body}.${signature}`);
          request.setHeader('X-AIHub-Plugin-ID', settings.pluginID);
        });
        server.on('error', (_error, _request, response) => {
          if (typeof response.writeHead === 'function' && !response.headersSent) {
            send(response, 502, { success: false, message: '插件后端不可达，请检查启动状态及 JAVA_EXAMPLE_DEV_BACKEND_URL' });
          }
        });
      },
    },
  };
  return { middleware, proxy: settings.mock ? {} : proxy };
}
