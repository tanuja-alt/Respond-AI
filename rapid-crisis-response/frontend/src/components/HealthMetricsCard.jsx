// frontend/src/components/HealthMetricsCard.jsx
// Real-Time Smartwatch Health Data Telemetry card
// Polls GET /api/health/latest/:email every 30 s and supports manual refresh.
// Falls back to safe placeholder values when no live sync is available.

import React, { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { joinHealthStream, onHealthUpdate } from '../services/socketService';
import { loginWithGoogle } from '../firebase';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const POLL_INTERVAL_MS = 10_000;

// Fallback values shown while awaiting first sync
const FALLBACK = {
  heartRate: 72,
  spo2: 98,
  steps: 0,
  source: null,        // null triggers "Connecting…" badge
  lastSynced: null,
};

// Development mock data — used when Google Fit credentials are unavailable
const DEV_MOCK = {
  heartRate: 74,
  spo2: 97,
  steps: 3842,
  source: 'Mock Data (Dev Mode)',
  lastSynced: new Date().toISOString(),
};

// Forward-ref so SOSPage can read latest vitals via ref
const HealthMetricsCard = forwardRef(function HealthMetricsCard({ userEmail }, ref) {
  const { t } = useTranslation();
  const [vitals, setVitals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(null);
  const intervalRef = useRef(null);

  const fetchVitals = useCallback(async () => {
    if (!userEmail) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/health/latest?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) {
        const data = await res.json();
        setVitals(data);
      } else if (res.status === 401 || res.status === 403) {
        // Token expired or scopes not granted
        setVitals({
          heartRate: '--',
          spo2: '--',
          steps: '--',
          source: 'Session Expired (Re-login required)',
          isExpired: true
        });
      } else if (res.status === 404) {
        // No data found — use dev mock in development, null in production
        if (process.env.NODE_ENV === 'development') {
          setVitals({ ...DEV_MOCK, lastSynced: new Date().toISOString() });
        } else {
          setVitals(null);
        }
      }
    } catch (_) {
      // Network error — fall back to dev mock in development
      if (process.env.NODE_ENV === 'development') {
        setVitals({ ...DEV_MOCK, lastSynced: new Date().toISOString() });
      } else {
        setVitals(null);
      }
    } finally {
      setLoading(false);
      setLastFetch(new Date());
    }
  }, [userEmail]);

  const [reAuthLoading, setReAuthLoading] = useState(false);

  const reAuthenticateGoogle = async () => {
    setReAuthLoading(true);
    try {
      await loginWithGoogle();
      // Wait for RTDB write to propagate before re-fetching
      await new Promise(resolve => setTimeout(resolve, 2000));
      await fetchVitals();
    } catch (err) {
      console.error("Re-authentication failed", err);
    } finally {
      setReAuthLoading(false);
    }
  };

  // Expose latest vitals snapshot to parent (SOSPage) via ref
  useImperativeHandle(ref, () => ({
    getVitals: () => vitals || FALLBACK,
  }));

  // Initial fetch and polling
  useEffect(() => {
    fetchVitals();
    intervalRef.current = setInterval(fetchVitals, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchVitals]);

  // Real-time socket updates
  useEffect(() => {
    if (!userEmail) return;
    try {
      joinHealthStream(userEmail);
      const unsubscribe = onHealthUpdate((record) => {
        if (record?.userEmail?.toLowerCase() === userEmail.toLowerCase()) {
          setVitals(record);
          setLastFetch(new Date());
        }
      });
      return unsubscribe;
    } catch (err) {
      console.warn("Socket subscription failed", err);
    }
  }, [userEmail]);

  // "Last updated: X seconds ago" timer
  const [secondsAgo, setSecondsAgo] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastFetch) {
        setSecondsAgo(Math.floor((new Date() - lastFetch) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastFetch]);

  // ── Derived display values ────────────────────────────────────────
  const display = vitals || FALLBACK;
  const heartRate = display.heartRate ?? FALLBACK.heartRate;
  const spo2      = display.spo2      ?? FALLBACK.spo2;
  const steps     = display.steps     ?? FALLBACK.steps;
  const source    = display.source;
  const synced    = display.lastSynced
    ? new Date(display.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const sourceBadge = source
    ? (source.toLowerCase().includes('connect') ? t('health.source_watch', 'Live Smartwatch Feed') : t('health.source_synced', 'Synced via Google Fit'))
    : t('health.source_connecting', 'Connecting…');

  const sourceBadgeColor = source ? '#34D399' : '#F59E0B';
  const sourceBadgeBg    = source ? 'rgba(52,211,153,0.12)' : 'rgba(245,158,11,0.12)';
  const sourceBadgeBorder = source ? 'rgba(52,211,153,0.3)' : 'rgba(245,158,11,0.3)';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      style={containerStyle}
    >
      {/* Header */}
      <div style={{ padding: '10px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px' }}>💓</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#E5E7EB', fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.3px' }}>
            {t('health.title', 'Live Health Vitals')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Source badge */}
          <span style={{
            fontSize: '10px', fontWeight: 600,
            color: sourceBadgeColor,
            background: sourceBadgeBg,
            border: `1px solid ${sourceBadgeBorder}`,
            borderRadius: '20px', padding: '2px 8px',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {!source && <span style={{ marginRight: '3px' }}>⌚</span>}
            {source && <span style={{ marginRight: '3px' }}>🔗</span>}
            {sourceBadge}
          </span>

          {/* Refresh button */}
          <button
            onClick={fetchVitals}
            disabled={loading}
            title={t('health.refresh', 'Refresh Vitals')}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none', borderRadius: '50%',
              width: '26px', height: '26px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading ? 'wait' : 'pointer',
              color: '#9CA3AF', flexShrink: 0,
            }}
          >
            <span style={{
              fontSize: '13px',
              display: 'inline-block',
              transform: loading ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.4s',
            }}>↻</span>
          </button>
        </div>
      </div>

      {vitals?.isExpired && (
        <div style={{ padding: '10px 14px' }}>
          <button 
            onClick={reAuthenticateGoogle}
            disabled={reAuthLoading}
            style={{
              width: '100%',
              padding: '8px',
              background: 'rgba(248, 113, 113, 0.15)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              color: '#FCA5A5',
              borderRadius: '8px',
              cursor: reAuthLoading ? 'wait' : 'pointer',
              fontSize: '12px',
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 600,
              opacity: reAuthLoading ? 0.6 : 1,
              transition: 'opacity 0.3s',
            }}
          >
            {reAuthLoading ? '⏳ Refreshing…' : '↻ Refresh Google Fit Session'}
          </button>
        </div>
      )}

      {/* Metric tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '10px 14px 12px' }}>
        {/* Heart Rate */}
        <div style={metricTile}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
            <HeartIcon />
            <span style={metricLabel}>{t('health.heart_rate', 'Heart Rate')}</span>
          </div>
          <div style={{ ...metricValue, color: '#F87171' }}>
            {heartRate}
          </div>
          <div style={metricUnit}>{t('health.bpm', 'BPM')}</div>
        </div>

        {/* SpO2 */}
        <div style={metricTile}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px' }}>🫁</span>
            <span style={metricLabel}>{t('health.spo2', 'Blood Oxygen')}</span>
          </div>
          <div style={{ ...metricValue, color: '#60A5FA' }}>
            {spo2}
          </div>
          <div style={metricUnit}>{t('health.percent', '%')} SpO₂</div>
        </div>

        {/* Steps */}
        <div style={metricTile}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px' }}>👟</span>
            <span style={metricLabel}>{t('health.steps', 'Steps Today')}</span>
          </div>
          <div style={{ ...metricValue, color: '#34D399' }}>
            {typeof steps === 'number' ? steps.toLocaleString() : (steps || '—')}
          </div>
          <div style={metricUnit}>{t('health.steps', 'steps')}</div>
        </div>
      </div>

      {/* Last synced footer */}
      {synced && (
        <div style={{ padding: '0 14px 10px', fontSize: '10px', color: '#4B5563', fontFamily: "'DM Sans', sans-serif" }}>
          {t('health.last_synced', 'Last synced')}: {synced} <br/>
          {lastFetch && <span style={{color: '#9CA3AF'}}>Last updated: {secondsAgo} seconds ago</span>}
        </div>
      )}
      {!synced && (
        <div style={{ padding: '0 14px 10px', fontSize: '10px', color: '#4B5563', fontFamily: "'DM Sans', sans-serif" }}>
          {t('health.no_data', 'Awaiting sync')}
        </div>
      )}

      {/* Pulsing heart animation keyframes */}
      <style>{`
        @keyframes heartbeat {
          0%, 100% { transform: scale(1); }
          14%       { transform: scale(1.25); }
          28%       { transform: scale(1); }
          42%       { transform: scale(1.18); }
          70%       { transform: scale(1); }
        }
        .health-heart { animation: heartbeat 1.6s ease-in-out infinite; }
      `}</style>
    </motion.div>
  );
});

// Pulsing ❤️ icon component
function HeartIcon() {
  return (
    <span
      className="health-heart"
      style={{ fontSize: '12px', display: 'inline-block', transformOrigin: 'center' }}
    >
      ❤️
    </span>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────
const containerStyle = {
  background: 'rgba(26,26,38,0.5)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '12px',
  overflow: 'hidden',
  marginBottom: '16px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  backdropFilter: 'blur(12px)',
};

const metricTile = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '10px',
  padding: '8px 10px',
  textAlign: 'center',
};

const metricLabel = {
  fontSize: '9px',
  color: '#6B7280',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: 600,
};

const metricValue = {
  fontSize: '22px',
  fontWeight: 700,
  fontFamily: "'Bebas Neue', cursive",
  lineHeight: 1.1,
  margin: '2px 0',
};

const metricUnit = {
  fontSize: '9px',
  color: '#6B7280',
  fontFamily: "'DM Sans', sans-serif",
};

export default HealthMetricsCard;

