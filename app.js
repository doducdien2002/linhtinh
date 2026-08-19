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
};

const savedSource = window.localStorage.getItem('marketSource');
if (['yahoo', 'twelvedata', 'finnhub', 'binance'].includes(savedSource)) {
  el.source.value = savedSource;
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
let latestMarkers = [];
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
let latestSignalCopy = '';
let latestSignalTelegram = null;
let telegramSignalStates = [];
let telegramPriceCheckRunning = false;
let telegramQueuedPrice = null;
let telegramRetryTimer = null;
let signalDetectionReady = false;
let signalNoticeCollapsed = false;
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
    await authPost('/api/signals/sync', { sessionId: authState.sessionId, signals });
    firebaseSignalSyncErrorShown = false;
  } catch (error) {
    console.warn('Firebase server sync failed:', error);
    if (!firebaseSignalSyncErrorShown) {
      el.status.textContent = 'Firebase server chưa ghi được kèo; vẫn lưu cục bộ.';
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
  }
}

const ADD_SIGNAL_TP_MIN_MOVE = 10;
const ADD_SIGNAL_TP_MAX_MOVE = 10;
const TELEGRAM_AUTO_INTERVAL = '5m';
const TELEGRAM_SIGNAL_STORAGE_KEY = 'craziiTelegramOpenSignals';
const TELEGRAM_SIGNAL_MAX_OPEN = 10;
const TRADE_SL_MOVE = 10;
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

const finnhubResolution = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
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
  finnhub: {
    default: 450,
  },
  twelvedata: {
    default: 60_000,
  },
};

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

function sma(values, length, index, key = null) {
  const start = Math.max(0, index - length + 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= index; i += 1) {
    const value = key ? values[i][key] : values[i];
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function ema(values, length) {
  const k = 2 / (length + 1);
  const out = [];
  let prev = values[0] || 0;
  for (let i = 0; i < values.length; i += 1) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
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

function computeTrendPhases(candles) {
  if (!candles.length) return [];

  const atrValues = atr(candles, 14);
  const closes = candles.map((item) => item.close);
  const fast = ema(closes, 5);
  const slow = ema(closes, 13);
  let side = candles[0].close >= candles[0].open ? 'buy' : 'sell';

  return candles.map((candle, index) => {
    const atrNow = Math.max(atrValues[index], Number.EPSILON);
    const prevFast = fast[index - 1] ?? fast[index];
    const trend = (fast[index] - slow[index]) / atrNow;
    const slope = (fast[index] - prevFast) / atrNow;
    const position = (candle.close - slow[index]) / atrNow;
    const bodyBias = ((candle.close - candle.open) / atrNow) * 0.2;
    const score = trend * 1.15 + slope * 2.8 + position * 0.35 + bodyBias;

    if (score > 0.1) side = 'buy';
    if (score < -0.1) side = 'sell';

    return {
      side,
      score,
      color: side === 'buy' ? COLORS.candleUp : COLORS.candleDown,
    };
  });
}

function computeBoysSide(candles, index, context) {
  const { atrValues, emaFast, emaSlow, emaTrigger, previousSide } = context;
  const candle = candles[index];
  const previous = candles[index - 1] || candle;
  const atrNow = Math.max(atrValues[index], Number.EPSILON);
  const prevTrigger = emaTrigger[index - 1] ?? emaTrigger[index];
  const prevClose = previous.close ?? candle.open;
  const body = (candle.close - candle.open) / atrNow;
  const closeMove = (candle.close - prevClose) / atrNow;
  const triggerSlope = (emaTrigger[index] - prevTrigger) / atrNow;
  const trend = (emaFast[index] - emaSlow[index]) / atrNow;
  const closeVsTrigger = (candle.close - emaTrigger[index]) / atrNow;

  const pressure =
    closeMove * 1.35 +
    triggerSlope * 2.2 +
    trend * 0.95 +
    closeVsTrigger * 0.65 +
    body * 0.35;

  if (pressure > 0.18) return 'buy';
  if (pressure < -0.18) return 'sell';
  return previousSide;
}

function quantizePrice(value) {
  if (!Number.isFinite(value)) return value;
  if (value >= 1000) return Number(value.toFixed(2));
  if (value >= 10) return Number(value.toFixed(3));
  return Number(value.toFixed(5));
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
  if (source === 'finnhub') return 'finnhubToken';
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

async function adminPost(path, payload = {}) {
  el.adminError.textContent = '';
  try {
    await authPost(path, { ...payload, sessionId: authState.sessionId });
    await loadAdminPanel();
  } catch (error) {
    if (error.status === 409 || error.status === 401) {
      handleAuthError(error);
      return;
    }
    el.adminError.textContent = error.message;
  }
}

async function bootApp() {
  document.body.classList.add('auth-locked');
  getDeviceId();
  const restored = await restoreAuthSession();
  if (restored) {
    loadChart().then(restoreTelegramSignalStatesFromFirebase);
  } else if (!el.sessionKickNotice || el.sessionKickNotice.classList.contains('hidden')) {
    showLogin();
  }
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

function trueRange(candle, prevClose) {
  if (!prevClose) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - prevClose),
    Math.abs(candle.low - prevClose),
  );
}

function atr(candles, length) {
  return candles.map((candle, index) => {
    const trValues = [];
    for (let i = Math.max(0, index - length + 1); i <= index; i += 1) {
      trValues.push(trueRange(candles[i], i > 0 ? candles[i - 1].close : null));
    }
    return trValues.reduce((sum, value) => sum + value, 0) / trValues.length;
  });
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

function toFinnhubSymbol(symbol) {
  const normalized = symbol.trim().toUpperCase().replace('/', '').replace('_', '');
  if (normalized === 'XAUUSD' || normalized === 'GOLD') return 'OANDA:XAU_USD';
  if (normalized === 'XAGUSD' || normalized === 'SILVER') return 'OANDA:XAG_USD';
  return symbol.trim().toUpperCase();
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

async function fetchFinnhubCandles(symbol, interval, limit, token) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - (intervalMs[interval] || 60_000) / 1000 * Math.max(limit + 10, 120);
  const params = new URLSearchParams({
    symbol: toFinnhubSymbol(symbol),
    resolution: finnhubResolution[interval] || '5',
    from: String(Math.floor(from)),
    to: String(to),
  });
  if (token) params.set('token', token);
  const response = await fetch(`/api/finnhub/candle?${params}`);
  if (!response.ok) throw new Error(`Finnhub candle tráº£ lá»—i ${response.status}.`);
  const data = await response.json();
  if (data.s !== 'ok') throw new Error(`Finnhub khÃ´ng tráº£ náº¿n: ${data.s || 'unknown'}`);

  return data.t.map((time, index) => ({
    time,
    open: Number(data.o[index]),
    high: Number(data.h[index]),
    low: Number(data.l[index]),
    close: Number(data.c[index]),
    volume: Number(data.v?.[index] || 1),
  })).slice(-limit);
}

async function fetchFinnhubDaily(symbol, token) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 420 * 24 * 60 * 60;
  const params = new URLSearchParams({
    symbol: toFinnhubSymbol(symbol),
    resolution: 'D',
    from: String(from),
    to: String(to),
  });
  if (token) params.set('token', token);
  const response = await fetch(`/api/finnhub/candle?${params}`);
  if (!response.ok) throw new Error(`Finnhub daily tráº£ lá»—i ${response.status}.`);
  const data = await response.json();
  if (data.s !== 'ok') throw new Error(`Finnhub khÃ´ng tráº£ daily: ${data.s || 'unknown'}`);

  return data.t.map((time, index) => ({
    time,
    open: Number(data.o[index]),
    high: Number(data.h[index]),
    low: Number(data.l[index]),
    close: Number(data.c[index]),
    volume: Number(data.v?.[index] || 1),
  }));
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

async function fetchMarketCandles(source, symbol, interval, limit, token) {
  if (source === 'binance') return fetchBinanceKlines(symbol, interval, limit);
  if (source === 'finnhub') return fetchFinnhubCandles(symbol, interval, limit, token);
  if (source === 'twelvedata') return fetchTwelveDataCandles(symbol, interval, limit, token);
  return fetchYahooChart(symbol, interval, limit);
}

async function fetchMarketDaily(source, symbol, token) {
  if (source === 'binance') return fetchDaily(symbol);
  if (source === 'finnhub') return fetchFinnhubDaily(symbol, token);
  if (source === 'twelvedata') return fetchTwelveDataDaily(symbol, token);
  return fetchYahooDaily(symbol);
}

async function fetchFinnhubQuote(symbol, token) {
  const params = new URLSearchParams({ symbol: toFinnhubSymbol(symbol) });
  if (token) params.set('token', token);
  const response = await fetch(`/api/finnhub/quote?${params}`);
  if (!response.ok) throw new Error(`Finnhub quote returned ${response.status}.`);

  const data = await response.json();
  const price = toPositiveNumber(data.c);
  if (price !== null) return price;
  throw new Error('Finnhub quote has no valid price.');
}

async function fetchTwelveDataPrice(symbol, token) {
  const params = new URLSearchParams({ symbol: toTwelveDataSymbol(symbol) });
  if (token) params.set('apikey', token);
  const response = await fetch(`/api/twelvedata/price?${params}`);
  if (!response.ok) throw providerError('twelvedata', `TwelveData price returned ${response.status}.`);

  const data = await response.json();
  if (data.status === 'error') throw providerError('twelvedata', data.message || 'TwelveData price error.');
  const price = toPositiveNumber(data.price);
  if (price !== null) return price;
  throw providerError('twelvedata', 'TwelveData price has no valid price.');
}

async function fetchMarketPrice(source, symbol, token = '') {
  if (source === 'binance') return fetchTickerPrice(symbol);
  if (source === 'finnhub') return fetchFinnhubQuote(symbol, token);
  if (source === 'twelvedata') return fetchTwelveDataPrice(symbol, token);
  return fetchYahooMetaPrice(symbol);
}

function resolveOpOffset(rawOp) {
  const value = Number(el.opOffset?.value);
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) >= 100 && Number.isFinite(rawOp) ? value - rawOp : value;
}

function computeLevels(candles, dailyCandles) {
  const last = candles.at(-1);
  const interval = el.interval.value;
  const day = localDayKey(last.time);
  const firstOfDay = candles.find((item) => localDayKey(item.time) === day) || candles[0];
  const currentDaily = dailyCandles.find((item) => localDayKey(item.time) === day) || dailyCandles.at(-1);
  const rawOp = quantizePrice(currentDaily?.open || firstOfDay.open);
  const opOffset = resolveOpOffset(rawOp);
  const op = quantizePrice(rawOp + opOffset);
  const ktrStep = op * 0.004;
  const ratioLevel = (ratio) => quantizePrice(op + ktrStep * ratio);
  const dailyCloses = dailyCandles.map((item) => item.close).filter(Number.isFinite);
  const ma200 = dailyCloses.length >= 200
    ? quantizePrice(average(dailyCloses.slice(-200)))
    : null;

  return {
    interval,
    op,
    ktrStep,
    ktrPlus1: ratioLevel(1),
    ktrPlus2: ratioLevel(2),
    ktrPlus3: ratioLevel(3),
    ktrMinus1: ratioLevel(-1),
    ktrMinus2: ratioLevel(-2),
    ktrMinus3: ratioLevel(-3),
    pivot1: ratioLevel(CRAZII_LEVEL_RATIOS.pivot1),
    pivot2: ratioLevel(CRAZII_LEVEL_RATIOS.pivot2),
    mlp: ratioLevel(CRAZII_LEVEL_RATIOS.mlp),
    kcb01: ratioLevel(CRAZII_LEVEL_RATIOS.kcb01),
    kcb02: ratioLevel(CRAZII_LEVEL_RATIOS.kcb02),
    kcb03: ratioLevel(CRAZII_LEVEL_RATIOS.kcb03),
    ma30: ratioLevel(CRAZII_LEVEL_RATIOS.ma30Fallback),
    ma200,
    price: last.close,
  };
}

function isSwingLow(candles, index, leftBars = 2, rightBars = 2) {
  const low = candles[index]?.low;
  if (!Number.isFinite(low)) return false;

  for (let offset = 1; offset <= leftBars; offset += 1) {
    if (low > candles[index - offset]?.low) return false;
  }
  for (let offset = 1; offset <= rightBars; offset += 1) {
    if (low > candles[index + offset]?.low) return false;
  }
  return true;
}

function isSwingHigh(candles, index, leftBars = 2, rightBars = 2) {
  const high = candles[index]?.high;
  if (!Number.isFinite(high)) return false;

  for (let offset = 1; offset <= leftBars; offset += 1) {
    if (high < candles[index - offset]?.high) return false;
  }
  for (let offset = 1; offset <= rightBars; offset += 1) {
    if (high < candles[index + offset]?.high) return false;
  }
  return true;
}

function computeDiamondMarkers(candles, levels, context) {
  const { atrValues, emaFast, emaSlow, ksi, bullishness, trendPhases } = context;
  const levelValues = [
    levels.ktrPlus3,
    levels.ktrPlus2,
    levels.ktrPlus1,
    levels.pivot2,
    levels.pivot1,
    levels.op,
    levels.mlp,
    levels.ma30,
    levels.ktrMinus1,
    levels.ktrMinus2,
    levels.ktrMinus3,
    levels.kcb01,
    levels.kcb02,
    levels.kcb03,
    levels.ma200,
  ].filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));

  const nearestLevelDistance = (price) => (
    levelValues.length
      ? Math.min(...levelValues.map((level) => Math.abs(Number(level) - price)))
      : Infinity
  );

  const lookahead = levels.interval === '1d' ? 5 : 4;
  const minGapSameKind = levels.interval === '1d' ? 8 : 10;
  const minGapAny = levels.interval === '1d' ? 2 : 3;
  const candidates = [];

  for (let i = 5; i < candles.length - lookahead; i += 1) {
    const candle = candles[i];
    const atrNow = Math.max(atrValues[i], Number.EPSILON);
    const left = candles.slice(i - 5, i);
    const right = candles.slice(i + 1, i + 1 + lookahead);
    const neighborhood = [...left, ...right];
    const previousClose = candles[i - 5].close;
    const nextHigh = Math.max(...right.map((item) => item.high));
    const nextLow = Math.min(...right.map((item) => item.low));
    const nextCloseHigh = Math.max(...right.map((item) => item.close));
    const nextCloseLow = Math.min(...right.map((item) => item.close));
    const localLow = Math.min(...neighborhood.map((item) => item.low));
    const localHigh = Math.max(...neighborhood.map((item) => item.high));
    const levelLowDistance = nearestLevelDistance(candle.low) / atrNow;
    const levelHighDistance = nearestLevelDistance(candle.high) / atrNow;
    const levelLowScore = levelLowDistance <= 0.55 ? 0.72 : levelLowDistance <= 1.1 ? 0.42 : levelLowDistance <= 1.8 ? 0.18 : 0;
    const levelHighScore = levelHighDistance <= 0.55 ? 0.72 : levelHighDistance <= 1.1 ? 0.42 : levelHighDistance <= 1.8 ? 0.18 : 0;
    const lowProminence = (localLow - candle.low) / atrNow;
    const highProminence = (candle.high - localHigh) / atrNow;
    const lowerWick = (Math.min(candle.open, candle.close) - candle.low) / atrNow;
    const upperWick = (candle.high - Math.max(candle.open, candle.close)) / atrNow;
    const fallBefore = previousClose - candle.close > atrNow * 0.42 || emaFast[i] < emaSlow[i];
    const riseBefore = candle.close - previousClose > atrNow * 0.42 || emaFast[i] > emaSlow[i];
    const recoveryAfter = Math.max(nextHigh, nextCloseHigh) - candle.low > atrNow * 0.72;
    const rejectionAfter = candle.high - Math.min(nextLow, nextCloseLow) > atrNow * 0.72;
    const bearishNow = bullishness[i]?.value || 0;
    const bearishPrev1 = bullishness[i - 1]?.value || 0;
    const bearishPrev2 = bullishness[i - 2]?.value || 0;
    const bearishNext = bullishness[i + 1]?.value || bearishNow;
    const bearishExtreme = bearishNow < -245 || bearishPrev1 < -245 || bearishPrev2 < -245;
    const bearishEasing = bearishNow > bearishPrev1 || bearishNext > bearishNow;
    const boysTurnsUp = ksi[i].color === COLORS.boysBuy && ksi[i - 1].color === COLORS.boysSell;
    const boysTurnsDown = ksi[i].color === COLORS.boysSell && ksi[i - 1].color === COLORS.boysBuy;
    const boysSpike = ksi[i].value > 2.65 || ksi[i - 1].value > 2.75;
    const phaseSell = trendPhases[i]?.side === 'sell';
    const phaseBuy = trendPhases[i]?.side === 'buy';
    const levelLowConfluence = levelLowScore >= 0.18;
    const levelHighConfluence = levelHighScore >= 0.18;
    const buyOscillatorOk = bearishExtreme || bearishEasing || boysTurnsUp || ksi[i]?.color === COLORS.boysBuy;
    const sellOscillatorOk = boysSpike || boysTurnsDown || ksi[i]?.color === COLORS.boysSell;

    const buyScore =
      lowProminence * 1.35 +
      levelLowScore +
      (fallBefore ? 0.34 : 0) +
      (recoveryAfter ? 0.84 : 0) +
      (bearishExtreme ? 0.44 : 0) +
      (bearishEasing ? 0.18 : 0) +
      (boysTurnsUp ? 0.3 : 0) +
      (lowerWick > 0.16 ? 0.2 : 0) +
      (phaseSell ? 0.16 : 0);

    const supportRetestScore =
      levelLowScore +
      (fallBefore ? 0.26 : 0) +
      (recoveryAfter ? 0.48 : 0) +
      (lowerWick > 0.12 ? 0.22 : 0) +
      (bearishEasing ? 0.18 : 0) +
      (boysTurnsUp ? 0.24 : 0);

    if (
      isSwingLow(candles, i) &&
      recoveryAfter &&
      levelLowConfluence &&
      buyOscillatorOk &&
      buyScore >= 1.3 &&
      (lowProminence >= 0.08 || lowerWick > 0.16 || bearishExtreme || boysTurnsUp)
    ) {
      candidates.push({
        index: i,
        score: buyScore,
        time: candle.time,
        price: candle.low - atrNow * 0.08,
        anchorClose: candle.close,
        anchorLow: candle.low,
        anchorHigh: candle.high,
        position: 'belowBar',
        kind: 'buy',
        color: COLORS.cyan,
      });
    } else if (
      isSwingLow(candles, i, 2, 2) &&
      recoveryAfter &&
      supportRetestScore >= 1.16 &&
      levelLowConfluence &&
      (phaseBuy || ksi[i]?.color === COLORS.boysBuy) &&
      !bearishExtreme
    ) {
      candidates.push({
        index: i,
        score: supportRetestScore,
        time: candle.time,
        price: candle.low - atrNow * 0.08,
        anchorClose: candle.close,
        anchorLow: candle.low,
        anchorHigh: candle.high,
        position: 'belowBar',
        kind: 'add',
        color: COLORS.markerAdd,
      });
    }

    const addScore =
      highProminence * 1.35 +
      levelHighScore +
      (riseBefore ? 0.34 : 0) +
      (rejectionAfter ? 0.84 : 0) +
      (boysSpike ? 0.35 : 0) +
      (boysTurnsDown ? 0.32 : 0) +
      (upperWick > 0.16 ? 0.2 : 0) +
      (phaseBuy ? 0.12 : 0);

    if (
      isSwingHigh(candles, i) &&
      rejectionAfter &&
      levelHighConfluence &&
      sellOscillatorOk &&
      addScore >= 1.3 &&
      (highProminence >= 0.08 || upperWick > 0.16 || boysSpike || boysTurnsDown)
    ) {
      candidates.push({
        index: i,
        score: addScore,
        time: candle.time,
        price: candle.high + atrNow * 0.08,
        anchorClose: candle.close,
        anchorLow: candle.low,
        anchorHigh: candle.high,
        position: 'aboveBar',
        kind: 'add',
        color: COLORS.markerAdd,
      });
    }
  }

  const markers = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const overlapsAny = markers.some((marker) => Math.abs(marker.index - candidate.index) < minGapAny);
    const overlapsSameKind = markers.some((marker) => marker.kind === candidate.kind && Math.abs(marker.index - candidate.index) < minGapSameKind);
    if (!overlapsAny && !overlapsSameKind) markers.push(candidate);
  }

  return markers
    .sort((a, b) => a.index - b.index)
    .map((marker) => {
      const anchorClose = Number(marker.anchorClose ?? candles[marker.index]?.close);
      const atrNow = Math.max(atrValues[marker.index] || 0, Number.EPSILON);
      const stackWindow = levels.interval === '1d' ? 80 : 48;
      const stackTolerance = atrNow * 0.38;
      const stackCount = candidates.filter((candidate) => (
        candidate.kind === marker.kind
        && Math.abs(candidate.index - marker.index) <= stackWindow
        && Math.abs(Number(candidate.anchorClose ?? anchorClose) - anchorClose) <= stackTolerance
      )).length;

      return {
        ...marker,
        stackCount,
        strength: stackCount >= 3 ? 'accumulation' : marker.kind,
      };
    });
}

function latestDiamondLineFromMarkers(candles, diamondMarkers) {
  const marker = diamondMarkers
    .filter((item) => item.kind === 'buy')
    .at(-1);
  const candle = marker ? candles[marker.index] : null;
  if (!marker || !candle) return null;

  return {
    index: marker.index,
    time: candle.time,
    price: candle.close,
    kind: marker.kind,
    stackCount: marker.stackCount || 1,
    anchorLow: Number(marker.anchorLow ?? candle.low),
    anchorHigh: Number(marker.anchorHigh ?? candle.high),
  };
}

function candleTrendSide(candle, phase) {
  return phase?.side || candleSide(candle);
}

function computeDiamondLineTradeMarkers(candles, diamondLine, { atrValues, ksi, trendPhases }) {
  if (!diamondLine) return [];
  if (diamondLine.index >= candles.length - 1) return [];

  const markers = [];
  const startIndex = diamondLine.index + 1;
  const minGap = 3;
  let activeSide = null;

  for (let i = startIndex; i < candles.length; i += 1) {
    const candle = candles[i];
    const atrNow = Math.max(atrValues[i] || 0, Number.EPSILON);
    const tolerance = atrNow * 0.22;
    const side = candleTrendSide(candle, trendPhases[i]);
    const isYellowClose = side === 'buy';
    const isRedClose = side === 'sell';
    const ksiBuy = ksi[i]?.color === COLORS.boysBuy;
    const ksiSell = ksi[i]?.color === COLORS.boysSell;
    const aboveLine = candle.close >= diamondLine.price;
    const belowLine = candle.close < diamondLine.price;
    const touchesLine = candle.low <= diamondLine.price + tolerance && candle.high >= diamondLine.price - tolerance;
    const rejectsLine = touchesLine && candle.high >= diamondLine.price - tolerance && candle.close < diamondLine.price;
    const bouncesLine = touchesLine && candle.low <= diamondLine.price + tolerance && candle.close > diamondLine.price;
    const buyRuleA = aboveLine && isYellowClose && ksiBuy;
    const buyRuleB = bouncesLine && isYellowClose && ksiBuy;
    const sellRuleC = rejectsLine && isRedClose && ksiSell;
    const sellRuleD = belowLine && isRedClose && ksiSell;
    const sideSignal = buyRuleA || buyRuleB ? 'buy' : sellRuleC || sellRuleD ? 'sell' : null;

    if (!sideSignal) continue;
    if (activeSide === sideSignal) continue;
    if (markers.some((marker) => marker.sideSignal === sideSignal && Math.abs(marker.index - i) < minGap)) continue;

    const isBuy = sideSignal === 'buy';
    const rule = buyRuleB
      ? 'Bật lên từ DL'
      : buyRuleA
        ? 'Trên DL'
        : sellRuleC
          ? 'Bị từ chối tại DL'
          : 'Dưới DL';
    markers.push({
      index: i,
      time: candle.time,
      price: isBuy ? candle.low - atrNow * 0.12 : candle.high + atrNow * 0.12,
      position: isBuy ? 'belowBar' : 'aboveBar',
      kind: isBuy ? 'buy-arrow' : 'sell-arrow',
      color: isBuy ? COLORS.blinkGreen : COLORS.candleDown,
      label: isBuy ? 'BUY BIG' : 'SELL BIG',
      sideSignal,
      strategy: 'diamond-line',
      strategyLabel: `${rule} ${formatPrice(diamondLine.price)} + nến ${isBuy ? 'Vàng' : 'Đỏ'} + KSI ${isBuy ? 'Xanh' : 'Đỏ'}`,
      entry: candle.close,
      setupFirstLow: Math.min(diamondLine.anchorLow, candle.low),
      setupFirstHigh: Math.max(diamondLine.anchorHigh, candle.high),
      diamondLinePrice: diamondLine.price,
      diamondStackCount: diamondLine.stackCount,
    });
    activeSide = sideSignal;
  }

  return markers.length ? [markers.at(-1)] : [];
}

function confluenceLevelValues(levels) {
  return [
    levels.ktrPlus3,
    levels.ktrPlus2,
    levels.ktrPlus1,
    levels.pivot2,
    levels.pivot1,
    levels.op,
    levels.mlp,
    levels.ma30,
    levels.ktrMinus1,
    levels.ktrMinus2,
    levels.ktrMinus3,
    levels.kcb01,
    levels.kcb02,
    levels.kcb03,
    levels.ma200,
  ].filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
}

function nearestConfluenceLevelDistance(price, levelValues) {
  return levelValues.length
    ? Math.min(...levelValues.map((level) => Math.abs(Number(level) - price)))
    : Infinity;
}

function filterConfluenceSpacing(markers, minGap) {
  const filtered = [];
  for (const marker of markers.sort((a, b) => b.score - a.score)) {
    if (!filtered.some((item) => Math.abs(item.index - marker.index) < minGap)) {
      filtered.push(marker);
    }
  }
  return filtered.sort((a, b) => a.index - b.index);
}

function mergeTradeMarkers(baseMarkers, addMarkers, minAddGap = 2) {
  const merged = [...baseMarkers].sort((a, b) => a.index - b.index);

  for (const addMarker of addMarkers.sort((a, b) => a.index - b.index)) {
    const addSide = markerSignalSide(addMarker);
    const isDuplicate = merged.some((marker) => (
      markerSignalSide(marker) === addSide
      && Math.abs(marker.index - addMarker.index) < minAddGap
    ));
    const conflictsOpposite = merged.some((marker) => (
      markerSignalSide(marker)
      && markerSignalSide(marker) !== addSide
      && Math.abs(marker.index - addMarker.index) <= 1
    ));

    if (!isDuplicate && !conflictsOpposite) merged.push(addMarker);
  }

  return merged.sort((a, b) => a.index - b.index);
}

function markerSignalSide(marker) {
  if (marker.kind === 'buy-arrow') return 'buy';
  if (marker.kind === 'sell-arrow') return 'sell';
  return null;
}

function isAddSignalMarker(marker) {
  return ['add-pullback', 'tp-window-add', 'cycle-continuation-add'].includes(marker.strategy);
}

function filterTrueAddSignals(addMarkers, baseMarkers, minAfterBase = 6, rejectNearBase = 5) {
  if (!addMarkers.length) return [];

  return addMarkers.filter((addMarker) => {
    const side = markerSignalSide(addMarker);
    if (!side || !isAddSignalMarker(addMarker)) return false;

    const nearBase = baseMarkers.some((baseMarker) => (
      markerSignalSide(baseMarker)
      && Math.abs(baseMarker.index - addMarker.index) <= rejectNearBase
    ));
    if (nearBase) return false;

    const previousSameSideBase = baseMarkers
      .filter((baseMarker) => (
        markerSignalSide(baseMarker) === side
        && baseMarker.index <= addMarker.index - minAfterBase
      ))
      .at(-1);
    if (!previousSameSideBase) return false;

    const oppositeAfterBase = baseMarkers.some((baseMarker) => (
      markerSignalSide(baseMarker) !== side
      && baseMarker.index > previousSameSideBase.index
      && baseMarker.index < addMarker.index
    ));
    return !oppositeAfterBase;
  });
}

function filterTpWindowAddSignals(addMarkers, baseMarkers, candles, minMove = ADD_SIGNAL_TP_MIN_MOVE, maxMove = ADD_SIGNAL_TP_MAX_MOVE) {
  if (!addMarkers.length) return [];

  return addMarkers
    .map((addMarker) => {
      const side = markerSignalSide(addMarker);
      if (!side || !isAddSignalMarker(addMarker)) return null;

      const previousSameSideBase = baseMarkers
        .filter((baseMarker) => markerSignalSide(baseMarker) === side && baseMarker.index < addMarker.index)
        .at(-1);
      if (!previousSameSideBase) return null;

      const oppositeAfterBase = baseMarkers.some((baseMarker) => (
        markerSignalSide(baseMarker) !== side
        && baseMarker.index > previousSameSideBase.index
        && baseMarker.index < addMarker.index
      ));
      if (oppositeAfterBase) return null;

      const baseEntry = Number(candles[previousSameSideBase.index]?.close);
      const addEntry = Number(candles[addMarker.index]?.close);
      if (!Number.isFinite(baseEntry) || !Number.isFinite(addEntry)) return null;

      const moveFromBase = side === 'buy' ? addEntry - baseEntry : baseEntry - addEntry;
      if (moveFromBase < minMove || moveFromBase > maxMove) return null;

      const sideText = side === 'buy' ? 'BUY' : 'SELL';
      return {
        ...addMarker,
        label: `${sideText} ADD`,
        strategyLabel: `${addMarker.strategyLabel} | TP ${moveFromBase.toFixed(2)} giá từ entry ${formatPrice(baseEntry)}`,
        baseEntry,
        moveFromBase,
      };
    })
    .filter(Boolean);
}

function computeTpWindowAddMarkers(candles, levels, { atrValues, ksi, bullishness, trendPhases }, baseMarkers) {
  if (!baseMarkers.length) return [];

  const minAfterAnchor = levels.interval === '1d' ? 3 : 4;
  const lookAheadBars = levels.interval === '1d' ? 22 : 48;
  const minGap = levels.interval === '1d' ? 4 : 5;
  const touchRange = clamp(Math.abs(Number(levels.ktrStep || 0)) * 0.18, 1.1, 4.2);
  const addLevels = [
    { name: 'KTR+3', price: levels.ktrPlus3 },
    { name: 'KTR+2', price: levels.ktrPlus2 },
    { name: 'KTR+1', price: levels.ktrPlus1 },
    { name: 'Pivot 02', price: levels.pivot2 },
    { name: 'MLP', price: levels.mlp },
    { name: 'OP', price: levels.op },
    { name: 'Pivot 01', price: levels.pivot1 },
    { name: '30MA', price: levels.ma30 },
    { name: 'KTR-1', price: levels.ktrMinus1 },
    { name: 'KTR-2', price: levels.ktrMinus2 },
    { name: 'KTR-3', price: levels.ktrMinus3 },
    { name: 'KCB 01', price: levels.kcb01 },
    { name: 'KCB 02', price: levels.kcb02 },
    { name: 'KCB 03', price: levels.kcb03 },
  ].filter((item) => Number.isFinite(Number(item.price)));

  const nearestTouchedLevel = (price) => addLevels
    .map((item) => ({ ...item, distance: Math.abs(price - Number(item.price)) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;

  const markers = [];
  const anchors = baseMarkers
    .map((marker) => ({
      marker,
      side: markerSignalSide(marker),
      entry: Number(candles[marker.index]?.close),
      rootIndex: marker.index,
    }))
    .filter((anchor) => anchor.side && Number.isFinite(anchor.entry))
    .sort((a, b) => a.marker.index - b.marker.index);

  for (let anchorCursor = 0; anchorCursor < anchors.length; anchorCursor += 1) {
    const anchor = anchors[anchorCursor];
    const { side } = anchor;
    const anchorEntry = Number(anchor.entry);
    const startIndex = anchor.marker.index + minAfterAnchor;
    const searchEnd = Math.min(candles.length, anchor.marker.index + lookAheadBars + 1);

    for (let i = startIndex; i < searchEnd; i += 1) {
      const candle = candles[i];
      const previous = candles[i - 1];
      if (!candle || !previous) continue;

      const hasOppositeSignal = baseMarkers.some((marker) => (
        markerSignalSide(marker) !== side
        && marker.index > anchor.rootIndex
        && marker.index <= i
      ));
      if (hasOppositeSignal) break;

      const overlapsExistingAdd = markers.some((marker) => (
        markerSignalSide(marker) === side
        && Math.abs(marker.index - i) < minGap
      ));
      if (overlapsExistingAdd) continue;

      const triggerEntry = side === 'buy'
        ? anchorEntry + ADD_SIGNAL_TP_MIN_MOVE
        : anchorEntry - ADD_SIGNAL_TP_MIN_MOVE;
      const reachedAddTrigger = side === 'buy'
        ? candle.high >= triggerEntry
        : candle.low <= triggerEntry;
      if (!reachedAddTrigger) continue;

      const entry = triggerEntry;
      const moveFromAnchor = ADD_SIGNAL_TP_MIN_MOVE;
      const atrNow = Math.max(atrValues[i] || candle.high - candle.low, Number.EPSILON);
      const range = Math.max(candle.high - candle.low, Math.abs(candle.close - candle.open), Number.EPSILON);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const touchedLevel = side === 'buy' ? nearestTouchedLevel(candle.low) : nearestTouchedLevel(candle.high);
      const nearLevelOk = Boolean(touchedLevel && touchedLevel.distance <= touchRange);
      const trendOk = displayedCandleSide(candles, trendPhases, i) === side;
      const ksiOk = side === 'buy' ? ksi[i]?.color === COLORS.boysBuy : ksi[i]?.color === COLORS.boysSell;
      const bearishNow = bearishnessValue(bullishness, i);
      const bearishPrev = bearishnessValue(bullishness, i - 1);
      const reactionOk = side === 'buy'
        ? candle.close >= candle.open || lowerWick / range >= 0.18 || candle.close >= previous.close
        : candle.close <= candle.open || upperWick / range >= 0.18 || candle.close <= previous.close;
      const pressureOk = side === 'buy'
        ? bearishNow >= bearishPrev || bearishNow === 0
        : bearishNow < 0 || bearishNow < bearishPrev;
      const continuedMoveOk = side === 'buy'
        ? candle.high >= anchorEntry + ADD_SIGNAL_TP_MIN_MOVE
        : candle.low <= anchorEntry - ADD_SIGNAL_TP_MIN_MOVE;

      const confluenceScore = [trendOk, ksiOk, reactionOk, nearLevelOk, pressureOk, continuedMoveOk]
        .filter(Boolean).length;
      if (confluenceScore < 3 || (!nearLevelOk && !reactionOk)) continue;

      const isBuy = side === 'buy';
      const sideText = isBuy ? 'BUY' : 'SELL';
      const addMarker = {
        index: i,
        score: 2.4 + confluenceScore * 0.18 + Math.max((ADD_SIGNAL_TP_MAX_MOVE - moveFromAnchor) / ADD_SIGNAL_TP_MAX_MOVE, 0),
        time: candle.time,
        price: isBuy ? candle.low - atrNow * 0.08 : candle.high + atrNow * 0.08,
        position: isBuy ? 'belowBar' : 'aboveBar',
        kind: isBuy ? 'buy-arrow' : 'sell-arrow',
        color: isBuy ? COLORS.blinkGreen : COLORS.candleDown,
        label: `${sideText} ADD`,
        strategy: 'tp-window-add',
        strategyLabel: `ADD sau ${moveFromAnchor.toFixed(2)} giá + hội tụ ${touchedLevel?.name || 'xu hướng'}`,
        baseEntry: anchorEntry,
        moveFromBase: moveFromAnchor,
        entry,
        setupFirstLow: Math.min(candle.low, previous.low, candles[anchor.marker.index]?.low ?? candle.low),
        setupFirstHigh: Math.max(candle.high, previous.high, candles[anchor.marker.index]?.high ?? candle.high),
      };

      markers.push(addMarker);
      anchors.push({
        marker: addMarker,
        side,
        entry,
        rootIndex: anchor.rootIndex,
      });
      break;
    }
  }

  return markers.sort((a, b) => a.index - b.index);
}
function filterFirstSignalPerCycle(markers) {
  const filtered = [];
  let activeSignalKey = null;

  for (const marker of markers.sort((a, b) => a.index - b.index)) {
    const signalSide = markerSignalSide(marker);
    const signalKey = signalSide ? `${signalSide}:${marker.strategy || 'ksi'}` : null;

    if (!signalSide) {
      filtered.push(marker);
      continue;
    }

    if (isAddSignalMarker(marker) || marker.strategy === 'tp-window-add') {
      filtered.push(marker);
      continue;
    }

    if (signalKey === activeSignalKey) continue;
    activeSignalKey = signalKey;
    filtered.push(marker);
  }

  return filtered;
}

function averageAtrAround(atrValues, index, lookback = 20) {
  const start = Math.max(0, index - lookback + 1);
  const slice = atrValues.slice(start, index + 1).filter(Number.isFinite);
  if (!slice.length) return 0;
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function filterMarkersByTrendAndVolatility(markers, candles, { atrValues, trendPhases }, volatilityRatio = 0.85) {
  return markers.filter((marker) => {
    const side = markerSignalSide(marker);
    if (!side) return true;

    // Chỉ giữ tín hiệu thuận theo xu hướng hiện tại của nến (buy trong sóng tăng,
    // sell trong sóng giảm) — loại các tín hiệu ngược pha gây nhiễu trong vùng giằng co.
    const trendSide = displayedCandleSide(candles, trendPhases, marker.index);
    if (trendSide !== side) return false;

    // Chỉ giữ tín hiệu khi biến động (ATR) tại thời điểm đó không quá thấp so với
    // trung bình gần đây — tránh bắn tín hiệu trong vùng đi ngang, biên độ hẹp.
    const atrNow = Number(atrValues[marker.index]);
    const atrAvg = averageAtrAround(atrValues, marker.index);
    if (!Number.isFinite(atrNow) || !Number.isFinite(atrAvg) || atrAvg <= 0) return true;
    return atrNow >= atrAvg * volatilityRatio;
  });
}

function filterMarkersByOutcomeGap(markers, candles, tpMove = TRADE_TP_MAX_MOVE, slMove = TRADE_SL_MOVE) {
  if (!markers.length) return [];

  const sorted = [...markers].sort((a, b) => a.index - b.index);
  const filtered = [];
  let lastKept = null;

  for (const marker of sorted) {
    const side = markerSignalSide(marker);
    if (!side) {
      filtered.push(marker);
      continue;
    }

    if (!lastKept) {
      filtered.push(marker);
      lastKept = marker;
      continue;
    }

    const lastSide = markerSignalSide(lastKept);

    // Tín hiệu CÙNG CHIỀU (tiếp diễn xu hướng) được giữ ngay, không cần chờ lệnh
    // trước đóng — vì đây không phải đảo lệnh, không có gì mâu thuẫn cần chờ giải quyết.
    if (lastSide && side === lastSide) {
      filtered.push(marker);
      lastKept = marker;
      continue;
    }

    const lastEntry = Number(candles[lastKept.index]?.close);
    if (!Number.isFinite(lastEntry)) {
      filtered.push(marker);
      lastKept = marker;
      continue;
    }

    // Tín hiệu NGƯỢC CHIỀU (đảo lệnh) chỉ được chấp nhận sau khi lệnh trước đã
    // thực sự đóng hẳn — chạm TP3 (tpMove) hoặc dính SL (slMove) — tránh đảo lệnh
    // non trên những cú giật ngược tạm thời rồi giá quay lại xu hướng cũ.
    let outcomeReached = false;
    for (let i = lastKept.index + 1; i <= marker.index && i < candles.length; i += 1) {
      const candle = candles[i];
      if (!candle) continue;
      const favorableMove = lastSide === 'buy' ? candle.high - lastEntry : lastEntry - candle.low;
      const adverseMove = lastSide === 'buy' ? lastEntry - candle.low : candle.high - lastEntry;
      if (favorableMove >= tpMove || adverseMove >= slMove) {
        outcomeReached = true;
        break;
      }
    }

    if (!outcomeReached) continue;

    filtered.push(marker);
    lastKept = marker;
  }

  return filtered;
}

function displayedCandleSide(candles, trendPhases, index) {
  return trendPhases[index]?.side || candleSide(candles[index]);
}

function bearishnessValue(bullishness, index) {
  return bullishness[index]?.value || 0;
}

function computeHighProbabilityMarkers(candles, levels, { atrValues, ksi, bullishness, trendPhases }) {
  if (hideProbabilitySignals) return [];

  const minGap = levels.interval === '1d' ? 5 : 7;
  const touchRange = clamp(Math.abs(Number(levels.ktrStep || 0)) * 0.18, 1.1, 4.5);
  const rawMarkers = [];
  const buyTrendLevels = [
    { name: 'KTR-1', price: levels.ktrMinus1 },
    { name: 'Pivot 01', price: levels.pivot1 },
    { name: '30MA', price: levels.ma30 },
    { name: 'MLP', price: levels.mlp },
  ].filter((item) => Number.isFinite(Number(item.price)));
  const buyDeepLevels = [
    { name: 'KTR-2', price: levels.ktrMinus2 },
    { name: 'KTR-3', price: levels.ktrMinus3 },
    { name: 'Pivot 01', price: levels.pivot1 },
  ].filter((item) => Number.isFinite(Number(item.price)));
  const sellTrendLevels = [
    { name: 'KTR+1', price: levels.ktrPlus1 },
    { name: 'Pivot 02', price: levels.pivot2 },
    { name: '30MA', price: levels.ma30 },
    { name: 'MLP', price: levels.mlp },
  ].filter((item) => Number.isFinite(Number(item.price)));
  const sellExtremeLevels = [
    { name: 'KTR+2', price: levels.ktrPlus2 },
    { name: 'KTR+3', price: levels.ktrPlus3 },
    { name: 'Pivot 02', price: levels.pivot2 },
  ].filter((item) => Number.isFinite(Number(item.price)));
  const nearestTouchedLevel = (price, candidates) => candidates
    .map((item) => ({ ...item, distance: Math.abs(price - Number(item.price)) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;

  for (let i = 4; i < candles.length; i += 1) {
    const candle = candles[i];
    const previous = candles[i - 1];
    if (!candle || !previous) continue;

    const atrNow = Math.max(atrValues[i] || candle.high - candle.low, Number.EPSILON);
    const range = Math.max(candle.high - candle.low, Math.abs(candle.close - candle.open), Number.EPSILON);
    const lowerWickRatio = (Math.min(candle.open, candle.close) - candle.low) / range;
    const upperWickRatio = (candle.high - Math.max(candle.open, candle.close)) / range;
    const recent = candles.slice(Math.max(0, i - 4), i + 1);
    const recentLow = Math.min(...recent.map((item) => item.low));
    const recentHigh = Math.max(...recent.map((item) => item.high));
    const boysBuy = ksi[i]?.color === COLORS.boysBuy;
    const boysSell = ksi[i]?.color === COLORS.boysSell;
    const boysTurnsBuy = boysBuy && ksi[i - 1]?.color === COLORS.boysSell;
    const boysTurnsSell = boysSell && ksi[i - 1]?.color === COLORS.boysBuy;
    const bearishNow = bearishnessValue(bullishness, i);
    const bearishPrev = bearishnessValue(bullishness, i - 1);
    const bearishExtreme = bearishNow < -245 || bearishPrev < -245;
    const bearishEasing = bearishNow === 0 || bearishNow > bearishPrev;
    const bearishPressing = bearishNow < -120 && bearishNow <= bearishPrev;
    const reactionBuy = candle.close >= candle.open || candle.close > previous.close || lowerWickRatio >= 0.28;
    const reactionSell = candle.close <= candle.open || candle.close < previous.close || upperWickRatio >= 0.28;
    const phaseBuy = displayedCandleSide(candles, trendPhases, i) === 'buy';
    const phaseSell = displayedCandleSide(candles, trendPhases, i) === 'sell';
    const aboveOp = candle.close >= levels.op;
    const belowOp = candle.close <= levels.op;

    const buyTrendLevel = nearestTouchedLevel(candle.low, buyTrendLevels);
    const buyDeepLevel = nearestTouchedLevel(candle.low, buyDeepLevels);
    const sellTrendLevel = nearestTouchedLevel(candle.high, sellTrendLevels);
    const sellExtremeLevel = nearestTouchedLevel(candle.high, sellExtremeLevels);
    const buyTrendTouch = Boolean(buyTrendLevel && buyTrendLevel.distance <= touchRange);
    const buyDeepTouch = Boolean(buyDeepLevel && buyDeepLevel.distance <= touchRange);
    const sellTrendTouch = Boolean(sellTrendLevel && sellTrendLevel.distance <= touchRange);
    const sellExtremeTouch = Boolean(sellExtremeLevel && sellExtremeLevel.distance <= touchRange);

    const buyTrendScore =
      (aboveOp ? 30 : 0) +
      (buyTrendTouch ? 24 : 0) +
      (reactionBuy ? 18 : 0) +
      (boysBuy ? 14 : 0) +
      (bearishEasing ? 10 : 0) +
      (phaseBuy ? 8 : 0) +
      (candle.low <= recentLow ? 6 : 0);
    const buyDeepScore =
      (buyDeepTouch ? 28 : 0) +
      (bearishExtreme ? 22 : 0) +
      (reactionBuy ? 18 : 0) +
      (bearishEasing ? 14 : 0) +
      (boysBuy || boysTurnsBuy ? 12 : 0) +
      (candle.low <= recentLow ? 8 : 0);

    if ((buyTrendScore >= 74 && buyTrendTouch) || (buyDeepScore >= 78 && buyDeepTouch)) {
      const isTrend = buyTrendScore >= buyDeepScore;
      const touchedLevel = isTrend ? buyTrendLevel : buyDeepLevel;
      rawMarkers.push({
        index: i,
        score: 3 + Math.max(buyTrendScore, buyDeepScore) / 100,
        time: candle.time,
        price: candle.low - atrNow * 0.12,
        position: 'belowBar',
        kind: 'buy-arrow',
        color: COLORS.blinkGreen,
        label: isTrend ? 'BUY OK' : 'BUY HỒI',
        strategy: 'probability-ok',
        strategyLabel: `${isTrend ? 'OK thuận xu hướng' : 'OK bắt hồi'}: ${aboveOp ? 'trên OP' : 'quá đà'} + ${touchedLevel?.name || 'level'} + phản ứng BUY`,
        entry: candle.close,
        setupFirstLow: recentLow,
        setupFirstHigh: recentHigh,
      });
      continue;
    }

    const sellTrendScore =
      (belowOp ? 30 : 0) +
      (sellTrendTouch ? 24 : 0) +
      (reactionSell ? 18 : 0) +
      (boysSell ? 14 : 0) +
      (bearishPressing ? 10 : 0) +
      (phaseSell ? 8 : 0) +
      (candle.high >= recentHigh ? 6 : 0);
    const sellExtremeScore =
      (sellExtremeTouch ? 28 : 0) +
      (reactionSell ? 20 : 0) +
      (boysSell || boysTurnsSell ? 16 : 0) +
      (upperWickRatio >= 0.24 ? 14 : 0) +
      (candle.high >= recentHigh ? 10 : 0) +
      (!bearishEasing ? 6 : 0);

    if ((sellTrendScore >= 74 && sellTrendTouch) || (sellExtremeScore >= 78 && sellExtremeTouch)) {
      const isTrend = sellTrendScore >= sellExtremeScore;
      const touchedLevel = isTrend ? sellTrendLevel : sellExtremeLevel;
      rawMarkers.push({
        index: i,
        score: 3 + Math.max(sellTrendScore, sellExtremeScore) / 100,
        time: candle.time,
        price: candle.high + atrNow * 0.12,
        position: 'aboveBar',
        kind: 'sell-arrow',
        color: COLORS.candleDown,
        label: isTrend ? 'SELL OK' : 'SELL HỒI',
        strategy: 'probability-ok',
        strategyLabel: `${isTrend ? 'OK thuận xu hướng' : 'OK bắt hồi'}: ${belowOp ? 'dưới OP' : 'quá đà'} + ${touchedLevel?.name || 'level'} + phản ứng SELL`,
        entry: candle.close,
        setupFirstHigh: recentHigh,
        setupFirstLow: recentLow,
      });
    }
  }

  return filterConfluenceSpacing(rawMarkers, minGap);
}

function computeBuyConfluenceMarkers(candles, levels, { atrValues, ksi, bullishness, trendPhases }) {
  const lookback = 4;
  const minGap = 6;
  const maxExtensionAtr = 6;
  const rawMarkers = [];

  const getSetup = (endIndex) => {
    const start = endIndex - lookback + 1;
    if (start < 0) return null;

    const windowCandles = candles.slice(start, endIndex + 1);
    const firstCandle = windowCandles[0];
    const candle = candles[endIndex];
    const atrNow = Math.max(atrValues[endIndex] || candle.high - candle.low, Number.EPSILON);
    const candleColorsBuy = windowCandles.every((_, offset) => (
      displayedCandleSide(candles, trendPhases, start + offset) === 'buy'
    ));
    const boysBuy = windowCandles.every((_, offset) => ksi[start + offset]?.color === COLORS.boysBuy);
    const bearishnessClear = windowCandles.every((_, offset) => bearishnessValue(bullishness, start + offset) === 0);
    if (!candleColorsBuy || !boysBuy || !bearishnessClear) return null;

    let cycleStart = start;
    while (cycleStart > 0 && displayedCandleSide(candles, trendPhases, cycleStart - 1) === 'buy') {
      cycleStart -= 1;
    }
    const swingLow = Math.min(...candles.slice(cycleStart, endIndex + 1).map((item) => item.low));

    return {
      candle,
      index: endIndex,
      atrNow,
      cycleStart,
      swingLow,
      firstLow: firstCandle.low,
      setupHigh: Math.max(...windowCandles.map((item) => item.high)),
      setupLow: Math.min(...windowCandles.map((item) => item.low)),
      setupClose: candle.close,
      score: 1 + Math.max(candle.close - windowCandles[0].open, candle.close - windowCandles[0].close) / atrNow,
    };
  };

  for (let i = lookback - 1; i < candles.length; i += 1) {
    const setup = getSetup(i);
    if (!setup) continue;

    const triggerIndex = i + 1;
    const candle = candles[triggerIndex];
    if (!candle) continue;

    const atrNow = Math.max(atrValues[triggerIndex] || candle.high - candle.low, Number.EPSILON);
    const pullbackDepth = setup.setupClose - candle.low;
    const breaksFirstCandle = candle.low < setup.firstLow;
    // Chặn tín hiệu BUY khi sóng tăng đã đi quá xa (dễ mua đỉnh trước khi đảo chiều).
    const extension = (candle.close - setup.swingLow) / atrNow;
    const tooExtended = extension > maxExtensionAtr;
    // Chặn tín hiệu BUY nếu ngay tại cây nến kích hoạt, momentum (histogram boys) đã
    // đảo sang đỏ — tránh bắn BUY đúng lúc đà tăng vừa gãy.
    const triggerTurnedBearish = ksi[triggerIndex]?.color === COLORS.boysSell;
    // Chặn tín hiệu BUY nếu chính cây trigger đã có dấu hiệu bị bán ép — đóng cửa dưới
    // mở cửa (nến đỏ) hoặc bóng trên dài — dù setup 4 cây trước vẫn hợp lệ, đây là dấu
    // hiệu mua đỉnh (không có chỉ báo lực mua liên tục như bên sell nên dùng price action).
    const triggerRange = Math.max(candle.high - candle.low, Number.EPSILON);
    const triggerUpperWick = candle.high - Math.max(candle.open, candle.close);
    const triggerToppingCandle = candle.close < candle.open || triggerUpperWick / triggerRange >= 0.3;

    if (breaksFirstCandle || tooExtended || triggerTurnedBearish || triggerToppingCandle || rawMarkers.some((marker) => marker.cycleStart === setup.cycleStart)) continue;

    rawMarkers.push({
      index: triggerIndex,
      score: setup.score + Math.max(Math.min(pullbackDepth / atrNow, 1), 0),
      time: candle.time,
      price: candle.low - atrNow * 0.08,
      position: 'belowBar',
      kind: 'buy-arrow',
      color: COLORS.blinkGreen,
      cycleStart: setup.cycleStart,
      setupFirstLow: setup.firstLow,
      setupFirstHigh: setup.setupHigh,
    });
  }

  return filterConfluenceSpacing(rawMarkers, minGap);
}

function computeSellConfluenceMarkers(candles, levels, { atrValues, ksi, bullishness, trendPhases }) {
  const lookback = 4;
  const minGap = levels.interval === '1d' ? 8 : 14;
  const maxExtensionAtr = 6;
  const rawMarkers = [];

  const getSetup = (endIndex) => {
    const start = endIndex - lookback + 1;
    if (start < 0) return null;

    const windowCandles = candles.slice(start, endIndex + 1);
    const firstCandle = windowCandles[0];
    const candle = candles[endIndex];
    const atrNow = Math.max(atrValues[endIndex] || candle.high - candle.low, Number.EPSILON);
    const candleColorsSell = windowCandles.every((_, offset) => (
      displayedCandleSide(candles, trendPhases, start + offset) === 'sell'
    ));
    const boysSell = windowCandles.every((_, offset) => ksi[start + offset]?.color === COLORS.boysSell);
    const bearishnessSell = windowCandles.every((_, offset) => bearishnessValue(bullishness, start + offset) < 0);
    const bearishPressure = windowCandles.reduce((sum, _, offset) => sum + Math.abs(bearishnessValue(bullishness, start + offset)), 0) / lookback;

    if (!candleColorsSell || !boysSell || !bearishnessSell) return null;

    let cycleStart = start;
    while (cycleStart > 0 && displayedCandleSide(candles, trendPhases, cycleStart - 1) === 'sell') {
      cycleStart -= 1;
    }
    const swingHigh = Math.max(...candles.slice(cycleStart, endIndex + 1).map((item) => item.high));

    return {
      candle,
      index: endIndex,
      atrNow,
      cycleStart,
      swingHigh,
      firstHigh: firstCandle.high,
      setupHigh: Math.max(...windowCandles.map((item) => item.high)),
      setupLow: Math.min(...windowCandles.map((item) => item.low)),
      setupClose: candle.close,
      score: 1 + bearishPressure / 120,
    };
  };

  for (let i = lookback - 1; i < candles.length; i += 1) {
    const setup = getSetup(i);
    if (!setup) continue;

    const triggerIndex = i + 1;
    const candle = candles[triggerIndex];
    if (!candle) continue;

    const atrNow = Math.max(atrValues[triggerIndex] || candle.high - candle.low, Number.EPSILON);
    const pullbackDepth = candle.high - setup.setupClose;
    const breaksFirstCandle = candle.high > setup.firstHigh;
    // Chặn tín hiệu SELL khi sóng giảm đã đi quá xa (dễ bán đáy trước khi đảo chiều).
    const extension = (setup.swingHigh - candle.close) / atrNow;
    const tooExtended = extension > maxExtensionAtr;
    // Chặn tín hiệu SELL nếu ngay tại cây nến kích hoạt, momentum (histogram boys) đã
    // đảo sang xanh — tránh bắn SELL đúng lúc đà giảm vừa gãy.
    const triggerTurnedBullish = ksi[triggerIndex]?.color === COLORS.boysBuy;
    // Chặn tín hiệu SELL nếu lực bán (bearishness) tại cây trigger đã cạn dần so với
    // cây trước — giá vẫn giảm nhưng lực yếu đi là dấu hiệu quá đà, sắp đảo chiều (kiểu
    // "bán đáy" như trong case bị báo lỗi).
    // So với trung bình lực bán của cả 4 cây setup (mượt hơn, tránh bị 1 cây bất
    // thường "cứu" điều kiện) — nếu lực bán tại trigger đã yếu hơn baseline này, coi
    // là đang cạn đà, bất kể cây liền trước nó ra sao.
    const bearishMagnitudeAtTrigger = Math.abs(bearishnessValue(bullishness, triggerIndex));
    const momentumEasing = bearishMagnitudeAtTrigger === 0 || bearishMagnitudeAtTrigger < setup.bearishPressure;
    // Chặn tín hiệu SELL nếu chính cây trigger đã có dấu hiệu bị mua đỡ — đóng cửa trên
    // mở cửa (nến xanh) hoặc bóng dưới dài — đối xứng với check "topping" bên buy.
    const triggerRange = Math.max(candle.high - candle.low, Number.EPSILON);
    const triggerLowerWick = Math.min(candle.open, candle.close) - candle.low;
    const triggerBottomingCandle = candle.close > candle.open || triggerLowerWick / triggerRange >= 0.3;

    if (breaksFirstCandle || tooExtended || triggerTurnedBullish || momentumEasing || triggerBottomingCandle || rawMarkers.some((marker) => marker.cycleStart === setup.cycleStart)) continue;

    rawMarkers.push({
      index: triggerIndex,
      score: setup.score + Math.max(Math.min(pullbackDepth / atrNow, 1), 0),
      time: candle.time,
      price: candle.high + atrNow * 0.08,
      position: 'aboveBar',
      kind: 'sell-arrow',
      color: COLORS.candleDown,
      cycleStart: setup.cycleStart,
      setupFirstHigh: setup.firstHigh,
      setupFirstLow: setup.setupLow,
    });
  }

  return filterConfluenceSpacing(rawMarkers, minGap);
}

function computeAddMarkers(candles, levels, { atrValues, ksi, bullishness, trendPhases }) {
  const minGap = levels.interval === '1d' ? 8 : 10;
  const lookback = levels.interval === '1d' ? 5 : 8;
  const touchRange = clamp(Math.abs(Number(levels.ktrStep || 0)) * 0.12, 0.8, 3.2);
  const rawMarkers = [];
  const addLevels = [
    { name: 'KTR+2', price: levels.ktrPlus2 },
    { name: 'KTR+1', price: levels.ktrPlus1 },
    { name: 'Pivot 02', price: levels.pivot2 },
    { name: 'MLP', price: levels.mlp },
    { name: 'OP', price: levels.op },
    { name: 'Pivot 01', price: levels.pivot1 },
    { name: '30MA', price: levels.ma30 },
    { name: 'KTR-1', price: levels.ktrMinus1 },
    { name: 'KTR-2', price: levels.ktrMinus2 },
  ].filter((item) => Number.isFinite(Number(item.price)));

  const nearestTouchedLevel = (price) => addLevels
    .map((item) => ({ ...item, distance: Math.abs(price - Number(item.price)) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;

  for (let i = lookback; i < candles.length; i += 1) {
    const candle = candles[i];
    const previous = candles[i - 1];
    const atrNow = Math.max(atrValues[i] || candle.high - candle.low, Number.EPSILON);
    const range = Math.max(candle.high - candle.low, Math.abs(candle.close - candle.open), Number.EPSILON);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const recent = candles.slice(Math.max(0, i - lookback), i);
    const buyTrendCount = recent.filter((_, offset) => (
      displayedCandleSide(candles, trendPhases, i - recent.length + offset) === 'buy'
    )).length;
    const sellTrendCount = recent.length - buyTrendCount;
    const buyLevel = nearestTouchedLevel(candle.low);
    const sellLevel = nearestTouchedLevel(candle.high);
    const touchedBuyLevel = Boolean(buyLevel && buyLevel.distance <= touchRange);
    const touchedSellLevel = Boolean(sellLevel && sellLevel.distance <= touchRange);
    const ksiBuy = ksi[i]?.color === COLORS.boysBuy;
    const ksiSell = ksi[i]?.color === COLORS.boysSell;
    const bearishNow = bearishnessValue(bullishness, i);
    const bearishPrev = bearishnessValue(bullishness, i - 1);
    const bearishEasing = bearishNow >= bearishPrev || bearishNow === 0;
    const bearishPressing = bearishNow < 0 || bearishNow < bearishPrev;
    const buyAdd = touchedBuyLevel
      && buyTrendCount >= Math.ceil(recent.length * 0.58)
      && candle.close >= Number(buyLevel.price)
      && (candle.close > candle.open || lowerWick / range >= 0.28 || candle.close > previous.close)
      && ksiBuy
      && bearishEasing;
    const sellAdd = touchedSellLevel
      && sellTrendCount >= Math.ceil(recent.length * 0.58)
      && candle.close <= Number(sellLevel.price)
      && (candle.close < candle.open || upperWick / range >= 0.28 || candle.close < previous.close)
      && ksiSell
      && bearishPressing;

    if (buyAdd) {
      rawMarkers.push({
        index: i,
        score: 1.45 + Math.min(lowerWick / range, 1) + Math.min((touchRange - buyLevel.distance) / atrNow, 0.6),
        time: candle.time,
        price: candle.low - atrNow * 0.08,
        position: 'belowBar',
        kind: 'buy-arrow',
        color: COLORS.blinkGreen,
        label: 'BUY ADD',
        strategy: 'add-pullback',
        strategyLabel: `ADD pullback ${buyLevel.name}`,
        setupFirstLow: Math.min(candle.low, previous.low),
        setupFirstHigh: Math.max(candle.high, previous.high),
      });
    }

    if (sellAdd) {
      rawMarkers.push({
        index: i,
        score: 1.45 + Math.min(upperWick / range, 1) + Math.min((touchRange - sellLevel.distance) / atrNow, 0.6),
        time: candle.time,
        price: candle.high + atrNow * 0.08,
        position: 'aboveBar',
        kind: 'sell-arrow',
        color: COLORS.candleDown,
        label: 'SELL ADD',
        strategy: 'add-pullback',
        strategyLabel: `ADD pullback ${sellLevel.name}`,
        setupFirstHigh: Math.max(candle.high, previous.high),
        setupFirstLow: Math.min(candle.low, previous.low),
      });
    }
  }

  return filterConfluenceSpacing(rawMarkers, minGap);
}

function computeCycleContinuationAddMarkers(candles, levels, { atrValues, ksi, bullishness, trendPhases }) {
  const trendLookback = levels.interval === '1d' ? 5 : 7;
  const pullbackLookback = levels.interval === '1d' ? 2 : 3;
  const minGap = levels.interval === '1d' ? 4 : 5;
  const touchRange = clamp(Math.abs(Number(levels.ktrStep || 0)) * 0.18, 1.1, 4.5);
  const rawMarkers = [];
  const addLevels = [
    { name: 'KTR+3', price: levels.ktrPlus3 },
    { name: 'KTR+2', price: levels.ktrPlus2 },
    { name: 'KTR+1', price: levels.ktrPlus1 },
    { name: 'Pivot 01', price: levels.pivot1 },
    { name: 'MLP', price: levels.mlp },
    { name: 'OP', price: levels.op },
    { name: '30MA', price: levels.ma30 },
    { name: 'KTR-1', price: levels.ktrMinus1 },
    { name: 'KTR-2', price: levels.ktrMinus2 },
    { name: 'KTR-3', price: levels.ktrMinus3 },
    { name: 'Pivot 02', price: levels.pivot2 },
    { name: 'KCB 01', price: levels.kcb01 },
    { name: 'KCB 02', price: levels.kcb02 },
    { name: 'KCB 03', price: levels.kcb03 },
  ].filter((item) => Number.isFinite(Number(item.price)));

  const nearestTouchedLevel = (prices) => {
    let best = null;
    for (const price of prices) {
      if (!Number.isFinite(price)) continue;
      for (const level of addLevels) {
        const distance = Math.abs(price - Number(level.price));
        if (!best || distance < best.distance) best = { ...level, distance };
      }
    }
    return best;
  };

  for (let i = trendLookback + pullbackLookback; i < candles.length; i += 1) {
    const candle = candles[i];
    const previous = candles[i - 1];
    if (!candle || !previous) continue;

    const side = displayedCandleSide(candles, trendPhases, i);
    const isBuy = side === 'buy';
    const sideColor = isBuy ? COLORS.boysBuy : COLORS.boysSell;
    if (candleSide(candle) !== side) continue;

    const trendStart = i - pullbackLookback - trendLookback;
    const pullbackStart = i - pullbackLookback;
    const trendWindow = candles.slice(trendStart, pullbackStart);
    const pullbackWindow = candles.slice(pullbackStart, i);
    if (!trendWindow.length || !pullbackWindow.length) continue;

    const trendCount = trendWindow.filter((_, offset) => (
      displayedCandleSide(candles, trendPhases, trendStart + offset) === side
    )).length;
    const ksiTrendCount = trendWindow.filter((_, offset) => ksi[trendStart + offset]?.color === sideColor).length;
    const oppositePullbacks = pullbackWindow.filter((item) => candleSide(item) !== side);
    if (!oppositePullbacks.length) continue;

    const atrNow = Math.max(atrValues[i] || candle.high - candle.low, Number.EPSILON);
    const range = Math.max(candle.high - candle.low, Math.abs(candle.close - candle.open), Number.EPSILON);
    const lowerWickRatio = (Math.min(candle.open, candle.close) - candle.low) / range;
    const upperWickRatio = (candle.high - Math.max(candle.open, candle.close)) / range;
    const trendLow = Math.min(...trendWindow.map((item) => item.low));
    const trendHigh = Math.max(...trendWindow.map((item) => item.high));
    const pullbackLow = Math.min(...pullbackWindow.map((item) => item.low));
    const pullbackHigh = Math.max(...pullbackWindow.map((item) => item.high));
    const noStructureBreak = isBuy
      ? pullbackLow >= trendLow - atrNow * 0.35
      : pullbackHigh <= trendHigh + atrNow * 0.35;
    const touchedLevel = isBuy
      ? nearestTouchedLevel([pullbackLow, candle.low, Math.min(candle.open, candle.close)])
      : nearestTouchedLevel([pullbackHigh, candle.high, Math.max(candle.open, candle.close)]);
    const nearLevelOk = Boolean(touchedLevel && touchedLevel.distance <= touchRange);
    const reclaimedLevel = Boolean(touchedLevel && (
      isBuy ? candle.close >= Number(touchedLevel.price) : candle.close <= Number(touchedLevel.price)
    ));
    const reactionOk = isBuy
      ? candle.close >= candle.open || candle.close > previous.close || lowerWickRatio >= 0.22
      : candle.close <= candle.open || candle.close < previous.close || upperWickRatio >= 0.22;
    const ksiOk = ksi[i]?.color === sideColor || ksi[i - 1]?.color === sideColor;
    const bearishNow = bearishnessValue(bullishness, i);
    const bearishPrev = bearishnessValue(bullishness, i - 1);
    const pressureOk = isBuy
      ? bearishNow === 0 || bearishNow >= bearishPrev
      : bearishNow < 0 && (bearishNow <= bearishPrev || bearishNow < -120);
    const trendPoint = trendCount >= Math.ceil(trendWindow.length * 0.66)
      && ksiTrendCount >= Math.ceil(trendWindow.length * 0.55);
    const pullbackPoint = noStructureBreak && oppositePullbacks.length >= 1;
    const levelPoint = nearLevelOk && (reclaimedLevel || reactionOk);
    const pressurePoint = ksiOk && pressureOk;
    const triggerPoint = reactionOk && candleSide(candle) === side;
    const confluenceScore = [trendPoint, pullbackPoint, levelPoint, pressurePoint, triggerPoint]
      .filter(Boolean).length;

    if (!trendPoint || !pullbackPoint || !levelPoint || confluenceScore < 3) continue;

    rawMarkers.push({
      index: i,
      score: 2.1 + confluenceScore * 0.24 + Math.max((touchRange - (touchedLevel?.distance || touchRange)) / atrNow, 0),
      time: candle.time,
      price: isBuy ? candle.low - atrNow * 0.1 : candle.high + atrNow * 0.1,
      position: isBuy ? 'belowBar' : 'aboveBar',
      kind: isBuy ? 'buy-arrow' : 'sell-arrow',
      color: isBuy ? COLORS.blinkGreen : COLORS.candleDown,
      label: isBuy ? 'BUY ADD' : 'SELL ADD',
      strategy: 'cycle-continuation-add',
      strategyLabel: `ADD chu kỳ: kéo ngược + hội tụ ${touchedLevel?.name || 'level'}`,
      entry: candle.close,
      setupFirstLow: Math.min(trendLow, pullbackLow, candle.low),
      setupFirstHigh: Math.max(trendHigh, pullbackHigh, candle.high),
    });
  }

  return filterConfluenceSpacing(rawMarkers, minGap);
}

function computeIndicators(candles, levels) {
  const atrValues = atr(candles, 14);
  const closes = candles.map((item) => item.close);
  const emaFast = ema(closes, 8);
  const emaSlow = ema(closes, 21);
  const emaTrigger = ema(closes, 5);
  const trendPhases = computeTrendPhases(candles);

  let previousKsi = 2.2;
  let previousBoysSide = candleSide(candles[0]) === 'buy' ? 'buy' : 'sell';
  const ksi = candles.map((candle, index) => {
    const atrNow = Math.max(atrValues[index], Number.EPSILON);
    const prevTrigger = emaTrigger[index - 1] ?? emaTrigger[index];
    const prevCandle = candles[index - 1] || candle;
    const volAvg = Math.max(sma(candles, 20, index, 'volume'), Number.EPSILON);
    const range = Math.max(candle.high - candle.low, Math.abs(candle.close - candle.open));
    const bodySize = Math.abs(candle.close - candle.open);
    const trend = (emaFast[index] - emaSlow[index]) / atrNow;
    const triggerSlope = (emaTrigger[index] - prevTrigger) / atrNow;
    const volumeRatio = clamp(candle.volume / volAvg, 0.25, 2.8);
    const volumeChange = clamp(candle.volume / Math.max(prevCandle.volume || 1, Number.EPSILON), 0.35, 2.8);
    const rangePower = clamp(range / atrNow, 0.12, 2.85);
    const bodyPower = clamp(bodySize / atrNow, 0, 2.25);
    const closeImpulse = clamp(Math.abs(candle.close - prevCandle.close) / atrNow, 0, 2.45);
    const momentumImpulse = clamp(Math.abs(triggerSlope) * 1.2 + Math.abs(trend) * 0.55, 0, 2.2);
    const volumeImpulse = Math.max(volumeRatio, (volumeRatio + volumeChange) / 2);
    const raw = clamp(
      0.32 +
        volumeImpulse * 0.78 +
        rangePower * 0.72 +
        bodyPower * 0.38 +
        closeImpulse * 0.3 +
        momentumImpulse * 0.18,
      0.25,
      4,
    );
    const value = clamp(lerp(previousKsi, raw, 0.62), 0.25, 4);
    previousKsi = value;
    previousBoysSide = computeBoysSide(candles, index, {
      atrValues,
      emaFast,
      emaSlow,
      emaTrigger,
      previousSide: previousBoysSide,
    });

    return {
      time: candle.time,
      value,
      color: previousBoysSide === 'buy' ? COLORS.boysBuy : COLORS.boysSell,
    };
  });

  const bullishness = candles.map((candle, index) => {
    const atrNow = Math.max(atrValues[index], Number.EPSILON);
    const prevCandle = candles[index - 1] || candle;
    const prevClose = prevCandle.close ?? candle.open;
    const volAvg = Math.max(sma(candles, 20, index, 'volume'), Number.EPSILON);
    const range = Math.max(candle.high - candle.low, Math.abs(candle.close - candle.open), Number.EPSILON);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerClose = (candle.high - candle.close) / range;
    const volumeRatio = clamp(candle.volume / volAvg, 0.35, 2.6);
    const rangePower = clamp(range / atrNow, 0.15, 2.8);
    const trendPressure = clamp((emaSlow[index] - emaFast[index]) / atrNow, -1.6, 2.6);
    const closePressure = clamp((prevClose - candle.close) / atrNow, -1.4, 2.5);
    const positionPressure = clamp((emaFast[index] - candle.close) / atrNow, -1.4, 2.4);
    const wickPressure = clamp(upperWick / atrNow, 0, 1.8);
    const phasePressure = trendPhases[index]?.side === 'sell' ? 0.48 : -0.32;
    const rawPressure =
      trendPressure * 0.95 +
      closePressure * 1.2 +
      positionPressure * 0.72 +
      wickPressure * 0.38 +
      lowerClose * 0.42 +
      phasePressure;
    const activity = 0.78 + volumeRatio * 0.28 + rangePower * 0.24;
    const pressure = rawPressure * activity;
    const value = pressure > 0.2 ? -clamp(pressure * 92 + 42, 40, 400) : 0;
    return {
      time: candle.time,
      value,
      color: COLORS.blue,
    };
  });

  const context = {
    atrValues,
    emaFast,
    emaSlow,
    ksi,
    bullishness,
    trendPhases,
  };
  const diamondMarkers = hideDiamondSignals ? [] : computeDiamondMarkers(candles, levels, context);
  const diamondLine = latestDiamondLineFromMarkers(candles, diamondMarkers);
  const diamondLineTradeMarkers = hideDiamondSignals
    ? []
    : computeDiamondLineTradeMarkers(candles, diamondLine, context);
  const probabilityMarkers = computeHighProbabilityMarkers(candles, levels, context);
  const buyConfluenceMarkers = computeBuyConfluenceMarkers(candles, levels, context);
  const sellConfluenceMarkers = computeSellConfluenceMarkers(candles, levels, context);
  const baseConfluenceMarkers = filterMarkersByOutcomeGap(
    filterMarkersByTrendAndVolatility(
      filterConfluenceSpacing(
        [...probabilityMarkers, ...buyConfluenceMarkers, ...sellConfluenceMarkers],
        levels.interval === '1d' ? 6 : 5,
      ),
      candles,
      context,
    ),
    candles,
  );
  const baseMarkers = [...baseConfluenceMarkers].sort((a, b) => a.index - b.index);
  const tpWindowAddMarkers = hideAddSignals ? [] : computeTpWindowAddMarkers(candles, levels, context, baseMarkers);
  const rawAddMarkers = hideAddSignals ? [] : computeAddMarkers(candles, levels, context);
  const cycleContinuationAddMarkers = hideAddSignals ? [] : computeCycleContinuationAddMarkers(candles, levels, context);
  const trueAddMarkers = hideAddSignals
    ? []
    : [
        ...tpWindowAddMarkers,
        ...cycleContinuationAddMarkers,
        ...filterTpWindowAddSignals(filterTrueAddSignals(rawAddMarkers, baseMarkers), baseMarkers, candles),
      ];
  const confluenceMarkers = mergeTradeMarkers(baseMarkers, trueAddMarkers, levels.interval === '1d' ? 2 : 2);
  const tradeMarkers = [...confluenceMarkers].sort((a, b) => a.index - b.index);
  const visibleTradeMarkers = diamondLine && !hideDiamondSignals
    ? tradeMarkers.filter((marker) => marker.index < diamondLine.index)
    : tradeMarkers;
  const markers = [...diamondMarkers, ...visibleTradeMarkers, ...diamondLineTradeMarkers].sort((a, b) => a.index - b.index);

  return { ksi, bullishness, markers, trendPhases, diamondLine };
}

function makePriceLine(series, price, color, title, lineStyle = LightweightCharts.LineStyle.Solid, lineWidth = 1) {
  if (!Number.isFinite(Number(price))) return null;
  const line = series.createPriceLine({
    price: Number(price),
    color,
    lineWidth,
    lineStyle,
    axisLabelVisible: true,
    title,
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
    const line = makePriceLine(candleSeries, item.price, item.color, item.title, item.style, item.lineWidth || 1);
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

function renderComputed(candles, dailyCandles, shouldFit = false) {
  const levels = computeLevels(candles, dailyCandles);
  const indicators = computeIndicators(candles, levels);
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
  latestMarkers = markers;
  renderDiamondMarkers(markers);
  markerApi?.setMarkers?.([]);
  markerApi = null;
  candleSeries?.setMarkers?.([]);
}

function renderDiamondMarkers(markers = latestMarkers) {
  if (!markerLayer || !chart || !candleSeries) return;
  markerLayer.replaceChildren();

  for (const marker of markers) {
    const x = chart.timeScale().timeToCoordinate(marker.time);
    const y = candleSeries.priceToCoordinate(marker.price);
    if (x === null || y === null) continue;

    const isBuyArrow = marker.kind === 'buy-arrow';
    const isSellArrow = marker.kind === 'sell-arrow';
    const node = document.createElement('div');
    node.className = isBuyArrow
      ? 'buy-arrow-marker'
      : isSellArrow
        ? 'sell-arrow-marker'
        : `diamond-marker ${marker.kind === 'add' ? 'diamond-add' : 'diamond-buy'}`;
    node.style.left = `${x}px`;
    node.style.top = `${y + (isBuyArrow ? 36 : isSellArrow ? -36 : marker.position === 'belowBar' ? 14 : -14)}px`;
    if (isBuyArrow) node.textContent = marker.label || 'BUY';
    if (isSellArrow) node.textContent = marker.label || 'SELL';
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

function nextTelegramSignalNumber() {
  try {
    const current = Number(window.localStorage.getItem('telegramSignalNumber') || '0');
    const next = Number.isFinite(current) ? current + 1 : 1;
    window.localStorage.setItem('telegramSignalNumber', String(next));
    return next;
  } catch (error) {
    return Math.floor(Date.now() / 1000);
  }
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
  const trend = signal.isBuy ? 'Xu hướng Tăng' : 'Xu hướng Giảm';
  const icon = signal.isBuy ? '🟢' : '🔴';
  const vietnameseSide = signal.isBuy ? 'mua' : 'bán';
  return [
    `⚡️ ${tradeLabel}${direction}`,
    trend,
    `${icon} Có thể cân nhắc ${direction} (${vietnameseSide}):  ${formatPrice(signal.entry)}`,
    `📌 Quản trị rủi ro:`,
    `→ Cắt lỗ: ${formatPrice(signal.sl)} ( ${TRADE_SL_MOVE} giá )`,
    `→ TP1: ${formatPrice(signal.tp1)} ( ${TRADE_TP_MIN_MOVE} giá từ entry )`,
    `→ TP2: ${formatPrice(signal.tp2)} ( 10 giá từ entry )`,
    `→ TP3: ${formatPrice(signal.tp3)} ( ${TRADE_TP_MAX_MOVE} giá từ entry )`,
    ``,
    `⚠️ Lưu ý:`,
    `Đây là góc nhìn cá nhân, không phải khuyến nghị đầu tư.`,
    `Anh/chị tự chịu trách nhiệm với quyết định giao dịch.`,
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
    `Entry: ${formatPrice(signal.entry)} (Market)`,
    `SL: ${formatPrice(signal.sl)}`,
    `TP: ${formatPrice(signal.tp1)}`,
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
      `🔒 Cân nhắc chốt một phần hoặc kéo cắt lỗ về điểm vào: ${formatPrice(signal.entry)}`,
    ].join('\n')
    : resultText === 'TP2'
      ? [
        targetProfit,
        `📍 Cân nhắc chốt thêm một phần, phần còn lại quan sát TP3: ${formatPrice(signal.tp3)}`,
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
    `Entry: ${formatPrice(signal.entry)}`,
    `Thời gian mở: ${formatTelegramTime(signal.time)}`,
    `Thời gian đóng: ${formatTelegramTime()}`,
    `${isWin ? resultText : isBreakEven ? 'Hòa vốn' : 'SL'}: ${formatPrice(targetPrice)}`,
    `Giá hiện tại: ${formatPrice(price)}`,
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
    return true;
  } catch (error) {
    console.warn(error);
    el.status.textContent = `Telegram lỗi: ${error.message}`;
    return false;
  }
}

async function activateTelegramSignal(signal, levels) {
  telegramSignalStates = loadTelegramSignalStates();
  const existingSignal = telegramSignalStates.find((item) => item.id === signal.id && !item.closed);
  if (existingSignal) {
    await checkTelegramSignalPrice(levels.price);
    return;
  }
  await checkTelegramSignalPrice(levels.price);

  const openSignals = telegramSignalStates.filter((item) => item && !item.closed);
  if (openSignals.length >= TELEGRAM_SIGNAL_MAX_OPEN) {
    el.status.textContent = `Đang có ${TELEGRAM_SIGNAL_MAX_OPEN} kèo ${formatIntervalLabel(TELEGRAM_AUTO_INTERVAL)} mở, tạm dừng bắn kèo mới.`;
    saveTelegramSignalStates();
    return;
  }

  const number = nextTelegramSignalNumber();
  const nextSignalState = {
    ...signal,
    number,
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
  if (!sent) return;
  telegramSignalStates = [
    ...openSignals,
    nextSignalState,
  ];
  saveTelegramSignalStates();
  checkTelegramSignalPrice(levels.price);
}

function telegramTargetLevels(signal) {
  return [
    { key: 'tp1', name: 'TP1', price: Number(signal.tp1) },
    { key: 'tp2', name: 'TP2', price: Number(signal.tp2) },
    { key: 'tp3', name: 'TP3', price: Number(signal.tp3) },
  ].filter((target) => Number.isFinite(target.price));
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
        signal.tpHits = Array.isArray(signal.tpHits) ? signal.tpHits : [];

        const hitSl = signal.isBuy ? currentPrice <= Number(signal.sl) : currentPrice >= Number(signal.sl);
        if (hitSl) {
          const isBreakEven = signal.breakEvenMoved && Math.abs(Number(signal.sl) - Number(signal.entry)) < 0.000001;
          const result = isBreakEven ? 'BE' : 'SL';
          const sent = await notifyTelegramTradeResult(signal, result, currentPrice);
          if (!sent) continue;

          signal.closed = true;
          signal.closedAt = Date.now();
          changed = true;
          continue;
        }

        for (const target of telegramTargetLevels(signal)) {
          if (signal.tpHits.includes(target.name)) continue;
          const hitTp = signal.isBuy ? currentPrice >= target.price : currentPrice <= target.price;
          if (!hitTp) continue;

          const sent = await notifyTelegramTradeResult(signal, target.name, currentPrice);
          if (!sent) break;

          signal.tpHits.push(target.name);
          if (target.name === 'TP1') {
            signal.originalSl = Number.isFinite(Number(signal.originalSl)) ? signal.originalSl : signal.sl;
            signal.sl = signal.entry;
            signal.breakEvenMoved = true;
          }
          if (target.name === 'TP3') {
            signal.closed = true;
            signal.closedAt = Date.now();
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
  const sl = isBuy ? entry - TRADE_SL_MOVE : entry + TRADE_SL_MOVE;
  const tp1 = isBuy ? entry + TRADE_TP_MIN_MOVE : entry - TRADE_TP_MIN_MOVE;
  const tp2 = isBuy ? entry + 10 : entry - 10;
  const tp3 = isBuy ? entry + TRADE_TP_MAX_MOVE : entry - TRADE_TP_MAX_MOVE;
  const risk = Math.abs(entry - sl);
  const near = nearestLevel(levels);
  const diamondLineNote = Number.isFinite(Number(tradeMarker.diamondLinePrice))
    ? `→ DL Kim Cương mới nhất: ${formatPrice(tradeMarker.diamondLinePrice)}${tradeMarker.diamondStackCount >= 3 ? ` | Tích lũy ${tradeMarker.diamondStackCount} kim cương` : ''}`
    : '';
  const entryZone = entryZoneText(entry, isBuy);
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
    entry,
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
    el.signalNotice.classList.add('hidden');
    if (el.sendTelegram) el.sendTelegram.disabled = true;
    return;
  }

  el.signalNotice.classList.toggle('hidden', signalNoticeCollapsed);
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
    signalDetectionReady = true;
    syncSignalToggle(false);
    return;
  }

  const isNewSignal = signalDetectionReady && latestSignalId !== signal.id;
  const isAutoTelegramInterval = levels.interval === TELEGRAM_AUTO_INTERVAL;
  latestSignalId = signal.id;
  latestSignalCopy = signal.copy;
  latestSignalTelegram = { signal, levels };
  signalDetectionReady = true;

  el.signalNotice.classList.remove('hidden', 'signal-buy', 'signal-sell', 'signal-pulse');
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
    if (isAutoTelegramInterval) {
      activateTelegramSignal(signal, levels);
    }
  }

  checkTelegramSignalPrice(levels.price);
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

function renderLiveCandle(candle, price) {
  queuedLiveCandle = candle;
  queuedLivePrice = price;

  if (liveRenderFrame) return;
  liveRenderFrame = window.requestAnimationFrame(() => {
    liveRenderFrame = 0;
    if (queuedLiveCandle) {
      const livePhases = computeTrendPhases(currentCandles);
      candleSeries?.update(colorCandle(queuedLiveCandle, livePhases.at(-1)));
    }
    updateLivePriceLine(queuedLivePrice);
    queuedLiveCandle = null;
    queuedLivePrice = null;
  });
}

function scheduleFullRender(delayMs = 450) {
  window.clearTimeout(fullRenderTimer);
  fullRenderTimer = window.setTimeout(() => {
    if (!currentCandles.length || !currentDailyCandles.length) return;
    renderComputed(currentCandles, currentDailyCandles, false);
  }, delayMs);
}

function maybeRefreshComputed(maxAgeMs = 2500) {
  if (performance.now() - lastFullRenderAt >= maxAgeMs) {
    scheduleFullRender(0);
  }
}

function alignCandleTime(timestampSeconds, interval) {
  const step = Math.floor((intervalMs[interval] || intervalMs['1m']) / 1000);
  return Math.floor(timestampSeconds / step) * step;
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
      tickPollTimer = window.setTimeout(poll, pollMs);
    }
  };

  poll();
}

function startFinnhubStream(symbol, interval, limit, token) {
  closeLiveSocket();
  const finnhubSymbol = toFinnhubSymbol(symbol);
  liveSocket = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(token)}`);

  liveSocket.onopen = () => {
    liveSocket.send(JSON.stringify({ type: 'subscribe', symbol: finnhubSymbol }));
    el.status.textContent = `${symbol} ${interval} FINNHUB TICK`;
  };

  liveSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'trade' || !Array.isArray(message.data)) return;
    const lastTick = message.data.at(-1);
    const price = Number(lastTick?.p);
    if (!Number.isFinite(price)) return;

    const candle = updateCurrentPrice(price, interval, limit, Math.floor(Number(lastTick.t || Date.now()) / 1000));
    if (candle) renderLiveCandle(candle, price);
    maybeRefreshComputed(1800);
    el.status.textContent = `${symbol} FINNHUB ${formatPrice(price)}`;
  };

  liveSocket.onerror = () => {
    el.status.textContent = `${symbol} ${interval} Finnhub socket lá»—i, Ä‘ang poll dá»± phÃ²ng`;
    startTickerFallback('finnhub', symbol, interval, limit, token);
  };

  liveSocket.onclose = () => {
    liveSocket = null;
    if (!tickPollTimer) startTickerFallback('finnhub', symbol, interval, limit, token);
  };
}

function fallbackToYahoo(sourceName, symbol, interval, limit, reason = '') {
  closeLiveSocket();
  const detail = reason ? ` (${reason})` : '';
  el.status.textContent = `${sourceName} het quota/loi${detail}, chuyen sang Yahoo fallback`;
  startTickerFallback('yahoo', symbol, interval, limit);
}

function startTwelveDataStream(symbol, interval, limit, token) {
  closeLiveSocket();
  const tdSymbol = toTwelveDataSymbol(symbol);
  liveSocket = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(token)}`);

  liveSocket.onopen = () => {
    liveSocket.send(JSON.stringify({
      action: 'subscribe',
      params: { symbols: tdSymbol },
    }));
    socketHeartbeatTimer = window.setInterval(() => {
      if (liveSocket?.readyState === WebSocket.OPEN) {
        liveSocket.send(JSON.stringify({ action: 'heartbeat' }));
      }
    }, 10_000);
    el.status.textContent = `${symbol} ${interval} TWELVEDATA TICK`;
  };

  liveSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.status === 'error' || message.event === 'error' || message.code === 429) {
      fallbackToYahoo('TwelveData', symbol, interval, limit, message.message || message.code || 'stream error');
      return;
    }

    if (message.event === 'subscribe-status' && message.status && message.status !== 'ok') {
      fallbackToYahoo('TwelveData', symbol, interval, limit, message.message || message.status);
      return;
    }

    const price = Number(message.price ?? message.p ?? message.value);
    if (!Number.isFinite(price)) return;

    const timestampMs = Number(message.timestamp ? message.timestamp * 1000 : Date.now());
    const candle = updateCurrentPrice(price, interval, limit, Math.floor(timestampMs / 1000));
    if (candle) renderLiveCandle(candle, price);
    maybeRefreshComputed(1800);
    el.status.textContent = `${symbol} TWELVEDATA ${formatPrice(price)}`;
  };

  liveSocket.onerror = () => {
    fallbackToYahoo('TwelveData', symbol, interval, limit, 'socket loi');
  };

  liveSocket.onclose = () => {
    window.clearInterval(socketHeartbeatTimer);
    socketHeartbeatTimer = null;
    liveSocket = null;
    if (!tickPollTimer) startTickerFallback('yahoo', symbol, interval, limit);
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

function startLiveStream(source, symbol, interval, limit, token) {
  if (source === 'binance') {
    startBinanceStream(symbol, interval, limit);
    return;
  }

  if (source === 'finnhub' && token) {
    startFinnhubStream(symbol, interval, limit, token);
    return;
  }

  if (source === 'twelvedata' && token) {
    startTwelveDataStream(symbol, interval, limit, token);
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
  const sourceNote = source === 'yahoo'
    ? 'Yahoo fallback data, delayed'
    : source === 'twelvedata'
      ? 'TwelveData live data'
      : `${source} data`;
  el.status.textContent = `Loading ${symbol} ${interval} ${sourceNote}...`;
  el.reload.disabled = true;
  closeLiveSocket();
  window.clearInterval(refreshTimer);
  latestSignalId = '';
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
      if (source !== 'twelvedata' || !isTwelveDataLimitError(error)) throw error;
      console.warn(error);
      activeSource = 'yahoo';
      activeToken = '';
      el.status.textContent = `TwelveData het quota/loi, dang chuyen ${symbol} sang Yahoo fallback...`;
      [candles, dailyCandles] = await Promise.all([
        fetchMarketCandles(activeSource, symbol, interval, limit, activeToken),
        fetchMarketDaily(activeSource, symbol, activeToken),
      ]);
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
          activeSource = 'yahoo';
          activeToken = '';
          currentDailyCandles = await fetchMarketDaily(activeSource, symbol, activeToken);
          fallbackToYahoo('TwelveData', symbol, interval, limit, error.message);
          return;
        }
        throw error;
      }
    }, Math.max(intervalMs[interval] || 60_000, 60_000));
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

window.addEventListener('resize', () => {
  chart?.applyOptions({
    width: el.chart.clientWidth,
    height: el.chart.clientHeight,
  });
  renderLevelBadges(latestLevelItems);
  renderDiamondMarkers();
  renderDrawings();
});

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

function setSignalFilterMenuOpen(open) {
  el.signalFilterMenu?.classList.toggle('hidden', !open);
  el.signalFilterButton?.parentElement?.classList.toggle('open', open);
  el.signalFilterButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
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
  setAdvancedControlsOpen(el.advancedControlsPanel?.classList.contains('hidden'));
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
  if (el.source.value === 'finnhub' || el.source.value === 'twelvedata') loadChart();
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
  if (!username || !password) {
    el.loginError.textContent = 'Nhap tai khoan va mat khau.';
    return;
  }

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
  showLogin('Da dang xuat.');
});

el.kickLoginAgain?.addEventListener('click', () => {
  el.sessionKickNotice?.classList.add('hidden');
  showLogin('Dang nhap lai de tiep tuc.');
});

el.adminButton?.addEventListener('click', async () => {
  el.adminPanel?.classList.remove('hidden');
  await loadAdminPanel();
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
    const password = window.prompt('Nhap mat khau moi (toi thieu 4 ky tu):');
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




















