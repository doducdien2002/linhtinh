const COLORS = {
  background: '#111722',
  text: '#d1d4dc',
  grid: '#283142',
  border: '#2f3a4c',
  candleUp: '#ffff00',
  candleDown: '#ff2d15',
  lime: '#7fff00',
  yellow: '#ffff00',
  gold: '#daa520',
  magenta: '#ff1493',
  blue: '#148cff',
  cyan: '#00f0ff',
  kcb: '#c8f3ff',
  mlp: '#fff6a6',
  boysBuy: '#009900',
  boysSell: '#ff1515',
  blinkGreen: '#6aff00',
  markerAdd: '#ffd199',
};

const el = {
  chart: document.querySelector('#chart'),
  status: document.querySelector('#status'),
  symbol: document.querySelector('#symbolInput'),
  symbolPreset: document.querySelector('#symbolPresetSelect'),
  source: document.querySelector('#sourceSelect'),
  token: document.querySelector('#tokenInput'),
  opOffset: document.querySelector('#opOffsetInput'),
  resetOpOffset: document.querySelector('#resetOpOffsetButton'),
  interval: document.querySelector('#intervalSelect'),
  limit: document.querySelector('#limitSelect'),
  reload: document.querySelector('#reloadButton'),
  signalFilterButton: document.querySelector('#signalFilterButton'),
  signalFilterMenu: document.querySelector('#signalFilterMenu'),
  showProbabilitySignals: document.querySelector('#showProbabilitySignalsCheckbox'),
  showAddSignals: document.querySelector('#showAddSignalsCheckbox'),
  showDiamondSignals: document.querySelector('#showDiamondSignalsCheckbox'),
  timeframeButtons: [...document.querySelectorAll('.timeframe-button')],
  iconButtons: [...document.querySelectorAll('.icon-button[data-action]')],
  drawToolButtons: [...document.querySelectorAll('.draw-tool-button[data-draw-tool]')],
  clearDrawings: document.querySelector('#clearDrawingsButton'),
  chartFrame: document.querySelector('.chart-frame'),
  ksiTitle: document.querySelector('#ksiTitle'),
  kcxTitle: document.querySelector('#kcxTitle'),
  candleCountdown: document.querySelector('#candleCountdown'),
  bias: document.querySelector('#biasText'),
  ktr: document.querySelector('#ktrText'),
  nearest: document.querySelector('#nearestText'),
  signal: document.querySelector('#signalText'),
  signalNotice: document.querySelector('#signalNotice'),
  signalNoticeTitle: document.querySelector('#signalNoticeTitle'),
  signalNoticeText: document.querySelector('#signalNoticeText'),
  signalRiskText: document.querySelector('#signalRiskText'),
  copySignal: document.querySelector('#copySignalButton'),
  sendTelegram: document.querySelector('#sendTelegramButton'),
  hideSignal: document.querySelector('#hideSignalButton'),
  signalToggle: document.querySelector('#signalToggleButton'),
  advancedControlsButton: document.querySelector('#advancedControlsButton'),
  advancedControlsPanel: document.querySelector('#advancedControlsPanel'),
  levelVisibilityCheckboxes: [...document.querySelectorAll('.level-visibility-checkbox')],
  authScreen: document.querySelector('#authScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginUsername: document.querySelector('#loginUsername'),
  loginPassword: document.querySelector('#loginPassword'),
  loginButton: document.querySelector('#loginButton'),
  loginError: document.querySelector('#loginError'),
  accountName: document.querySelector('#accountName'),
  logout: document.querySelector('#logoutButton'),
  adminButton: document.querySelector('#adminButton'),
  adminPanel: document.querySelector('#adminPanel'),
  closeAdmin: document.querySelector('#closeAdminButton'),
  createUserForm: document.querySelector('#createUserForm'),
  newUsername: document.querySelector('#newUsername'),
  newPassword: document.querySelector('#newPassword'),
  newRole: document.querySelector('#newRole'),
  adminError: document.querySelector('#adminError'),
  adminUserList: document.querySelector('#adminUserList'),
  sessionKickNotice: document.querySelector('#sessionKickNotice'),
  kickLoginAgain: document.querySelector('#kickLoginAgainButton'),
  adminTabUsers: document.querySelector('#adminTabUsers'),
  adminTabDevices: document.querySelector('#adminTabDevices'),
  adminUsersSection: document.querySelector('#adminUsersSection'),
  adminDevicesSection: document.querySelector('#adminDevicesSection'),
  adminDeviceError: document.querySelector('#adminDeviceError'),
  adminDeviceList: document.querySelector('#adminDeviceList'),
};

// --- DEVICE-AWARE FETCH --------------------------------------------------
// Every request to our own /api/* endpoints is tagged with a persistent
// device id (and a human-readable device name) via headers, so the server
// can recognize/block a specific device instead of guessing from IP+UA.
// Patched globally so we don't have to touch every individual fetch() call
// scattered through this file.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const requestUrl = typeof input === 'string' ? input : input?.url || '';
  if (!requestUrl.startsWith('/api/')) return nativeFetch(input, init);

  const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
  headers.set('x-device-id', getDeviceId());
  headers.set('x-device-name', getDeviceName());
  if (authState?.sessionId) headers.set('x-session-id', authState.sessionId);
  return nativeFetch(input, { ...init, headers });
};
// --------------------------------------------------------------------------

const MARKET_SOURCE_DEFAULT_VERSION = 'tradingview-oanda-default-v1';
if (window.localStorage.getItem('marketSourceDefaultVersion') !== MARKET_SOURCE_DEFAULT_VERSION) {
  window.localStorage.setItem('marketSource', 'tradingview');
  window.localStorage.setItem('marketSourceDefaultVersion', MARKET_SOURCE_DEFAULT_VERSION);
}
const savedSource = window.localStorage.getItem('marketSource');
if (savedSource === 'twelvedata' || savedSource === 'tradingview') {
  el.source.value = savedSource;
} else {
  window.localStorage.setItem('marketSource', 'twelvedata');
}
el.token.value = window.localStorage.getItem(sourceTokenKey(el.source.value)) || '';
const savedOpOffset = window.localStorage.getItem('opOffset');
if (savedOpOffset === '2.55') {
  window.localStorage.setItem('opOffset', '0');
}
el.opOffset.value = savedOpOffset && savedOpOffset !== '2.55' ? savedOpOffset : '0';

let chart;
let candleSeries;
let ksiSeries;
let bullishSeries;
let blinkSeries;
let markerApi;
let markerLayer;
let levelLayer;
let drawLayer;
let chartResizeObserver;
let chartResizeFrame = null;

function applyChartSize() {
  if (!chart) return;
  const width = el.chart.clientWidth;
  const height = el.chart.clientHeight;
  if (width > 0 && height > 0) {
    chart.applyOptions({ width, height });
  }
}

function ensureChartResizeObserver() {
  if (chartResizeObserver || typeof ResizeObserver === 'undefined') return;
  chartResizeObserver = new ResizeObserver(() => {
    if (chartResizeFrame) cancelAnimationFrame(chartResizeFrame);
    chartResizeFrame = requestAnimationFrame(applyChartSize);
  });
  chartResizeObserver.observe(el.chart);
}
let latestMarkers = [];
const persistentSignalMarkers = new Map();
let persistentMarkerContext = '';
let latestLevelItems = [];
let latestDiamondLine = null;
let priceLines = [];
let livePriceLine = null;
let refreshTimer;
let liveSocket;
let socketHeartbeatTimer;
let tickPollTimer;
let fullRenderTimer;
let liveRenderFrame = 0;
let queuedLiveCandle = null;
let queuedLivePrice = null;
let lastFullRenderAt = 0;
let lastLiveComputedCandleTime = null;
let tickPollSource;
let tickPollSymbol;
let tickPollInterval;
let tickPollLimit;
let tickPollToken;
let activeYahooSymbol = '';
let currentCandles = [];
let currentDailyCandles = [];
let latestBlinkData = [];
let blinkOn = true;
let blinkTimer;
let currentBarSpacing = 5;
let latestSignalId = '';
let latestAutoTelegramSignalId = '';
let autoTelegramSignalInFlightId = '';
const telegramSignalActivationPromises = new Map();
let latestSignalCopy = '';
let latestSignalTelegram = null;
let telegramSignalStates = [];
let telegramPriceCheckRunning = false;
let telegramQueuedPrice = null;
let telegramRetryTimer = null;
let signalDetectionReady = false;
let telegramSignalRestorePromise = null;
let signalNoticeCollapsed = false;
let signalNoticeDragState = null;
let twelveDataStreamPollMs = 60_000;
let twelveDataReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 6;
const SIGNAL_NOTICE_POSITION_KEY = 'signalNoticePosition';
function savedHiddenDefaultOn(key) {
  const saved = window.localStorage.getItem(key);
  return saved === null ? true : saved === '1';
}

let hideAddSignals = savedHiddenDefaultOn('hideAddSignals');
let hideProbabilitySignals = savedHiddenDefaultOn('hideProbabilitySignals');
let hideDiamondSignals = savedHiddenDefaultOn('hideDiamondSignals');
let hiddenPriceLevels = new Set();
let suppressNextSignalSend = false;
let drawingMode = '';
let pendingDrawPoint = null;
let previewDrawPoint = null;
let drawings = [];
let authHeartbeatTimer = null;
let authState = {
  sessionId: window.localStorage.getItem('craziiSessionId') || '',
  deviceId: window.localStorage.getItem('craziiDeviceId') || '',
  user: null,
};
let firebaseSignalSyncTimer = null;
let firebaseSignalSyncErrorShown = false;

async function syncTelegramSignalStatesToFirebase(signals = telegramSignalStates) {
  if (!authState.sessionId || !Array.isArray(signals) || !signals.length) return;

  try {
    await authPost('/api/signals/sync', {
      sessionId: authState.sessionId,
      signals,
    });
    firebaseSignalSyncErrorShown = false;
  } catch (error) {
    console.warn('Firebase server sync failed:', error);
    if (!firebaseSignalSyncErrorShown) {
      el.status.textContent = 'Server chưa ghi được kèo; vẫn lưu cục bộ.';
      firebaseSignalSyncErrorShown = true;
    }
  }
}

function scheduleFirebaseSignalSync(signals = telegramSignalStates) {
  window.clearTimeout(firebaseSignalSyncTimer);
  const snapshot = Array.isArray(signals) ? signals.map((signal) => ({ ...signal })) : [];
  firebaseSignalSyncTimer = window.setTimeout(() => {
    syncTelegramSignalStatesToFirebase(snapshot);
  }, 250);
}

async function restoreTelegramSignalStatesFromFirebase() {
  if (!authState.sessionId) return;

  if (telegramSignalRestorePromise) {
    await telegramSignalRestorePromise;
    return;
  }

  telegramSignalRestorePromise = (async () => {
  try {
    const data = await authPost('/api/signals/open', { sessionId: authState.sessionId });
    const restored = (Array.isArray(data.signals) ? data.signals : [])
      .filter((signal) => signal && !signal.closed && signal.id && Number.isFinite(Number(signal.entry)))
      .slice(-TELEGRAM_SIGNAL_MAX_OPEN);
    if (!restored.length) return;

    const merged = new Map(telegramSignalStates.map((signal) => [signal.id, signal]));
    for (const signal of restored) merged.set(signal.id, signal);
    telegramSignalStates = [...merged.values()].slice(-TELEGRAM_SIGNAL_MAX_OPEN);
    saveTelegramSignalStates();
  } catch (error) {
    console.warn('Firebase signal restore failed:', error);
  } finally {
    telegramSignalRestorePromise = null;
  }
  })();

  await telegramSignalRestorePromise;
}

const ADD_SIGNAL_TP_MIN_MOVE = 10;
const ADD_SIGNAL_TP_MAX_MOVE = 10;
const TELEGRAM_AUTO_INTERVAL = '5m';
const TELEGRAM_SIGNAL_STORAGE_KEY = 'craziiTelegramOpenSignals';
const TELEGRAM_SIGNAL_MAX_OPEN = 10;
const TELEGRAM_TP_ORDER = ['TP1', 'TP2', 'TP3'];
const TRADE_ENTRY_RANGE_MOVE = 4;
const TRADE_SL_BUFFER_MOVE = 7;
const TRADE_SL_MOVE = TRADE_ENTRY_RANGE_MOVE + TRADE_SL_BUFFER_MOVE;
const TRADE_TP_MIN_MOVE = 5;
const TRADE_TP_MAX_MOVE = 15;
const PRICE_LEVEL_STORAGE_KEY = 'craziiHiddenPriceLevels';
const PRICE_LEVEL_KEYS = [
  'price',
  'op',
  'ktrPlus3',
  'ktrPlus2',
  'ktrPlus1',
  'ktrMinus1',
  'ktrMinus2',
  'ktrMinus3',
  'ma30',
  'ma200',
  'pivot1',
  'pivot2',
  'mlp',
  'kcb01',
  'kcb02',
  'kcb03',
  'diamondLine',
];

const CRAZII_LEVEL_RATIOS = {
  pivot1: -0.47,
  ma30Fallback: -0.6208,
  mlp: 0.3622,
  kcb01: -4.25,
  kcb02: -5.11855357,
  pivot2: 1.2286,
  kcb03: -7.13861742,
};

const intervalMs = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

const yahooIntervalRange = {
  '1m': '8d',
  '5m': '60d',
  '15m': '60d',
  '30m': '60d',
  '1h': '730d',
  '4h': '730d',
  '1d': '10y',
};

const twelveDataInterval = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
};

const fallbackPollMs = {
  yahoo: {
    default: 700,
  },
  binance: {
    default: 300,
  },
  twelvedata: {
    default: 1_000,
  },
};
const dailyRefreshMinMs = 15 * 60_000;

const BEARISHNESS_SCALE = {
  min: -420,
  max: 20,
  extreme: -300,
};

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  if (number >= 1000) return number.toFixed(2);
  if (number >= 10) return number.toFixed(3);
  return number.toFixed(5);
}

function lerp(previous, current, weight) {
  return previous * (1 - weight) + current * weight;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function candleSide(candle) {
  return candle.close >= candle.open ? 'buy' : 'sell';
}

function fixedAutoscale(minValue, maxValue, margins = { above: 6, below: 4 }) {
  return () => ({
    priceRange: { minValue, maxValue },
    margins,
  });
}

function toPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function providerError(provider, message) {
  const error = new Error(message);
  error.provider = provider;
  return error;
}

function sourceTokenKey(source) {
  if (source === 'twelvedata') return 'twelveDataToken';
  return `${source}Token`;
}

function getDeviceId() {
  if (authState.deviceId) return authState.deviceId;
  authState.deviceId = window.crypto?.randomUUID?.() || `device_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem('craziiDeviceId', authState.deviceId);
  return authState.deviceId;
}

function getDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Web';
  return `${platform} ${screen.width}x${screen.height}`;
}

async function authPost(path, payload = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `Lỗi đăng nhập ${response.status}`);
    error.status = response.status;
    error.reason = data.reason || '';
    error.data = data;
    throw error;
  }
  return data;
}

async function authGet(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `Lỗi tải dữ liệu ${response.status}`);
    error.status = response.status;
    error.reason = data.reason || '';
    error.data = data;
    throw error;
  }
  return data;
}

function syncAuthUi() {
  const loggedIn = Boolean(authState.user && authState.sessionId);
  document.body.classList.toggle('auth-locked', !loggedIn);
  el.authScreen?.classList.toggle('hidden', loggedIn);
  el.accountName.textContent = authState.user
    ? `${authState.user.displayName || authState.user.username}`
    : 'Chưa đăng nhập';
  el.adminButton?.classList.toggle('hidden', authState.user?.role !== 'admin');
}

function stopAuthHeartbeat() {
  window.clearInterval(authHeartbeatTimer);
  authHeartbeatTimer = null;
}

function stopMarketRuntime() {
  closeLiveSocket();
  window.clearInterval(refreshTimer);
  window.clearTimeout(tickPollTimer);
  window.clearTimeout(fullRenderTimer);
  tickPollTimer = null;
}

function clearAuthSession() {
  authState.sessionId = '';
  authState.user = null;
  window.localStorage.removeItem('craziiSessionId');
  stopAuthHeartbeat();
  stopMarketRuntime();
}

function showLogin(message = '') {
  clearAuthSession();
  el.sessionKickNotice?.classList.add('hidden');
  el.authScreen?.classList.remove('hidden');
  el.loginError.textContent = message;
  syncAuthUi();
  window.setTimeout(() => el.loginUsername?.focus(), 0);
}

function showKickNotice(message = 'Tài khoản này vừa đăng nhập trên thiết bị khác.') {
  clearAuthSession();
  el.authScreen?.classList.add('hidden');
  el.sessionKickNotice?.classList.remove('hidden');
  const paragraph = el.sessionKickNotice?.querySelector('p');
  if (paragraph) paragraph.textContent = message;
  syncAuthUi();
}

function handleAuthError(error) {
  if (error.status === 409 || error.reason === 'another_device_login') {
    showKickNotice(error.message);
    return;
  }
  showLogin(error.message || 'Phiên đăng nhập không hợp lệ.');
}

function startAuthHeartbeat() {
  stopAuthHeartbeat();
  authHeartbeatTimer = window.setInterval(async () => {
    if (!authState.sessionId) return;
    try {
      const data = await authPost('/api/auth/check', {
        sessionId: authState.sessionId,
        deviceId: getDeviceId(),
      });
      authState.user = data.user;
      syncAuthUi();
    } catch (error) {
      handleAuthError(error);
    }
  }, 5000);
}

async function restoreAuthSession() {
  if (!authState.sessionId) {
    syncAuthUi();
    return false;
  }

  try {
    const data = await authPost('/api/auth/check', {
      sessionId: authState.sessionId,
      deviceId: getDeviceId(),
    });
    authState.user = data.user;
    syncAuthUi();
    startAuthHeartbeat();
    return true;
  } catch (error) {
    handleAuthError(error);
    return false;
  }
}

async function login(username, password) {
  const data = await authPost('/api/auth/login', {
    username,
    password,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
  });
  authState.sessionId = data.sessionId;
  authState.user = data.user;
  window.localStorage.setItem('craziiSessionId', authState.sessionId);
  el.loginPassword.value = '';
  el.loginError.textContent = '';
  el.authScreen?.classList.add('hidden');
  el.sessionKickNotice?.classList.add('hidden');
  syncAuthUi();
  startAuthHeartbeat();
  loadChart().then(restoreTelegramSignalStatesFromFirebase);
}

function formatAuthTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('vi-VN');
}

async function loadAdminPanel() {
  if (!authState.sessionId) return;
  el.adminError.textContent = '';
  try {
    const data = await authPost('/api/auth/admin/list', { sessionId: authState.sessionId });
    renderAdminUsers(data.users || []);
  } catch (error) {
    el.adminError.textContent = error.message;
  }
}

function renderAdminUsers(users) {
  if (!el.adminUserList) return;
  el.adminUserList.innerHTML = users.map((user) => {
    const online = Boolean(user.activeSessionId);
    const enabledLabel = user.enabled ? 'Đang mở' : 'Đang khóa';
    const roleLabel = user.role === 'admin' ? 'Admin' : 'User';
    const actionLabel = user.enabled ? 'Khóa' : 'Mở';
    return `
      <div class="admin-user-row">
        <div class="admin-user-status ${online ? 'online' : ''}">
          <strong>${escapeHtml(user.username)}</strong>
          <span>${roleLabel} - ${enabledLabel}</span>
        </div>
        <div>
          <span>${online ? escapeHtml(user.activeDeviceName || 'Đang online') : 'Chưa đăng nhập'}</span>
          <small>${escapeHtml(user.activeIp || '--')}</small>
        </div>
        <div>
          <span>Lần cuối</span>
          <small>${formatAuthTime(user.activeAt)}</small>
        </div>
        <div class="admin-user-actions">
          <button type="button" data-admin-action="password" data-user-id="${user.id}">Mật khẩu</button>
          <button type="button" data-admin-action="kick" data-user-id="${user.id}" class="danger" ${online ? '' : 'disabled'}>Kick</button>
          <button type="button" data-admin-action="toggle" data-user-id="${user.id}" data-enabled="${user.enabled ? '0' : '1'}">${actionLabel}</button>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

async function adminPost(path, payload = {}, reloadFn = loadAdminPanel, errorEl = el.adminError) {
  errorEl.textContent = '';
  try {
    await authPost(path, { ...payload, sessionId: authState.sessionId });
    await reloadFn();
  } catch (error) {
    if (error.status === 409 || error.status === 401) {
      handleAuthError(error);
      return;
    }
    errorEl.textContent = error.message;
  }
}

// --- DEVICE MANAGEMENT (admin panel) --------------------------------------
function setAdminTab(tab) {
  const showUsers = tab === 'users';
  el.adminTabUsers?.classList.toggle('admin-tab-active', showUsers);
  el.adminTabDevices?.classList.toggle('admin-tab-active', !showUsers);
  el.adminUsersSection?.classList.toggle('hidden', !showUsers);
  el.adminDevicesSection?.classList.toggle('hidden', showUsers);
  if (showUsers) {
    loadAdminPanel();
  } else {
    loadAdminDevices();
  }
}

async function loadAdminDevices() {
  if (!authState.sessionId || !el.adminDeviceList) return;
  el.adminDeviceError.textContent = '';
  try {
    const data = await authPost('/api/auth/admin/list-devices', { sessionId: authState.sessionId });
    renderAdminDevices(data.devices || [], data.currentDeviceId || '');
  } catch (error) {
    el.adminDeviceError.textContent = error.message;
  }
}

function renderAdminDevices(devices, currentDeviceId) {
  if (!el.adminDeviceList) return;
  if (!devices.length) {
    el.adminDeviceList.innerHTML = '<div class="admin-device-row">Chưa có thiết bị nào truy cập.</div>';
    return;
  }

  el.adminDeviceList.innerHTML = devices.map((device) => {
    const isCurrent = device.id === currentDeviceId;
    const name = device.deviceName || 'Thiết bị chưa đặt tên';
    return `
      <div class="admin-device-row ${device.blocked ? 'blocked' : ''}">
        <div class="admin-device-info">
          <strong>${escapeHtml(name)}${isCurrent ? ' (thiết bị này)' : ''}</strong>
          <div class="admin-device-note">
            <input type="text" value="${escapeHtml(device.note || '')}" maxlength="240" placeholder="Ghi chú: máy nhà, VPS, điện thoại..." data-device-note />
            <button type="button" data-device-action="note" data-device-id="${escapeHtml(device.id)}">Lưu</button>
          </div>
          <small>${escapeHtml(device.lastIp || '--')} · ${escapeHtml(device.lastUserAgent || '--')}</small>
          <small>Lần cuối: ${formatAuthTime(device.lastSeenAt)} · ${Number(device.requestCount || 0)} request</small>
        </div>
        <div class="admin-device-actions">
          ${device.blocked
            ? `<button type="button" data-device-action="unblock" data-device-id="${escapeHtml(device.id)}">Bỏ chặn</button>`
            : `<button type="button" data-device-action="block" data-device-id="${escapeHtml(device.id)}" class="danger">Chặn</button>`}
          <button type="button" data-device-action="delete" data-device-id="${escapeHtml(device.id)}" class="danger">Xóa</button>
        </div>
      </div>
    `;
  }).join('');
}

el.adminTabUsers?.addEventListener('click', () => setAdminTab('users'));
el.adminTabDevices?.addEventListener('click', () => setAdminTab('devices'));

el.adminDeviceList?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-device-action]');
  if (!button) return;
  const deviceId = button.dataset.deviceId;
  const action = button.dataset.deviceAction;

  if (action === 'block') {
    await adminPost('/api/auth/admin/block-device', { deviceId }, loadAdminDevices, el.adminDeviceError);
    return;
  }
  if (action === 'unblock') {
    await adminPost('/api/auth/admin/unblock-device', { deviceId }, loadAdminDevices, el.adminDeviceError);
    return;
  }
  if (action === 'delete') {
    if (!window.confirm('Xóa thiết bị này khỏi danh sách?')) return;
    await adminPost('/api/auth/admin/delete-device', { deviceId }, loadAdminDevices, el.adminDeviceError);
    return;
  }
  if (action === 'note') {
    const row = button.closest('.admin-device-row');
    const note = row?.querySelector('[data-device-note]')?.value || '';
    await adminPost('/api/auth/admin/set-device-note', { deviceId, note }, loadAdminDevices, el.adminDeviceError);
  }
});
// --------------------------------------------------------------------------

async function bootApp() {
  document.body.classList.add('auth-locked');
  getDeviceId();
  const restored = await restoreAuthSession();
  if (restored) {
    loadChart().then(restoreTelegramSignalStatesFromFirebase);
    return;
  }

  showLogin();
}

function isTwelveDataLimitError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.provider === 'twelvedata'
    || message.includes('twelvedata')
    || message.includes('api credits')
    || message.includes('credit')
    || message.includes('limit')
    || message.includes('quota')
    || message.includes('429');
}

function parseYahooBar(time, quote, index) {
  const open = toPositiveNumber(quote.open?.[index]);
  const high = toPositiveNumber(quote.high?.[index]);
  const low = toPositiveNumber(quote.low?.[index]);
  const close = toPositiveNumber(quote.close?.[index]);

  if (open === null || high === null || low === null || close === null) {
    return null;
  }

  return {
    time,
    open,
    high,
    low,
    close,
    volume: Math.max(Number(quote.volume?.[index]) || 1, 1),
  };
}

function localDayKey(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function isLocalMarketWeekday(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function previousChartDayOpen(candles, currentDay) {
  let previousDay = '';
  let previousOpen = null;

  for (const candle of candles) {
    if (!Number.isFinite(Number(candle?.open))) continue;
    if (!isLocalMarketWeekday(candle.time)) continue;
    const candleDay = localDayKey(candle.time);
    if (candleDay >= currentDay || candleDay === previousDay) continue;
    previousDay = candleDay;
    previousOpen = candle.open;
  }

  return previousOpen;
}

async function fetchBinanceKlines(symbol, interval, limit) {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  const response = await fetch(`/api/binance/klines?${params}`);
  if (!response.ok) {
    throw new Error(`Binance tráº£ lá»—i ${response.status}. HÃ£y kiá»ƒm tra symbol hoáº·c máº¡ng.`);
  }
  const rows = await response.json();
  return rows.map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

async function fetchDaily(symbol) {
  const params = new URLSearchParams({ symbol, interval: '1d', limit: '260' });
  const response = await fetch(`/api/binance/klines?${params}`);
  if (!response.ok) throw new Error(`KhÃ´ng táº£i Ä‘Æ°á»£c daily data ${response.status}.`);
  const rows = await response.json();
  return rows.map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

async function fetchTickerPrice(symbol) {
  const params = new URLSearchParams({ symbol });
  const response = await fetch(`/api/binance/ticker?${params}`);
  if (!response.ok) throw new Error(`KhÃ´ng táº£i Ä‘Æ°á»£c ticker ${response.status}.`);
  const row = await response.json();
  return Number(row.price);
}

function toYahooSymbol(symbol) {
  return getYahooSymbols(symbol)[0];
}

function getYahooSymbols(symbol) {
  const normalized = symbol.trim().toUpperCase().replace('/', '');
  if (normalized === 'XAUUSD') return ['XAUUSD=X'];
  if (normalized === 'GOLD' || normalized === 'GC') return ['GC=F'];
  if (normalized === 'XAGUSD' || normalized === 'SILVER') return ['XAGUSD=X'];
  return [symbol.trim().toUpperCase()];
}

async function fetchYahooResult(yahooSymbol, params, label) {
  const response = await fetch(`/api/yahoo/chart?symbol=${encodeURIComponent(yahooSymbol)}&${params}`);
  if (!response.ok) throw new Error(`Yahoo ${label} ${yahooSymbol} returned ${response.status}.`);

  const json = await response.json();
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) throw new Error(`Yahoo ${label} ${yahooSymbol} has no data.`);
  return { result, quote };
}

function toTwelveDataSymbol(symbol) {
  const normalized = symbol.trim().toUpperCase().replace('/', '').replace('_', '');
  if (normalized === 'XAUUSD' || normalized === 'GOLD') return 'XAU/USD';
  if (normalized === 'XAGUSD' || normalized === 'SILVER') return 'XAG/USD';
  if (normalized.endsWith('USDT')) return `${normalized.slice(0, -4)}/USD`;
  return symbol.trim().toUpperCase();
}

async function fetchYahooChart(symbol, interval, limit) {
  const params = new URLSearchParams({
    range: yahooIntervalRange[interval] || '5d',
    interval,
    includePrePost: 'true',
    t: String(Date.now()),
  });
  const errors = [];

  for (const yahooSymbol of getYahooSymbols(symbol)) {
    try {
      const { result, quote } = await fetchYahooResult(yahooSymbol, params, 'chart');
      const candles = result.timestamp
        .map((time, index) => parseYahooBar(time, quote, index))
        .filter(Boolean)
        .slice(-limit);
      if (candles.length) return candles;
      errors.push(`${yahooSymbol}: empty candles`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Yahoo khong tra du lieu chart (${errors.join('; ')})`);
}

async function fetchYahooDaily(symbol) {
  const params = new URLSearchParams({ range: '2y', interval: '1d' });
  const errors = [];

  for (const yahooSymbol of getYahooSymbols(symbol)) {
    try {
      const { result, quote } = await fetchYahooResult(yahooSymbol, params, 'daily');
      const candles = result.timestamp
        .map((time, index) => parseYahooBar(time, quote, index))
        .filter(Boolean);
      if (candles.length) return candles;
      errors.push(`${yahooSymbol}: empty candles`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Yahoo khong tra du lieu daily (${errors.join('; ')})`);
}

async function fetchYahooMetaPrice(symbol) {
  const params = new URLSearchParams({
    range: '1d',
    interval: '1m',
    includePrePost: 'true',
    t: String(Date.now()),
  });
  const errors = [];

  for (const yahooSymbol of getYahooSymbols(symbol)) {
    try {
      const { result, quote } = await fetchYahooResult(yahooSymbol, params, 'price');
      const metaPrice = toPositiveNumber(result?.meta?.regularMarketPrice);
      if (metaPrice !== null) return metaPrice;

      const timestamps = result?.timestamp || [];
      for (let index = timestamps.length - 1; index >= 0; index -= 1) {
        const close = toPositiveNumber(quote?.close?.[index]);
        if (close !== null) return close;
      }
      errors.push(`${yahooSymbol}: no valid price`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Yahoo has no valid XAU price (${errors.join('; ')})`);
}

async function fetchYahooLastPrice(symbol) {
  const candles = await fetchYahooChart(symbol, '1m', 1);
  const last = candles.at(-1);
  if (!last) throw new Error('Yahoo chÆ°a cÃ³ tick XAU.');
  return last.close;
}

function parseTwelveDataValues(data) {
  if (data.status === 'error') {
    throw providerError('twelvedata', data.message || 'TwelveData error.');
  }
  if (!Array.isArray(data.values)) {
    throw providerError('twelvedata', 'TwelveData khong tra du lieu nen.');
  }

  return data.values
    .map((row) => ({
      time: Math.floor(new Date(`${String(row.datetime).replace(' ', 'T')}Z`).getTime() / 1000),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Math.max(Number(row.volume) || 1, 1),
    }))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close))
    .sort((a, b) => a.time - b.time);
}

async function fetchTwelveDataCandles(symbol, interval, limit, token) {
  const params = new URLSearchParams({
    symbol: toTwelveDataSymbol(symbol),
    interval: twelveDataInterval[interval] || '5min',
    outputsize: String(limit),
    timezone: 'UTC',
    order: 'ASC',
  });
  if (token) params.set('apikey', token);
  const response = await fetch(`/api/twelvedata/time_series?${params}`);
  if (!response.ok) throw providerError('twelvedata', `TwelveData candle returned ${response.status}.`);
  return parseTwelveDataValues(await response.json()).slice(-limit);
}

async function fetchTwelveDataDaily(symbol, token) {
  const params = new URLSearchParams({
    symbol: toTwelveDataSymbol(symbol),
    interval: '1day',
    outputsize: '260',
    timezone: 'UTC',
    order: 'ASC',
  });
  if (token) params.set('apikey', token);
  const response = await fetch(`/api/twelvedata/time_series?${params}`);
  if (!response.ok) throw providerError('twelvedata', `TwelveData daily returned ${response.status}.`);
  return parseTwelveDataValues(await response.json());
}

async function fetchTradingViewCandles(symbol, interval, limit) {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  const response = await fetch(`/api/tradingview/history?${params}`);
  if (!response.ok) throw new Error(`TradingView history returned ${response.status}.`);
  const data = await response.json();
  if (data.s !== 'ok' || !Array.isArray(data.candles)) {
    throw new Error(data.error || 'TradingView history unavailable.');
  }
  return data.candles;
}

async function fetchMarketCandles(source, symbol, interval, limit, token) {
  if (source === 'binance') return fetchBinanceKlines(symbol, interval, limit);
  if (source === 'tradingview') return fetchTradingViewCandles(symbol, interval, limit);
  if (source === 'twelvedata') return fetchTwelveDataCandles(symbol, interval, limit, token);
  return fetchYahooChart(symbol, interval, limit);
}

async function fetchMarketDaily(source, symbol, token) {
  if (source === 'binance') return fetchDaily(symbol);
  if (source === 'tradingview') return fetchTradingViewCandles(symbol, '1d', 260);
  if (source === 'twelvedata') return fetchTwelveDataDaily(symbol, token);
  return fetchYahooDaily(symbol);
}

async function fetchTwelveDataPrice(symbol, token) {
  const params = new URLSearchParams({
    symbol: toTwelveDataSymbol(symbol),
    _: String(Date.now()),   // ← chống cache
  });
  if (token) params.set('apikey', token);
  const response = await fetch(`/api/twelvedata/price?${params}`, { cache: 'no-store' });
  if (!response.ok) throw providerError('twelvedata', `TwelveData price returned ${response.status}.`);

  const data = await response.json();
  if (data.status === 'error') throw providerError('twelvedata', data.message || 'TwelveData price error.');
  const price = toPositiveNumber(data.price);
  if (price !== null) return price;
  throw providerError('twelvedata', 'TwelveData price has no valid price.');
}

async function fetchMarketPrice(source, symbol, token = '') {
  if (source === 'binance') return fetchTickerPrice(symbol);
  if (source === 'twelvedata') return fetchTwelveDataPrice(symbol, token);
  return fetchYahooMetaPrice(symbol);
}

function makePriceLine(series, price, color, title, lineStyle = LightweightCharts.LineStyle.Solid, lineWidth = 1, axisLabelVisible = true) {
  if (!Number.isFinite(Number(price))) return null;
  const line = series.createPriceLine({
    price: Number(price),
    color,
    lineWidth,
    lineStyle,
    axisLabelVisible,
    // Names are already shown by the left-side badges. Keep only the
    // color-coded numeric price on the right price scale.
    title: '',
  });
  priceLines.push(line);
  return line;
}

function clearPriceLines() {
  if (!candleSeries) return;
  for (const line of priceLines) {
    candleSeries.removePriceLine(line);
  }
  priceLines = [];
  livePriceLine = null;
}

function renderLevels(levels, diamondLine = null) {
  clearPriceLines();
  const dashed = LightweightCharts.LineStyle.LargeDashed;
  const dotted = LightweightCharts.LineStyle.Dotted;
  const levelItems = [
    { key: 'ktrPlus3', title: 'KTR+3', price: levels.ktrPlus3, color: COLORS.gold, style: dashed, group: 'ktr gold' },
    { key: 'ktrPlus2', title: 'KTR+2', price: levels.ktrPlus2, color: COLORS.yellow, style: dashed, group: 'ktr yellow' },
    { key: 'ktrPlus1', title: 'KTR+1', price: levels.ktrPlus1, color: COLORS.lime, style: dashed, group: 'ktr lime' },
    { key: 'op', title: 'OP', price: levels.op, color: '#ffffff', style: dotted, group: 'plain' },
    { key: 'pivot1', title: 'Pivot 01', price: levels.pivot1, color: COLORS.magenta, style: LightweightCharts.LineStyle.Solid, group: 'pivot' },
    { key: 'price', title: 'Price Line', price: levels.price, color: '#d9d9d9', style: dotted, group: 'price' },
    { key: 'diamondLine', title: 'DL', price: diamondLine?.price, color: '#ffffff', style: LightweightCharts.LineStyle.Solid, lineWidth: 2, group: 'diamond-line' },
    { key: 'ktrMinus1', title: 'KTR-1', price: levels.ktrMinus1, color: COLORS.lime, style: dashed, group: 'ktr lime' },
    { key: 'ma30', title: '30MA', price: levels.ma30, color: COLORS.lime, style: LightweightCharts.LineStyle.Solid, group: 'ma lime' },
    { key: 'ktrMinus2', title: 'KTR-2', price: levels.ktrMinus2, color: COLORS.yellow, style: dashed, group: 'ktr yellow' },
    { key: 'mlp', title: 'MLP', price: levels.mlp, color: COLORS.mlp, style: dotted, group: 'mlp' },
    { key: 'kcb01', title: 'KCB 01', price: levels.kcb01, color: COLORS.kcb, style: dashed, group: 'kcb' },
    { key: 'ktrMinus3', title: 'KTR-3', price: levels.ktrMinus3, color: COLORS.gold, style: dashed, group: 'ktr gold' },
    { key: 'kcb02', title: 'KCB 02', price: levels.kcb02, color: COLORS.kcb, style: LightweightCharts.LineStyle.Solid, group: 'kcb' },
    { key: 'pivot2', title: 'Pivot 02', price: levels.pivot2, color: COLORS.magenta, style: LightweightCharts.LineStyle.Solid, group: 'pivot' },
    { key: 'kcb03', title: 'KCB 03', price: levels.kcb03, color: COLORS.kcb, style: LightweightCharts.LineStyle.Solid, group: 'kcb' },
    { key: 'ma200', title: '200MA', price: levels.ma200, color: '#f6a800', style: LightweightCharts.LineStyle.Solid, group: 'ma orange' },
  ];

  const visibleLevelItems = levelItems.filter(isPriceLevelVisible);

  for (const item of visibleLevelItems) {
    const line = makePriceLine(
      candleSeries,
      item.price,
      item.color,
      item.title,
      item.style,
      item.lineWidth || 1,
      true,
    );
    if (item.key === 'price') livePriceLine = line;
  }
  renderLevelBadges(visibleLevelItems);
}

function renderLevelBadges(levelItems) {
  if (!levelLayer || !candleSeries) return;
  latestLevelItems = levelItems;
  levelLayer.replaceChildren();

  for (const item of levelItems) {
    if (!Number.isFinite(Number(item.price))) continue;
    const y = candleSeries.priceToCoordinate(Number(item.price));
    if (y === null) continue;

    const badge = document.createElement('div');
    badge.className = `level-badge ${item.group}`;
    badge.textContent = item.title;
    badge.style.top = `${y}px`;
    levelLayer.appendChild(badge);
  }
}

function colorCandle(candle, phase = null) {
  const side = phase?.side || candleSide(candle);
  const color = side === 'buy' ? COLORS.candleUp : COLORS.candleDown;
  return {
    ...candle,
    color,
    borderColor: color,
    wickColor: color,
  };
}

function updatePaneTitles(indicators) {
  if (el.ksiTitle) {
    el.ksiTitle.textContent = 'BOYS SELLING';
  }
  if (el.kcxTitle) {
    el.kcxTitle.textContent = 'BEARISHNESS';
  }
}

let indicatorComputeRequestId = 0;

async function fetchServerIndicators(candles, dailyCandles) {
  const response = await fetch('/api/indicators/compute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candles,
      dailyCandles,
      interval: el.interval.value,
      opOffset: Number(el.opOffset?.value || 0),
      hideProbabilitySignals,
      hideAddSignals,
      hideDiamondSignals,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false || !data.levels || !data.indicators) {
    throw new Error(data.error || `Indicator server returned ${response.status}`);
  }
  return data;
}

async function renderComputed(candles, dailyCandles, shouldFit = false) {
  const requestId = ++indicatorComputeRequestId;
  let computed;
  try {
    computed = await fetchServerIndicators(candles, dailyCandles);
  } catch (error) {
    console.error('Server indicator computation failed:', error);
    if (requestId === indicatorComputeRequestId) {
      el.status.textContent = 'Không thể tải bộ tính tín hiệu từ máy chủ.';
    }
    return;
  }
  if (requestId !== indicatorComputeRequestId) return;

  lastLiveComputedCandleTime = candles.at(-1)?.time ?? null;
  const { levels, indicators } = computed;
  latestDiamondLine = indicators.diamondLine;
  lastFullRenderAt = performance.now();

  candleSeries.setData(candles.map((candle, index) => colorCandle(candle, indicators.trendPhases[index])));
  ksiSeries.setData(indicators.ksi);
  bullishSeries.setData(indicators.bullishness);
  latestBlinkData = indicators.bullishness
    .filter((item) => item.value < BEARISHNESS_SCALE.extreme)
    .map((item) => ({ ...item, color: COLORS.blinkGreen }));
  blinkSeries.setData(latestBlinkData);
  renderLevels(levels, indicators.diamondLine);

  if (shouldFit) {
    chart.timeScale().fitContent();
  }

  setMarkers(indicators.markers);
  updatePaneTitles(indicators);
  updateAnalysis(levels, indicators);
  renderSignalNotice(candles, indicators.markers, levels);

  window.requestAnimationFrame(() => {
    renderLevelBadges(latestLevelItems);
    renderDiamondMarkers();
    renderDrawings();
  });
}

function setMarkers(markers) {
  for (const marker of markers || []) {
    if (!Number.isFinite(Number(marker?.time))) continue;
    // A signal belongs to its candle and direction. Labels/strategy text may
    // be refined on a later server recomputation, but the visible marker must
    // remain anchored to the original candle.
    const markerKey = [marker.time, marker.kind || 'marker'].join('|');
    if (!persistentSignalMarkers.has(markerKey)) {
      persistentSignalMarkers.set(markerKey, marker);
    }
  }

  const visibleTimes = new Set(currentCandles.map((candle) => candle.time));
  latestMarkers = [...persistentSignalMarkers.values()]
    .filter((marker) => visibleTimes.has(marker.time))
    .sort((a, b) => a.time - b.time);
  renderDiamondMarkers(latestMarkers);
  markerApi?.setMarkers?.([]);
  markerApi = null;
  candleSeries?.setMarkers?.([]);
}

function renderDiamondMarkers(markers = latestMarkers) {
  if (!markerLayer || !chart || !candleSeries) return;
  markerLayer.replaceChildren();

  const placedLabels = [];
  const laneStep = 24;
  const labelHeight = 26;

  const collides = (candidate) => placedLabels.some((placed) => (
    Math.abs(candidate.x - placed.x) < (candidate.width + placed.width) / 2 + 6
    && Math.abs(candidate.top - placed.top) < labelHeight
  ));

  const chooseTop = (x, top, width, direction) => {
    const offsets = [0, laneStep, laneStep * 2, laneStep * 3, -laneStep, -laneStep * 2];
    for (const offset of offsets) {
      const candidate = { x, top: top + offset * direction, width };
      if (!collides(candidate)) return candidate.top;
    }
    return top + laneStep * 4 * direction;
  };

  for (const marker of markers) {
    const x = chart.timeScale().timeToCoordinate(marker.time);
    const y = candleSeries.priceToCoordinate(marker.price);
    if (x === null || y === null) continue;

    const isBuyArrow = marker.kind === 'buy-arrow';
    const isSellArrow = marker.kind === 'sell-arrow';
    const label = marker.label || (isBuyArrow ? 'BUY' : isSellArrow ? 'SELL' : '');
    const width = Math.max(32, String(label).length * 7 + 12);
    const direction = isBuyArrow ? 1 : isSellArrow ? -1 : 1;
    const desiredTop = y + (isBuyArrow ? 36 : isSellArrow ? -36 : marker.position === 'belowBar' ? 14 : -14);
    const top = chooseTop(x, desiredTop, width, direction);
    placedLabels.push({ x, top, width });
    const node = document.createElement('div');
    node.className = isBuyArrow
      ? 'buy-arrow-marker'
      : isSellArrow
        ? 'sell-arrow-marker'
        : `diamond-marker ${marker.kind === 'add' ? 'diamond-add' : 'diamond-buy'}`;
    node.style.left = `${x}px`;
    node.style.top = `${top}px`;
    if (isBuyArrow || isSellArrow) node.textContent = label;
    if (!isBuyArrow && !isSellArrow) {
      node.style.background = marker.color;
      if (marker.stackCount > 1) {
        node.classList.add('diamond-accumulation');
      }
    }
    markerLayer.appendChild(node);
  }
}

function syncDrawingToolButtons() {
  for (const button of el.drawToolButtons) {
    const tool = button.dataset.drawTool;
    button.classList.toggle('active', tool === drawingMode || (tool === 'cursor' && !drawingMode));
  }
  el.chartFrame?.classList.toggle('drawing-active', Boolean(drawingMode));
}

function setDrawingMode(mode) {
  if (mode === 'cursor') {
    drawingMode = '';
    pendingDrawPoint = null;
    previewDrawPoint = null;
    syncDrawingToolButtons();
    renderDrawings();
    return;
  }

  drawingMode = drawingMode === mode ? '' : mode;
  pendingDrawPoint = null;
  previewDrawPoint = null;
  syncDrawingToolButtons();
  renderDrawings();
}

function clearDrawings() {
  drawings = [];
  pendingDrawPoint = null;
  previewDrawPoint = null;
  renderDrawings();
}

function chartPointFromEvent(event) {
  if (!chart || !candleSeries) return null;
  const rect = el.chart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const time = chart.timeScale().coordinateToTime(x);
  const price = candleSeries.coordinateToPrice(y);
  if (time === null || !Number.isFinite(price)) return null;
  return { time, price };
}

function handleDrawPointerDown(event) {
  if (!drawingMode) return;
  const point = chartPointFromEvent(event);
  if (!point) return;
  event.preventDefault();
  event.stopPropagation();

  if (drawingMode === 'hline') {
    drawings.push({ type: 'hline', price: point.price });
    pendingDrawPoint = null;
    previewDrawPoint = null;
    renderDrawings();
    return;
  }

  if (!pendingDrawPoint) {
    pendingDrawPoint = point;
    previewDrawPoint = point;
    renderDrawings();
    return;
  }

  drawings.push({ type: 'trendline', start: pendingDrawPoint, end: point });
  pendingDrawPoint = null;
  previewDrawPoint = null;
  renderDrawings();
}

function handleDrawPointerMove(event) {
  if (!drawingMode || !pendingDrawPoint) return;
  previewDrawPoint = chartPointFromEvent(event);
  renderDrawings();
}

function createSvgNode(name, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function appendDrawingLine(start, end, dashed = false) {
  if (!drawLayer || !chart || !candleSeries) return;
  const x1 = chart.timeScale().timeToCoordinate(start.time);
  const x2 = chart.timeScale().timeToCoordinate(end.time);
  const y1 = candleSeries.priceToCoordinate(start.price);
  const y2 = candleSeries.priceToCoordinate(end.price);
  if (x1 === null || x2 === null || y1 === null || y2 === null) return;

  drawLayer.appendChild(createSvgNode('line', {
    x1,
    y1,
    x2,
    y2,
    stroke: COLORS.yellow,
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-dasharray': dashed ? '6 5' : '',
  }));
}

function appendHorizontalDrawing(price) {
  if (!drawLayer || !candleSeries) return;
  const y = candleSeries.priceToCoordinate(price);
  if (y === null) return;
  drawLayer.appendChild(createSvgNode('line', {
    x1: 0,
    y1: y,
    x2: el.chart.clientWidth,
    y2: y,
    stroke: COLORS.yellow,
    'stroke-width': 2,
    'stroke-dasharray': '7 5',
  }));
}

function renderDrawings() {
  if (!drawLayer) return;
  drawLayer.setAttribute('viewBox', `0 0 ${el.chart.clientWidth} ${el.chart.clientHeight}`);
  drawLayer.replaceChildren();

  for (const drawing of drawings) {
    if (drawing.type === 'hline') appendHorizontalDrawing(drawing.price);
    if (drawing.type === 'trendline') appendDrawingLine(drawing.start, drawing.end);
  }

  if (pendingDrawPoint && previewDrawPoint) {
    appendDrawingLine(pendingDrawPoint, previewDrawPoint, true);
  }
}

function initChart() {
  if (chart) chart.remove();
  markerLayer?.remove();
  levelLayer?.remove();
  drawLayer?.remove();
  levelLayer = document.createElement('div');
  levelLayer.className = 'level-layer';
  markerLayer = document.createElement('div');
  markerLayer.className = 'marker-layer';
  drawLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  drawLayer.classList.add('draw-layer');
  el.chart.appendChild(levelLayer);
  el.chart.appendChild(markerLayer);

  const isCompactView = window.matchMedia('(max-width: 620px)').matches;
  chart = LightweightCharts.createChart(el.chart, {
    width: el.chart.clientWidth,
    height: el.chart.clientHeight,
    localization: { priceFormatter: formatPrice },
    layout: {
      textColor: COLORS.text,
      background: { type: 'solid', color: COLORS.background },
      fontFamily: 'Inter, Arial, sans-serif',
      panes: {
        separatorColor: COLORS.border,
        separatorHoverColor: COLORS.grid,
        enableResize: true,
      },
    },
    grid: {
      vertLines: { color: COLORS.grid, style: LightweightCharts.LineStyle.Solid },
      horzLines: { color: COLORS.grid, style: LightweightCharts.LineStyle.Solid },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#758696', width: 1, style: LightweightCharts.LineStyle.Dashed },
      horzLine: { color: '#758696', width: 1, style: LightweightCharts.LineStyle.Dashed },
    },
    timeScale: {
      borderColor: COLORS.border,
      timeVisible: true,
      secondsVisible: false,
      minBarSpacing: 0.5,
      barSpacing: currentBarSpacing,
      rightOffset: isCompactView ? 8 : 18,
      fixLeftEdge: false,
      lockVisibleTimeRangeOnResize: true,
      tickMarkFormatter: (time) => {
        const d = new Date(time * 1000);
        const day = String(d.getUTCDate()).padStart(2, '0');
        const hour = String(d.getUTCHours()).padStart(2, '0');
        const minute = String(d.getUTCMinutes()).padStart(2, '0');
        return `${day} ${hour}:${minute}`;
      },
    },
    rightPriceScale: {
      borderColor: '#555555',
      visible: true,
      entireTextOnly: true,
      ticksVisible: true,
      minimumWidth: isCompactView ? 74 : 62,
      scaleMargins: { top: isCompactView ? 0.06 : 0.1, bottom: isCompactView ? 0.08 : 0.1 },
    },
  });
  el.chart.appendChild(levelLayer);
  el.chart.appendChild(markerLayer);
  el.chart.appendChild(drawLayer);
  drawLayer.addEventListener('pointerdown', handleDrawPointerDown);
  drawLayer.addEventListener('pointermove', handleDrawPointerMove);

  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    priceLineVisible: false,
    lastValueVisible: true,
    upColor: COLORS.candleUp,
    downColor: COLORS.candleDown,
    borderUpColor: COLORS.candleUp,
    borderDownColor: COLORS.candleDown,
    wickUpColor: COLORS.candleUp,
    wickDownColor: COLORS.candleDown,
  }, 0);

  ksiSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    autoscaleInfoProvider: fixedAutoscale(0, 4.4),
    base: 0,
    priceScaleId: 'right',
    priceLineVisible: false,
    lastValueVisible: false,
  }, 1);

  bullishSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    autoscaleInfoProvider: fixedAutoscale(BEARISHNESS_SCALE.min, BEARISHNESS_SCALE.max, { above: 8, below: 4 }),
    base: 0,
    priceScaleId: 'right',
    priceLineVisible: false,
    lastValueVisible: false,
  }, 2);

  blinkSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    autoscaleInfoProvider: fixedAutoscale(BEARISHNESS_SCALE.min, BEARISHNESS_SCALE.max, { above: 8, below: 4 }),
    base: BEARISHNESS_SCALE.extreme,
    priceScaleId: 'right',
    priceLineVisible: false,
    lastValueVisible: false,
  }, 2);

  window.clearInterval(blinkTimer);
  blinkTimer = null;
  blinkOn = true;

  const panes = typeof chart.panes === 'function' ? chart.panes() : chart.panes;
  if (Array.isArray(panes) && panes.length >= 3) {
    panes[0].setStretchFactor(isCompactView ? 6 : 4);
    panes[1].setStretchFactor(isCompactView ? 0.55 : 0.8);
    panes[2].setStretchFactor(isCompactView ? 0.55 : 0.8);
  }

  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    renderDiamondMarkers();
    renderDrawings();
  });

  ensureChartResizeObserver();
  requestAnimationFrame(applyChartSize);
  window.setTimeout(applyChartSize, 300);
}

function nearestLevel(levels) {
  const candidates = [
    ['KTR+1', levels.ktrPlus1],
    ['KTR+2', levels.ktrPlus2],
    ['KTR-1', levels.ktrMinus1],
    ['KTR-2', levels.ktrMinus2],
    ['Pivot 01', levels.pivot1],
    ['30MA', levels.ma30],
    ['OP', levels.op],
  ];
  return candidates
    .map(([name, price]) => ({ name, price, distance: Math.abs(levels.price - price) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function updateAnalysis(levels, indicators) {
  const lastBull = indicators.bullishness.at(-1)?.value || 0;
  const bias = levels.price >= levels.op ? 'BUY above OP' : 'SELL below OP';
  const near = nearestLevel(levels);
  const signal = indicators.diamondLine
    ? `DL ${formatPrice(indicators.diamondLine.price)} ${levels.price >= indicators.diamondLine.price ? 'BUY side' : 'SELL side'}`
    : levels.price >= levels.op && lastBull > -120
      ? 'Buy side, wait pullback'
      : levels.price < levels.op && lastBull < -180
        ? 'Sell side, avoid chasing'
        : 'Neutral / wait KTR reaction';

  el.bias.textContent = bias;
  el.ktr.textContent = formatPrice(levels.ktrStep);
  el.nearest.textContent = `${near.name} ${formatPrice(near.price)}`;
  el.signal.textContent = signal;
}

function formatSignalTime(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hour}:${minute}`;
}

function formatTelegramTime(timestampSeconds = Math.floor(Date.now() / 1000)) {
  const date = new Date(timestampSeconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

function formatIntervalLabel(interval) {
  const value = String(interval || '').toLowerCase();
  if (value === '1d') return 'D1';
  if (value.endsWith('m')) return value.toUpperCase();
  if (value.endsWith('h')) return value.toUpperCase();
  return value.toUpperCase() || '--';
}

function formatPriceMove(value) {
  const number = Math.abs(Number(value));
  if (!Number.isFinite(number)) return '--';
  return `${number.toFixed(2)} giá`;
}

function formatTradePrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatEntryRange(signal) {
  if (signal.entryText) return String(signal.entryText);
  const entryLow = Number(signal.entryLow);
  const entryHigh = Number(signal.entryHigh);
  if (Number.isFinite(entryLow) && Number.isFinite(entryHigh)) {
    return signal.isBuy
      ? `${formatTradePrice(Math.max(entryLow, entryHigh))} - ${formatTradePrice(Math.min(entryLow, entryHigh))}`
      : `${formatTradePrice(Math.min(entryLow, entryHigh))} - ${formatTradePrice(Math.max(entryLow, entryHigh))}`;
  }
  return formatTradePrice(signal.entry);
}

function tradeLevelsFromEntry(entry, isBuy) {
  const base = Number(entry);
  if (!Number.isFinite(base)) return null;

  const entryLow = isBuy ? base - TRADE_ENTRY_RANGE_MOVE : base;
  const entryHigh = isBuy ? base : base + TRADE_ENTRY_RANGE_MOVE;
  const targetBase = isBuy ? entryHigh : entryLow;
  return {
    entryLow,
    entryHigh,
    entryText: isBuy
      ? `${formatTradePrice(entryHigh)} - ${formatTradePrice(entryLow)}`
      : `${formatTradePrice(entryLow)} - ${formatTradePrice(entryHigh)}`,
    sl: isBuy ? entryLow - TRADE_SL_BUFFER_MOVE : entryHigh + TRADE_SL_BUFFER_MOVE,
    tp1: isBuy ? targetBase + TRADE_TP_MIN_MOVE : targetBase - TRADE_TP_MIN_MOVE,
    tp2: isBuy ? targetBase + 10 : targetBase - 10,
    tp3: isBuy ? targetBase + TRADE_TP_MAX_MOVE : targetBase - TRADE_TP_MAX_MOVE,
  };
}

async function reserveTelegramSignalNumberFromFirebase() {
  if (!authState.sessionId) throw new Error('Cần đăng nhập để lấy STT kèo từ Firebase.');

  const data = await authPost('/api/signals/next-number', { sessionId: authState.sessionId });
  const number = Number(data.number);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('Firebase không trả về STT kèo hợp lệ.');
  }

  return {
    number: Math.floor(number),
    signalDate: String(data.dateKey || ''),
    signalNumberTimeZone: String(data.timeZone || ''),
  };
}

function telegramProfitLine(signal, price, isWin) {
  const move = signal.isBuy ? price - signal.entry : signal.entry - price;
  const gia = Math.abs(move);
  const pips = gia * 10;
  return `${isWin ? '💰 Lợi nhuận' : '💸 Thua lỗ'} ${isWin ? '+' : '-'}${pips.toFixed(1)} PIP (${gia.toFixed(2)} Giá)`;
}

function loadTelegramSignalStates() {
  try {
    const raw = window.localStorage.getItem(TELEGRAM_SIGNAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((signal) => signal && !signal.closed && Number.isFinite(Number(signal.entry)))
      .slice(-TELEGRAM_SIGNAL_MAX_OPEN);
  } catch (error) {
    return [];
  }
}

function saveTelegramSignalStates() {
  try {
    const openSignals = telegramSignalStates
      .filter((signal) => signal && !signal.closed)
      .slice(-TELEGRAM_SIGNAL_MAX_OPEN);
    window.localStorage.setItem(TELEGRAM_SIGNAL_STORAGE_KEY, JSON.stringify(openSignals));
  } catch (error) {
    console.warn(error);
  }
  scheduleFirebaseSignalSync(telegramSignalStates);
}

function formatTradeSignalMessage(signal) {
  const direction = signal.isBuy ? 'BUY' : 'SELL';
  const tradeLabel = signal.number ? `[KÈO ${signal.number}] ` : '';
  return [
    `⚡️ ${tradeLabel}${direction}`,
    ``,
    `Entry : ${formatEntryRange(signal)}`,
    ``,
    `SL : ${formatTradePrice(signal.sl)} ⚔️`,
    ``,
    `TP 1 : ${formatTradePrice(signal.tp1)} 🍀🍀`,
    ``,
    `TP 2 : ${formatTradePrice(signal.tp2)} 🍀🍀`,
    ``,
    `TP 3 : ${formatTradePrice(signal.tp3)} 🍀🍀`,
  ].join('\n');
}
function formatTelegramOpenMessage(signal) {
  return formatTradeSignalMessage(signal);
}

function formatTelegramConfluenceMessage(signal) {
  return [
    `⭐ [ Kèo ${signal.number} ] Hợp lưu OP/KTR`,
    `${signal.isBuy ? '✅ BUY đẹp' : '✅ SELL đẹp'}`,
    `Lý do: ${signal.confluence.reason}`,
    `Entry: ${formatEntryRange(signal)}`,
    `SL: ${formatTradePrice(signal.sl)} ⚔️`,
    `TP: ${formatTradePrice(signal.tp1)}`,
  ].join('\n');
}

function formatTelegramCloseMessage(signal, result, price) {
  const resultText = String(result || '').toUpperCase();
  const isWin = resultText.startsWith('TP');
  const isBreakEven = resultText === 'BE';
  const targetKey = resultText.toLowerCase();
  const targetPrice = isWin ? Number(signal[targetKey]) : isBreakEven ? Number(signal.entry) : Number(signal.sl);
  const targetProfit = isWin ? telegramProfitLine(signal, targetPrice, true) : '';
  const followUp = resultText === 'TP1'
    ? [
      targetProfit,
      `🔒 Cân nhắc chốt một phần hoặc kéo cắt lỗ về vùng entry: ${formatEntryRange(signal)}`,
    ].join('\n')
    : resultText === 'TP2'
      ? [
        targetProfit,
        `📍 Cân nhắc chốt thêm một phần, phần còn lại quan sát TP3: ${formatTradePrice(signal.tp3)}`,
      ].join('\n')
      : resultText === 'TP3'
        ? [targetProfit, '🏁 Hoàn tất đủ 3 mục tiêu chốt lãi.'].join('\n')
        : isBreakEven
          ? '🟡 Giá quay về điểm vào sau TP1, kèo đã hòa vốn.'
          : '';
  const statusIcon = isWin ? '✅' : isBreakEven ? '🟡' : '❌';
  const statusText = isWin ? `ĐÃ ${resultText}` : isBreakEven ? 'ĐÃ HÒA VỐN' : 'ĐÃ SL';
  return [
    `${statusIcon} KÈO ${signal.number} ${signal.side} ${statusText}`,
    `Mã: ${signal.symbol || el.symbol.value.trim().toUpperCase()} | Khung: ${formatIntervalLabel(signal.interval)}`,
    `Entry: ${formatEntryRange(signal)}`,
    `Thời gian mở: ${formatTelegramTime(signal.time)}`,
    `Thời gian đóng: ${formatTelegramTime()}`,
    `${isWin ? resultText : isBreakEven ? 'Hòa vốn' : 'SL'}: ${formatTradePrice(targetPrice)}`,
    `Giá hiện tại: ${formatTradePrice(price)}`,
    isWin || isBreakEven ? '' : telegramProfitLine(signal, price, isWin),
    followUp,
  ].filter(Boolean).join('\n');
}
async function sendTelegramMessage(text, deliveryId = '') {
  if (!authState.sessionId) {
    el.status.textContent = 'Telegram loi: can dang nhap';
    return false;
  }

  try {
    const response = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, deliveryId, sessionId: authState.sessionId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.description || data.error || `Telegram returned ${response.status}`);
    }
    el.status.textContent = data.deduplicated
      ? 'Telegram: thông báo này đã được gửi trước đó.'
      : `Đã gửi Telegram ${new Date().toLocaleTimeString()}`;
    return data.deduplicated ? 'deduplicated' : true;
  } catch (error) {
    console.warn(error);
    el.status.textContent = `Telegram lỗi: ${error.message}`;
    return false;
  }
}

async function doActivateTelegramSignal(signal, levels) {
  if (signal?.confirmed === false) {
    el.status.textContent = 'Chờ nến đóng để xác nhận mũi tên rồi mới bắn Telegram.';
    return false;
  }

  telegramSignalStates = loadTelegramSignalStates();
  await restoreTelegramSignalStatesFromFirebase();
  const existingSignal = telegramSignalStates.find((item) => item.id === signal.id && !item.closed);
  if (existingSignal) {
    await checkTelegramSignalPrice(levels.price);
    return true;
  }
  await checkTelegramSignalPrice(levels.price);

  const openSignals = telegramSignalStates.filter((item) => item && !item.closed);
  if (openSignals.length >= TELEGRAM_SIGNAL_MAX_OPEN) {
    el.status.textContent = `Đang có ${TELEGRAM_SIGNAL_MAX_OPEN} kèo ${formatIntervalLabel(TELEGRAM_AUTO_INTERVAL)} mở, tạm dừng bắn kèo mới.`;
    saveTelegramSignalStates();
    return false;
  }

  let reservedNumber;
  try {
    reservedNumber = await reserveTelegramSignalNumberFromFirebase();
  } catch (error) {
    console.warn(error);
    el.status.textContent = `Không lấy được STT kèo từ Firebase: ${error.message}`;
    return false;
  }

  const nextSignalState = {
    ...signal,
    number: reservedNumber.number,
    signalDate: reservedNumber.signalDate,
    signalNumberTimeZone: reservedNumber.signalNumberTimeZone,
    symbol: el.symbol.value.trim().toUpperCase(),
    interval: levels.interval,
    originalSl: signal.sl,
    tpHits: [],
    breakEvenMoved: false,
    closed: false,
  };
  const sent = await sendTelegramMessage(
    formatTelegramOpenMessage(nextSignalState),
    `open:${nextSignalState.id}`,
  );
  if (sent === 'deduplicated') return true;
  if (!sent) return false;
  telegramSignalStates = [
    ...openSignals,
    nextSignalState,
  ];
  saveTelegramSignalStates();
  await syncTelegramSignalStatesToFirebase(telegramSignalStates);
  checkTelegramSignalPrice(levels.price);
  return true;
}

async function activateTelegramSignal(signal, levels) {
  const signalId = String(signal?.id || '');
  if (!signalId) return false;

  const existingPromise = telegramSignalActivationPromises.get(signalId);
  if (existingPromise) return existingPromise;

  const promise = doActivateTelegramSignal(signal, levels)
    .finally(() => {
      telegramSignalActivationPromises.delete(signalId);
    });
  telegramSignalActivationPromises.set(signalId, promise);
  return promise;
}

function normalizeTelegramTpHits(tpHits) {
  const hitNames = new Set(
    (Array.isArray(tpHits) ? tpHits : [])
      .map((item) => String(item || '').toUpperCase())
      .filter((item) => TELEGRAM_TP_ORDER.includes(item)),
  );
  const orderedHits = [];
  for (const name of TELEGRAM_TP_ORDER) {
    if (!hitNames.has(name)) break;
    orderedHits.push(name);
  }
  return orderedHits;
}

function nextPendingTelegramTarget(signal) {
  signal.tpHits = normalizeTelegramTpHits(signal.tpHits);
  const nextName = TELEGRAM_TP_ORDER[signal.tpHits.length];
  if (!nextName) return null;

  const key = nextName.toLowerCase();
  const price = Number(signal[key]);
  return Number.isFinite(price) ? { key, name: nextName, price } : null;
}

function scheduleTelegramPriceRetry(price) {
  window.clearTimeout(telegramRetryTimer);
  telegramRetryTimer = window.setTimeout(() => {
    checkTelegramSignalPrice(price);
  }, 5000);
}

async function notifyTelegramTradeResult(signal, result, price) {
  const sent = await sendTelegramMessage(
    formatTelegramCloseMessage(signal, result, price),
    `result:${signal.id}:${String(result || '').toUpperCase()}`,
  );
  if (!sent) scheduleTelegramPriceRetry(price);
  return sent;
}

async function checkTelegramSignalPrice(price) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice)) return;

  telegramQueuedPrice = numericPrice;
  if (telegramPriceCheckRunning) return;

  telegramPriceCheckRunning = true;
  try {
    while (Number.isFinite(telegramQueuedPrice)) {
      const currentPrice = telegramQueuedPrice;
      telegramQueuedPrice = null;

      if (!telegramSignalStates.length) {
        telegramSignalStates = loadTelegramSignalStates();
      }

      let changed = false;
      for (const signal of telegramSignalStates) {
        if (!signal || signal.closed) continue;
        signal.tpHits = normalizeTelegramTpHits(signal.tpHits);

        const hitSl = signal.isBuy ? currentPrice <= Number(signal.sl) : currentPrice >= Number(signal.sl);
        if (hitSl) {
          const isBreakEven = signal.breakEvenMoved && Math.abs(Number(signal.sl) - Number(signal.entry)) < 0.000001;
          signal.closed = true;
          signal.closedAt = Date.now();
          signal.closeResult = isBreakEven ? 'BE' : 'SL';
          changed = true;
          continue;
        }

        const target = nextPendingTelegramTarget(signal);
        if (target) {
          const hitTp = signal.isBuy ? currentPrice >= target.price : currentPrice <= target.price;
          if (!hitTp) continue;
          const sent = await notifyTelegramTradeResult(signal, target.name, currentPrice);
          if (!sent) continue;

          signal.tpHits.push(target.name);
          if (target.name === 'TP1') {
            signal.originalSl = Number.isFinite(Number(signal.originalSl)) ? signal.originalSl : signal.sl;
            signal.sl = signal.entry;
            signal.breakEvenMoved = true;
          }
          if (target.name === 'TP3') {
            signal.closed = true;
            signal.closedAt = Date.now();
            signal.closeResult = 'TP3';
          }
          changed = true;
        }
      }
      if (changed) saveTelegramSignalStates();
    }
  } finally {
    telegramPriceCheckRunning = false;
  }
}

function signalRiskLabel(reward, risk) {
  if (!Number.isFinite(risk) || risk <= 0) return 'RR dang cho tinh lai';
  return `RR ${Math.max(reward / risk, 0).toFixed(2)}`;
}

function entryZoneText(entry) {
  return formatPrice(entry);
}

function targetMoveText() {
  return `${ADD_SIGNAL_TP_MIN_MOVE} giá`;
}

function syncSignalFilterMenu() {
  const visibleCount = [!hideProbabilitySignals, !hideAddSignals, !hideDiamondSignals].filter(Boolean).length;
  if (el.signalFilterButton) {
    el.signalFilterButton.textContent = `Tín hiệu: ${visibleCount}/3`;
  }
  if (el.showProbabilitySignals) el.showProbabilitySignals.checked = !hideProbabilitySignals;
  if (el.showAddSignals) el.showAddSignals.checked = !hideAddSignals;
  if (el.showDiamondSignals) el.showDiamondSignals.checked = !hideDiamondSignals;
}

function loadHiddenPriceLevels() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PRICE_LEVEL_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter((key) => PRICE_LEVEL_KEYS.includes(key)) : []);
  } catch (error) {
    return new Set();
  }
}

function isPriceLevelVisible(item) {
  return !hiddenPriceLevels.has(item.key);
}

function syncLevelVisibilityControls() {
  for (const checkbox of el.levelVisibilityCheckboxes) {
    checkbox.checked = !hiddenPriceLevels.has(checkbox.dataset.levelKey);
  }
}

function applyLevelVisibilityChange() {
  hiddenPriceLevels = new Set(
    el.levelVisibilityCheckboxes
      .filter((checkbox) => !checkbox.checked)
      .map((checkbox) => checkbox.dataset.levelKey)
      .filter((key) => PRICE_LEVEL_KEYS.includes(key)),
  );
  window.localStorage.setItem(PRICE_LEVEL_STORAGE_KEY, JSON.stringify([...hiddenPriceLevels]));
  syncLevelVisibilityControls();

  if (currentCandles.length && currentDailyCandles.length) {
    renderComputed(currentCandles, currentDailyCandles, false);
  }
}

function setAdvancedControlsOpen(open) {
  el.advancedControlsPanel?.classList.toggle('hidden', !open);
  el.advancedControlsButton?.classList.toggle('active', open);
  el.advancedControlsButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function confluenceDistanceLimit(levels) {
  const stepBased = Math.abs(Number(levels.ktrStep || 0)) * 0.35;
  return clamp(stepBased || 2.5, 1.5, 3);
}

function nearestNamedLevel(entry, candidates) {
  return candidates
    .filter((item) => Number.isFinite(Number(item.price)))
    .map((item) => ({ ...item, distance: Math.abs(entry - Number(item.price)) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

function signalConfluence(signal, levels) {
  const entry = Number(signal.entry);
  const maxDistance = confluenceDistanceLimit(levels);
  const directionOk = signal.isBuy ? levels.price >= levels.op : levels.price <= levels.op;
  const candidates = signal.isBuy
    ? [
        { name: 'KTR-1', price: levels.ktrMinus1 },
        { name: 'KTR-2', price: levels.ktrMinus2 },
        { name: '30MA', price: levels.ma30 },
        { name: 'MLP', price: levels.mlp },
      ]
    : [
        { name: 'KTR+1', price: levels.ktrPlus1 },
        { name: 'KTR+2', price: levels.ktrPlus2 },
        { name: 'Pivot 01', price: levels.pivot1 },
        { name: 'Pivot 02', price: levels.pivot2 },
      ];
  const nearest = nearestNamedLevel(entry, candidates);
  const nearLevelOk = Boolean(nearest && nearest.distance <= maxDistance);
  const directionText = signal.isBuy ? 'Trên OP' : 'Dưới OP';
  const levelText = nearest
    ? `gần ${nearest.name} ${formatPrice(nearest.price)} (${nearest.distance.toFixed(2)} giá)`
    : 'chưa gần vùng hợp lưu';

  return {
    ok: directionOk && nearLevelOk,
    directionOk,
    nearLevelOk,
    nearest,
    maxDistance,
    reason: `${directionText} + ${levelText}`,
    rejectReason: !directionOk
      ? `${signal.side} chưa đúng phía OP`
      : `cách vùng hợp lưu quá xa, cần <= ${maxDistance.toFixed(2)} giá`,
  };
}

function buildTradeSignal(candles, markers, levels) {
  const tradeMarker = markers
    .filter((marker) => marker.kind === 'buy-arrow' || marker.kind === 'sell-arrow')
    .at(-1);
  if (!tradeMarker) return null;

  const candle = candles[tradeMarker.index];
  if (!candle) return null;

  const isBuy = tradeMarker.kind === 'buy-arrow';
  const side = isBuy ? 'BUY' : 'SELL';
  const label = tradeMarker.label || side;
  const strategy = tradeMarker.strategy || 'ksi';
  const strategyLabel = tradeMarker.strategyLabel || 'KSI';
  const markerEntry = Number(tradeMarker.entry);
  const entry = Number.isFinite(markerEntry) ? markerEntry : candle.close;
  const tradeLevels = tradeLevelsFromEntry(entry, isBuy);
  if (!tradeLevels) return null;
  const { entryLow, entryHigh, entryText, sl, tp1, tp2, tp3 } = tradeLevels;
  const risk = Math.abs(entry - sl);
  const near = nearestLevel(levels);
  const diamondLineNote = Number.isFinite(Number(tradeMarker.diamondLinePrice))
    ? `→ DL Kim Cương mới nhất: ${formatPrice(tradeMarker.diamondLinePrice)}${tradeMarker.diamondStackCount >= 3 ? ` | Tích lũy ${tradeMarker.diamondStackCount} kim cương` : ''}`
    : '';
  const entryZone = entryText;
  const invalidationNote = isBuy
    ? 'Sai kịch bản nếu giá phá xuống dưới vùng SL.'
    : 'Sai kịch bản nếu giá phá lên trên vùng SL.';

  const signal = {
    id: `${tradeMarker.kind}:${strategy}:${tradeMarker.time}`,
    index: tradeMarker.index,
    time: tradeMarker.time,
    side,
    label,
    strategy,
    strategyLabel,
    isBuy,
    confirmed: tradeMarker.index < candles.length - 1,
    entry,
    entryLow,
    entryHigh,
    entryText,
    sl,
    tp1,
    tp2,
    tp3,
    risk,
    entryZone,
    diamondLinePrice: tradeMarker.diamondLinePrice,
    diamondStackCount: tradeMarker.diamondStackCount,
    invalidationNote,
  };
  signal.copy = formatTradeSignalMessage(signal);
  return signal;
}

function isSignalOnClosedCandle(signal, candles) {
  if (signal?.confirmed === false) return false;
  const index = Number(signal?.index);
  return Number.isInteger(index) && index >= 0 && index < candles.length - 1;
}

function syncSignalToggle(hasSignal) {
  if (!el.signalNotice || !el.signalToggle) return;
  const signal = hasSignal ? latestSignalTelegram?.signal : null;
  const isBuy = Boolean(signal?.isBuy);
  const isSell = Boolean(signal && !signal.isBuy);

  el.signalToggle.classList.remove(
    'hidden',
    'signal-state-empty',
    'signal-state-buy',
    'signal-state-sell',
    'signal-panel-open',
  );
  el.signalToggle.classList.add(isBuy ? 'signal-state-buy' : isSell ? 'signal-state-sell' : 'signal-state-empty');
  el.signalToggle.textContent = 'TIN HIEU';
  el.signalToggle.title = isBuy ? 'Keo BUY dang chay' : isSell ? 'Keo SELL dang chay' : 'Chua co keo';

  if (!hasSignal) {
    signalNoticeCollapsed = true;
    el.signalNotice.classList.add('signal-collapsed');
    if (el.sendTelegram) el.sendTelegram.disabled = true;
    return;
  }

  el.signalNotice.classList.toggle('signal-collapsed', signalNoticeCollapsed);
  el.signalToggle.classList.toggle('signal-panel-open', !signalNoticeCollapsed);
  if (el.sendTelegram) el.sendTelegram.disabled = false;
}

function renderSignalNotice(candles, markers, levels) {
  if (!el.signalNotice || !el.signalNoticeText || !el.signalNoticeTitle || !el.signalRiskText) return;
  const suppressAutoSend = suppressNextSignalSend;
  suppressNextSignalSend = false;
  const signal = buildTradeSignal(candles, markers, levels);
  if (!signal) {
    latestSignalCopy = '';
    latestSignalTelegram = null;
    latestSignalId = '';
    latestAutoTelegramSignalId = '';
    autoTelegramSignalInFlightId = '';
    signalDetectionReady = true;
    syncSignalToggle(false);
    return;
  }

  const isNewSignal = signalDetectionReady && latestSignalId !== signal.id;
  const isAutoTelegramInterval = levels.interval === TELEGRAM_AUTO_INTERVAL;
  const canAutoSendSignal = isAutoTelegramInterval && isSignalOnClosedCandle(signal, candles);
  const shouldAutoSendSignal = signalDetectionReady
    && !suppressAutoSend
    && canAutoSendSignal
    && latestAutoTelegramSignalId !== signal.id
    && autoTelegramSignalInFlightId !== signal.id;
  latestSignalId = signal.id;
  latestSignalCopy = signal.copy;
  latestSignalTelegram = { signal, levels };
  signalDetectionReady = true;

  el.signalNotice.classList.remove('signal-collapsed', 'signal-buy', 'signal-sell', 'signal-pulse');
  el.signalNotice.classList.add(signal.isBuy ? 'signal-buy' : 'signal-sell');
  el.signalNoticeTitle.textContent = `${signal.label} ${signal.entryZone}`;
  el.signalNoticeText.textContent = signal.copy;
  el.signalRiskText.textContent = isAutoTelegramInterval
    ? `${signal.invalidationNote} Auto Telegram 5M đang bật. Rủi ro/lệnh nên <= 0.5-1% tài khoản.`
    : `${signal.invalidationNote} Đang ưu tiên bắn Telegram khung 5M, khung ${formatIntervalLabel(levels.interval)} chỉ hiển thị trên chart.`;
  syncSignalToggle(true);

  if (isNewSignal && !suppressAutoSend) {
    signalNoticeCollapsed = false;
    syncSignalToggle(true);
    el.signalNotice.classList.add('signal-pulse');
    window.setTimeout(() => el.signalNotice?.classList.remove('signal-pulse'), 1800);
  }

  if (shouldAutoSendSignal) {
    autoTelegramSignalInFlightId = signal.id;
    activateTelegramSignal(signal, levels)
      .then((opened) => {
        if (opened) latestAutoTelegramSignalId = signal.id;
      })
      .catch((error) => {
        console.warn(error);
      })
      .finally(() => {
        if (autoTelegramSignalInFlightId === signal.id) autoTelegramSignalInFlightId = '';
      });
  }

  checkTelegramSignalPrice(levels.price);
}

function readSignalNoticePosition() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SIGNAL_NOTICE_POSITION_KEY) || 'null');
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved;
  } catch (error) {
    window.localStorage.removeItem(SIGNAL_NOTICE_POSITION_KEY);
  }
  return null;
}

function signalNoticeFrame() {
  return el.signalNotice?.closest('.chart-frame') || el.chart?.parentElement || document.body;
}

function clampSignalNoticePosition(x, y) {
  const frame = signalNoticeFrame();
  const notice = el.signalNotice;
  const margin = 8;
  const frameWidth = frame?.clientWidth || window.innerWidth;
  const frameHeight = frame?.clientHeight || window.innerHeight;
  const width = notice?.offsetWidth || 360;
  const height = notice?.offsetHeight || 180;
  return {
    x: clamp(x, margin, Math.max(margin, frameWidth - width - margin)),
    y: clamp(y, margin, Math.max(margin, frameHeight - height - margin)),
  };
}

function applySignalNoticePosition(x, y, persist = true) {
  if (!el.signalNotice) return;
  const position = clampSignalNoticePosition(Number(x), Number(y));
  el.signalNotice.classList.add('signal-custom-position');
  el.signalNotice.style.left = `${position.x}px`;
  el.signalNotice.style.top = `${position.y}px`;
  el.signalNotice.style.right = 'auto';
  el.signalNotice.style.bottom = 'auto';
  if (persist) {
    window.localStorage.setItem(SIGNAL_NOTICE_POSITION_KEY, JSON.stringify(position));
  }
}

function restoreSignalNoticePosition() {
  const position = readSignalNoticePosition();
  if (position) applySignalNoticePosition(position.x, position.y, false);
}

function initSignalNoticeDrag() {
  const notice = el.signalNotice;
  const handle = notice?.querySelector('.signal-head');
  if (!notice || !handle) return;

  restoreSignalNoticePosition();

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button')) return;
    const frameRect = signalNoticeFrame().getBoundingClientRect();
    const noticeRect = notice.getBoundingClientRect();
    signalNoticeDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - noticeRect.left,
      offsetY: event.clientY - noticeRect.top,
      frameLeft: frameRect.left,
      frameTop: frameRect.top,
    };
    notice.classList.add('signal-dragging');
    notice.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  notice.addEventListener('pointermove', (event) => {
    if (!signalNoticeDragState || signalNoticeDragState.pointerId !== event.pointerId) return;
    const x = event.clientX - signalNoticeDragState.frameLeft - signalNoticeDragState.offsetX;
    const y = event.clientY - signalNoticeDragState.frameTop - signalNoticeDragState.offsetY;
    applySignalNoticePosition(x, y, true);
  });

  const finishDrag = (event) => {
    if (!signalNoticeDragState || signalNoticeDragState.pointerId !== event.pointerId) return;
    notice.classList.remove('signal-dragging');
    notice.releasePointerCapture?.(event.pointerId);
    signalNoticeDragState = null;
  };

  notice.addEventListener('pointerup', finishDrag);
  notice.addEventListener('pointercancel', finishDrag);
}

function closeLiveSocket() {
  window.clearTimeout(tickPollTimer);
  window.clearTimeout(fullRenderTimer);
  window.clearInterval(socketHeartbeatTimer);
  window.cancelAnimationFrame(liveRenderFrame);
  tickPollTimer = null;
  fullRenderTimer = null;
  socketHeartbeatTimer = null;
  liveRenderFrame = 0;
  liveAnimState = null;
  queuedLiveCandle = null;
  queuedLivePrice = null;

  if (!liveSocket) return;
  liveSocket.onopen = null;
  liveSocket.onmessage = null;
  liveSocket.onerror = null;
  liveSocket.onclose = null;
  liveSocket.close();
  liveSocket = null;
}

function updateLastCandle(kline, limit) {
  const liveCandle = {
    time: Math.floor(kline.t / 1000),
    open: Number(kline.o),
    high: Number(kline.h),
    low: Number(kline.l),
    close: Number(kline.c),
    volume: Number(kline.v),
  };

  const lastIndex = currentCandles.length - 1;
  if (lastIndex >= 0 && currentCandles[lastIndex].time === liveCandle.time) {
    currentCandles[lastIndex] = liveCandle;
  } else if (lastIndex < 0 || liveCandle.time > currentCandles[lastIndex].time) {
    currentCandles.push(liveCandle);
    currentCandles = currentCandles.slice(-limit);
  }

  return liveCandle;
}

function updateLivePriceLine(price) {
  if (!livePriceLine || !Number.isFinite(price)) return;
  if (typeof livePriceLine.applyOptions === 'function') {
    livePriceLine.applyOptions({ price });
  }
  checkTelegramSignalPrice(price);
  if (latestLevelItems.length) {
    renderLevelBadges(latestLevelItems.map((item) => (
      item.key === 'price' ? { ...item, price } : item
    )));
  }
}

// function renderLiveCandle(candle, price) {
//   queuedLiveCandle = candle;
//   queuedLivePrice = price;

//   if (liveRenderFrame) return;
//   liveRenderFrame = window.requestAnimationFrame(() => {
//     liveRenderFrame = 0;
//     if (queuedLiveCandle) {
//       const livePhases = computeTrendPhases(currentCandles);
//       candleSeries?.update(colorCandle(queuedLiveCandle, livePhases.at(-1)));
//     }
//     updateLivePriceLine(queuedLivePrice);
//     queuedLiveCandle = null;
//     queuedLivePrice = null;
//   });
// }
let liveAnimState = null;

function renderLiveCandle(candle, price) {
  if (!candleSeries || !Number.isFinite(price)) return;
  const liveCandle = {
    ...candle,
    close: price,
    high: Math.max(Number(candle.high), price),
    low: Math.min(Number(candle.low), price),
  };
  currentCandles[currentCandles.length - 1] = liveCandle;
  candleSeries.update(colorCandle(liveCandle, candleSide(liveCandle)));
  updateLivePriceLine(price);
}

function stepLiveCandleAnimation(now) {
  if (!liveAnimState) {
    liveRenderFrame = 0;
    return;
  }

  const t = clamp((now - liveAnimState.start) / liveAnimState.duration, 0, 1);
  // easeInOutQuad: mượt cả lúc bắt đầu lẫn lúc gần tới đích, không giật ở 2 đầu
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const displayClose = lerp(liveAnimState.fromClose, liveAnimState.toClose, eased);
  const displayPrice = lerp(liveAnimState.fromPrice, liveAnimState.toPrice, eased);

  liveAnimState.currentClose = displayClose;
  liveAnimState.currentPrice = displayPrice;

  candleSeries?.update(colorCandle({ ...liveAnimState.base, close: displayClose }, liveAnimState.side));
  updateLivePriceLine(displayPrice);

  if (t >= 1) {
    liveRenderFrame = 0;
    return;
  }
  liveRenderFrame = window.requestAnimationFrame(stepLiveCandleAnimation);
}
function scheduleFullRender(delayMs = 450) {
  window.clearTimeout(fullRenderTimer);
  fullRenderTimer = window.setTimeout(() => {
    if (!currentCandles.length || !currentDailyCandles.length) return;
    renderComputed(currentCandles, currentDailyCandles, false);
  }, delayMs);
}

function maybeRefreshComputed(maxAgeMs = 2500) {
  const currentCandleTime = currentCandles.at(-1)?.time;
  if (!Number.isFinite(currentCandleTime) || currentCandleTime === lastLiveComputedCandleTime) return;
  lastLiveComputedCandleTime = currentCandleTime;
  scheduleFullRender(0);
}

function alignCandleTime(timestampSeconds, interval) {
  const step = Math.floor((intervalMs[interval] || intervalMs['1m']) / 1000);
  return Math.floor(timestampSeconds / step) * step;
}

function formatCandleCountdown(seconds) {
  const remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateCandleCountdown() {
  if (!el.candleCountdown) return;
  const interval = el.interval?.value || '5m';
  const step = Math.floor((intervalMs[interval] || intervalMs['5m']) / 1000);
  const now = Date.now() / 1000;
  const candleStart = Math.floor(now / step) * step;
  el.candleCountdown.textContent = `Nến ${formatCandleCountdown(candleStart + step - now)}`;
}

function updateCurrentPrice(price, interval, limit, tickTime = Math.floor(Date.now() / 1000)) {
  const lastIndex = currentCandles.length - 1;
  if (lastIndex < 0 || !Number.isFinite(price)) return;

  const candle = currentCandles[lastIndex];
  const liveTime = alignCandleTime(tickTime, interval);

  if (liveTime > candle.time) {
    currentCandles.push({
      time: liveTime,
      open: candle.close,
      high: Math.max(candle.close, price),
      low: Math.min(candle.close, price),
      close: price,
      volume: 1,
    });
    currentCandles = currentCandles.slice(-limit);
    return currentCandles.at(-1);
  }

  currentCandles[lastIndex] = {
    ...candle,
    high: Math.max(candle.high, price),
    low: Math.min(candle.low, price),
    close: price,
    volume: Math.max(candle.volume || 1, 1),
  };
  return currentCandles[lastIndex];
}

function startTickerFallback(source, symbol, interval, limit, token = '') {
  window.clearTimeout(tickPollTimer);
  tickPollSource = source;
  tickPollSymbol = symbol;
  tickPollInterval = interval;
  tickPollLimit = limit;
  tickPollToken = token;
  const pollMs = fallbackPollMs[source]?.[interval] || fallbackPollMs[source]?.default || 350;

  const poll = async () => {
    const startedAt = Date.now(); // <-- THÊM DÒNG NÀY
    try {
      const price = await fetchMarketPrice(source, symbol, token);
      const candle = updateCurrentPrice(price, interval, limit);
      if (candle) renderLiveCandle(candle, price);
      maybeRefreshComputed(source === 'yahoo' ? 4000 : 2500);
      const realtimeHint = source === 'yahoo' ? 'YAHOO SPOT, delayed feed' : `${source.toUpperCase()} LIVE`;
      el.status.textContent = `${symbol} ${realtimeHint} ${formatPrice(price)} ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      console.error(error);
    } finally {
      tickPollTimer = window.setTimeout(poll, Math.max(150, pollMs - (Date.now() - startedAt)));
    }
  };

  poll();
}

function fallbackToYahoo(sourceName, symbol, interval, limit, reason = '') {
  closeLiveSocket();
  const detail = reason ? ` (${reason})` : '';
  el.status.textContent = `${sourceName} loi${detail}, dang chay Yahoo du phong`;
  startTickerFallback('yahoo', symbol, interval, limit, '');
}

function startTwelveDataStream(symbol, interval, limit, token) {
  // A Twelve Data API key can use the provider's push feed directly. The old
  // local proxy remains the fallback for deployments that keep the key server-side.
  if (token) {
    startTwelveDataDirectStream(symbol, interval, limit, token);
    return;
  }

  startTwelveDataProxyStream(symbol, interval, limit, token);
}

function startTwelveDataDirectStream(symbol, interval, limit, token) {
  closeLiveSocket();
  liveSocket = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(token)}`);

  liveSocket.onopen = () => {
    twelveDataReconnectAttempts = 0;
    liveSocket.send(JSON.stringify({
      action: 'subscribe',
      params: { symbols: toTwelveDataSymbol(symbol) },
    }));
    socketHeartbeatTimer = window.setInterval(() => {
      if (liveSocket?.readyState === WebSocket.OPEN) {
        liveSocket.send(JSON.stringify({ action: 'heartbeat' }));
      }
    }, 15000);
    el.status.textContent = `${symbol} ${interval} TWELVEDATA WS dang ket noi`;
  };

  liveSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.event === 'subscribe-status' || message.type === 'subscribe-status') {
      el.status.textContent = `${symbol} ${interval} TWELVEDATA WS LIVE`;
      return;
    }
    if (message.event === 'heartbeat' || message.type === 'heartbeat') return;
    if (message.event === 'error' || message.type === 'error') {
      el.status.textContent = `${symbol} TwelveData WS loi: ${message.message || message.error || 'stream error'}`;
      return;
    }

    const price = Number(message.price ?? message.p ?? message.value);
    if (!Number.isFinite(price)) return;

    const rawTimestamp = Number(message.timestamp || message.ts || Date.now());
    const timestampMs = rawTimestamp > 0 && rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;
    const candle = updateCurrentPrice(price, interval, limit, Math.floor(timestampMs / 1000));
    if (candle) renderLiveCandle(candle, price);
    maybeRefreshComputed(1800);
    el.status.textContent = `${symbol} ${interval} TWELVEDATA WS LIVE ${formatPrice(price)} ${new Date(timestampMs).toLocaleTimeString()}`;
  };

  liveSocket.onerror = () => {
    el.status.textContent = `${symbol} TwelveData WS loi, dang thu ket noi lai...`;
  };

  liveSocket.onclose = () => {
    window.clearInterval(socketHeartbeatTimer);
    socketHeartbeatTimer = null;
    liveSocket = null;

    if (twelveDataReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(2000 * 2 ** twelveDataReconnectAttempts, 30000);
      twelveDataReconnectAttempts += 1;
      el.status.textContent = `${symbol} TwelveData WS mat ket noi, thu lai sau ${Math.round(delay / 1000)}s...`;
      window.setTimeout(() => {
        if (el.source.value === 'twelvedata') {
          startTwelveDataDirectStream(symbol, interval, limit, token);
        }
      }, delay);
    } else {
      startTwelveDataProxyStream(symbol, interval, limit, token);
    }
  };
}

function startTwelveDataProxyStream(symbol, interval, limit, token) {
  closeLiveSocket();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    symbol,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    sessionId: authState.sessionId,
  });
  if (token) params.set('apikey', token);
  liveSocket = new WebSocket(`${protocol}//${window.location.host}/api/ws/price?${params}`);

  liveSocket.onopen = () => {
    twelveDataReconnectAttempts = 0;
    socketHeartbeatTimer = window.setInterval(() => {
      if (liveSocket?.readyState === WebSocket.OPEN) liveSocket.send('ping');
    }, 15000);
    el.status.textContent = `${symbol} ${interval} PROXY dang ket noi`;
  };

  liveSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'ready') {
      twelveDataStreamPollMs = Number(message.intervalMs) || twelveDataStreamPollMs;
      el.status.textContent = `${symbol} proxy ${Math.round(twelveDataStreamPollMs / 1000)}s da ket noi`;
      return;
    }
    if (message.type === 'error') {
      el.status.textContent = `${symbol} proxy loi: ${message.error || 'stream error'}`;
      return;
    }
    const price = Number(message.price ?? message.p ?? message.value);
    if (!Number.isFinite(price)) return;
    const timestampMs = Number(message.timestamp || Date.now());
    const candle = updateCurrentPrice(price, interval, limit, Math.floor(timestampMs / 1000));
    if (candle) renderLiveCandle(candle, price);
    maybeRefreshComputed(1000);
    el.status.textContent = `${symbol} PROXY ${Math.round(twelveDataStreamPollMs / 1000)}S ${formatPrice(price)} ${new Date(timestampMs).toLocaleTimeString()}`;
  };

  liveSocket.onerror = () => {
    el.status.textContent = `${symbol} proxy loi, dang thu ket noi lai...`;
  };

  liveSocket.onclose = () => {
    window.clearInterval(socketHeartbeatTimer);
    socketHeartbeatTimer = null;
    liveSocket = null;
  };
}
function startBinanceStream(symbol, interval, limit) {
  closeLiveSocket();
  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  liveSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);

  liveSocket.onopen = () => {
    el.status.textContent = `${symbol} ${interval} LIVE TICK`;
  };

  liveSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.k || !chart) return;

    const candle = updateLastCandle(message.k, limit);
    if (candle) renderLiveCandle(candle, Number(message.k.c));
    maybeRefreshComputed(1800);

    const close = formatPrice(message.k.c);
    el.status.textContent = `${symbol} ${interval} LIVE ${close}`;
  };

  liveSocket.onerror = () => {
    el.status.textContent = `${symbol} ${interval} websocket lá»—i, Ä‘ang dÃ¹ng poll dá»± phÃ²ng`;
    startTickerFallback('binance', symbol, interval, limit);
  };

  liveSocket.onclose = () => {
    liveSocket = null;
    if (!tickPollTimer) startTickerFallback('binance', symbol, interval, limit);
  };
}

function startTradingViewStream(symbol, interval, limit, token) {
  closeLiveSocket();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    source: 'tradingview',
    symbol,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    sessionId: authState.sessionId,
  });
  liveSocket = new WebSocket(`${protocol}//${window.location.host}/api/ws/price?${params}`);

  liveSocket.onopen = () => {
    twelveDataReconnectAttempts = 0;
    socketHeartbeatTimer = window.setInterval(() => {
      if (liveSocket?.readyState === WebSocket.OPEN) liveSocket.send('ping');
    }, 15000);
    el.status.textContent = `${symbol} ${interval} TRADINGVIEW OANDA dang ket noi`;
  };

  liveSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'ready') {
      el.status.textContent = `${symbol} ${interval} TRADINGVIEW OANDA LIVE`;
      return;
    }
    if (message.type === 'error') {
      el.status.textContent = `${symbol} TradingView loi: ${message.error || 'stream error'}`;
      return;
    }
    const price = Number(message.price ?? message.p ?? message.value);
    if (!Number.isFinite(price)) return;
    const timestampMs = Number(message.timestamp || Date.now());
    const candle = updateCurrentPrice(price, interval, limit, Math.floor(timestampMs / 1000));
    if (candle) renderLiveCandle(candle, price);
    maybeRefreshComputed(1800);
    el.status.textContent = `${symbol} ${interval} TRADINGVIEW OANDA LIVE ${formatPrice(price)} ${new Date(timestampMs).toLocaleTimeString()}`;
  };

  liveSocket.onerror = () => {
    el.status.textContent = `${symbol} TradingView loi, dang ket noi lai...`;
  };

  liveSocket.onclose = () => {
    window.clearInterval(socketHeartbeatTimer);
    socketHeartbeatTimer = null;
    liveSocket = null;
    if (twelveDataReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(2000 * 2 ** twelveDataReconnectAttempts, 30000);
      twelveDataReconnectAttempts += 1;
      window.setTimeout(() => {
        if (el.source.value === 'tradingview') startTradingViewStream(symbol, interval, limit, token);
      }, delay);
    } else {
      el.status.textContent = `${symbol} TradingView mat ket noi, dang dung TwelveData du phong`;
      startTwelveDataStream(symbol, interval, limit, token);
    }
  };
}

function startLiveStream(source, symbol, interval, limit, token) {
  if (source === 'binance') {
    startBinanceStream(symbol, interval, limit);
    return;
  }

  if (source === 'twelvedata') {
    startTwelveDataStream(symbol, interval, limit, token);
    return;
  }

  if (source === 'tradingview') {
    startTradingViewStream(symbol, interval, limit, token);
    return;
  }

  closeLiveSocket();
  startTickerFallback(source, symbol, interval, limit, token);
}

async function loadChart() {
  const symbol = el.symbol.value.trim().toUpperCase();
  const source = el.source.value;
  const token = el.token.value.trim();
  const interval = el.interval.value;
  const limit = Number(el.limit.value);
  syncTimeframeButtons();
  el.symbol.value = symbol;
  if (el.symbolPreset && [...el.symbolPreset.options].some((option) => option.value === symbol)) {
    el.symbolPreset.value = symbol;
  }
  const sourceNote = source === 'yahoo'
    ? 'Yahoo fallback data, delayed'
    : source === 'twelvedata'
      ? 'TwelveData live data'
      : source === 'tradingview'
        ? 'TradingView OANDA thử nghiệm'
      : `${source} data`;
  el.status.textContent = `Loading ${symbol} ${interval} ${sourceNote}...`;
  el.reload.disabled = true;
  closeLiveSocket();
  window.clearInterval(refreshTimer);
  latestSignalId = '';
  latestAutoTelegramSignalId = '';
  autoTelegramSignalInFlightId = '';
  latestSignalCopy = '';
  latestSignalTelegram = null;
  telegramSignalStates = [];
  signalDetectionReady = false;
  try {
    let activeSource = source;
    let activeToken = token;
    let candles;
    let dailyCandles;

    try {
      [candles, dailyCandles] = await Promise.all([
        fetchMarketCandles(source, symbol, interval, limit, token),
        fetchMarketDaily(source, symbol, token),
      ]);
    } catch (error) {
      if (source === 'tradingview' || (source === 'twelvedata' && isTwelveDataLimitError(error))) {
        activeSource = source === 'tradingview' ? 'twelvedata' : 'yahoo';
        activeToken = source === 'tradingview' ? token : '';
        el.status.textContent = source === 'tradingview'
          ? 'TradingView history loi, dang dung TwelveData du phong...'
          : 'TwelveData het han muc, dang dung Yahoo du phong...';
        [candles, dailyCandles] = await Promise.all([
          fetchMarketCandles(activeSource, symbol, interval, limit, activeToken),
          fetchMarketDaily(activeSource, symbol, activeToken),
        ]);
      } else {
        throw error;
      }
    }

    const nextMarkerContext = `${symbol}|${interval}|${activeSource}`;
    if (persistentMarkerContext !== nextMarkerContext) {
      persistentSignalMarkers.clear();
      persistentMarkerContext = nextMarkerContext;
    }

    currentCandles = candles;
    currentDailyCandles = dailyCandles;

    initChart();
    renderComputed(currentCandles, currentDailyCandles, true);
    startLiveStream(activeSource, symbol, interval, limit, activeToken);

    refreshTimer = window.setInterval(async () => {
      try {
        currentDailyCandles = await fetchMarketDaily(activeSource, symbol, activeToken);
      } catch (error) {
        if (activeSource === 'twelvedata' && isTwelveDataLimitError(error)) {
          el.status.textContent = `TwelveData het han muc/loi (${error.message}), se thu lai...`;
          return;
        }
        throw error;
      }
    }, Math.max(intervalMs[interval] || dailyRefreshMinMs, dailyRefreshMinMs));
  } catch (error) {
    console.error(error);
    el.status.textContent = error.message;
  } finally {
    el.reload.disabled = false;
  }
}

function syncTimeframeButtons() {
  for (const button of el.timeframeButtons) {
    button.classList.toggle('active', button.dataset.timeframe === el.interval.value);
  }
}

function handleChartAction(action) {
  if (action === 'fit') {
    chart?.timeScale().fitContent();
    return;
  }

  if (action === 'zoom-in' || action === 'zoom-out') {
    currentBarSpacing = clamp(currentBarSpacing + (action === 'zoom-in' ? 1.4 : -1.4), 1, 28);
    chart?.timeScale().applyOptions({ barSpacing: currentBarSpacing });
    renderDiamondMarkers();
    return;
  }

  if (action === 'fullscreen') {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.();
    }
  }
}

function handleViewportChange() {
  applyChartSize();
  renderLevelBadges(latestLevelItems);
  renderDiamondMarkers();
  renderDrawings();
}

window.addEventListener('resize', handleViewportChange);
window.addEventListener('orientationchange', () => {
  window.setTimeout(handleViewportChange, 250);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', handleViewportChange);
}

el.reload.addEventListener('click', loadChart);
function isAddStrategy(strategy) {
  return strategy === 'add-pullback'
    || strategy === 'tp-window-add'
    || strategy === 'cycle-continuation-add';
}

function clearHiddenSignalNotice() {
  const visibleStrategy = (strategy) => {
    if (isAddStrategy(strategy)) return !hideAddSignals;
    if (strategy === 'probability-ok') return !hideProbabilitySignals;
    return true;
  };

  if (latestSignalTelegram?.signal && !visibleStrategy(latestSignalTelegram.signal.strategy)) {
    latestSignalCopy = '';
    latestSignalTelegram = null;
    latestSignalId = '';
    latestAutoTelegramSignalId = '';
    autoTelegramSignalInFlightId = '';
    syncSignalToggle(false);
  }
  telegramSignalStates = telegramSignalStates.filter((signal) => visibleStrategy(signal.strategy));
}

function applySignalFilterChange() {
  hideProbabilitySignals = !Boolean(el.showProbabilitySignals?.checked);
  hideAddSignals = !Boolean(el.showAddSignals?.checked);
  hideDiamondSignals = !Boolean(el.showDiamondSignals?.checked);
  window.localStorage.setItem('hideProbabilitySignals', hideProbabilitySignals ? '1' : '0');
  window.localStorage.setItem('hideAddSignals', hideAddSignals ? '1' : '0');
  window.localStorage.setItem('hideDiamondSignals', hideDiamondSignals ? '1' : '0');
  syncSignalFilterMenu();
  suppressNextSignalSend = true;
  clearHiddenSignalNotice();

  if (currentCandles.length && currentDailyCandles.length) {
    renderComputed(currentCandles, currentDailyCandles, false);
  }
}

function positionFixedPanel(panel, anchorEl, { align = 'right' } = {}) {
  if (!panel || !anchorEl) return;
  // Keep floating controls outside the app/chart stacking contexts. The chart
  // uses clipped canvas layers, which can otherwise cover fixed descendants.
  if (panel.parentElement !== document.body) document.body.appendChild(panel);
  const margin = 8;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const viewportWidth = window.visualViewport?.width || window.innerWidth;

  const place = () => {
    if (panel.classList.contains('hidden')) return; // closed again before we ran
    const anchorRect = anchorEl.getBoundingClientRect();
    panel.style.top = `${Math.round(anchorRect.bottom + margin)}px`;
    panel.style.right = 'auto';
    panel.style.left = '0px';

    // Measure natural width/position first, then clamp within the viewport.
    const panelRect = panel.getBoundingClientRect();
    let left = align === 'right'
      ? anchorRect.right - panelRect.width
      : anchorRect.left;
    left = Math.max(8, Math.min(left, viewportWidth - panelRect.width - 8));
    panel.style.left = `${Math.round(left)}px`;

    // Never let the panel bottom fall below the visible viewport: if the
    // anchor is low on screen, flip the panel to open upward instead of
    // clamping it to a sliver that's effectively invisible.
    let maxHeight = viewportHeight - anchorRect.bottom - margin - 8;
    if (maxHeight < 160 && anchorRect.top - margin - 8 > 160) {
      const upHeight = Math.min(anchorRect.top - margin - 8, viewportHeight * 0.72);
      panel.style.top = 'auto';
      panel.style.bottom = `${Math.round(viewportHeight - anchorRect.top + margin)}px`;
      panel.style.maxHeight = `${Math.round(upHeight)}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.maxHeight = `${Math.max(160, Math.round(maxHeight))}px`;
    }
  };

  // Run once immediately (covers the common case) and once more on the next
  // animation frame in case the "hidden" class removal hasn't been painted
  // yet (seen on some mobile browsers), so the anchor rect is never stale.
  place();
  requestAnimationFrame(place);
}

function setSignalFilterMenuOpen(open) {
  el.signalFilterMenu?.classList.toggle('hidden', !open);
  el.signalFilterButton?.parentElement?.classList.toggle('open', open);
  el.signalFilterButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) positionFixedPanel(el.signalFilterMenu, el.signalFilterButton, { align: 'right' });
}

el.signalFilterButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  setSignalFilterMenuOpen(el.signalFilterMenu?.classList.contains('hidden'));
});
el.signalFilterMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});
el.showProbabilitySignals?.addEventListener('change', applySignalFilterChange);
el.showAddSignals?.addEventListener('change', applySignalFilterChange);
el.showDiamondSignals?.addEventListener('change', applySignalFilterChange);
el.advancedControlsButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  const opening = el.advancedControlsPanel?.classList.contains('hidden');
  setAdvancedControlsOpen(opening);
  if (opening) positionFixedPanel(el.advancedControlsPanel, el.advancedControlsButton, { align: 'right' });
});
el.advancedControlsPanel?.addEventListener('click', (event) => {
  event.stopPropagation();
});
for (const checkbox of el.levelVisibilityCheckboxes) {
  checkbox.addEventListener('change', applyLevelVisibilityChange);
}
document.addEventListener('click', () => {
  setSignalFilterMenuOpen(false);
  setAdvancedControlsOpen(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !liveSocket && !tickPollTimer && authState.sessionId) {
    loadChart();
  }
});
document.querySelector('.toolbar')?.addEventListener('scroll', () => {
  setSignalFilterMenuOpen(false);
  setAdvancedControlsOpen(false);
}, { passive: true });
window.addEventListener('resize', () => {
  if (!el.advancedControlsPanel?.classList.contains('hidden')) {
    positionFixedPanel(el.advancedControlsPanel, el.advancedControlsButton, { align: 'right' });
  }
  if (!el.signalFilterMenu?.classList.contains('hidden')) {
    positionFixedPanel(el.signalFilterMenu, el.signalFilterButton, { align: 'right' });
  }
  const signalPosition = readSignalNoticePosition();
  if (signalPosition) applySignalNoticePosition(signalPosition.x, signalPosition.y, true);
});
window.addEventListener('orientationchange', () => {
  setSignalFilterMenuOpen(false);
  setAdvancedControlsOpen(false);
});
initSignalNoticeDrag();
el.hideSignal?.addEventListener('click', () => {
  signalNoticeCollapsed = true;
  syncSignalToggle(Boolean(latestSignalCopy));
});
el.signalToggle?.addEventListener('click', () => {
  if (!latestSignalCopy) {
    syncSignalToggle(false);
    return;
  }
  signalNoticeCollapsed = !signalNoticeCollapsed;
  syncSignalToggle(true);
});
el.sendTelegram?.addEventListener('click', async () => {
  if (!latestSignalTelegram) return;
  const oldText = el.sendTelegram.textContent;
  el.sendTelegram.disabled = true;
  el.sendTelegram.textContent = '...';
  await activateTelegramSignal(latestSignalTelegram.signal, latestSignalTelegram.levels);
  window.setTimeout(() => {
    el.sendTelegram.textContent = oldText;
    el.sendTelegram.disabled = false;
  }, 1200);
});
el.copySignal?.addEventListener('click', async () => {
  if (!latestSignalCopy) return;
  try {
    await navigator.clipboard.writeText(latestSignalCopy);
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = latestSignalCopy;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  const oldText = el.copySignal.textContent;
  el.copySignal.textContent = 'COPIED';
  window.setTimeout(() => {
    el.copySignal.textContent = oldText;
  }, 1200);
});
el.symbol.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadChart();
});
el.symbolPreset?.addEventListener('change', () => {
  el.symbol.value = el.symbolPreset.value;
  loadChart();
});
el.source.addEventListener('change', () => {
  window.localStorage.setItem('marketSource', el.source.value);
  el.token.value = window.localStorage.getItem(sourceTokenKey(el.source.value)) || '';
  const current = el.symbol.value.trim().toUpperCase();
  if (el.source.value === 'binance' && (current === 'XAUUSD' || current === 'GOLD')) {
    el.symbol.value = 'ETHUSDT';
  }
  if (el.source.value !== 'binance' && (current === 'ETHUSDT' || current === 'BTCUSDT')) {
    el.symbol.value = 'XAUUSD';
  }
  loadChart();
});
el.token.addEventListener('change', () => {
  window.localStorage.setItem(sourceTokenKey(el.source.value), el.token.value.trim());
  if (el.source.value === 'twelvedata' || el.source.value === 'tradingview') loadChart();
});
function applyOpOffsetChange() {
  window.localStorage.setItem('opOffset', el.opOffset.value.trim() || '0');
  if (currentCandles.length && currentDailyCandles.length) {
    renderComputed(currentCandles, currentDailyCandles, false);
  }
}

el.opOffset.addEventListener('input', applyOpOffsetChange);
el.opOffset.addEventListener('change', applyOpOffsetChange);
el.resetOpOffset?.addEventListener('click', () => {
  el.opOffset.value = '0';
  applyOpOffsetChange();
});
el.opOffset.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.currentTarget.blur();
  }
});
el.interval.addEventListener('change', loadChart);
updateCandleCountdown();
window.setInterval(updateCandleCountdown, 250);
for (const button of el.timeframeButtons) {
  button.addEventListener('click', () => {
    if (button.dataset.timeframe === el.interval.value) return;
    el.interval.value = button.dataset.timeframe;
    loadChart();
  });
}
for (const button of el.iconButtons) {
  button.addEventListener('click', () => handleChartAction(button.dataset.action));
}
for (const button of el.drawToolButtons) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setDrawingMode(button.dataset.drawTool);
  });
}
el.clearDrawings?.addEventListener('click', (event) => {
  event.stopPropagation();
  clearDrawings();
});
el.limit.addEventListener('change', loadChart);

el.loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = el.loginUsername.value.trim();
  const password = el.loginPassword.value;
  el.loginButton.disabled = true;
  el.loginError.textContent = '';
  try {
    await login(username, password);
  } catch (error) {
    el.loginError.textContent = error.message;
  } finally {
    el.loginButton.disabled = false;
  }
});

el.logout?.addEventListener('click', async () => {
  const sessionId = authState.sessionId;
  clearAuthSession();
  syncAuthUi();
  if (sessionId) {
    try {
      await authPost('/api/auth/logout', { sessionId });
    } catch (error) {
      console.warn(error);
    }
  }
  showLogin();
});

el.kickLoginAgain?.addEventListener('click', () => {
  el.sessionKickNotice?.classList.add('hidden');
  bootApp();
});

el.adminButton?.addEventListener('click', async () => {
  el.adminPanel?.classList.remove('hidden');
  setAdminTab('users');
});

el.closeAdmin?.addEventListener('click', () => {
  el.adminPanel?.classList.add('hidden');
});

el.adminPanel?.addEventListener('click', (event) => {
  if (event.target === el.adminPanel) {
    el.adminPanel.classList.add('hidden');
  }
});

el.createUserForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = el.newUsername.value.trim();
  const password = el.newPassword.value;
  const role = el.newRole.value;
  if (!username || !password) {
    el.adminError.textContent = 'Nhap tai khoan va mat khau moi.';
    return;
  }

  await adminPost('/api/auth/admin/create-user', { username, password, role });
  if (!el.adminError.textContent) {
    el.newUsername.value = '';
    el.newPassword.value = '';
    el.newRole.value = 'user';
  }
});

el.adminUserList?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-admin-action]');
  if (!button || button.disabled) return;
  const userId = button.dataset.userId;
  const action = button.dataset.adminAction;

  if (action === 'kick') {
    await adminPost('/api/auth/admin/kick', { userId });
    return;
  }

  if (action === 'toggle') {
    await adminPost('/api/auth/admin/toggle-user', {
      userId,
      enabled: button.dataset.enabled === '1',
    });
    return;
  }

  if (action === 'password') {
    const password = window.prompt('Nhập mật khẩu mới (tối thiểu 12 ký tự):');
    if (!password) return;
    await adminPost('/api/auth/admin/change-password', { userId, password });
  }
});

hiddenPriceLevels = loadHiddenPriceLevels();
syncSignalFilterMenu();
syncLevelVisibilityControls();
syncTimeframeButtons();
syncDrawingToolButtons();
bootApp();
