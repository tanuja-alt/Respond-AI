// frontend/src/pages/SOSPage.jsx
// KEY FIXES:
//   1. submitOnline() has TWO separate try-catch blocks:
//      - Block A: createIncident (Firebase) — failure here → offline fallback
//      - Block B: axios /api/classify — failure here → WARN ONLY, never offline fallback
//   2. API URL reads from REACT_APP_API_URL env var (set this in Vercel!)
//   3. guestUid/guestName/guestEmail always stamped on every incident
//   4. PATCH_1b: buildIncidentData() helper added to include guestPhone in both online/offline incidents
//   5. Full i18n support added

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  auth,
  createIncident,
  updateIncident,
  sendMessage,
  listenToIncident,
  getGuestProfile,
} from '../firebase';
import { saveOfflineIncident, saveOfflineLocation } from '../utils/db';
import { registerBackgroundSync } from '../utils/sync-manager';
import CrisisCompanion from '../components/CrisisCompanion';
import DisasterBanner from '../components/DisasterBanner';
import AmbulanceMap from '../components/AmbulanceMap';
import WeatherWidget from '../components/WeatherWidget';
import HealthMetricsCard from '../components/HealthMetricsCard';
import { joinIncidentRoom, onAmbulanceLocationChanged } from '../services/socketService';
import AcousticDetectorPanel from '../components/AcousticDetectorPanel';

// ── Backend API URL ──────────────────────────────────────────────
// In production: set REACT_APP_API_URL in Vercel env vars.
// Locally: defaults to http://localhost:3001 (backend dev server).
const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const log = (...a) => console.log('[SOS]', ...a);
const warn = (...a) => console.warn('[SOS]', ...a);

const CRISIS_TYPES = [
  { id: 'fire', icon: '🔥', color: '#E24B4A', rgb: '226,75,74' },
  { id: 'medical', icon: '🏥', color: '#F59E0B', rgb: '245,158,11' },
  { id: 'security', icon: '🔒', color: '#8B5CF6', rgb: '139,92,246' },
  { id: 'flood', icon: '🌊', color: '#3B82F6', rgb: '59,130,246' },
  { id: 'other', icon: '⚠️', color: '#9CA3AF', rgb: '107,114,128' },
];

// SilentSOS config
const SHAKE_THRESHOLD = 25;
const SHAKES_REQUIRED = 3;
const SHAKE_WINDOW_MS = 2000;
const SHAKE_DEBOUNCE_MS = 150;

export default function SOSPage() {
  const { t } = useTranslation();
  
  // Form
  const [crisisType, setCrisisType] = useState('fire');
  const [description, setDescription] = useState('');
  const [floor, setFloor] = useState('');
  const [room, setRoom] = useState('');
  const [severity, setSeverity] = useState('YELLOW');
  const [location, setLocation] = useState(null);

  // Flow: 'sos' | 'counting' | 'saving-offline' | 'sending-online' | 'confirm-offline' | 'confirm-online'
  const [screen, setScreen] = useState('sos-main');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [weatherAlert, setWeatherAlert] = useState(null);
  const [countdown, setCountdown] = useState(3);
  const [aiResult, setAiResult] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [guestMsg, setGuestMsg] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [locationCount, setLocationCount] = useState(0);

  // Ambulance dispatch
  const [requiresAmbulance, setRequiresAmbulance] = useState(false);
  const [ambulanceEnRoute, setAmbulanceEnRoute] = useState(false);
  const [ambulanceEta, setAmbulanceEta] = useState(null);
  const [ambulanceLocation, setAmbulanceLocation] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState(null);

  // SilentSOS
  const [silentEnabled, setSilentEnabled] = useState(true);
  const [shakeCount, setShakeCount] = useState(0);

  // Acoustic Crisis Detection
  const [acousticEnabled, setAcousticEnabled] = useState(false);
  const acousticFiredRef = useRef(false);
  const [motionOk, setMotionOk] = useState(true);

  // Refs
  const chatEndRef = useRef(null);
  const countTimerRef = useRef(null);
  const locationTimerRef = useRef(null);
  const recognitionRef = useRef(null);
  const shakeCountRef = useRef(0);
  const lastShakeRef = useRef(0);
  const shakeTimerRef = useRef(null);
  const silentFiredRef = useRef(false);
  const silentEnabledRef = useRef(true);
  const locationRef = useRef(null);
  // Ref to read latest vitals from HealthMetricsCard at dispatch time
  const healthCardRef = useRef(null);

  useEffect(() => {
    silentEnabledRef.current = silentEnabled;
  }, [silentEnabled]);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const getIsOnline = () => navigator.onLine;

  // Helper: grab a fresh high-accuracy GPS fix (promise-based)
  const getFreshGPS = () => new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(locationRef.current); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const freshLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        log('Fresh GPS fix:', freshLoc.lat, freshLoc.lng, 'accuracy:', pos.coords.accuracy, 'm');
        // Update local state & ref so everything downstream sees the freshest coords
        setLocation(freshLoc);
        resolve(freshLoc);
      },
      (err) => {
        warn('Fresh GPS failed, using cached:', err.message);
        resolve(locationRef.current); // fall back to watchPosition cache
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
    );
  });

  const buildIncidentData = async (overrides = {}) => {
    const user = auth.currentUser;

    let guestPhone = null;
    let guardians = [];
    if (user?.uid) {
      try {
        const profile = await getGuestProfile(user.uid);
        guestPhone = profile?.phone ?? profile?.phoneNumber ?? profile?.guestPhone ?? null;
        const rawGuardians = profile?.guardians;
        if (Array.isArray(rawGuardians)) {
          guardians = rawGuardians.filter(g => typeof g === 'string' && g.trim());
        } else if (rawGuardians && typeof rawGuardians === 'object') {
          guardians = Object.values(rawGuardians).filter(g => typeof g === 'string' && g.trim());
        }
      } catch (e) {
        console.warn('[SOS] getGuestProfile failed:', e);
      }
    }

    // CRITICAL: grab a FRESH GPS fix right at submission time
    // This prevents the Admin from seeing stale/old coordinates
    const freshLocation = await getFreshGPS();
    log('SOS location payload:', JSON.stringify(freshLocation));

    return {
      crisisType: overrides.crisisType || crisisType,
      description: overrides.description || description,
      floor: overrides.floor || floor,
      room: overrides.room || room,
      severity: overrides.severity || severity,
      requiresAmbulance,
      location: freshLocation,
      weatherAlert: weatherAlert || null,
      guestUid: user?.uid || null,
      guestName: user?.displayName || 'Unknown',
      guestEmail: user?.email || null,
      guestPhone,
      guardians,
      // Attach latest smartwatch health vitals to every SOS dispatch
      healthVitals: healthCardRef.current ? healthCardRef.current.getVitals() : null,
    };
  };

  // Continuous GPS tracking for the guest — watchPosition gives live updates
  useEffect(() => {
    if (!navigator.geolocation) { log('GPS unavailable'); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(newLoc);
      },
      (err) => log('GPS error:', err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Push live guest location to Firebase every 10s so admin map stays current
  useEffect(() => {
    if (!currentId) return;
    const pushInterval = setInterval(() => {
      const loc = locationRef.current;
      if (loc && loc.lat != null) {
        updateIncident(currentId, { location: loc }).catch(() => {});
      }
    }, 10000);
    // Push immediately on mount too
    if (locationRef.current && locationRef.current.lat != null) {
      updateIncident(currentId, { location: locationRef.current }).catch(() => {});
    }
    return () => clearInterval(pushInterval);
  }, [currentId]);

  useEffect(() => {
    registerBackgroundSync().catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentId) return;
    const unsub = listenToIncident(currentId, (data) => {
      if (data?.chat) setChatMessages(Object.values(data.chat).sort((a, b) => a.time - b.time));
      
      // Sync requiresAmbulance if admin assigned a driver or if it was marked required
      if (data?.requiresAmbulance || data?.assignedDriverUid) {
        setRequiresAmbulance(true);
      }

      // Sync navigation status from Firebase (reliable fallback for missed socket events)
      if (data?.navigating === true || data?.status === 'navigating' || data?.status === 'dispatched') {
        if (data?.assignedDriverUid) {
          setAmbulanceEnRoute(true);
          log('Firebase: ambulance en route, driver:', data.assignedDriverUid);
        }
      }

      // Firebase fallback: pick up driver location persisted by the server
      // This ensures the guest sees the ambulance even if the socket event was missed
      if (data?.driverLocation && data.driverLocation.lat != null) {
        log('Firebase fallback: driverLocation =', data.driverLocation);
        setAmbulanceLocation([data.driverLocation.lat, data.driverLocation.lng]);
        setAmbulanceEnRoute(true);
        if (data.routeEtaMinutes != null) setAmbulanceEta(data.routeEtaMinutes);
        if (data.routeDistanceKm != null) {
          // Build routeCoordinates from Firebase if available
        }
      }
      
      // Fallback location if local GPS is unavailable
      if (data?.location && !locationRef.current) {
        setLocation(data.location);
      }
    });
    return () => typeof unsub === 'function' && unsub();
  }, [currentId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (!currentId) return;
    
    // Explicitly join room from Guest Dashboard
    joinIncidentRoom(currentId);
    log('Joined socket room for incident:', currentId);
    
    const unsub = onAmbulanceLocationChanged((payload) => {
      log('Socket: ambulance_location_update received:', JSON.stringify(payload).slice(0, 200));
      // Only process updates for the current incident
      if (payload.incidentId && payload.incidentId !== currentId) return;
      if (payload.driverLocation) {
        log('Socket: setting ambulanceLocation:', payload.driverLocation);
        setAmbulanceLocation([payload.driverLocation.lat, payload.driverLocation.lng]);
        setAmbulanceEnRoute(true);
      }
      if (payload.routeData) {
        setRouteCoordinates(payload.routeData.polyline);
        setAmbulanceEta(payload.routeData.etaMinutes);
        setAmbulanceEnRoute(true);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [currentId]);

  useEffect(
    () => () => {
      clearInterval(countTimerRef.current);
      clearInterval(locationTimerRef.current);
      clearTimeout(shakeTimerRef.current);
      recognitionRef.current?.stop();
    },
    []
  );

  useEffect(() => {
    if (screen !== 'saving-offline') return;
    const safetyTimer = setTimeout(() => {
      warn('Safety timer: forcing confirm-offline');
      toast(`📱 ${t('sos.storedAutoSends')}`, {
        icon: '📱',
        duration: 4000,
        style: {
          background: 'rgba(245,158,11,0.15)',
          color: '#FCD34D',
          border: '1px solid rgba(245,158,11,0.3)',
        },
      });
      setScreen('confirm-offline');
    }, 3000);
    return () => clearTimeout(safetyTimer);
  }, [screen, t]);

  const startGPSTracking = (localId) => {
    if (locationTimerRef.current) return;
    const track = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const saved = await saveOfflineLocation(
            localId,
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy
          );
          if (saved) setLocationCount((c) => c + 1);
        },
        () => {}
      );
    };
    track();
    locationTimerRef.current = setInterval(track, 10000);
  };

  const stopGPSTracking = () => {
    clearInterval(locationTimerRef.current);
    locationTimerRef.current = null;
  };

  const handleDeviceMotion = useCallback((event) => {
    if (!silentEnabledRef.current || silentFiredRef.current) return;
    const acc = event.accelerationIncludingGravity || event.acceleration;
    if (!acc) return;
    const { x = 0, y = 0, z = 0 } = acc;
    if (Math.sqrt(x * x + y * y + z * z) < SHAKE_THRESHOLD) return;
    const now = Date.now();
    if (now - lastShakeRef.current < SHAKE_DEBOUNCE_MS) return;
    lastShakeRef.current = now;
    shakeCountRef.current++;
    setShakeCount(shakeCountRef.current);
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      shakeCountRef.current = 0;
      setShakeCount(0);
    }, SHAKE_WINDOW_MS);
    if (shakeCountRef.current >= SHAKES_REQUIRED) {
      clearTimeout(shakeTimerRef.current);
      shakeCountRef.current = 0;
      setShakeCount(0);
      fireSilentSOS();
    }
  }, []);

  useEffect(() => {
    if (!silentEnabled) {
      window.removeEventListener('devicemotion', handleDeviceMotion);
      return;
    }
    if (!window.DeviceMotionEvent) {
      setMotionOk(false);
      return;
    }
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then((p) =>
          p === 'granted'
            ? window.addEventListener('devicemotion', handleDeviceMotion)
            : setMotionOk(false)
        )
        .catch(() => setMotionOk(false));
    } else {
      window.addEventListener('devicemotion', handleDeviceMotion);
    }
    return () => window.removeEventListener('devicemotion', handleDeviceMotion);
  }, [silentEnabled, handleDeviceMotion]);

  const fireSilentSOS = async () => {
    if (silentFiredRef.current) return;
    silentFiredRef.current = true;
    const user = auth.currentUser;

    const data = {
      crisisType: 'covert-security-alert',
      severity: 'RED',
      silentAlert: true,
      description: 'Silent SOS — potential threat (shake detection)',
      location: locationRef.current,
      guestUid: user?.uid || null,
      guestName: user?.displayName || 'Unknown',
      guestEmail: user?.email || null,
    };

    try {
      if (getIsOnline()) {
        await createIncident(data);
      } else {
        const s = await saveOfflineIncident(data);
        if (s) startGPSTracking(s.id);
      }
      if (navigator.vibrate) navigator.vibrate([50]);
    } catch (e) {
      warn('SilentSOS error:', e);
    } finally {
      setTimeout(() => {
        silentFiredRef.current = false;
      }, 8000);
    }
  };

  const handleSOSTap = () => {
    if (!description.trim()) {
      toast.error(t('sos.pleaseDescribe'));
      return;
    }
    setCountdown(3);
    setScreen('counting');
    let c = 3;
    countTimerRef.current = setInterval(() => {
      c--;
      if (c > 0) {
        setCountdown(c);
      } else {
        clearInterval(countTimerRef.current);
        if (getIsOnline()) submitOnline();
        else submitOffline();
      }
    }, 1000);
  };

  const cancelCountdown = () => {
    clearInterval(countTimerRef.current);
    setScreen('sos');
  };

  const submitOffline = async (overrides = {}) => {
    log('Offline path');
    setScreen('saving-offline');

    try {
      const incidentData = await buildIncidentData(overrides);

      toast.loading(t('sos.savingLocally'), { id: 'offline-save' });
      const saved = await saveOfflineIncident(incidentData);
      if (!saved) throw new Error('saveOfflineIncident returned null');

      toast.success(t('sos.sosSaved'), { id: 'offline-save', duration: 3000 });
      startGPSTracking(saved.id);

      try {
        await registerBackgroundSync();
      } catch (_) {}
      try {
        if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      } catch (_) {}

      setScreen('confirm-offline');
    } catch (e) {
      warn('Offline save error:', e);
      toast.error(t('common.error'), { id: 'offline-save' });
      setTimeout(() => setScreen('confirm-offline'), 800);
    }
  };

  const submitOnline = async (overrides = {}) => {
    log('Online path');
    setScreen('sending-online');

    const incidentData = await buildIncidentData(overrides);

    let firebaseId;
    try {
      firebaseId = await createIncident(incidentData);
      setCurrentId(firebaseId);
      log('Incident created in Firebase:', firebaseId, 'location:', JSON.stringify(incidentData.location));

      // Ensure the freshest GPS is persisted — update location again in case
      // watchPosition delivered a newer fix between buildIncidentData and now
      if (locationRef.current && locationRef.current.lat != null) {
        updateIncident(firebaseId, { location: locationRef.current }).catch(() => {});
      }
    } catch (createErr) {
      warn('createIncident failed — falling back to offline:', createErr);
      toast(`⚠️ ${t('sos.offlineWillSync')}`, {
        icon: '⚠️',
        duration: 3000,
        style: {
          background: 'rgba(245,158,11,0.15)',
          color: '#FCD34D',
          border: '1px solid rgba(245,158,11,0.3)',
        },
      });
      try {
        const saved = await saveOfflineIncident(incidentData);
        if (saved) startGPSTracking(saved.id);
        setScreen('confirm-offline');
      } catch (saveErr) {
        warn('Offline fallback also failed:', saveErr);
        toast.error(t('common.error'));
        setScreen('sos');
      }
      return;
    }

    toast.success(t('sos.alertSent'));
    setScreen('confirm-online');

    let classifyResult = null; 
    if (API) {
      try {
        const { data } = await axios.post(
          `${API}/api/classify`,
          { description, floor, crisisType, lang: i18n.language || 'en' },
          { timeout: 10000 }
        );
        const safeData = data || { severity: 'YELLOW', sop: [], summary: 'Pending classification' };
        classifyResult = safeData;
        setAiResult(safeData);
        await updateIncident(firebaseId, {
          severity: safeData?.severity || 'YELLOW',
          sop: safeData?.sop || [],
          summary: safeData?.summary || '',
        });
        log('AI classify success:', safeData?.severity);
      } catch (aiErr) {
        warn('AI classify failed (non-fatal):', aiErr?.message || aiErr);
      }
    }

    try {
      const notifyPayload = {
        incidentId: firebaseId,
        incidentData: {
          ...incidentData,
          severity: classifyResult?.severity || incidentData.severity,
        },
      };
      const notifyUrl = `${API}/api/notify`;
      const resp = await axios.post(notifyUrl, notifyPayload, { timeout: 20000 });
      const waCount = resp.data?.guardianWhatsAppSent;
      if (waCount != null) {
        try {
          await updateIncident(firebaseId, { guardiansNotified: waCount });
        } catch (writeErr) {
          console.error('[SOS] ❌ Failed to write guardiansNotified:', writeErr);
        }
      } else {
        try {
          await updateIncident(firebaseId, { guardiansNotified: 0 });
        } catch (writeErr) {
          console.error('[SOS] ❌ Failed to write guardiansNotified=0:', writeErr);
        }
      }
    } catch (notifyErr) {
      console.error('[SOS] ❌ Notify API failed:', notifyErr);
      try {
        await updateIncident(firebaseId, { guardiansNotified: 0 });
      } catch (writeErr) {
        console.error('[SOS] ❌ Failed to write guardiansNotified=0:', writeErr);
      }
    }

    try {
      const ctx = new window.AudioContext();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g);
      g.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (_) {}
  };

  const sendGuestMsg = () => {
    if (!guestMsg.trim() || !currentId) return;
    sendMessage(currentId, guestMsg, 'guest');
    setGuestMsg('');
  };

  const resetAll = () => {
    stopGPSTracking();
    setScreen('sos');
    setChatMessages([]);
    setCurrentId(null);
    setAiResult(null);
    setDescription('');
    setFloor('');
    setRoom('');
    setSeverity('YELLOW');
    setLocationCount(0);
    setAmbulanceEnRoute(false);
    setAmbulanceEta(null);
    setAmbulanceLocation(null);
    setRouteCoordinates(null);
  };

  const selectedCrisis = CRISIS_TYPES.find((c) => c.id === crisisType);
  const isOnline = getIsOnline();
  const sosColor = isOnline ? '#E24B4A' : '#F59E0B';
  const sosRgb = isOnline ? '226,75,74' : '245,158,11';

  const getSevClass = (sev) =>
    sev === 'RED'
      ? 'severity-red'
      : sev === 'YELLOW'
        ? 'severity-yellow'
        : sev === 'GREEN'
          ? 'severity-green'
          : 'severity-pending';

  // ══════════════════════════════════════════════════════════
  // COUNTING
  // ══════════════════════════════════════════════════════════
  if (screen === 'counting')
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0A0A0F',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <motion.div
          key={countdown}
          initial={{ scale: 1.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{
            fontFamily: "'Bebas Neue',cursive",
            fontSize: '140px',
            color: sosColor,
            lineHeight: 1,
          }}
        >
          {countdown}
        </motion.div>
        <p style={{ color: '#6B7280', fontSize: '16px', marginTop: '16px' }}>
          {isOnline ? t('sos.sendingIn', { count: countdown }) : t('sos.savingIn', { count: countdown })}
        </p>
        {!isOnline && (
          <p style={{ color: '#F59E0B', fontSize: '12px', marginTop: '6px' }}>
            {t('sos.offlineWillSync')}
          </p>
        )}
        <button
          onClick={cancelCountdown}
          style={{
            marginTop: '24px',
            color: '#4B5563',
            background: 'none',
            border: '1px solid #2A2A3A',
            borderRadius: '10px',
            padding: '8px 20px',
            cursor: 'pointer',
            fontFamily: "'DM Sans',sans-serif",
            fontSize: '14px',
          }}
        >
          {t('sos.cancel')}
        </button>
      </div>
    );

  // ══════════════════════════════════════════════════════════
  // SAVING OFFLINE (amber spinner)
  // ══════════════════════════════════════════════════════════
  if (screen === 'saving-offline')
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0A0A0F',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            border: '3px solid #2A2A3A',
            borderTopColor: '#F59E0B',
          }}
        />
        <p style={{ color: '#FCD34D', fontSize: '18px', fontWeight: 500, margin: 0 }}>
          {t('sos.savingLocally')}
        </p>
        <p style={{ color: '#6B7280', fontSize: '13px', margin: 0 }}>
          {t('sos.storingOnDevice')}
        </p>
      </div>
    );

  // ══════════════════════════════════════════════════════════
  // SENDING ONLINE (red spinner)
  // ══════════════════════════════════════════════════════════
  if (screen === 'sending-online')
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0A0A0F',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            border: '3px solid #2A2A3A',
            borderTopColor: '#E24B4A',
          }}
        />
        <p style={{ color: '#E5E7EB', fontSize: '18px', fontWeight: 500, margin: 0 }}>
          {t('sos.sendingAlert')}
        </p>
        <p style={{ color: '#6B7280', fontSize: '13px', margin: 0 }}>
          {t('sos.notifyingStaff')}
        </p>
      </div>
    );

  // ══════════════════════════════════════════════════════════
  // OFFLINE CONFIRM
  // ══════════════════════════════════════════════════════════
  if (screen === 'confirm-offline')
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0F', padding: '20px 20px 40px' }}>
        <div style={{ maxWidth: '460px', margin: '0 auto' }}>
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ textAlign: 'center', padding: '28px 0 18px' }}
          >
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background: 'rgba(245,158,11,0.15)',
                border: '1px solid rgba(245,158,11,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 14px',
                fontSize: '30px',
              }}
            >
              📱
            </div>
            <h2
              style={{
                fontFamily: "'Bebas Neue',cursive",
                fontSize: '30px',
                letterSpacing: '2px',
                color: '#FCD34D',
                margin: '0 0 4px',
              }}
            >
              {t('sos.sosSaved')}
            </h2>
            <p style={{ color: '#6B7280', fontSize: '14px', margin: 0 }}>
              {t('sos.storedAutoSends')}
            </p>
          </motion.div>
          <div
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: '14px',
              padding: '16px',
              marginBottom: '12px',
            }}
          >
            {[
              { label: t('sos.sosStatus'), value: t('sos.savedLocally'), color: '#FCD34D' },
              { label: t('sos.gpsTracking'), value: t('sos.gpsActive', { count: locationCount }), color: '#34D399' },
              { label: t('sos.autoSync'), value: t('sos.willSendWhenOnline'), color: '#93C5FD' },
            ].map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  fontSize: '12px',
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                <span style={{ color: '#6B7280' }}>{r.label}</span>
                <span style={{ color: r.color, fontWeight: 600 }}>{r.value}</span>
              </div>
            ))}
          </div>
          <button
            onClick={resetAll}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent',
              color: '#6B7280',
              cursor: 'pointer',
              fontFamily: "'DM Sans',sans-serif",
            }}
          >
            {t('sos.returnToSOS')}
          </button>
        </div>
      </div>
    );

  // ══════════════════════════════════════════════════════════
  // ONLINE CONFIRM + LIVE CHAT
  // ══════════════════════════════════════════════════════════
  if (screen === 'confirm-online')
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0F', padding: '20px 20px 40px' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto' }}>
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ textAlign: 'center', padding: '28px 0 18px' }}
          >
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background: 'rgba(16,185,129,0.15)',
                border: '1px solid rgba(16,185,129,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 14px',
                fontSize: '30px',
              }}
            >
              ✓
            </div>
            <h2
              style={{
                fontFamily: "'Bebas Neue',cursive",
                fontSize: '34px',
                letterSpacing: '2px',
                color: '#fff',
                margin: '0 0 4px',
              }}
            >
              {t('sos.alertSent')}
            </h2>
            <p style={{ color: '#6B7280', fontSize: '14px', margin: 0 }}>
              {t('sos.staffNotifiedHelp')}
            </p>
          </motion.div>

          {/* Live Ambulance Map (shown if ambulance was requested) */}
          {requiresAmbulance && currentId && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              style={{
                background: 'rgba(226,75,74,0.06)',
                border: '1px solid rgba(226,75,74,0.25)',
                borderRadius: '16px',
                padding: '14px',
                marginBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '18px' }}>🚑</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#F87171', fontFamily: "'DM Sans',sans-serif" }}>
                    {ambulanceEnRoute ? 'Ambulance En Route' : 'Ambulance Dispatch Active'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: "'DM Sans',sans-serif" }}>
                    {ambulanceEnRoute 
                      ? (ambulanceEta ? `Arriving in ${ambulanceEta} minutes` : 'Live tracking active') 
                      : 'Waiting for ambulance to start navigation...'}
                  </div>
                </div>
              </div>
              <AmbulanceMap 
                incidentId={currentId} 
                victimLocation={location} 
                ambulanceLocation={ambulanceLocation}
                routeCoordinates={routeCoordinates}
                etaMinutes={ambulanceEta}
                parentManaged={true}
              />
            </motion.div>
          )}
          {/* AI Response Plan */}
          {!aiResult ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ width: '24px', height: '24px', border: '2px solid #374151', borderTopColor: '#A78BFA', borderRadius: '50%', margin: '0 auto 10px' }} />
              {t('sos.analyzingIncident') || 'Analyzing incident...'}
            </div>
          ) : (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.15 }}
              style={{
                background: 'rgba(99,60,255,0.08)',
                border: '1px solid rgba(99,60,255,0.22)',
                borderRadius: '14px',
                padding: '14px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#A78BFA',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('sos.aiResponsePlan')}
                </span>
                <span className={getSevClass(aiResult?.severity || 'YELLOW')}>{aiResult?.severity || 'PENDING'}</span>
              </div>
              {aiResult?.summary && (
                <p style={{ fontSize: '12px', color: '#8B5CF6', marginBottom: '8px', fontStyle: 'italic' }}>
                  {aiResult.summary}
                </p>
              )}
              <ol style={{ paddingLeft: '18px', margin: 0 }}>
                {aiResult?.sop?.map((s, i) => (
                  <li key={i} style={{ fontSize: '12px', color: '#C4B5FD', marginBottom: '5px', lineHeight: 1.5 }}>
                    {s}
                  </li>
                ))}
              </ol>
            </motion.div>
          )}

          {/* Live chat */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            style={{
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '14px',
              overflow: 'hidden',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                background: 'rgba(226,75,74,0.1)',
                borderBottom: '1px solid rgba(226,75,74,0.2)',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#F87171' }}>{t('sos.liveChatWithStaff')}</span>
              <span style={{ fontSize: '11px', color: '#6B7280' }}>{t('sos.messages', { count: chatMessages.length })}</span>
            </div>
            <div style={{ background: 'rgba(10,10,15,0.6)', padding: '12px', minHeight: '80px', maxHeight: '180px', overflowY: 'auto' }}>
              {chatMessages.length === 0 ? (
                <p style={{ color: '#374151', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
                  {t('sos.waitingForStaff')}
                </p>
              ) : (
                chatMessages.map((m, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.sender === 'guest' ? 'flex-end' : 'flex-start', marginBottom: '10px' }}>
                    <span style={{ fontSize: '10px', color: '#4B5563', marginBottom: '3px' }}>
                      {m.sender === 'guest' ? t('sos.you') : t('sos.staff')}
                    </span>
                    <div
                      style={{
                        display: 'inline-block',
                        padding: '8px 12px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        maxWidth: '78%',
                        background: m.sender === 'guest' ? '#E24B4A' : 'rgba(255,255,255,0.08)',
                        color: m.sender === 'guest' ? '#fff' : '#D1D5DB',
                      }}
                    >
                      {m.text}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <input
                value={guestMsg}
                onChange={(e) => setGuestMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendGuestMsg()}
                placeholder={t('sos.typeMessageToStaff')}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#E5E7EB',
                  fontSize: '13px',
                  fontFamily: "'DM Sans',sans-serif",
                }}
              />
              <button
                onClick={sendGuestMsg}
                style={{
                  padding: '0 20px',
                  background: '#E24B4A',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                }}
              >
                {t('sos.send')}
              </button>
            </div>
          </motion.div>

          <button
            onClick={resetAll}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent',
              color: '#6B7280',
              cursor: 'pointer',
              fontFamily: "'DM Sans',sans-serif",
            }}
          >
            {t('sos.sendAnotherAlert')}
          </button>
        </div>
      </div>
    );

  // ══════════════════════════════════════════════════════════
  // MAIN SOS SCREEN
  // ══════════════════════════════════════════════════════════
  // Auto-fill handler from DisasterBanner
  const handleAutoFill = async (data) => {
    if (data.crisisType) setCrisisType(data.crisisType);
    if (data.severity)   setSeverity(data.severity);
    if (data.description) setDescription(data.description);
    
    if (data.isInstantSubmit) {
      toast.success('Instant SOS Triggered!');
      const overrides = {
        crisisType: data.crisisType,
        severity: data.severity,
        description: data.description,
      };
      if (getIsOnline()) await submitOnline(overrides);
      else await submitOffline(overrides);
    } else {
      toast.success(t('disasterBanner.filled'));
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0F', padding: '20px 20px 60px' }}>
      <div style={{ maxWidth: '440px', margin: '0 auto' }}>
        {/* Early Warning Banner */}
        <DisasterBanner location={location} onAutoFill={handleAutoFill} />

        <WeatherWidget onSevereWeather={() => {}} />

        <HealthMetricsCard ref={healthCardRef} userEmail={auth.currentUser?.email} />

        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ textAlign: 'center', padding: '16px 0 6px' }}>
          <h1 style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '36px', letterSpacing: '3px', color: '#fff', margin: '0 0 4px' }}>
            {t('sos.title')} <span style={{ color: sosColor }}>{t('sos.titleHighlight')}</span>
          </h1>
          <p style={{ color: '#6B7280', fontSize: '13px', margin: 0 }}>
            {isOnline ? t('sos.subtitleOnline') : t('sos.subtitleOffline')}
          </p>
        </motion.div>

        {/* SilentSOS */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} style={{ marginBottom: '12px' }}>
          <div style={{ background: silentEnabled ? 'rgba(16,185,129,0.06)' : 'rgba(107,114,128,0.06)', border: `1px solid ${silentEnabled ? 'rgba(16,185,129,0.25)' : 'rgba(107,114,128,0.2)'}`, borderRadius: '14px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: silentEnabled ? '10px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: silentEnabled ? '#10B981' : '#6B7280' }} />
                <span style={{ fontSize: '12px', fontWeight: 500, color: silentEnabled ? '#34D399' : '#6B7280', fontFamily: "'DM Sans',sans-serif" }}>
                  {silentEnabled ? t('sos.silentActive') : t('sos.silentDisabled')}
                  {!motionOk ? ` ${t('sos.silentNotSupported')}` : ''}
                </span>
              </div>
              <div onClick={() => setSilentEnabled((v) => !v)} style={{ width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', position: 'relative', background: silentEnabled ? '#10B981' : '#374151', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', left: silentEnabled ? '23px' : '3px' }} />
              </div>
            </div>
            {silentEnabled && (
              <>
                <p style={{ fontSize: '11px', color: '#6B7280', margin: '0 0 8px', lineHeight: 1.5, fontFamily: "'DM Sans',sans-serif" }}>
                  {t('sos.silentHint')}
                </p>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 600,
                        transition: 'all 0.2s',
                        background: shakeCount >= n ? '#10B981' : 'rgba(255,255,255,0.06)',
                        color: shakeCount >= n ? '#fff' : '#6B7280',
                      }}
                    >
                      {n}
                    </div>
                  ))}
                  <span style={{ fontSize: '11px', color: '#6B7280', marginLeft: '6px', fontFamily: "'DM Sans',sans-serif" }}>
                    {shakeCount > 0 ? `${shakeCount}/3` : t('sos.shakeCounter')}
                  </span>
                </div>
              </>
            )}
          </div>
        </motion.div>

        {/* Acoustic Crisis Detection */}
        <AcousticDetectorPanel
          enabled={acousticEnabled}
          onToggle={setAcousticEnabled}
          onCrisisDetected={async (detection) => {
            if (acousticFiredRef.current) return;
            acousticFiredRef.current = true;
            const user = auth.currentUser;
            const acousticData = {
              crisisType: 'acoustic-detection',
              acousticType: detection.label,
              audioConfidence: Math.round(detection.confidence * 100),
              acousticAlert: true,
              severity: 'RED',
              description: `Acoustic auto-detect: ${detection.label} (${Math.round(detection.confidence * 100)}% confidence)`,
              location: locationRef.current,
              guestUid: user?.uid || null,
              guestName: user?.displayName || 'Unknown',
              guestEmail: user?.email || null,
              timestamp: detection.timestamp,
            };
            try {
              if (getIsOnline()) {
                await createIncident(acousticData);
              } else {
                await saveOfflineIncident(acousticData);
              }
              if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
              console.log('[SOS] Acoustic SOS dispatched:', detection.label);
            } catch (e) {
              console.error('[SOS] Acoustic SOS failed:', e);
            } finally {
              setTimeout(() => { acousticFiredRef.current = false; }, 10000);
            }
          }}
        />

        {/* SOS circle */}
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 }} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px 0 16px', position: 'relative', height: '200px' }}>
          {[160, 195, 230].map((size, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: '50%',
                border: `2px solid rgba(${sosRgb},${0.45 - i * 0.12})`,
                animation: `ring-expand ${1.8 + i * 0.5}s ease-out infinite`,
                animationDelay: `${i * 0.4}s`,
              }}
            />
          ))}
          <motion.button
            whileTap={{ scale: 0.91 }}
            onClick={handleSOSTap}
            style={{
              width: '148px',
              height: '148px',
              borderRadius: '50%',
              background: sosColor,
              border: `4px solid rgba(${sosRgb},0.4)`,
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              zIndex: 2,
              boxShadow: `0 0 48px rgba(${sosRgb},0.4)`,
            }}
          >
            <span style={{ fontSize: '38px', lineHeight: 1 }}>{selectedCrisis?.icon}</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '26px', letterSpacing: '3px', marginTop: '4px' }}>SOS</span>
            <span style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>{isOnline ? t('sos.tapToAlert') : t('sos.tapOffline')}</span>
          </motion.button>
        </motion.div>

        {/* Crisis pills */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '14px' }}>
          {CRISIS_TYPES.map((c) => {
            const sel = crisisType === c.id;
            return (
              <motion.button
                key={c.id}
                whileTap={{ scale: 0.94 }}
                onClick={() => setCrisisType(c.id)}
                style={{
                  padding: '7px 13px',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 500,
                  fontFamily: "'DM Sans',sans-serif",
                  outline: 'none',
                  transition: 'all 0.15s',
                  background: sel ? `rgba(${c.rgb},0.2)` : 'rgba(255,255,255,0.04)',
                  color: sel ? c.color : '#6B7280',
                  border: sel ? `1px solid ${c.color}70` : '1px solid rgba(255,255,255,0.07)',
                }}
              >
                {c.icon} {t(`sos.crisisTypes.${c.id}`)}
              </motion.button>
            );
          })}
        </div>

        {/* GPS + Voice + Ambulance */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.22)', borderRadius: '12px', padding: '10px 12px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', flexShrink: 0, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
            <span style={{ fontSize: '11px', color: '#34D399' }}>{location ? (isOnline ? t('sos.gpsLive') : t('sos.gpsOffline')) : t('sos.gpsLocating')}</span>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              if (!('webkitSpeechRecognition' in window)) { toast.error(t('sos.voiceRequiresChrome')); return; }
              const r = new window.webkitSpeechRecognition();
              r.lang = 'en-IN'; r.continuous = false; r.interimResults = false;
              r.onstart = () => setIsListening(true);
              r.onend   = () => setIsListening(false);
              r.onresult = (e) => {
                const tr = e.results[0][0].transcript;
                setDescription(tr);
                if (tr.toLowerCase().includes('fire'))     setCrisisType('fire');
                else if (tr.toLowerCase().includes('medical')) setCrisisType('medical');
                else if (tr.toLowerCase().includes('security')) setCrisisType('security');
                toast.success(t('sos.voiceCaptured'));
              };
              recognitionRef.current = r;
              r.start();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: isListening ? 'rgba(226,75,74,0.15)' : 'rgba(255,255,255,0.04)', border: isListening ? '1px solid rgba(226,75,74,0.4)' : '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '10px 12px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
          >
            <span style={{ fontSize: '16px' }}>🎤</span>
            <span style={{ fontSize: '11px', color: isListening ? '#F87171' : '#6B7280' }}>{isListening ? t('sos.voiceListening') : t('sos.voiceSOS')}</span>
          </motion.button>

          {/* Ambulance Toggle — spans full width */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setRequiresAmbulance(v => !v)}
            style={{
              gridColumn: '1 / -1',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '10px', padding: '12px 14px', borderRadius: '12px', cursor: 'pointer',
              fontFamily: "'DM Sans',sans-serif",
              background: requiresAmbulance ? 'rgba(226,75,74,0.1)' : 'rgba(255,255,255,0.04)',
              border: requiresAmbulance ? '1px solid rgba(226,75,74,0.4)' : '1px solid rgba(255,255,255,0.08)',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🚑</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: requiresAmbulance ? '#F87171' : '#D1D5DB', textAlign: 'left' }}>{t('sos.request_ambulance', 'Request Ambulance Service')}</div>
                <div style={{ fontSize: '11px', color: '#6B7280', textAlign: 'left' }}>{requiresAmbulance ? t('sos.ambulance_will_be_requested', 'Ambulance dispatch will be requested') : t('sos.tap_to_request_ambulance', 'Tap to request emergency ambulance')}</div>
              </div>
            </div>
            <div style={{ width: '44px', height: '24px', borderRadius: '12px', background: requiresAmbulance ? '#E24B4A' : '#374151', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
              <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', left: requiresAmbulance ? '23px' : '3px' }} />
            </div>
          </motion.button>
        </div>

        {/* Form */}
        <div className="glass-card" style={{ padding: '16px', marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '7px' }}>
            {t('sos.whatIsHappening')}
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('sos.descriptionPlaceholder')}
            className="glass-input"
            style={{ resize: 'none', marginBottom: '12px' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#6B7280', marginBottom: '6px' }}>{t('sos.floor')}</label>
              <input value={floor} onChange={(e) => setFloor(e.target.value)} placeholder={t('sos.floorPlaceholder')} className="glass-input" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#6B7280', marginBottom: '6px' }}>{t('sos.room')}</label>
              <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('sos.roomPlaceholder')} className="glass-input" />
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            {t('sos.urgencyLevel')}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px' }}>
            {[
              { val: 'GREEN', labelKey: 'low', color: '#10B981', rgb: '16,185,129' },
              { val: 'YELLOW', labelKey: 'medium', color: '#F59E0B', rgb: '245,158,11' },
              { val: 'RED', labelKey: 'critical', color: '#E24B4A', rgb: '226,75,74' },
            ].map((s) => (
              <button
                key={s.val}
                onClick={() => setSeverity(s.val)}
                style={{
                  padding: '9px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontFamily: "'DM Sans',sans-serif",
                  fontSize: '12px',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                  background: severity === s.val ? `rgba(${s.rgb},0.2)` : 'rgba(255,255,255,0.03)',
                  color: severity === s.val ? s.color : '#4B5563',
                  border: severity === s.val ? `1px solid ${s.color}60` : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {t(`sos.${s.labelKey}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Crisis Companion FAB */}
      <CrisisCompanion
        crisisType={crisisType}
        floor={floor}
        room={room}
        location={location}
        severity={severity}
      />

      <style>{`
        @keyframes ring-expand{0%{transform:scale(0.75);opacity:.8}100%{transform:scale(1.15);opacity:0}}
        @keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.4}}
      `}</style>
    </div>
  );
}