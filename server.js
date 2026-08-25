const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const port = Number(process.env.PORT || 8097);
const host = process.env.HOST || '0.0.0.0';
const telegramConfigPath = path.join(root, 'telegram.config.json');
const authStorePath = path.join(root, 'auth.store.json');
const firebaseServiceAccountPath = path.join(root, 'firebase.service-account.json');
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const loginAttempts = new Map();
const telegramDeliveryPending = new Map();
let firestore = null;
let firestoreInitErrorShown = false;
let signalMonitorRunning = false;
let authStoreCache = null;
let authStoreCacheAt = 0;
const deviceCache = new Map();
const priceCache = new Map();
const proxyResponseCache = new Map();
const priceStreams = new Map();
const runtimeCollectionName = process.env.FIRESTORE_RUNTIME_COLLECTION || 'craziiRuntime';
const authStoreDocName = process.env.FIRESTORE_AUTH_DOC || 'authStore';
const devicesCollectionName = process.env.FIRESTORE_DEVICES_COLLECTION || 'craziiDevices';
const telegramDeliveriesCollectionName = process.env.FIRESTORE_DELIVERIES_COLLECTION || 'telegramDeliveries';
const telegramSignalsCollectionName = process.env.FIRESTORE_SIGNALS_COLLECTION || 'telegramSignals';
const authCacheTtlMs = Number(process.env.AUTH_CACHE_TTL_MS || 5000);
const deviceWriteIntervalMs = Number(process.env.DEVICE_WRITE_INTERVAL_MS || 300000);
const realtimePricePollMs = Math.max(Number(process.env.REALTIME_PRICE_POLL_MS || 60_000), 10_000);
const priceCacheTtlMs = Math.max(Number(process.env.PRICE_CACHE_TTL_MS || realtimePricePollMs - 1000), 5_000);
const signalMonitorIntervalMs = Math.max(Number(process.env.SIGNAL_MONITOR_MS || 60_000), 10_000);
const apiLimitCooldownMs = Math.max(Number(process.env.TWELVEDATA_LIMIT_COOLDOWN_MS || 60 * 60_000), 60_000);
const proxyDailyCacheTtlMs = Math.max(Number(process.env.PROXY_DAILY_CACHE_TTL_MS || 15 * 60_000), 60_000);
const marketApiKeys = [
  ...(process.env.MARKET_API_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
  '3465f94ff4d64f2e94cc85ef80b50272',
  'e8f78a96e634470588a4f1f2e2449972',
].filter((key, index, all) => all.indexOf(key) === index);
const priceFetchPending = new Map();
const apiLimitCooldowns = new Map();
const blockedFileNames = new Set([
  '.env',
  '.env.local',
  'auth.store.json',
  'telegram.config.json',
  'telegram.delivery.store.json',
  'telegram.signals.store.json',
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
  const headers = {
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
  if (isProduction) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
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

function getFirestore() {
  if (firestore) return firestore;

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      let serviceAccount = null;
      if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      } else if (fs.existsSync(firebaseServiceAccountPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(firebaseServiceAccountPath, 'utf8'));
      }

      if (!serviceAccount) return null;
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

function requireFirestore() {
  const db = getFirestore();
  if (!db) throw sessionError(503, 'Firebase server is not configured.');
  return db;
}

function runtimeDoc(name) {
  return requireFirestore().collection(runtimeCollectionName).doc(name);
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

function normalizeAuthStore(store) {
  const normalized = store && typeof store === 'object' ? store : {};
  normalized.version = normalized.version || 1;
  normalized.createdAt = normalized.createdAt || nowIso();
  normalized.updatedAt = normalized.updatedAt || normalized.createdAt;
  normalized.users = Array.isArray(normalized.users) ? normalized.users : [];
  normalized.sessions = Array.isArray(normalized.sessions) ? normalized.sessions : [];
  return normalized;
}

function loadLegacyAuthStore() {
  try {
    if (!fs.existsSync(authStorePath)) return null;
    const store = JSON.parse(fs.readFileSync(authStorePath, 'utf8'));
    return normalizeAuthStore(store);
  } catch (error) {
    console.warn(`Legacy auth store migration skipped: ${error.message}`);
    return null;
  }
}

async function loadAuthStore() {
  if (authStoreCache && Date.now() - authStoreCacheAt < authCacheTtlMs) {
    return authStoreCache;
  }

  const ref = runtimeDoc(authStoreDocName);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    authStoreCache = normalizeAuthStore(snapshot.data());
    authStoreCacheAt = Date.now();
    return authStoreCache;
  }

  const store = loadLegacyAuthStore() || defaultAuthStore();
  await saveAuthStore(store);
  return store;
}

async function saveAuthStore(store) {
  store.updatedAt = nowIso();
  authStoreCache = store;
  authStoreCacheAt = Date.now();
  await runtimeDoc(authStoreDocName).set(store, { merge: false });
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

function requestQueryValue(req, key) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    return url.searchParams.get(key) || '';
  } catch (error) {
    return '';
  }
}

// --- DEVICE MANAGEMENT -------------------------------------------------
// Every request is attributed to a "device". If the client sends an
// `x-device-id` header (recommended: a random id the frontend generates
// once and stores locally) that id is used. Otherwise we fall back to a
// fingerprint derived from IP + User-Agent, so blocking still works even
// without any frontend changes (though a shared IP/browser will then
// share one fingerprint).
//
// Device state is stored in Firestore so Render remains authoritative even
// when the browser/computer that opened the chart is offline.
function normalizeDeviceId(value) {
  const id = String(value || '').trim().slice(0, 120);
  return id.replace(/[\/\\#?\[\]]/g, '_');
}

function deviceFingerprint(req) {
  const headerId = normalizeDeviceId(req.headers['x-device-id'] || requestQueryValue(req, 'deviceId'));
  if (headerId) return headerId;
  const ip = requestIp(req);
  const ua = String(req.headers['user-agent'] || '');
  return `fp_${crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)}`;
}

function deviceDoc(deviceId) {
  return requireFirestore().collection(devicesCollectionName).doc(normalizeDeviceId(deviceId));
}

async function touchDevice(req) {
  const id = deviceFingerprint(req);
  const now = nowIso();
  const headerName = String(req.headers['x-device-name'] || requestQueryValue(req, 'deviceName') || '').trim().slice(0, 80);
  const cached = deviceCache.get(id);
  if (cached) {
    const cachedDevice = cached.device;
    cachedDevice.lastSeenAt = now;
    cachedDevice.lastIp = requestIp(req);
    cachedDevice.lastUserAgent = String(req.headers['user-agent'] || '').slice(0, 220);
    cachedDevice.lastPath = req.url ? String(req.url).split('?')[0].slice(0, 200) : '';
    cachedDevice.requestCount = Number(cachedDevice.requestCount || 0) + 1;
    if (headerName) cachedDevice.deviceName = headerName;
    if (Date.now() - cached.wroteAt >= deviceWriteIntervalMs) {
      await deviceDoc(id).set(cachedDevice, { merge: true });
      cached.wroteAt = Date.now();
    }
    return cachedDevice;
  }

  const ref = deviceDoc(id);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() : {
    id,
    deviceName: headerName || '',
    firstSeenAt: now,
    requestCount: 0,
    blocked: false,
    blockedAt: '',
    note: '',
  };
  const updates = {
    ...existing,
    id,
    lastSeenAt: now,
    lastIp: requestIp(req),
    lastUserAgent: String(req.headers['user-agent'] || '').slice(0, 220),
    lastPath: req.url ? String(req.url).split('?')[0].slice(0, 200) : '',
    requestCount: Number(existing.requestCount || 0) + 1,
    deviceName: headerName || existing.deviceName || '',
    blocked: existing.blocked === true,
    blockedAt: existing.blockedAt || '',
    note: String(existing.note || '').slice(0, 240),
  };
  if (!snapshot.exists || Date.now() - new Date(existing.lastSeenAt || 0).getTime() >= deviceWriteIntervalMs) {
    await ref.set(updates, { merge: true });
  }
  deviceCache.set(id, { device: updates, wroteAt: Date.now() });
  return updates;
}

// Called once at the very top of every request. Returns true if the
// request was blocked (response already sent) and the caller must stop.
async function enforceDeviceGate(req, res) {
  const device = await touchDevice(req);
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

async function listDevices() {
  const snapshot = await requireFirestore().collection(devicesCollectionName).get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .sort((left, right) => String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || '')));
}

async function getDeviceOrThrow(deviceId) {
  const ref = deviceDoc(deviceId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw sessionError(404, 'Không tìm thấy thiết bị.');
  return { ref, device: { id: snapshot.id, ...snapshot.data() } };
}

async function blockDevice(deviceId) {
  const { ref, device } = await getDeviceOrThrow(deviceId);
  Object.assign(device, { blocked: true, blockedAt: nowIso() });
  await ref.set(device, { merge: true });
  deviceCache.set(device.id, { device, wroteAt: Date.now() });
  return device;
}

async function unblockDevice(deviceId) {
  const { ref, device } = await getDeviceOrThrow(deviceId);
  Object.assign(device, { blocked: false, blockedAt: '' });
  await ref.set(device, { merge: true });
  deviceCache.set(device.id, { device, wroteAt: Date.now() });
  return device;
}

async function deleteDevice(deviceId) {
  const { ref } = await getDeviceOrThrow(deviceId);
  await ref.delete();
  deviceCache.delete(normalizeDeviceId(deviceId));
}

async function setDeviceNote(deviceId, note) {
  const { ref, device } = await getDeviceOrThrow(deviceId);
  device.note = String(note || '').trim().slice(0, 240);
  await ref.set({ note: device.note }, { merge: true });
  deviceCache.set(device.id, { device, wroteAt: Date.now() });
  return device;
}
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

function payloadDeviceId(payload, req) {
  return String(payload?.deviceId || req.headers['x-device-id'] || requestQueryValue(req, 'deviceId') || deviceFingerprint(req) || '').trim();
}

function revokeSession(session, reason) {
  if (!session || session.revokedAt) return;
  session.revokedAt = nowIso();
  session.revokedReason = reason;
}

async function resolveSession(store, payload = {}, req = null) {
  const sessionId = String(payload.sessionId || '').trim();
  if (!sessionId) throw sessionError(401, 'Vui lòng đăng nhập lại.', 'missing_session');

  const session = store.sessions.find((item) => item.id === sessionId);
  if (!session || session.revokedAt) {
    throw sessionError(401, 'Phiên đăng nhập không hợp lệ.', session?.revokedReason || 'invalid_session');
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    revokeSession(session, 'expired');
    const expiredUser = store.users.find((item) => item.id === session.userId);
    if (expiredUser?.activeSessionId === session.id) expiredUser.activeSessionId = '';
    await saveAuthStore(store);
    throw sessionError(401, 'Phiên đăng nhập đã hết hạn.', 'expired');
  }

  const user = store.users.find((item) => item.id === session.userId);
  if (!user || user.enabled === false) {
    revokeSession(session, 'disabled');
    await saveAuthStore(store);
    throw sessionError(403, 'Tài khoản đã bị khóa.', 'disabled');
  }

  const currentDeviceId = req ? payloadDeviceId(payload, req) : String(payload.deviceId || '');
  if (session.deviceId && currentDeviceId && session.deviceId !== currentDeviceId) {
    revokeSession(session, 'device_mismatch');
    if (user.activeSessionId === session.id) user.activeSessionId = '';
    await saveAuthStore(store);
    throw sessionError(401, 'Thiết bị không khớp với phiên đăng nhập.', 'device_mismatch');
  }

  if (user.activeSessionId && user.activeSessionId !== session.id) {
    revokeSession(session, 'another_device_login');
    await saveAuthStore(store);
    throw sessionError(409, 'Tài khoản này đang đăng nhập trên thiết bị khác.', 'another_device_login');
  }

  session.lastSeenAt = nowIso();
  user.activeSessionId = session.id;
  user.activeDeviceId = session.deviceId || currentDeviceId;
  user.activeDeviceName = session.deviceName || String(req?.headers['x-device-name'] || '').slice(0, 80);
  user.activeIp = req ? requestIp(req) : user.activeIp;
  user.activeUserAgent = req ? String(req.headers['user-agent'] || '').slice(0, 220) : user.activeUserAgent;
  user.activeAt = session.lastSeenAt;
  return { session, user };
}

async function requireAdmin(store, payload = {}, req = null) {
  const auth = await resolveSession(store, payload, req);
  if (auth.user.role !== 'admin') throw sessionError(403, 'Chỉ admin mới được thao tác.');
  return auth;
}

async function handleAuthLogin(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  try {
    const payload = await readJsonBody(req);
    const username = String(payload.username || '').trim();
    const key = loginAttemptKey(req, username);
    if (isLoginBlocked(key)) {
      sendJson(res, 429, { ok: false, error: 'Đăng nhập sai quá nhiều lần, thử lại sau 10 phút.' });
      return;
    }

    const store = await loadAuthStore();
    const user = findUserByUsername(store, username);
    if (!user || user.enabled === false || !verifyPassword(payload.password, user)) {
      recordLoginFailure(key);
      sendJson(res, 401, { ok: false, error: 'Sai tài khoản hoặc mật khẩu.' });
      return;
    }

    clearLoginFailures(key);
    const now = nowIso();
    const oldActive = store.sessions.find((item) => item.id === user.activeSessionId);
    revokeSession(oldActive, 'another_device_login');

    const session = {
      id: createId('sess'),
      userId: user.id,
      deviceId: payloadDeviceId(payload, req),
      deviceName: String(payload.deviceName || req.headers['x-device-name'] || '').trim().slice(0, 80),
      ip: requestIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 220),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
      revokedAt: '',
      revokedReason: '',
    };

    store.sessions.push(session);
    store.sessions = store.sessions.slice(-300);
    user.activeSessionId = session.id;
    user.activeDeviceId = session.deviceId;
    user.activeDeviceName = session.deviceName;
    user.activeIp = session.ip;
    user.activeUserAgent = session.userAgent;
    user.activeAt = now;
    user.loginCount = Number(user.loginCount || 0) + 1;
    await saveAuthStore(store);
    sendJson(res, 200, { ok: true, sessionId: session.id, user: sanitizeUser(user) });
  } catch (error) {
    sendJson(res, error.status || 400, { ok: false, error: error.message, reason: error.reason || '' });
  }
}

async function handleAuthCheck(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  try {
    const payload = await readJsonBody(req);
    const store = await loadAuthStore();
    const auth = await resolveSession(store, payload, req);
    sendJson(res, 200, { ok: true, user: sanitizeUser(auth.user) });
  } catch (error) {
    sendJson(res, error.status || 401, { ok: false, error: error.message, reason: error.reason || '' });
  }
}

async function handleAuthLogout(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (rejectCrossOrigin(req, res)) return;

  try {
    const payload = await readJsonBody(req);
    const store = await loadAuthStore();
    const auth = await resolveSession(store, payload, req);
    revokeSession(auth.session, 'logout');
    if (auth.user.activeSessionId === auth.session.id) auth.user.activeSessionId = '';
    await saveAuthStore(store);
  } catch (error) {
    // Logout should be idempotent from the browser's point of view.
  }
  sendJson(res, 200, { ok: true });
}

async function handleAuthAdmin(req, res, url) {
  try {
    const store = await loadAuthStore();

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    if (rejectCrossOrigin(req, res)) return;

    const payload = await readJsonBody(req);
    const admin = await requireAdmin(store, payload, req);

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
      await saveAuthStore(store);
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
      await saveAuthStore(store);
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
      await saveAuthStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/auth/admin/list-devices') {
      sendJson(res, 200, { ok: true, devices: await listDevices(), currentDeviceId: deviceFingerprint(req) });
      return;
    }

    if (url.pathname === '/api/auth/admin/block-device') {
      const deviceId = String(payload.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'Thiếu deviceId.' });
        return;
      }
      const device = await blockDevice(deviceId);
      sendJson(res, 200, { ok: true, device });
      return;
    }

    if (url.pathname === '/api/auth/admin/unblock-device') {
      const deviceId = String(payload.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'Thiếu deviceId.' });
        return;
      }
      const device = await unblockDevice(deviceId);
      sendJson(res, 200, { ok: true, device });
      return;
    }

    if (url.pathname === '/api/auth/admin/delete-device') {
      const deviceId = String(payload.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'Thiếu deviceId.' });
        return;
      }
      await deleteDevice(deviceId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/auth/admin/set-device-note') {
      const deviceId = String(payload.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { ok: false, error: 'Thiếu deviceId.' });
        return;
      }
      const device = await setDeviceNote(deviceId, payload.note);
      sendJson(res, 200, { ok: true, device });
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
      await saveAuthStore(store);
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
  const deliveryRef = normalizedDeliveryId
    ? requireFirestore().collection(telegramDeliveriesCollectionName).doc(deliveryDocumentId(normalizedDeliveryId))
    : null;
  if (deliveryRef) {
    const snapshot = await deliveryRef.get();
    if (snapshot.exists) {
      return { deduplicated: true, sentAt: snapshot.data().sentAt };
    }
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
    if (deliveryRef) {
      await deliveryRef.set({
        deliveryId: normalizedDeliveryId,
        sentAt: nowIso(),
        textHash: crypto.createHash('sha256').update(normalizedText).digest('hex'),
      });
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
    await resolveSession(await loadAuthStore(), payload, req);
    const delivered = await deliverTelegramText(payload.text, payload.deliveryId);
    sendJson(res, 200, { ok: true, ...delivered });
  } catch (error) {
    sendJson(res, error.status || 502, { ok: false, error: error.message || 'Telegram delivery failed' });
  }
}

function signalDocumentId(signal) {
  return String(signal?.id || '').replace(/\//g, '_').slice(0, 240);
}

function deliveryDocumentId(deliveryId) {
  const normalized = String(deliveryId || '').trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex');
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
    const auth = await resolveSession(await loadAuthStore(), payload, req);
    const db = requireFirestore();

    if (url.pathname === '/api/signals/open') {
      const snapshot = await db.collection(telegramSignalsCollectionName).where('ownerId', '==', auth.user.id).get();
      const signals = snapshot.docs
        .map((document) => document.data())
        .filter((signal) => signal && !signal.closed)
        .sort((left, right) => String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')))
        .slice(-10);
      sendJson(res, 200, { ok: true, signals });
      return;
    }

    const incoming = Array.isArray(payload.signals) ? payload.signals.slice(-10) : [];
    const syncedAt = nowIso();
    const collection = db.collection(telegramSignalsCollectionName);
    const batch = db.batch();
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
  return fetchRealtimePrice(symbol);
}

function marketKeyCandidates(token = '') {
  return [
    String(token || '').trim(),
    ...marketApiKeys,
  ].filter((key, index, all) => key && all.indexOf(key) === index);
}

function apiKeyLabel(key) {
  return crypto.createHash('sha1').update(String(key || '')).digest('hex').slice(0, 8);
}

function apiKeyCooldownUntil(key) {
  const until = apiLimitCooldowns.get(key);
  if (!until) return 0;
  if (Date.now() >= until) {
    apiLimitCooldowns.delete(key);
    return 0;
  }
  return until;
}

function markApiKeyCoolingDown(key, reason = '') {
  const until = Date.now() + apiLimitCooldownMs;
  apiLimitCooldowns.set(key, until);
  console.warn(`TwelveData key ${apiKeyLabel(key)} cooldown ${Math.ceil(apiLimitCooldownMs / 60000)}m${reason ? `: ${reason}` : ''}`);
}

function clearApiKeyCooldown(key) {
  apiLimitCooldowns.delete(key);
}

async function fetchRealtimePrice(symbol, token = '') {
  const normalizedSymbol = String(symbol || 'XAUUSD').trim().toUpperCase();
  const tokenHash = token ? crypto.createHash('sha1').update(String(token)).digest('hex').slice(0, 10) : 'server';
  const cacheKey = `${normalizedSymbol}:${tokenHash}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.at < priceCacheTtlMs) return cached.price;
  const pending = priceFetchPending.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const target = new URL('https://api.twelvedata.com/price');
    target.searchParams.set('symbol', twelveDataSignalSymbol(normalizedSymbol));
    let lastError = 'No Twelve Data key available';
    for (const key of marketKeyCandidates(token)) {
      const coolingUntil = apiKeyCooldownUntil(key);
      if (coolingUntil) {
        lastError = `key cooldown, retry in ${Math.ceil((coolingUntil - Date.now()) / 1000)}s`;
        continue;
      }
      target.searchParams.set('apikey', key);
      try {
        const response = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 CRAZII-realtime-proxy' } });
        const body = await response.json();
        const price = Number(body?.price);
        if (response.ok && Number.isFinite(price)) {
          clearApiKeyCooldown(key);
          priceCache.set(cacheKey, { price, at: Date.now() });
          return price;
        }
        lastError = body?.message || `Twelve Data returned ${response.status}`;
        if (looksLikeApiLimit(response.status, JSON.stringify(body))) {
          markApiKeyCoolingDown(key, lastError);
        }
      } catch (error) {
        lastError = error.message;
      }
    }
    throw new Error(`Twelve Data price unavailable for ${normalizedSymbol}: ${lastError}`);
  })();

  priceFetchPending.set(cacheKey, request);
  try {
    return await request;
  } finally {
    priceFetchPending.delete(cacheKey);
  }
}

function websocketAcceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function websocketFrame(payload) {
  const body = Buffer.from(String(payload));
  const length = body.length;
  if (length < 126) return Buffer.concat([Buffer.from([0x81, length]), body]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, body]);
}

function sendWebSocketJson(socket, payload) {
  if (socket.destroyed) return;
  socket.write(websocketFrame(JSON.stringify(payload)));
}

function websocketCloseFrame() {
  return Buffer.from([0x88, 0x00]);
}

function closeWebSocket(socket) {
  if (socket.destroyed) return;
  try {
    socket.write(websocketCloseFrame());
  } catch (error) {
    // Ignore close races.
  }
  socket.destroy();
}

function priceStreamKey(symbol, token = '') {
  const normalizedSymbol = String(symbol || 'XAUUSD').trim().toUpperCase();
  const tokenHash = token ? crypto.createHash('sha1').update(String(token)).digest('hex').slice(0, 10) : 'server';
  return `${normalizedSymbol}:${tokenHash}`;
}

function stopPriceStreamIfIdle(key) {
  const stream = priceStreams.get(key);
  if (!stream || stream.clients.size) return;
  clearInterval(stream.timer);
  priceStreams.delete(key);
}

function getPriceStream(symbol, token = '') {
  const key = priceStreamKey(symbol, token);
  let stream = priceStreams.get(key);
  if (stream) return stream;

  stream = {
    key,
    symbol: String(symbol || 'XAUUSD').trim().toUpperCase(),
    token: String(token || '').trim(),
    clients: new Set(),
    timer: null,
    busy: false,
  };

  const tick = async () => {
    if (stream.busy) return;
    stream.busy = true;
    try {
      const price = await fetchRealtimePrice(stream.symbol, stream.token);
      const payload = {
        type: 'price',
        source: 'twelvedata-proxy',
        symbol: stream.symbol,
        price,
        timestamp: Date.now(),
      };
      for (const client of stream.clients) sendWebSocketJson(client, payload);
    } catch (error) {
      const payload = {
        type: 'error',
        source: 'twelvedata-proxy',
        symbol: stream.symbol,
        error: error.message,
        timestamp: Date.now(),
      };
      for (const client of stream.clients) sendWebSocketJson(client, payload);
    } finally {
      stream.busy = false;
    }
  };

  stream.timer = setInterval(tick, realtimePricePollMs);
  priceStreams.set(key, stream);
  tick();
  return stream;
}

async function handlePriceWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    if (await enforceDeviceGate(req, { writeHead: () => {}, end: () => {} })) {
      socket.destroy();
      return;
    }

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${websocketAcceptKey(key)}`,
      '',
      '',
    ].join('\r\n'));

    const stream = getPriceStream(url.searchParams.get('symbol') || 'XAUUSD', url.searchParams.get('apikey') || url.searchParams.get('token') || '');
    stream.clients.add(socket);
    sendWebSocketJson(socket, {
      type: 'ready',
      source: 'twelvedata-proxy',
      symbol: stream.symbol,
      intervalMs: realtimePricePollMs,
      timestamp: Date.now(),
    });

    const cleanup = () => {
      stream.clients.delete(socket);
      stopPriceStreamIfIdle(stream.key);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
    socket.on('data', (buffer) => {
      const opcode = buffer[0] & 0x0f;
      if (opcode === 0x8) closeWebSocket(socket);
      if (opcode === 0x9 && !socket.destroyed) socket.write(Buffer.from([0x8a, 0x00]));
    });
  } catch (error) {
    console.warn(`Price websocket refused: ${error.message}`);
    socket.destroy();
  }
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
    const snapshot = await db.collection(telegramSignalsCollectionName).where('closed', '==', false).get();
    const docs = snapshot.docs.map((document) => ({
      signal: document.data(),
      set: (updates) => document.ref.set(updates, { merge: true }),
    }));
    const prices = new Map();
    for (const document of docs) {
      const signal = document.signal;
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
        await document.set(updates);
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
      await document.set(updates);
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

function proxyCacheKey(target, keyParam) {
  const cachedTarget = new URL(target);
  cachedTarget.searchParams.delete(keyParam);
  cachedTarget.searchParams.delete('_');
  cachedTarget.searchParams.delete('t');
  return cachedTarget.toString();
}

function proxyCacheTtlMs(target) {
  if (target.pathname.endsWith('/price')) return priceCacheTtlMs;
  const interval = String(target.searchParams.get('interval') || '').toLowerCase();
  if (interval === '1day' || interval === '1d') return proxyDailyCacheTtlMs;
  return Math.max(realtimePricePollMs, 60_000);
}

async function proxyJsonWithKeyFallback(res, target, keyParam) {
  const keyCandidates = marketKeyCandidates(target.searchParams.get(keyParam));
  if (!keyCandidates.length) {
    proxyJson(res, target);
    return;
  }

  const cachedKey = proxyCacheKey(target, keyParam);
  const cached = proxyResponseCache.get(cachedKey);
  if (cached && Date.now() - cached.at < cached.ttlMs) {
    send(res, cached.status, cached.body, cached.type);
    return;
  }

  let lastStatus = 502;
  let lastBody = '';
  let lastType = 'application/json; charset=utf-8';

  for (const key of keyCandidates) {
    const coolingUntil = apiKeyCooldownUntil(key);
    if (coolingUntil) {
      lastStatus = 429;
      lastBody = JSON.stringify({
        status: 'error',
        message: `TwelveData key cooling down, retry in ${Math.ceil((coolingUntil - Date.now()) / 1000)}s`,
      });
      continue;
    }

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
        clearApiKeyCooldown(key);
        if (upstream.ok) {
          proxyResponseCache.set(cachedKey, {
            status: upstream.status,
            body,
            type: lastType,
            at: Date.now(),
            ttlMs: proxyCacheTtlMs(keyedTarget),
          });
        }
        send(res, upstream.status, body, lastType);
        return;
      }
      markApiKeyCoolingDown(key, body.slice(0, 180));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  try {
    if (await enforceDeviceGate(req, res)) return;
  } catch (error) {
    sendJson(res, error.status || 503, {
      ok: false,
      error: error.message || 'Firebase server is not configured.',
      reason: error.reason || 'firebase_required',
    });
    return;
  }

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

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  if (url.pathname !== '/api/ws/price') {
    socket.destroy();
    return;
  }
  handlePriceWebSocket(req, socket);
});

server.listen(port, host, () => {
  console.log(`CRAZII chart running at http://127.0.0.1:${port} (LAN: http://<server-ip>:${port})`);
  monitorTradeSignals();
  setInterval(monitorTradeSignals, signalMonitorIntervalMs);
});
