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

const CRAZII_LEVEL_RATIOS = {
  pivot1: -0.47,
  ma30Fallback: -0.6208,
  mlp: 0.3622,
  kcb01: -4.25,
  kcb02: -5.11855357,
  pivot2: 1.2286,
  kcb03: -7.13861742,
};

const ADD_SIGNAL_TP_MIN_MOVE = 5;
const ADD_SIGNAL_TP_MAX_MOVE = 10;
const TRADE_SL_MOVE = 11;
const TRADE_TP_MAX_MOVE = 15;
const BEARISHNESS_SCALE = { min: -420, max: 20, extreme: -300 };
let hideDiamondSignals = false;
let hideProbabilitySignals = false;
let hideAddSignals = false;

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

function quantizePrice(value) {
  if (!Number.isFinite(value)) return value;
  if (value >= 1000) return Number(value.toFixed(2));
  if (value >= 10) return Number(value.toFixed(3));
  return Number(value.toFixed(5));
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
    return { side, score, color: side === 'buy' ? COLORS.candleUp : COLORS.candleDown };
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
  const pressure = closeMove * 1.35 + triggerSlope * 2.2 + trend * 0.95 + closeVsTrigger * 0.65 + body * 0.35;
  if (pressure > 0.18) return 'buy';
  if (pressure < -0.18) return 'sell';
  return previousSide;
}

function trueRange(candle, prevClose) {
  if (!prevClose) return candle.high - candle.low;
  return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose));
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


function resolveOpOffset(rawOp, offset = 0) {
  const value = Number(offset);
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) >= 100 && Number.isFinite(rawOp) ? value - rawOp : value;
}

function computeLevels(candles, dailyCandles, interval = '5m', opOffset = 0) {
  const last = candles.at(-1);
  const chartInterval = String(interval || '5m');
  const day = localDayKey(last.time);
  const firstOfDay = candles.find((item) => localDayKey(item.time) === day) || candles[0];
  const currentDaily = dailyCandles.find((item) => localDayKey(item.time) === day) || dailyCandles.at(-1);
  const rawOp = quantizePrice(currentDaily?.open || firstOfDay.open);
  const resolvedOpOffset = resolveOpOffset(rawOp, opOffset);
  const op = quantizePrice(rawOp + resolvedOpOffset);
  const ktrStep = op * 0.004;
  const ratioLevel = (ratio) => quantizePrice(op + ktrStep * ratio);
  const dailyCloses = dailyCandles.map((item) => item.close).filter(Number.isFinite);
  const ma200 = dailyCloses.length >= 200
    ? quantizePrice(average(dailyCloses.slice(-200)))
    : null;

  return {
    interval: chartInterval,
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

function computeIndicators(candles, levels, options = {}) {
  hideDiamondSignals = options.hideDiamondSignals === true;
  hideProbabilitySignals = options.hideProbabilitySignals === true;
  hideAddSignals = options.hideAddSignals === true;
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


module.exports = { computeLevels, computeIndicators, formatPrice };

