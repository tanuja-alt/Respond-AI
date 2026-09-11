// frontend/src/components/DisasterBanner.jsx
// Early Warning Detection Banner — fetches nearby alerts and offers auto-fill SOS

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const SEVERITY_STYLES = {
  critical: {
    bg: 'rgba(226,75,74,0.12)',
    border: 'rgba(226,75,74,0.35)',
    color: '#F87171',
    icon: '🔴',
    glow: 'rgba(226,75,74,0.2)',
  },
  warning: {
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.35)',
    color: '#FCD34D',
    icon: '🟠',
    glow: 'rgba(245,158,11,0.15)',
  },
  advisory: {
    bg: 'rgba(59,130,246,0.1)',
    border: 'rgba(59,130,246,0.3)',
    color: '#93C5FD',
    icon: '🔵',
    glow: 'rgba(59,130,246,0.1)',
  },
};

const CATEGORY_MAP = {
  fire: 'fire',
  flood: 'flood',
  security: 'security',
  medical: 'medical',
  other: 'other',
};

const SEVERITY_URGENCY_MAP = {
  critical: 'RED',
  warning: 'YELLOW',
  advisory: 'GREEN',
};

/**
 * @param {{ location: {lat, lng}, onAutoFill: (data) => void }} props
 */
export default function DisasterBanner({ location, onAutoFill }) {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const fetchAlerts = useCallback(async () => {
    if (!location?.lat || !location?.lng) return;

    try {
      setLoading(true);
      const { data } = await axios.get(`${API}/api/alerts/nearby`, {
        params: { lat: location.lat, lng: location.lng, radius: 20 },
        timeout: 12000,
      });
      setAlerts(data.alerts || []);
    } catch (err) {
      console.warn('[DisasterBanner] Fetch failed:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [location?.lat, location?.lng]);

  // Fetch on mount and every 5 minutes
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleAction = (alert) => {
    if (!onAutoFill) return;
    const isEarthquake = alert.source === 'USGS' || alert.title.toLowerCase().includes('earthquake');
    const isCritical = isEarthquake || alert.severity === 'critical';

    onAutoFill({
      crisisType: CATEGORY_MAP[alert.category] || 'other',
      severity: SEVERITY_URGENCY_MAP[alert.severity] || 'YELLOW',
      description: `${alert.title}: ${alert.description}`,
      isInstantSubmit: isCritical,
    });
  };

  const handleDismiss = (index) => {
    setDismissed(prev => new Set([...prev, index]));
  };

  const visibleAlerts = alerts.filter((_, i) => !dismissed.has(i));

  if (visibleAlerts.length === 0) return null;

  return (
    <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <AnimatePresence>
        {visibleAlerts.map((alert, idx) => {
          const realIndex = alerts.indexOf(alert);
          const isEarthquake = alert.source === 'USGS' || alert.title.toLowerCase().includes('earthquake');
          const isCritical = isEarthquake || alert.severity === 'critical';
          const sev = isCritical ? SEVERITY_STYLES.critical : (SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.advisory);
          
          // Force critical styling for earthquakes
          if (isEarthquake) sev.icon = '⚠️';

          const severityLabel =
            isCritical ? t('disasterBanner.critical')
            : alert.severity === 'warning' ? t('disasterBanner.warning')
            : t('disasterBanner.advisory');

          return (
            <motion.div
              key={`alert-${realIndex}`}
              initial={{ opacity: 0, y: -16, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto', scale: isEarthquake ? [1, 1.02, 1] : 1 }}
              exit={{ opacity: 0, y: -16, height: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300, repeat: isEarthquake ? Infinity : 0, repeatDelay: 2 }}
              style={{
                background: sev.bg,
                border: `2px solid ${sev.border}`,
                borderRadius: '14px',
                padding: '14px 16px',
                boxShadow: `0 2px 24px ${sev.glow}`,
                overflow: 'hidden',
              }}
            >
              {/* Top row: icon + title + severity + dismiss */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '8px', marginBottom: '8px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '18px', flexShrink: 0 }}>{sev.icon}</span>
                  <span style={{
                    fontSize: '13px', fontWeight: 600, color: sev.color,
                    fontFamily: "'DM Sans',sans-serif",
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {alert.title}
                  </span>
                  <span style={{
                    padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
                    background: `${sev.border}40`, color: sev.color, flexShrink: 0,
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    fontFamily: "'DM Sans',sans-serif",
                  }}>
                    {severityLabel}
                  </span>
                </div>
                <button
                  onClick={() => handleDismiss(realIndex)}
                  style={{
                    width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer', color: '#6B7280', fontSize: '11px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  aria-label={t('disasterBanner.dismiss')}
                >
                  ✕
                </button>
              </div>

              {/* Description */}
              <p style={{
                fontSize: '12px', color: '#9CA3AF', margin: '0 0 10px',
                lineHeight: 1.5, fontFamily: "'DM Sans',sans-serif",
              }}>
                {alert.description?.slice(0, 180)}{alert.description?.length > 180 ? '...' : ''}
              </p>

              {/* Instructions (if present) */}
              {alert.instructions && (
                <p style={{
                  fontSize: '11px', color: sev.color, margin: '0 0 10px',
                  lineHeight: 1.5, fontFamily: "'DM Sans',sans-serif",
                  fontStyle: 'italic', opacity: 0.9,
                }}>
                  💡 {alert.instructions}
                </p>
              )}

              {/* Action button */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleAction(alert)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    background: isCritical ? '#E24B4A' : sev.color,
                    color: isCritical ? '#FFF' : '#0A0A0F',
                    border: 'none', cursor: 'pointer',
                    fontSize: '13px', fontWeight: 700,
                    fontFamily: "'DM Sans',sans-serif",
                    transition: 'all 0.15s',
                    boxShadow: isCritical ? '0 4px 12px rgba(226,75,74,0.4)' : 'none',
                  }}
                >
                  {isCritical ? `🚨 Alert Responders & Share GPS` : `⚡ ${t('disasterBanner.autoFill')}`}
                </button>
                {alert.source && (
                  <span style={{
                    fontSize: '10px', color: '#4B5563', fontFamily: "'DM Sans',sans-serif",
                  }}>
                    {t('disasterBanner.source')}: {alert.source}
                    {alert.distance ? ` · ${alert.distance} km` : ''}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
