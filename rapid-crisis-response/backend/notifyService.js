// backend/notifyService.js
// Guardian WhatsApp notification service (Twilio WhatsApp Sandbox)
// Reads TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM from process.env
//
// IMPORTANT: guardians are passed in incidentData.guardians from the frontend.
// This avoids needing Firebase Admin credentials locally.
// Falls back to Firebase Admin RTDB fetch only if guardians not in payload.

require('dotenv').config();
const crypto = require('crypto');

// ── Lazy singletons ──────────────────────────────────────────────
let _twilio = null;
const getTwilio = () => {
    if (_twilio) return _twilio;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
        console.warn('[Notify] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — WhatsApp disabled');
        return null;
    }
    try {
        _twilio = require('twilio')(sid, token);
        console.log('[Notify] ✅ Twilio client initialized (SID:', sid.slice(0, 8) + '...)');
    } catch (err) {
        console.error('[Notify] ❌ Twilio client init FAILED:', err?.message || err);
        return null;
    }
    return _twilio;
};

let _admin = null;
const getDb = () => {
    if (_admin) return _admin.database();
    try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({
                databaseURL: process.env.FIREBASE_DB_URL || 'https://rapid-crisis-response-default-rtdb.firebaseio.com',
            });
        }
        _admin = admin;
        return _admin.database();
    } catch (err) {
        console.error('[Notify] Firebase Admin init failed:', err?.message || err);
        return null;
    }
};

// ── Helpers ──────────────────────────────────────────────────────

const generateToken = () => crypto.randomBytes(16).toString('hex');

/**
 * Format current time as IST string e.g. "01 May 2026, 11:15 PM IST"
 */
const formatIST = () => {
    return new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }) + ' IST';
};

/**
 * Build WhatsApp message body with all required fields
 */
const buildWhatsAppMessage = ({ guestName, crisisType, severity, location, trackingToken }) => {
    const time = formatIST();
    const type = (crisisType || 'UNKNOWN').toUpperCase();
    const sev = (severity || 'UNKNOWN').toUpperCase();
    const name = guestName || 'A guest';

    let msg = `🚨 *RESPONDAI EMERGENCY ALERT*\n\n`;
    msg += `*${name}* needs immediate help!\n\n`;
    msg += `📋 *Type:* ${type}\n`;
    msg += `⚠️ *Severity:* ${sev}\n`;
    msg += `🕐 *Time:* ${time}\n`;

    if (location && location.lat != null && location.lng != null) {
        const lat = Number(Number(location.lat).toFixed(6));
        const lng = Number(Number(location.lng).toFixed(6));
        msg += `📍 *Location:* https://maps.google.com/?q=${lat},${lng}\n`;
    }

    if (trackingToken) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        msg += `🔗 *Track live:* ${frontendUrl}/track/${trackingToken}\n`;
    }

    msg += `\n☎️ Please contact them immediately or call *112*`;
    return msg;
};

/**
 * Normalize a guardian phone string: remove spaces/dashes/parens, trim.
 * Ensures it starts with + for E.164.
 */
const normalizePhone = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    let cleaned = raw.replace(/[\s\-()]/g, '').trim();
    // If it looks like an Indian number without country code, add +91
    if (/^\d{10}$/.test(cleaned)) {
        cleaned = '+91' + cleaned;
    }
    return cleaned;
};

/**
 * Extract guardians array from various sources.
 * Priority: incidentData.guardians (from frontend) > Firebase RTDB fetch
 */
const resolveGuardians = async (incidentData) => {
    // 1. Try guardians from payload (frontend already fetched them)
    let rawGuardians = incidentData?.guardians;

    if (rawGuardians) {
        console.log('[Notify] Guardians found in payload (frontend-provided)');
        // Could be array or object (Firebase serialization)
        let arr = [];
        if (Array.isArray(rawGuardians)) {
            arr = rawGuardians;
        } else if (typeof rawGuardians === 'object') {
            arr = Object.values(rawGuardians);
        }
        const normalized = arr
            .filter(g => typeof g === 'string' && g.trim().length > 0)
            .map(g => normalizePhone(g))
            .filter(g => g.length > 0);

        if (normalized.length > 0) {
            console.log(`[Notify] Using ${normalized.length} guardian(s) from payload:`, normalized);
            return normalized;
        }
        console.log('[Notify] Payload guardians were empty after filtering');
    }

    // 2. Fallback: fetch from Firebase Admin RTDB
    const guestUid = incidentData?.guestUid;
    if (!guestUid) {
        console.warn('[Notify] No guestUid — cannot fetch guardians from RTDB');
        return [];
    }

    const db = getDb();
    if (!db) {
        console.error('[Notify] Firebase Admin DB unavailable — cannot fetch guardians');
        return [];
    }

    try {
        const path = `guests/${guestUid}/guardians`;
        console.log(`[Notify] Fetching guardians from Firebase RTDB: ${path}`);
        const snap = await db.ref(path).once('value');
        const val = snap.val();
        console.log(`[Notify] Raw RTDB guardians:`, JSON.stringify(val));

        let arr = [];
        if (Array.isArray(val)) {
            arr = val;
        } else if (val && typeof val === 'object') {
            arr = Object.values(val);
            console.log('[Notify] Converted object-style guardians to array');
        }

        const normalized = arr
            .filter(n => typeof n === 'string' && n.trim().length > 0)
            .map(g => normalizePhone(g))
            .filter(g => g.length > 0);

        console.log(`[Notify] RTDB guardians (${normalized.length}):`, normalized);
        return normalized;
    } catch (err) {
        console.error('[Notify] RTDB guardian fetch FAILED:', err?.code || '', err?.message || err);
        return [];
    }
};

// ══════════════════════════════════════════════════════════════════
// MAIN: notifyContacts(incidentId, incidentData)
//
// Called by /api/notify route when an SOS incident is created.
// Sends WhatsApp to up to 3 guardian numbers via Twilio Sandbox.
// Writes guardiansNotified count back to incidents/{incidentId}.
//
// Guardians must have joined sandbox: "join film-fall" to +14155238886
// ══════════════════════════════════════════════════════════════════

const notifyContacts = async (incidentId, incidentData) => {
    console.log('[Notify] ═══════════════════════════════════════════');
    console.log('[Notify] notifyContacts() CALLED');
    console.log('[Notify] incidentId:', incidentId);
    console.log('[Notify] incidentData keys:', Object.keys(incidentData || {}));
    console.log('[Notify] guestUid:', incidentData?.guestUid);
    console.log('[Notify] guestName:', incidentData?.guestName);
    console.log('[Notify] crisisType:', incidentData?.crisisType, '| severity:', incidentData?.severity);
    console.log('[Notify] guardians in payload:', JSON.stringify(incidentData?.guardians));

    // ── Init Twilio ────────────────────────────────────────────────
    const twilio = getTwilio();
    const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

    console.log('[Notify] Twilio client ready:', !!twilio);
    console.log('[Notify] WhatsApp from:', whatsappFrom);

    if (!twilio) {
        console.error('[Notify] ❌ Twilio not available — CANNOT send WhatsApp');
        // Still write guardiansNotified: 0 so dashboard shows something
        await safeWriteGuardiansNotified(incidentId, 0, null);
        return { guardianWhatsAppSent: 0 };
    }

    const {
        guestName,
        crisisType,
        severity,
        location,
    } = incidentData || {};

    let guardianWhatsAppSent = 0;
    const trackingToken = generateToken();

    // ── 1. Resolve guardians ───────────────────────────────────────
    const guardians = await resolveGuardians(incidentData);
    console.log(`[Notify] Resolved ${guardians.length} guardian(s):`, guardians);

    // ── 2. Send WhatsApp to each guardian (up to 3) ────────────────
    if (guardians.length > 0) {
        const waBody = buildWhatsAppMessage({ guestName, crisisType, severity, location, trackingToken });
        const toSend = guardians.slice(0, 3);
        console.log(`[Notify] ── Sending WhatsApp to ${toSend.length} guardian(s) ──`);
        console.log('[Notify] Message preview:', waBody.slice(0, 120) + '...');

        for (const guardianPhone of toSend) {
            const waTo = `whatsapp:${guardianPhone}`;
            try {
                console.log(`[Notify] >>> Sending: from=${whatsappFrom} to=${waTo}`);
                const waRes = await twilio.messages.create({
                    to: waTo,
                    from: whatsappFrom,
                    body: waBody,
                });
                guardianWhatsAppSent++;
                console.log(`[Notify] ✅ SUCCESS to ${waTo} | SID: ${waRes.sid} | status: ${waRes.status}`);
            } catch (err) {
                console.error(`[Notify] ❌ FAILED to ${waTo}`);
                console.error(`[Notify]    code=${err?.code} status=${err?.status}`);
                console.error(`[Notify]    message=${err?.message || err}`);
                if (err?.moreInfo) console.error(`[Notify]    moreInfo=${err.moreInfo}`);
            }
        }

        console.log(`[Notify] ── WhatsApp results: ${guardianWhatsAppSent}/${toSend.length} succeeded ──`);
    } else {
        console.warn('[Notify] ⚠ No guardians to notify');
    }

    // ── 3. Write guardiansNotified count to incident ───────────────
    await safeWriteGuardiansNotified(incidentId, guardianWhatsAppSent, trackingToken);

    console.log('[Notify] ═══════════════════════════════════════════');
    return { guardianWhatsAppSent, trackingToken };
};

/**
 * Safely write guardiansNotified to Firebase RTDB incident.
 * Uses Firebase Admin if available, never throws.
 */
const safeWriteGuardiansNotified = async (incidentId, count, trackingToken) => {
    if (!incidentId) return;
    const db = getDb();
    if (!db) {
        console.warn('[Notify] Cannot write guardiansNotified — Firebase Admin DB unavailable');
        return;
    }
    try {
        const updateData = { guardiansNotified: count };
        if (trackingToken) updateData.trackingToken = trackingToken;
        await db.ref(`incidents/${incidentId}`).update(updateData);
        console.log(`[Notify] ✅ Wrote guardiansNotified=${count} to incident ${incidentId}`);
    } catch (err) {
        console.error('[Notify] Failed to write guardiansNotified:', err?.message || err);
    }
};

module.exports = { notifyContacts, generateToken, getTwilio, getDb, buildWhatsAppMessage };
