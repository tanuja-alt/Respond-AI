// frontend/src/components/VitalsMonitorCard.jsx
// Admin Dashboard — Patient Live Health Vitals (Ambulance / Paramedic Telemetry)
// Fetches latest vitals for incident.guestEmail and listens for real-time
// `health:updated` Socket.io events to refresh automatically.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getSocket, joinHealthStream, onHealthUpdate } from '../services/socketService';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// Threshold constants
const HR_HIGH_THRESHOLD  = 120;   // BPM
const HR_LOW_THRESHOLD   = 50;    // BPM
const SPO2_LOW_THRESHOLD = 92;    // %

export default function VitalsMonitorCard({ incident }) {
  const { t } = useTranslation();
  const [vitals, setVitals]   = useState(null);
  const [loading, setLoading] = useState(true);
  const email = incident?.guestEmail;
  const socketRef = useRef(null);

  const fetchVitals = useCallback(async () => {
    if (!email) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/health/latest?email=${encodeURIComponent(email)}`);
      if (res.ok) setVitals(await res.json());
      else setVitals(null);
    } catch (_) {
      setVitals(null);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    fetchVitals();
  }, [fetchVitals]);

  // Real-time push — listen for health:updated from Socket.io for this specific room
  useEffect(() => {
    if (!email) return;
    try {
      joinHealthStream(email);
      const unsubscribe = onHealthUpdate((record) => {
        if (record?.userEmail?.toLowerCase() === email.toLowerCase()) {
          setVitals(record);
        }
      });
      return unsubscribe;
    } catch (_) { /* socket not available */ }
  }, [email]);

  // ── Derived alert states ────────────────────────────────────────
  const hr   = vitals?.heartRate;
  const spo2 = vitals?.spo2;
  const steps = vitals?.steps;
  const lastSynced = vitals?.lastSynced
    ? new Date(vitals.lastSynced).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const hrCritical  = hr != null && (hr > HR_HIGH_THRESHOLD || hr < HR_LOW_THRESHOLD);
  const o2Critical  = spo2 != null && spo2 < SPO2_LOW_THRESHOLD;
  const anyAlert    = hrCritical || o2Critical;

  if (!incident) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      style={{
        background: anyAlert ? 'rgba(226,75,74,0.06)' : 'rgba(26,26,38,0.6)',
        border: `1px solid ${anyAlert ? 'rgba(226,75,74,0.4)' : 'rgba(139,92,246,0.25)'}`,
        borderRadius: '14px',
        padding: '14px 16px',
        boxShadow: anyAlert ? '0 0 24px rgba(226,75,74,0.18)' : 'none',
        transition: 'all 0.4s ease',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>💓</span>
          <span style={{
            fontSize: '12px', fontWeight: 700,
            color: anyAlert ? '#F87171' : '#A78BFA',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {t('health.telemetry_title', 'Patient Live Health Vitals (Ambulance Telemetry)')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Live indicator dot */}
          {vitals && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: '#34D399',
                animation: 'vitals-ping 1.4s ease-in-out infinite',
                display: 'inline-block',
              }} />
              <span style={{ fontSize: '10px', color: '#34D399', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>LIVE</span>
            </span>
          )}

          {/* Refresh */}
          <button
            onClick={fetchVitals}
            disabled={loading}
            title={t('health.refresh', 'Refresh Vitals')}
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: 'none', borderRadius: '50%',
              width: '24px', height: '24px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading ? 'wait' : 'pointer',
              color: '#9CA3AF',
            }}
          >
            <span style={{ fontSize: '12px', display: 'inline-block', transform: loading ? 'rotate(180deg)' : 'none', transition: 'transform 0.4s' }}>↻</span>
          </button>
        </div>
      </div>

      {/* ── Critical Alerts ── */}
      {hrCritical && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={alertBanner}
        >
          <span style={{ fontSize: '16px' }}>🚨</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.5px' }}>
              {t('health.critical_hr', 'HIGH HEART RATE / DISTRESS DETECTED')}
            </div>
            <div style={{ fontSize: '11px', fontWeight: 400, opacity: 0.85, marginTop: '1px' }}>
              {hr > HR_HIGH_THRESHOLD
                ? `${hr} BPM — exceeds ${HR_HIGH_THRESHOLD} BPM threshold`
                : `${hr} BPM — below ${HR_LOW_THRESHOLD} BPM threshold`}
            </div>
          </div>
        </motion.div>
      )}

      {o2Critical && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{ ...alertBanner, marginTop: hrCritical ? '6px' : 0 }}
        >
          <span style={{ fontSize: '16px' }}>🫁</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.5px' }}>
              {t('health.low_o2', 'LOW OXYGEN ALERT')}
            </div>
            <div style={{ fontSize: '11px', fontWeight: 400, opacity: 0.85, marginTop: '1px' }}>
              SpO₂ {spo2}% — critical threshold &lt; {SPO2_LOW_THRESHOLD}%
            </div>
          </div>
        </motion.div>
      )}

      {/* ── No data state ── */}
      {!vitals && !loading && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#4B5563' }}>
          <div style={{ fontSize: '28px', marginBottom: '6px' }}>⌚</div>
          <p style={{ fontSize: '12px', margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {t('health.no_data', 'Awaiting sync')} — {email || 'no email'}
          </p>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !vitals && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: anyAlert ? '10px' : 0 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ ...vitalsTile, background: 'rgba(255,255,255,0.04)', height: '70px' }}>
              <div style={{ width: '60%', height: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', margin: '0 auto 8px' }} />
              <div style={{ width: '40%', height: '20px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', margin: '0 auto' }} />
            </div>
          ))}
        </div>
      )}

      {/* ── Vitals grid ── */}
      {vitals && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: anyAlert ? '10px' : 0 }}>
          {/* Heart Rate */}
          <div style={{ ...vitalsTile, border: hrCritical ? '1px solid rgba(226,75,74,0.5)' : '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', marginBottom: '4px' }}>
              <HeartIcon pulse />
              <span style={vitalsLabel}>{t('health.heart_rate', 'Heart Rate')}</span>
            </div>
            <div style={{ ...vitalsValue, color: hrCritical ? '#F87171' : '#FB7185' }}>
              {hr ?? '—'}
            </div>
            <div style={vitalsUnit}>{t('health.bpm', 'BPM')}</div>
          </div>

          {/* SpO2 */}
          <div style={{ ...vitalsTile, border: o2Critical ? '1px solid rgba(226,75,74,0.5)' : '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px' }}>🫁</span>
              <span style={vitalsLabel}>{t('health.spo2', 'Blood Oxygen')}</span>
            </div>
            <div style={{ ...vitalsValue, color: o2Critical ? '#F87171' : '#60A5FA' }}>
              {spo2 ?? '—'}
            </div>
            <div style={vitalsUnit}>{t('health.percent', '%')} SpO₂</div>
          </div>

          {/* Steps */}
          <div style={vitalsTile}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px' }}>👟</span>
              <span style={vitalsLabel}>{t('health.steps', 'Steps')}</span>
            </div>
            <div style={{ ...vitalsValue, color: '#34D399', fontSize: '18px' }}>
              {steps != null ? steps.toLocaleString() : '—'}
            </div>
            <div style={vitalsUnit}>{t('health.steps', 'steps')}</div>
          </div>
        </div>
      )}

      {/* Source + last synced */}
      {vitals && (
        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: '#6B7280', fontFamily: "'DM Sans', sans-serif" }}>
            🔗 {vitals.source || t('health.source_synced', 'Synced via Google Fit')}
          </span>
          {lastSynced && (
            <span style={{ fontSize: '10px', color: '#4B5563', fontFamily: "'DM Sans', sans-serif" }}>
              {t('health.last_synced', 'Last synced')}: {lastSynced}
            </span>
          )}
        </div>
      )}

      <style>{`
        @keyframes vitals-ping {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.4); }
        }
        @keyframes heartbeat-admin {
          0%, 100% { transform: scale(1); }
          14%       { transform: scale(1.3); }
          28%       { transform: scale(1); }
          42%       { transform: scale(1.2); }
          70%       { transform: scale(1); }
        }
        .vitals-heart { animation: heartbeat-admin 1.4s ease-in-out infinite; }
      `}</style>
    </motion.div>
  );
}

function HeartIcon({ pulse }) {
  return (
    <span
      className={pulse ? 'vitals-heart' : undefined}
      style={{ fontSize: '11px', display: 'inline-block', transformOrigin: 'center' }}
    >
      ❤️
    </span>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────
const alertBanner = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  background: 'rgba(226,75,74,0.18)',
  border: '1px solid rgba(226,75,74,0.5)',
  borderRadius: '10px',
  padding: '10px 12px',
  color: '#FCA5A5',
  fontFamily: "'DM Sans', sans-serif",
  animation: 'vitals-ping 2s ease-in-out infinite',
};

const vitalsTile = {
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '10px',
  padding: '8px 6px',
  textAlign: 'center',
};

const vitalsLabel = {
  fontSize: '8px',
  color: '#6B7280',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: 600,
};

const vitalsValue = {
  fontSize: '22px',
  fontWeight: 700,
  fontFamily: "'Bebas Neue', cursive",
  lineHeight: 1.1,
  margin: '2px 0',
};

const vitalsUnit = {
  fontSize: '9px',
  color: '#6B7280',
  fontFamily: "'DM Sans', sans-serif",
};
