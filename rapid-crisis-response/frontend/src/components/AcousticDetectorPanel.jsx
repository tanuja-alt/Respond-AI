// frontend/src/components/AcousticDetectorPanel.jsx
// Toggle + real-time waveform visualizer + noise floor threshold line + detection status.
// v2 — Updated for dynamic calibration service API.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  startDetector,
  stopDetector,
  getAnalyserNode,
  getNoiseFloor,
} from '../services/acousticDetectorService';

const BAR_COUNT = 48;
const CANVAS_HEIGHT = 72;

export default function AcousticDetectorPanel({ enabled, onToggle, onCrisisDetected }) {
  const { t } = useTranslation();
  // 'off' | 'calibrating' | 'listening' | 'detected' | 'cooldown' | 'error'
  const [status, setStatus] = useState('off');
  const [lastDetection, setLastDetection] = useState(null);
  const [micError, setMicError] = useState(false);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const detectionTimerRef = useRef(null);

  // Waveform drawing loop — draws bars + noise floor threshold line
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = getAnalyserNode();
    if (!canvas || !analyser) {
      animFrameRef.current = requestAnimationFrame(drawWaveform);
      return;
    }

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    ctx.clearRect(0, 0, width, height);

    // ── Draw frequency bars ──
    const step = Math.floor(freqData.length / BAR_COUNT);
    const barWidth = (width / BAR_COUNT) - 1;

    for (let i = 0; i < BAR_COUNT; i++) {
      const value = freqData[i * step];
      const barHeight = (value / 255) * height;

      // Color gradient: low=teal → mid=amber → high=red
      const ratio = value / 255;
      let r, g, b;
      if (ratio < 0.5) {
        const t2 = ratio * 2;
        r = Math.round(16 + (245 - 16) * t2);
        g = Math.round(185 + (158 - 185) * t2);
        b = Math.round(129 + (11 - 129) * t2);
      } else {
        const t2 = (ratio - 0.5) * 2;
        r = Math.round(245 + (226 - 245) * t2);
        g = Math.round(158 + (75 - 158) * t2);
        b = Math.round(11 + (74 - 11) * t2);
      }

      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.fillRect(i * (barWidth + 1), height - barHeight, barWidth, barHeight);
    }

    // ── Draw noise floor threshold line ──
    const noiseFloor = getNoiseFloor();
    if (noiseFloor) {
      const thresholdY = height - (noiseFloor.thresholdByte / 255) * height;
      ctx.strokeStyle = 'rgba(226,75,74,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(width, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = 'rgba(226,75,74,0.7)';
      ctx.font = '9px DM Sans, sans-serif';
      ctx.fillText('THRESHOLD', width - 62, thresholdY - 3);
    }

    animFrameRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  // Handle toggle on/off
  useEffect(() => {
    if (enabled) {
      setMicError(false);
      setStatus('calibrating');
      setLastDetection(null);

      const handleDetection = (detection) => {
        setStatus('detected');
        setLastDetection(detection);
        onCrisisDetected(detection);

        // Flash "DETECTED" for 5s, then service cooldown callback will set 'listening'
        clearTimeout(detectionTimerRef.current);
        detectionTimerRef.current = setTimeout(() => {
          setStatus('listening');
        }, 5000);
      };

      // Status callback from the service (calibrating → listening → cooldown → listening)
      const handleStatusChange = (newStatus) => {
        setStatus(newStatus);
      };

      startDetector(handleDetection, handleStatusChange)
        .then(() => {
          // Waveform animation starts immediately (even during calibration)
          animFrameRef.current = requestAnimationFrame(drawWaveform);
        })
        .catch((err) => {
          if (err.message === 'MIC_DENIED') {
            setMicError(true);
            setStatus('error');
            onToggle(false);
          }
        });
    } else {
      stopDetector();
      setStatus('off');
      setLastDetection(null);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }

    return () => {
      clearTimeout(detectionTimerRef.current);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [enabled, onCrisisDetected, onToggle, drawWaveform]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDetector();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const statusColor = {
    off: '#6B7280',
    calibrating: '#F59E0B',
    listening: '#10B981',
    detected: '#E24B4A',
    cooldown: '#F59E0B',
    error: '#EF4444',
  }[status] || '#6B7280';

  const statusText = {
    off: t('acoustic.off', 'Acoustic detection disabled'),
    calibrating: t('acoustic.calibrating', 'Calibrating ambient noise floor...'),
    listening: t('acoustic.listening', 'Listening for emergency sounds...'),
    detected: t('acoustic.detected', 'CRISIS DETECTED'),
    cooldown: t('acoustic.cooldown', 'Cooldown — resuming shortly...'),
    error: t('acoustic.micDenied', 'Microphone access denied'),
  }[status] || '';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15 }}
      style={{ marginBottom: '12px' }}
    >
      <div
        style={{
          background: enabled
            ? status === 'detected'
              ? 'rgba(226,75,74,0.08)'
              : 'rgba(139,92,246,0.06)'
            : 'rgba(107,114,128,0.06)',
          border: `1px solid ${
            enabled
              ? status === 'detected'
                ? 'rgba(226,75,74,0.35)'
                : 'rgba(139,92,246,0.25)'
              : 'rgba(107,114,128,0.2)'
          }`,
          borderRadius: '14px',
          padding: '12px 14px',
          transition: 'all 0.3s ease',
        }}
      >
        {/* Header row: label + toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: enabled ? '10px' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: statusColor,
                boxShadow: status === 'detected' ? '0 0 8px rgba(226,75,74,0.6)' : 'none',
                animation: status === 'listening' ? 'pulse-dot 2s ease-in-out infinite'
                  : status === 'detected' ? 'pulse-dot 0.5s ease-in-out infinite'
                  : status === 'calibrating' ? 'pulse-dot 1s ease-in-out infinite'
                  : 'none',
              }}
            />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: enabled ? (status === 'detected' ? '#F87171' : '#A78BFA') : '#6B7280',
                fontFamily: "'DM Sans',sans-serif",
              }}
            >
              {enabled
                ? t('acoustic.toggleOn', 'Acoustic Detection Active')
                : t('acoustic.toggleOff', 'Acoustic Detection Off')}
            </span>
          </div>

          {/* Toggle switch */}
          <div
            onClick={() => onToggle(!enabled)}
            style={{
              width: '44px',
              height: '24px',
              borderRadius: '12px',
              cursor: 'pointer',
              position: 'relative',
              background: enabled ? '#8B5CF6' : '#374151',
              transition: 'background 0.2s',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '3px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s',
                left: enabled ? '23px' : '3px',
              }}
            />
          </div>
        </div>

        {/* Expanded content when enabled */}
        <AnimatePresence>
          {enabled && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              style={{ overflow: 'hidden' }}
            >
              {/* Hint text */}
              <p
                style={{
                  fontSize: '11px',
                  color: '#6B7280',
                  margin: '0 0 8px',
                  lineHeight: 1.5,
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                {t('acoustic.hint', 'Monitors mic for gunshots, screams, crashes, and explosions. Auto-fires silent SOS.')}
              </p>

              {/* Status line */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '8px',
                  fontSize: '11px',
                  fontFamily: "'DM Sans',sans-serif",
                  color: statusColor,
                  fontWeight: status === 'detected' ? 700 : 500,
                }}
              >
                {status === 'calibrating' && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      border: '2px solid transparent',
                      borderTopColor: '#F59E0B',
                    }}
                  />
                )}
                {status === 'cooldown' && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      border: '2px solid transparent',
                      borderTopColor: '#F59E0B',
                    }}
                  />
                )}
                {status === 'detected' && <span style={{ fontSize: '14px' }}>🔊</span>}
                {status === 'listening' && <span style={{ fontSize: '12px' }}>🎙️</span>}
                {statusText}
              </div>

              {/* Waveform canvas with threshold line */}
              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '10px',
                  padding: '6px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={320}
                  height={CANVAS_HEIGHT}
                  style={{
                    width: '100%',
                    height: `${CANVAS_HEIGHT}px`,
                    display: 'block',
                    borderRadius: '6px',
                  }}
                />
                {/* Calibrating overlay */}
                {status === 'calibrating' && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: '6px',
                      borderRadius: '6px',
                      background: 'rgba(0,0,0,0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        border: '2px solid transparent',
                        borderTopColor: '#F59E0B',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#FCD34D', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
                      Calibrating Ambient Noise Floor...
                    </span>
                  </div>
                )}
              </div>

              {/* Mic error message */}
              {micError && (
                <p
                  style={{
                    fontSize: '11px',
                    color: '#EF4444',
                    margin: '8px 0 0',
                    fontFamily: "'DM Sans',sans-serif",
                  }}
                >
                  {t('acoustic.micDenied', 'Microphone access denied. Enable in browser settings.')}
                </p>
              )}

              {/* Detection flash */}
              <AnimatePresence>
                {lastDetection && status === 'detected' && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      marginTop: '8px',
                      padding: '8px 12px',
                      background: 'rgba(226,75,74,0.12)',
                      border: '1px solid rgba(226,75,74,0.3)',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#F87171',
                      fontFamily: "'DM Sans',sans-serif",
                    }}
                  >
                    {t('acoustic.detectedDetail', 'Detected: {{type}} ({{confidence}}% confidence) — Silent SOS sent', {
                      type: lastDetection.label.charAt(0).toUpperCase() + lastDetection.label.slice(1),
                      confidence: Math.round(lastDetection.confidence * 100),
                    })}
                    {lastDetection.spikeDb != null && (
                      <span style={{ display: 'block', fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>
                        Spike: +{lastDetection.spikeDb}dB above ambient floor ({lastDetection.baselineDb}dB baseline)
                      </span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
