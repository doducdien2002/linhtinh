const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const port = Number(process.env.PORT || 8097);
const host = process.env.HOST || '0.0.0.0';
const telegramConfigPath = path.join(root, 'telegram.config.json');
const authStorePath = path.join(root, 'auth.store.json');
const telegramDeliveryStorePath = path.join(root, 'telegram.delivery.store.json');
const firebaseServiceAccountPath = path.join(root, 'firebase.service-account.json');
const devicesStorePath = path.join(root, 'devices.store.json');
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const loginAttempts = new Map();
const telegramDeliveryPending = new Map();
let firestore = null;
let firestoreInitErrorShown = false;
let signalMonitorRunning = false;
let deviceRegistry = null;
let deviceRegistryDirty = false;
const marketApiKeys = [
  ...(process.env.MARKET_API_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
  '3465f94ff4d64f2e94cc85ef80b50272',
  'e8f78a96e634470588a4f1f2e2449972',
].filter((key, index, all) => all.indexOf(key) === index);
const blockedFileNames = new Set([
  '.env',
  '.env.local',
  'auth.store.json',
  'telegram.config.json',
  'telegram.delivery.store.json',
  'firebase.service-account.json',
  'devices.store.json',
]);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function securityHeaders(type) {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' https://api.telegram.org wss://stream.binance.com:9443 wss://ws.finnhub.io wss://ws.twelvedata.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  };
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...securityHeaders(type),
  });
  res.end(body);
}

function readTelegramConfig() {
  try {
    if (!fs.existsSync(telegramConfigPath)) return {};
    return JSON.parse(fs.readFileSync(telegramConfigPath, 'utf8'));
  } catch (error) {
    console.warn(`Telegram config error: ${error.message}`);
    return {};
  }
}

function loadTelegramDeliveryStore() {
  try {
    if (!fs.existsSync(telegramDeliveryStorePath)) return { deliveries: {} };
    const store = JSON.parse(fs.readFileSync(telegramDeliveryStorePath, 'utf8'));
    return store && typeof store.deliveries === 'object' && store.deliveries
      ? store
      : { deliveries: {} };
  } catch (error) {
    console.warn(`Telegram delivery store error: ${error.message}`);
    return { deliveries: {} };
  }
}

function saveTelegramDeliveryStore(store) {
  const entries = Object.entries(store.deliveries || {})
    .sort(([, left], [, right]) => String(left.sentAt).localeCompare(String(right.sentAt)))
    .slice(-1000);
  store.deliveries = Object.fromEntries(entries);
  fs.writeFileSync(telegramDeliveryStorePath, JSON.stringify(store, null, 2), 'utf8');
}

function getFirestore() {
  if (firestore) return firestore;
  if (!fs.existsSync(firebaseServiceAccountPath)) return null;

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(fs.readFileSync(firebaseServiceAccountPath, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firestore = admin.firestore();
    return firestore;
  } catch (error) {
    if (!firestoreInitErrorShown) {
      console.error(`Firebase Admin initialization failed: ${error.message}`);
      firestoreInitErrorShown = true;
    }
    return null;
  }
}

function readJsonBody(req, maxBytes = 20000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sameOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const hostHeader = String(req.headers.host || '').toLowerCase();
    return originUrl.host.toLowerCase() === hostHeader;
  } catch (error) {
    return false;
  }
}

function rejectCrossOrigin(req, res) {
  if (sameOriginRequest(req)) return false;
  sendJson(res, 403, { ok: false, error: 'Cross-origin request blocked.' });
  return true;
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('hex')}`;
}

function requireInitialAdminPassword() {
  const password = process.env.CRAZII_ADMIN_PASSWORD;
  if (isProduction && (!password || password.length < 12)) {
    throw new Error('Set CRAZII_ADMIN_PASSWORD with at least 12 characters before first deploy.');
  }
  return password || 'admin123';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const { hash } = hashPassword(password, user.passwordSalt);
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function defaultAuthStore() {
  const password = hashPassword(requireInitialAdminPassword());
  const createdAt = nowIso();
  return {
    version: 1,
    createdAt,
    updatedAt: createdAt,
    users: [{
      id: createId('user'),
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      enabled: true,
      passwordSalt: password.salt,
      passwordHash: password.hash,
      activeSessionId: '',
      activeDeviceId: '',
      activeDeviceName: '',
      activeIp: '',
      activeUserAgent: '',
      activeAt: '',
      createdAt,
      loginCount: 0,
    }],
    sessions: [],
  };
}

function loadAuthStore() {
  try {
    if (!fs.existsSync(authStorePath)) {
      const store = defaultAuthStore();
      saveAuthStore(store);
      return store;
    }

    const store = JSON.parse(fs.readFileSync(authStorePath, 'utf8'));
    store.users = Array.isArray(store.users) ? store.users : [];
    store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
    return store;
  } catch (error) {
    console.warn(`Auth store error: ${error.message}`);
    const store = defaultAuthStore();
    saveAuthStore(store);
    return store;
  }
}

function saveAuthStore(store) {
  store.updatedAt = nowIso();
  fs.writeFileSync(authStorePath, JSON.stringify(store, null, 2), 'utf8');
}

function sanitizeUser(user, includeAdminFields = false) {
  const safeUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || 'user',
    enabled: user.enabled !== false,
  };

  if (!includeAdminFields) return safeUser;

  return {
    ...safeUser,
    activeSessionId: user.activeSessionId || '',
    activeDeviceId: user.activeDeviceId || '',
    activeDeviceName: user.activeDeviceName || '',
    activeIp: user.activeIp || '',
    activeUserAgent: user.activeUserAgent || '',
    activeAt: user.activeAt || '',
    createdAt: user.createdAt || '',
    loginCount: Number(user.loginCount || 0),
  };
}

function sanitizeSession(session, store) {
  const user = store.users.find((item) => item.id === session.userId);
  return {
    id: session.id,
    userId: session.userId,
    username: user?.username || '',
    deviceId: session.deviceId || '',
    deviceName: session.deviceName || '',
    ip: session.ip || '',
    userAgent: session.userAgent || '',
    createdAt: session.createdAt || '',
    lastSeenAt: session.lastSeenAt || '',
    expiresAt: session.expiresAt || '',
    revokedAt: session.revokedAt || '',
    revokedReason: session.revokedReason || '',
  };
}

function findUserByUsername(store, username) {
  const normalized = String(username || '').trim().toLowerCase();
  return store.users.find((user) => user.username.toLowerCase() === normalized);
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// --- DEVICE MANAGEMENT -------------------------------------------------
// Every request is attributed to a "device". If the client sends an
// `x-device-id` header (recommended: a random id the frontend generates
// once and stores locally) that id is used. Otherwise we fall back to a
// fingerprint derived from IP + User-Agent, so blocking still works even
// without any frontend changes (though a shared IP/browser will then
// share one fingerprint).
//
// The registry lives in memory and is flushed to devices.store.json
// periodically (not on every request) to avoid disk I/O on every single
// page/API hit. Block/unblock/delete actions flush immediately.
function loadDeviceRegistry() {
  if (deviceRegistry) return deviceRegistry;
  try {
    if (fs.existsSync(devicesStorePath)) {
      const raw = JSON.parse(fs.readFileSync(devicesStorePath, 'utf8'));
      deviceRegistry = raw && typeof raw.devices === 'object' && raw.devices ? raw : { devices: {} };
    } else {
      deviceRegistry = { devices: {} };
    }
  } catch (error) {
    console.warn(`Device store error: ${error.message}`);
    deviceRegistry = { devices: {} };
  }
  return deviceRegistry;
}

function saveDeviceRegistryNow() {
  const registry = loadDeviceRegistry();
  fs.writeFileSync(devicesStorePath, JSON.stringify(registry, null, 2), 'utf8');
  deviceRegistryDirty = false;
}

function deviceFingerprint(req) {
  const headerId = String(req.headers['x-device-id'] || '').trim().slice(0, 120);
  if (headerId) return headerId;
  const ip = requestIp(req);
  const ua = String(req.headers['user-agent'] || '');
  return `fp_${crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)}`;
}

function touchDevice(req) {
  const registry = loadDeviceRegistry();
  const id = deviceFingerprint(req);
  const now = nowIso();
  const headerName = String(req.headers['x-device-name'] || '').trim().slice(0, 80);
  const existing = registry.devices[id] || {
    id,
    deviceName: headerName || '',
    firstSeenAt: now,
    requestCount: 0,
    blocked: false,
    blockedAt: '',
  };
  existing.lastSeenAt = now;
  existing.lastIp = requestIp(req);
  existing.lastUserAgent = String(req.headers['user-agent'] || '').slice(0, 220);
  existing.lastPath = req.url ? String(req.url).split('?')[0].slice(0, 200) : '';
  existing.requestCount = Number(existing.requestCount || 0) + 1;
  if (headerName) existing.deviceName = headerName;
  registry.devices[id] = existing;
  deviceRegistryDirty = true;
  return existing;
}

// Called once at the very top of every request. Returns true if the
// request was blocked (response already sent) and the caller must stop.
function enforceDeviceGate(req, res) {
  const device = touchDevice(req);
  if (device.blocked) {
    sendJson(res, 403, {
      ok: false,
      error: 'Thiết bị này đã bị chặn truy cập.',
      reason: 'device_blocked',
    });
    return true;
  }
  return false;
}

function listDevices() {
  const registry = loadDeviceRegistry();
  return Object.values(registry.devices).sort((left, right) =>
    String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || '')));
}

function blockDevice(deviceId) {
  const registry = loadDeviceRegistry();
  const device = registry.devices[deviceId];
  if (!device) throw sessionError(404, 'Không tìm thấy thiết bị.');
  device.blocked = true;
  device.blockedAt = nowIso();
  saveDeviceRegistryNow();
  return device;
}

function unblockDevice(deviceId) {
  const registry = loadDeviceRegistry();
  const device = registry.devices[deviceId];
  if (!device) throw sessionError(404, 'Không tìm thấy thiết bị.');
  device.blocked = false;
  device.blockedAt = '';
  saveDeviceRegistryNow();
  return device;
}

function deleteDevice(deviceId) {
  const registry = loadDeviceRegistry();
  if (!registry.devices[deviceId]) throw sessionError(404, 'Không tìm thấy thiết bị.');
  delete registry.devices[deviceId];
  saveDeviceRegistryNow();
}

// Periodic flush for the non-critical lastSeenAt/requestCount updates.
setInterval(() => {
  if (deviceRegistryDirty) {
    try {
      saveDeviceRegistryNow();
    } catch (error) {
      console.warn(`Device store flush error: ${error.message}`);
    }
  }
}, 15000);
// -------------------------------------------------------------------------

function loginAttemptKey(req, username) {
  return `${requestIp(req)}:${String(username || '').trim().toLowerCase()}`;
}

function isLoginBlocked(key) {
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (!attempt.blockedUntil) return false;
  if (Date.now() > attempt.blockedUntil) {
    loginAttempts.delete(key);
    return false;
  }
  return true;
}

function recordLoginFailure(key) {
  const current = loginAttempts.get(key) || { count: 0, blockedUntil: 0 };
  current.count += 1;
  current.blockedUntil = current.count >= 8 ? Date.now() + 10 * 60 * 1000 : 0;
  loginAttempts.set(key, current);
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

function sessionError(status, message, reason = '') {
  const error = new Error(message);
  error.status = status;
  error.reason = reason;
  return error;
}

// --- AUTH BYPASS -----------------------------------------------------
// resolveSession/requireAdmin no longer validate a real session: every
// request is treated as already logged in as the first enabled admin
// user in the store. This effectively removes the login requirement —
// there is no session expiry, no "another device" kick, no disabled
// check. Anyone who can reach the server can call every API route.
function resolveSession(store) {
  const user = store.users.find((item) => item.role === 'admin' && item.enabled !== false)
    || store.users.find((item) => item.enabled !== false)
    || store.users[0];

  if (!user) throw sessionError(500, 'Không có tài khoản nào trong hệ thống.');

  const session = {
    id: 'no-auth',
    userId: user.id,
    revokedAt: '',
    revokedReason: '',
  };

  return { session, user };
}

function requireAdmin(store) {
  return resolveSession(store);
}
// -----------------------------------------------------------------------

async function handleAuthLogin(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  // Login always succeeds — kept only so any existing frontend login
  // screen still gets an { ok: true } response and moves on.
  const store = loadAuthStore();
  const auth = resolveSession(store);
  sendJson(res, 200, { ok: true, sessionId: auth.session.id, user: sanitizeUser(auth.user) });
}

async function handleAuthCheck(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  const store = loadAuthStore();
  const auth = resolveSession(store);
  sendJson(res, 200, { ok: true, user: sanitizeUser(auth.user) });
}

async function handleAuthLogout(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  // No real sessions to revoke anymore.
  sendJson(res, 200, { ok: true });
}

async function handleAuthAdmin(req, res, url) {
  try {
    const store = loadAuthStore();

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    if (rejectCrossOrigin(req, res)) return;

    const payload = await readJsonBody(req);
    const admin = requireAdmin(store);

    if (url.pathname === '/api/auth/admin/list') {
      sendJson(res, 200, {
        ok: true,
        users: store.users.map((user) => sanitizeUser(user, true)),
        sessions: store.sessions.slice(-80).reverse().map((session) => sanitizeSession(session, store)),
      });
      return;
    }

    if (url.pathname === '/api/auth/admin/create-user') {
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '');
      const role = payload.role === 'admin' ? 'admin' : 'user';
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
        sendJson(res, 400, { ok: false, error: 'Tên tài khoản 3-32 ký tự, chỉ dùng chữ/số/._-' });
        return;
      }
      if (password.length < 4) {
        sendJson(res, 400, { ok: false, error: 'Mật khẩu cần ít nhất 4 ký tự.' });
        return;
      }
      if (findUserByUsername(store, username)) {
        sendJson(res, 409, { ok: false, error: 'Tài khoản đã tồn tại.' });
        return;
      }

      const createdAt = nowIso();
      const hashed = hashPassword(password);
      store.users.push({
        id: createId('user'),
        username,
        displayName: String(payload.displayName || username).trim().slice(0, 60) || username,
        role,
        enabled: true,
        passwordSalt: hashed.salt,
        passwordHash: hashed.hash,
        activeSessionId: '',
        activeDeviceId: '',
        activeDeviceName: '',
        activeIp: '',
        activeUserAgent: '',
        activeAt: '',
        createdAt,
        loginCount: 0,
      });
      saveAuthStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/auth/admin/kick') {
      const user = store.users.find((item) => item.id === String(payload.userId || ''));
      if (!user) {
        sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài khoản.' });
        return;
      }
      const active = store.sessions.find((item) => item.id === user.activeSessionId);
      if (active && !active.revokedAt) {
        active.revokedAt = nowIso();
        active.revokedReason = 'admin_kick';
      }
      user.activeSessionId = '';
      saveAuthStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/auth/admin/toggle-user') {
      const user = store.users.find((item) => item.id === String(payload.userId || ''));
      if (!user) {
        sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (user.id === admin.user.id && payload.enabled === false) {
        sendJson(res, 400, { ok: false, error: 'Không thể tự khóa tài khoản admin đang dùng.' });
        return;
      }
      user.enabled = payload.enabled !== false;
      if (!user.enabled) {
        const active = store.sessions.find((item) => item.id === user.activeSessionId);
        if (active && !active.revokedAt) {
          active.revokedAt = nowIso();
          active.revokedReason = 'disabled';
        }
        user.activeSessionId = '';
      }
      saveAuthStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/auth/admin/list-devices') {
      sendJson(res, 200, { ok: true, devices: listDevices(), currentDeviceId: deviceFingerprint(req) });
      return;
    }

    if (url.pathname === '/api/auth/admin/block-device') {
      const deviceId = String(payload.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'Thiếu deviceId.' });
        return;
      }
      const device = blockDevice(deviceId);
      sendJson(res, 200, { ok: true, device });
      return;
    }

    if (url.pathname === '/api/auth/admin/unblock-device') {
      const deviceId = String(payload.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'Thiếu deviceId.' });
        return;
      }
      const device = unblockDevice(deviceId);
      sendJson(res, 200, { ok: true, device });
      return;
    }

    if (url.pathname === '/api/auth/admin/delete-device') {
      const deviceId = String(payload.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'Thiếu deviceId.' });
        return;
      }
      deleteDevice(deviceId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/auth/admin/change-password') {
      const user = store.users.find((item) => item.id === String(payload.userId || ''));
      const password = String(payload.password || '');
      if (!user) {
        sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (password.length < 4) {
        sendJson(res, 400, { ok: false, error: 'Mật khẩu cần ít nhất 4 ký tự.' });
        return;
      }
      const hashed = hashPassword(password);
      user.passwordSalt = hashed.salt;
      user.passwordHash = hashed.hash;
      saveAuthStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Auth admin endpoint not found' });
  } catch (error) {
    sendJson(res, error.status || 400, { ok: false, error: error.message, reason: error.reason || '' });
  }
}

function handleAuth(req, res, url) {
  if (url.pathname === '/api/auth/login') {
    handleAuthLogin(req, res);
    return;
  }
  if (url.pathname === '/api/auth/check') {
    handleAuthCheck(req, res);
    return;
  }
  if (url.pathname === '/api/auth/logout') {
    handleAuthLogout(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/auth/admin/')) {
    handleAuthAdmin(req, res, url);
    return;
  }
  sendJson(res, 404, { ok: false, error: 'Auth endpoint not found' });
}

async function deliverTelegramText(text, deliveryId = '') {
  const telegramConfig = readTelegramConfig();
  const token = telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = telegramConfig.chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
  }

  const normalizedText = String(text || '').trim();
  if (!normalizedText) throw new Error('Missing message text');
  const normalizedDeliveryId = String(deliveryId || '').trim().slice(0, 180);
  const deliveryStore = normalizedDeliveryId ? loadTelegramDeliveryStore() : null;
  if (normalizedDeliveryId && deliveryStore.deliveries[normalizedDeliveryId]) {
    return { deduplicated: true, sentAt: deliveryStore.deliveries[normalizedDeliveryId].sentAt };
  }

  const deliver = async () => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: normalizedText.slice(0, 3900),
        disable_web_page_preview: true,
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Telegram returned ${response.status}: ${body.slice(0, 300)}`);
  };

  let pending = normalizedDeliveryId ? telegramDeliveryPending.get(normalizedDeliveryId) : null;
  if (!pending) {
    pending = deliver();
    if (normalizedDeliveryId) telegramDeliveryPending.set(normalizedDeliveryId, pending);
  }
  try {
    await pending;
    if (normalizedDeliveryId) {
      deliveryStore.deliveries[normalizedDeliveryId] = { sentAt: nowIso() };
      saveTelegramDeliveryStore(deliveryStore);
    }
    return { deduplicated: false };
  } finally {
    if (normalizedDeliveryId) telegramDeliveryPending.delete(normalizedDeliveryId);
  }
}

async function sendTelegramMessage(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  try {
    const payload = await readJsonBody(req);
    resolveSession(loadAuthStore());
    const delivered = await deliverTelegramText(payload.text, payload.deliveryId);
    sendJson(res, 200, { ok: true, ...delivered });
  } catch (error) {
    sendJson(res, error.status || 502, { ok: false, error: error.message || 'Telegram delivery failed' });
  }
}

function signalDocumentId(signal) {
  return String(signal?.id || '').replace(/\//g, '_').slice(0, 240);
}

function normalizeTradeSignal(input) {
  const signal = input && typeof input === 'object' ? input : {};
  const id = signalDocumentId(signal);
  const entry = Number(signal.entry);
  const sl = Number(signal.sl);
  const tp1 = Number(signal.tp1);
  const tp2 = Number(signal.tp2);
  const tp3 = Number(signal.tp3);
  if (!id || ![entry, sl, tp1, tp2, tp3].every(Number.isFinite)) {
    throw new Error('Invalid trade signal');
  }
  const isBuy = signal.isBuy === true || String(signal.side || '').toUpperCase() === 'BUY';
  return {
    id,
    number: Number.isFinite(Number(signal.number)) ? Number(signal.number) : 0,
    symbol: String(signal.symbol || 'XAUUSD').trim().toUpperCase().slice(0, 40),
    side: isBuy ? 'BUY' : 'SELL',
    isBuy,
    interval: String(signal.interval || '5m').slice(0, 12),
    entry,
    sl,
    originalSl: Number.isFinite(Number(signal.originalSl)) ? Number(signal.originalSl) : sl,
    tp1,
    tp2,
    tp3,
    tpHits: Array.isArray(signal.tpHits) ? signal.tpHits.filter((item) => ['TP1', 'TP2', 'TP3'].includes(item)) : [],
    breakEvenMoved: Boolean(signal.breakEvenMoved),
    closed: Boolean(signal.closed),
    closedAt: signal.closedAt || null,
    signalTime: signal.time || null,
  };
}

async function handleTradeSignals(req, res, url) {
  if (req.method !== 'POST' || !['/api/signals/sync', '/api/signals/open'].includes(url.pathname)) {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  try {
    const payload = await readJsonBody(req);
    const auth = resolveSession(loadAuthStore());
    const db = getFirestore();
    if (!db) throw sessionError(503, 'Firebase server is not configured.');
    const collection = db.collection('telegramSignals');

    if (url.pathname === '/api/signals/open') {
      const snapshot = await collection.where('ownerId', '==', auth.user.id).get();
      const signals = snapshot.docs
        .map((document) => document.data())
        .filter((signal) => signal && !signal.closed)
        .sort((left, right) => String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')))
        .slice(-10);
      sendJson(res, 200, { ok: true, signals });
      return;
    }

    const incoming = Array.isArray(payload.signals) ? payload.signals.slice(-10) : [];
    const batch = db.batch();
    const syncedAt = nowIso();
    for (const input of incoming) {
      const signal = normalizeTradeSignal(input);
      batch.set(collection.doc(signal.id), {
        ...signal,
        ownerId: auth.user.id,
        owner: auth.user.username,
        updatedAt: syncedAt,
      }, { merge: true });
    }
    if (incoming.length) await batch.commit();
    sendJson(res, 200, { ok: true, count: incoming.length });
  } catch (error) {
    sendJson(res, error.status || 400, { ok: false, error: error.message || 'Signal sync failed' });
  }
}

function twelveDataSignalSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (normalized === 'XAUUSD' || normalized === 'XAU/USD' || normalized === 'GOLD') return 'XAU/USD';
  if (normalized === 'XAGUSD' || normalized === 'XAG/USD' || normalized === 'SILVER') return 'XAG/USD';
  if (/^[A-Z0-9]+USDT$/.test(normalized)) return `${normalized.slice(0, -4)}/USD`;
  return String(symbol || '').trim().toUpperCase();
}

async function fetchSignalPrice(symbol) {
  const target = new URL('https://api.twelvedata.com/price');
  target.searchParams.set('symbol', twelveDataSignalSymbol(symbol));
  let lastError = 'No Twelve Data key available';
  for (const key of marketApiKeys) {
    target.searchParams.set('apikey', key);
    try {
      const response = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 CRAZII-signal-monitor' } });
      const body = await response.json();
      const price = Number(body?.price);
      if (response.ok && Number.isFinite(price)) return price;
      lastError = body?.message || `Twelve Data returned ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(`Twelve Data price unavailable for ${symbol}: ${lastError}`);
}

function formatServerTradeUpdate(signal, result, price) {
  const resultText = String(result).toUpperCase();
  const targetPrice = resultText === 'BE' ? signal.entry : resultText === 'SL' ? signal.sl : signal[resultText.toLowerCase()];
  return [
    `${resultText.startsWith('TP') ? '✅' : resultText === 'BE' ? '🟡' : '❌'} KÈO ${signal.number || ''} ${signal.side} ĐÃ ${resultText}`.trim(),
    `Mã: ${signal.symbol} | Khung: ${signal.interval}`,
    `Entry: ${Number(signal.entry).toFixed(2)} | ${resultText}: ${Number(targetPrice).toFixed(2)}`,
    `Giá kiểm tra: ${Number(price).toFixed(2)}`,
  ].join('\n');
}

async function monitorTradeSignals() {
  if (signalMonitorRunning) return;
  const db = getFirestore();
  if (!db) return;
  signalMonitorRunning = true;
  try {
    const snapshot = await db.collection('telegramSignals').where('closed', '==', false).get();
    const prices = new Map();
    for (const document of snapshot.docs) {
      const signal = document.data();
      if (!prices.has(signal.symbol)) {
        try {
          prices.set(signal.symbol, await fetchSignalPrice(signal.symbol));
        } catch (error) {
          console.warn(`Signal monitor price error for ${signal.symbol}: ${error.message}`);
          prices.set(signal.symbol, null);
        }
      }
      const price = prices.get(signal.symbol);
      if (!Number.isFinite(price)) continue;

      const updates = { lastPrice: price, checkedAt: nowIso(), updatedAt: nowIso() };
      const tpHits = Array.isArray(signal.tpHits) ? [...signal.tpHits] : [];
      const isBuy = signal.isBuy === true || signal.side === 'BUY';
      const hitSl = isBuy ? price <= Number(signal.sl) : price >= Number(signal.sl);
      if (hitSl) {
        const result = signal.breakEvenMoved && Math.abs(Number(signal.sl) - Number(signal.entry)) < 0.000001 ? 'BE' : 'SL';
        await deliverTelegramText(formatServerTradeUpdate(signal, result, price), `result:${signal.id}:${result}`);
        Object.assign(updates, { closed: true, closedAt: Date.now(), closeResult: result, tpHits });
        await document.ref.set(updates, { merge: true });
        continue;
      }

      for (const name of ['TP1', 'TP2', 'TP3']) {
        if (tpHits.includes(name)) continue;
        const target = Number(signal[name.toLowerCase()]);
        const hitTarget = isBuy ? price >= target : price <= target;
        if (!hitTarget) continue;
        await deliverTelegramText(formatServerTradeUpdate(signal, name, price), `result:${signal.id}:${name}`);
        tpHits.push(name);
        if (name === 'TP1') {
          updates.originalSl = Number.isFinite(Number(signal.originalSl)) ? Number(signal.originalSl) : Number(signal.sl);
          updates.sl = Number(signal.entry);
          updates.breakEvenMoved = true;
          signal.sl = updates.sl;
          signal.breakEvenMoved = true;
        }
        if (name === 'TP3') Object.assign(updates, { closed: true, closedAt: Date.now(), closeResult: name });
      }
      updates.tpHits = tpHits;
      await document.ref.set(updates, { merge: true });
    }
  } catch (error) {
    console.error(`Signal monitor error: ${error.message}`);
  } finally {
    signalMonitorRunning = false;
  }
}

async function proxyJson(res, target) {
  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 CRAZII-local-chart',
        Accept: 'application/json,text/plain,*/*',
      },
    });
    const body = await upstream.text();
    send(res, upstream.status, body, upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  } catch (error) {
    send(res, 502, JSON.stringify({ error: error.message }), 'application/json; charset=utf-8');
  }
}

function looksLikeApiLimit(status, body) {
  const text = String(body || '').toLowerCase();
  return status === 401
    || status === 403
    || status === 429
    || text.includes('api limit')
    || text.includes('rate limit')
    || text.includes('quota')
    || text.includes('credits')
    || text.includes('exceeded')
    || text.includes('too many requests')
    || text.includes('invalid api key')
    || text.includes('invalid token');
}

async function proxyJsonWithKeyFallback(res, target, keyParam) {
  if (target.searchParams.get(keyParam) || !marketApiKeys.length) {
    proxyJson(res, target);
    return;
  }

  let lastStatus = 502;
  let lastBody = '';
  let lastType = 'application/json; charset=utf-8';

  for (const key of marketApiKeys) {
    const keyedTarget = new URL(target);
    keyedTarget.searchParams.set(keyParam, key);

    try {
      const upstream = await fetch(keyedTarget, {
        headers: {
          'User-Agent': 'Mozilla/5.0 CRAZII-local-chart',
          Accept: 'application/json,text/plain,*/*',
        },
      });
      const body = await upstream.text();
      lastStatus = upstream.status;
      lastBody = body;
      lastType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
      if (!looksLikeApiLimit(upstream.status, body)) {
        send(res, upstream.status, body, lastType);
        return;
      }
    } catch (error) {
      lastStatus = 502;
      lastBody = JSON.stringify({ error: error.message });
      lastType = 'application/json; charset=utf-8';
    }
  }

  send(res, lastStatus, lastBody || JSON.stringify({ error: 'All API keys failed' }), lastType);
}

function serveFile(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(root, safePath));
  const lowerName = path.basename(filePath).toLowerCase();
  if (!filePath.startsWith(root)) {
    send(res, 403, 'Forbidden');
    return;
  }
  if (
    blockedFileNames.has(lowerName)
    || lowerName.endsWith('.bak')
    || lowerName.endsWith('.config.json')
    || lowerName.endsWith('.store.json')
    || lowerName.includes('secret')
  ) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, 'Not found');
      return;
    }

    const type = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, securityHeaders(type));
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  if (enforceDeviceGate(req, res)) return;

  if (url.pathname === '/api/telegram/send') {
    sendTelegramMessage(req, res);
    return;
  }

  if (url.pathname.startsWith('/api/signals/')) {
    handleTradeSignals(req, res, url);
    return;
  }

  if (url.pathname.startsWith('/api/auth/')) {
    handleAuth(req, res, url);
    return;
  }

  if (url.pathname === '/api/yahoo/chart') {
    const symbol = url.searchParams.get('symbol') || 'GC=F';
    const range = url.searchParams.get('range') || '1d';
    const interval = url.searchParams.get('interval') || '1m';
    const target = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    target.searchParams.set('range', range);
    target.searchParams.set('interval', interval);
    target.searchParams.set('includePrePost', 'true');
    target.searchParams.set('_', String(Date.now()));
    proxyJson(res, target);
    return;
  }

  if (url.pathname === '/api/binance/klines') {
    const target = new URL('https://api.binance.com/api/v3/klines');
    for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
    proxyJson(res, target);
    return;
  }

  if (url.pathname === '/api/binance/ticker') {
    const target = new URL('https://api.binance.com/api/v3/ticker/price');
    for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
    proxyJson(res, target);
    return;
  }

  if (url.pathname === '/api/finnhub/candle') {
    const target = new URL('https://finnhub.io/api/v1/forex/candle');
    for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
    proxyJsonWithKeyFallback(res, target, 'token');
    return;
  }

  if (url.pathname === '/api/finnhub/quote') {
    const target = new URL('https://finnhub.io/api/v1/quote');
    for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
    proxyJsonWithKeyFallback(res, target, 'token');
    return;
  }

  if (url.pathname === '/api/twelvedata/time_series') {
    const target = new URL('https://api.twelvedata.com/time_series');
    for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
    proxyJsonWithKeyFallback(res, target, 'apikey');
    return;
  }

  if (url.pathname === '/api/twelvedata/price') {
    const target = new URL('https://api.twelvedata.com/price');
    for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
    proxyJsonWithKeyFallback(res, target, 'apikey');
    return;
  }

  serveFile(res, decodeURIComponent(url.pathname));
});

server.listen(port, host, () => {
  console.log(`CRAZII chart running at http://127.0.0.1:${port} (LAN: http://<server-ip>:${port})`);
  monitorTradeSignals();
  setInterval(monitorTradeSignals, Number(process.env.SIGNAL_MONITOR_MS || 10_000));
});