// frontend/src/services/acousticDetectorService.js
// Real-time browser-based acoustic crisis detection using Web Audio API.
//
// v2 — Refactored for false-positive elimination:
//   1. Dynamic 2.5s ambient noise calibration on startup
//   2. All thresholds are RELATIVE to calibrated noise floor
//   3. Stricter spike requirements (+25 dB above baseline)
//   4. Confidence threshold raised to 0.88
//   5. Multi-hit: 2 hits / 2s OR 3 hits / 4s
//   6. 10-second cooldown after confirmed dispatch
//   7. Temporal analysis for scream sustain (300ms) & gunshot fast-rise (<50ms)

const CONFIDENCE_THRESHOLD = 0.90;
const SPIKE_DB_ABOVE_BASELINE = 30;       // dB above dynamic baseline to even consider
const SCREAM_DB_ABOVE_BASELINE = 25;      // sustained mid-range requirement
const CALIBRATION_DURATION_MS = 2500;     // initial ambient measurement
const CALIBRATION_SAMPLE_INTERVAL = 50;   // sample every 50ms during calibration
const ANALYSIS_INTERVAL_MS = 50;          // run classifier every 50ms for temporal resolution
const ROLLING_WINDOW_SIZE = 40;           // ~2s rolling average at 50ms intervals
const COOLDOWN_MS = 15000;                // prevent duplicate cascading
const SCREAM_SUSTAIN_MS = 300;            // scream must persist this long

// Multi-hit: 2 consecutive in 2s OR 3 in 4s
const HIT_CONFIG = { fast: { count: 2, window: 2000 }, slow: { count: 3, window: 4000 } };

// ── Internal state ──────────────────────────────────────────────
let audioContext = null;
let analyserNode = null;
let mediaStream = null;
let analysisTimer = null;
let isRunning = false;
let isCalibrating = false;
let onStatusChange = null;  // callback for UI status updates

// Calibration state
let calibrationSamples = [];
let baselineDb = 0;
let noiseFloorStdDev = 0;

// Rolling average for live amplitude tracking
let rollingDbValues = [];

// Hit tracking
let hitLog = [];   // Array of { label, confidence, time }
let lastFiredTime = 0;

// Temporal tracking for sustained sounds (screams)
let sustainTracker = { label: null, startTime: 0, peakConfidence: 0, frameCount: 0 };

// ── Utility: convert FFT byte values to approximate dB ──────────
function byteToDb(value) {
  // Uint8 0-255 maps roughly to -100dB to 0dB
  return value > 0 ? -100 + (value / 255) * 100 : -100;
}

function dbFromBytes(freqData) {
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) sum += freqData[i];
  const avgByte = sum / freqData.length;
  return byteToDb(avgByte);
}

function peakDb(freqData) {
  let max = 0;
  for (let i = 0; i < freqData.length; i++) {
    if (freqData[i] > max) max = freqData[i];
  }
  return byteToDb(max);
}

// ── Frequency band energy (in dB) ──────────────────────────────
function bandEnergyDb(freqData, sampleRate, fftSize, lowHz, highHz) {
  const binWidth = sampleRate / fftSize;
  const startBin = Math.max(0, Math.floor(lowHz / binWidth));
  const endBin = Math.min(freqData.length - 1, Math.ceil(highHz / binWidth));
  let sum = 0;
  let count = 0;
  for (let i = startBin; i <= endBin; i++) {
    sum += freqData[i];
    count++;
  }
  return count > 0 ? byteToDb(sum / count) : -100;
}

// ── Calibration ─────────────────────────────────────────────────
function runCalibration(freqData) {
  const db = dbFromBytes(freqData);
  calibrationSamples.push(db);
}

function finalizeCalibration() {
  if (calibrationSamples.length === 0) {
    baselineDb = -60;
    noiseFloorStdDev = 5;
    return;
  }
  const mean = calibrationSamples.reduce((a, b) => a + b, 0) / calibrationSamples.length;
  const variance = calibrationSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / calibrationSamples.length;
  baselineDb = mean;
  noiseFloorStdDev = Math.sqrt(variance);
  console.log(`[AcousticDetector] Calibration complete: baseline=${baselineDb.toFixed(1)}dB, stdDev=${noiseFloorStdDev.toFixed(1)}dB, samples=${calibrationSamples.length}`);
}

// ── Heuristic classifier (relative to calibrated baseline) ──────
function classifyFrame(freqData, sampleRate, fftSize) {
  const currentDb = dbFromBytes(freqData);
  const currentPeakDb = peakDb(freqData);
  const spikeAboveBaseline = currentPeakDb - baselineDb;

  // Update rolling dB for live tracking
  rollingDbValues.push(currentDb);
  if (rollingDbValues.length > ROLLING_WINDOW_SIZE) rollingDbValues.shift();

  // Gate: must exceed baseline by SPIKE_DB_ABOVE_BASELINE to even consider
  if (spikeAboveBaseline < SPIKE_DB_ABOVE_BASELINE) {
    // Reset sustain tracker if noise drops
    sustainTracker = { label: null, startTime: 0, peakConfidence: 0, frameCount: 0 };
    return null;
  }

  // Band energies relative to baseline
  const lowMidDb = bandEnergyDb(freqData, sampleRate, fftSize, 100, 800);
  const midDb = bandEnergyDb(freqData, sampleRate, fftSize, 1500, 4000);
  const highDb = bandEnergyDb(freqData, sampleRate, fftSize, 4000, 8000);
  const broadDb = bandEnergyDb(freqData, sampleRate, fftSize, 100, 8000);

  const lowMidSpike = lowMidDb - baselineDb;
  const midSpike = midDb - baselineDb;
  const highSpike = highDb - baselineDb;
  const broadSpike = broadDb - baselineDb;

  // Check for recent rapid rise (fast transient detection for gunshot/explosion)
  const recentWindow = rollingDbValues.slice(-1); // last ~50ms
  const olderWindow = rollingDbValues.slice(-4, -1); // previous ~150ms
  const recentAvg = recentWindow.length > 0 ? recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length : -100;
  const olderAvg = olderWindow.length > 0 ? olderWindow.reduce((a, b) => a + b, 0) / olderWindow.length : baselineDb;
  const riseRate = recentAvg - olderAvg; // dB rise in ~50ms vs previous ~150ms

  // ── GUNSHOT: ultra-fast broadband transient, rapid rise ──────
  // Time domain peak saturation check
  let maxByte = 0;
  for (let i = 0; i < freqData.length; i++) {
    if (freqData[i] > maxByte) maxByte = freqData[i];
  }
  const peakSaturation = maxByte >= 240;

  if (spikeAboveBaseline > 38 && highSpike > 28 && broadSpike > 32 && riseRate > 20 && peakSaturation) {
    const confidence = Math.min(0.98, 0.85 + (spikeAboveBaseline - 38) * 0.005 + (riseRate - 20) * 0.005);
    return { label: 'gunshot', confidence };
  }

  // ── EXPLOSION: massive broadband, dominant low, fast rise ────
  if (spikeAboveBaseline > 35 && lowMidSpike > 28 && broadSpike > 26 && riseRate > 16) {
    const confidence = Math.min(0.97, 0.82 + (lowMidSpike - 28) * 0.006 + (riseRate - 16) * 0.005);
    return { label: 'explosion', confidence };
  }

  // ── SCREAM: sustained mid-frequency peak, must persist 300ms ─
  if (midSpike > SCREAM_DB_ABOVE_BASELINE && midSpike > lowMidSpike * 0.8 && midSpike > highSpike * 0.6) {
    const now = Date.now();
    if (sustainTracker.label === 'scream') {
      sustainTracker.frameCount++;
      sustainTracker.peakConfidence = Math.max(sustainTracker.peakConfidence,
        Math.min(0.96, 0.78 + (midSpike - SCREAM_DB_ABOVE_BASELINE) * 0.008));
      const sustained = now - sustainTracker.startTime;
      if (sustained >= SCREAM_SUSTAIN_MS) {
        const result = { label: 'scream', confidence: sustainTracker.peakConfidence };
        // Don't reset — allow continued sustain to generate more hits
        return result;
      }
    } else {
      sustainTracker = { label: 'scream', startTime: now, peakConfidence: 0, frameCount: 1 };
    }
    return null; // Not yet sustained long enough
  }

  // ── CRASH: low-mid spike with energy saturation ──────────────
  if (spikeAboveBaseline > 30 && lowMidSpike > 25 && highSpike > 10 && riseRate > 12) {
    const confidence = Math.min(0.95, 0.76 + (lowMidSpike - 25) * 0.007 + (spikeAboveBaseline - 30) * 0.004);
    return { label: 'crash', confidence };
  }

  // Reset sustain if no scream pattern matched
  if (sustainTracker.label === 'scream') {
    sustainTracker = { label: null, startTime: 0, peakConfidence: 0, frameCount: 0 };
  }

  return null;
}

// ── Multi-hit verification ──────────────────────────────────────
function checkConfirmation(result, onCrisisDetected) {
  if (!result || result.confidence < CONFIDENCE_THRESHOLD) return;

  const now = Date.now();

  // Cooldown check
  if (now - lastFiredTime < COOLDOWN_MS) return;

  // Log this hit
  hitLog.push({ label: result.label, confidence: result.confidence, time: now });

  // Prune old hits (older than slow window)
  hitLog = hitLog.filter(h => now - h.time < HIT_CONFIG.slow.window);

  // Check fast path: 2 same-label hits within 2s
  const sameLabel = hitLog.filter(h => h.label === result.label);
  const recentSame = sameLabel.filter(h => now - h.time < HIT_CONFIG.fast.window);
  if (recentSame.length >= HIT_CONFIG.fast.count) {
    fireConfirmed(result, onCrisisDetected, now);
    return;
  }

  // Check slow path: 3 same-label hits within 4s
  if (sameLabel.length >= HIT_CONFIG.slow.count) {
    fireConfirmed(result, onCrisisDetected, now);
    return;
  }
}

function fireConfirmed(result, onCrisisDetected, now) {
  console.log(`[AcousticDetector] ✅ CONFIRMED: ${result.label} (${(result.confidence * 100).toFixed(0)}%) — spike ${(peakDb(lastFreqData) - baselineDb).toFixed(1)}dB above baseline`);
  lastFiredTime = now;
  hitLog = [];
  sustainTracker = { label: null, startTime: 0, peakConfidence: 0, frameCount: 0 };

  onCrisisDetected({
    label: result.label,
    confidence: result.confidence,
    timestamp: new Date().toISOString(),
    spikeDb: lastFreqData ? +(peakDb(lastFreqData) - baselineDb).toFixed(1) : 0,
    baselineDb: +baselineDb.toFixed(1),
  });

  // Pause analysis during cooldown
  if (analysisTimer) {
    clearInterval(analysisTimer);
    analysisTimer = null;
    if (onStatusChange) onStatusChange('cooldown');
    setTimeout(() => {
      if (isRunning) {
        startAnalysisLoop(onCrisisDetected);
        if (onStatusChange) onStatusChange('listening');
      }
    }, COOLDOWN_MS);
  }
}

// ── Analysis loop ───────────────────────────────────────────────
let lastFreqData = null;

function startAnalysisLoop(onCrisisDetected) {
  if (analysisTimer) clearInterval(analysisTimer);

  const freqData = new Uint8Array(analyserNode.frequencyBinCount);
  const sampleRate = audioContext.sampleRate;
  const fftSize = analyserNode.fftSize;

  analysisTimer = setInterval(() => {
    if (!isRunning || !analyserNode) return;
    analyserNode.getByteFrequencyData(freqData);
    lastFreqData = freqData;
    const result = classifyFrame(freqData, sampleRate, fftSize);
    checkConfirmation(result, onCrisisDetected);
  }, ANALYSIS_INTERVAL_MS);
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Start the acoustic detector with dynamic ambient calibration.
 * @param {Function} onCrisisDetected — called with { label, confidence, timestamp, spikeDb, baselineDb }
 * @param {Function} [statusCallback] — called with status string changes
 * @returns {Promise<void>}
 */
export async function startDetector(onCrisisDetected, statusCallback) {
  if (isRunning) {
    console.warn('[AcousticDetector] Already running');
    return;
  }

  onStatusChange = statusCallback || null;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('[AcousticDetector] Mic permission denied:', err.message);
    throw new Error('MIC_DENIED');
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 2048;
  analyserNode.smoothingTimeConstant = 0.3;

  const source = audioContext.createMediaStreamSource(mediaStream);
  source.connect(analyserNode);

  // Reset all state
  calibrationSamples = [];
  rollingDbValues = [];
  hitLog = [];
  lastFiredTime = 0;
  sustainTracker = { label: null, startTime: 0, peakConfidence: 0, frameCount: 0 };
  lastFreqData = null;
  isRunning = true;
  isCalibrating = true;

  if (onStatusChange) onStatusChange('calibrating');
  console.log('[AcousticDetector] Starting ambient noise calibration...');

  // ── Calibration phase: sample ambient noise for 2.5s ──────
  const freqData = new Uint8Array(analyserNode.frequencyBinCount);
  const calibTimer = setInterval(() => {
    if (!isRunning || !analyserNode) return;
    analyserNode.getByteFrequencyData(freqData);
    runCalibration(freqData);
  }, CALIBRATION_SAMPLE_INTERVAL);

  await new Promise(resolve => setTimeout(resolve, CALIBRATION_DURATION_MS));

  clearInterval(calibTimer);
  finalizeCalibration();
  isCalibrating = false;

  if (!isRunning) return; // stopped during calibration

  if (onStatusChange) onStatusChange('listening');
  startAnalysisLoop(onCrisisDetected);
  console.log('[AcousticDetector] Now actively listening for emergency sounds');
}

/**
 * Stop the acoustic detector and clean up all resources.
 */
export function stopDetector() {
  isRunning = false;
  isCalibrating = false;

  if (analysisTimer) {
    clearInterval(analysisTimer);
    analysisTimer = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  analyserNode = null;
  calibrationSamples = [];
  rollingDbValues = [];
  hitLog = [];
  sustainTracker = { label: null, startTime: 0, peakConfidence: 0, frameCount: 0 };
  lastFreqData = null;
  onStatusChange = null;

  console.log('[AcousticDetector] Stopped — all resources released');
}

/**
 * Get the current AnalyserNode for external visualizers.
 */
export function getAnalyserNode() {
  return isRunning ? analyserNode : null;
}

/**
 * Get the calibrated noise floor baseline (in dB) for visualizer threshold line.
 * Returns null if not calibrated yet.
 */
export function getNoiseFloor() {
  if (isCalibrating || baselineDb === 0) return null;
  return {
    baselineDb,
    stdDev: noiseFloorStdDev,
    // The activation threshold in byte value (0-255) for the canvas
    thresholdByte: Math.min(255, Math.max(0, Math.round(((baselineDb + SPIKE_DB_ABOVE_BASELINE + 100) / 100) * 255))),
  };
}

/**
 * Check if the detector is currently active.
 */
export function isDetectorRunning() {
  return isRunning;
}

/**
 * Check if the detector is in calibration phase.
 */
export function isDetectorCalibrating() {
  return isCalibrating;
}
