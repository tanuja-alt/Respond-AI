// backend/healthService.js
// In-memory health metrics store — keyed by userEmail (lowercased)
// Schema matches the requested HealthMetrics model:
//   { userEmail, heartRate, spo2, steps, source, lastSynced }

const metricsStore = {};  // email -> HealthMetrics object
const axios = require('axios');

// Lazy initialization of Firebase Admin to read googleAccessToken from RTDB
let _admin = null;
const getDb = () => {
    if (_admin) return _admin.database();
    try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            const serviceAccount = require('./serviceAccountKey.json');
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: process.env.FIREBASE_DB_URL || 'https://rapid-crisis-response-default-rtdb.firebaseio.com',
            });
        }
        _admin = admin;
        return _admin.database();
    } catch (err) {
        console.error('[HealthService] Firebase Admin init failed:', err?.message || err);
        return null;
    }
};

/**
 * Upsert health metrics for a given email address.
 * @param {string} email
 * @param {{ heartRate?: number, spo2?: number, steps?: number, source?: string }} payload
 * @returns {object} The stored record
 */
function upsertMetrics(email, payload) {
    if (!email || typeof email !== 'string') throw new Error('email is required');
    const key = email.toLowerCase().trim();
    const existing = metricsStore[key] || {};
    metricsStore[key] = {
        userEmail: key,
        heartRate: payload.heartRate != null ? Number(payload.heartRate) : (existing.heartRate ?? null),
        spo2: payload.spo2 != null ? Number(payload.spo2) : (existing.spo2 ?? null),
        steps: payload.steps != null ? Number(payload.steps) : (existing.steps ?? null),
        source: payload.source || existing.source || 'Google Fit / Health Connect (Da Fit)',
        lastSynced: new Date().toISOString(),
    };
    return metricsStore[key];
}

/**
 * Helper to query Google Fitness Aggregate API
 */
async function fetchAllGoogleFitMetrics(accessToken, email) {
    const endTimeMillis = Date.now();
    const startTimeMillis = endTimeMillis - (24 * 60 * 60 * 1000); // Last 24 hours

    console.log(`[HealthService] [${email}] Initiating Google Fit aggregate query...`);
    console.log(`[HealthService] [${email}] Using Access Token: ${accessToken ? accessToken.substring(0, 10) + '...' : 'NONE'}`);

    try {
        const response = await axios.post(
            'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
            {
                aggregateBy: [
                    { dataTypeName: 'com.google.heart_rate.bpm' },
                    { dataTypeName: 'com.google.oxygen_saturation' },
                    { dataTypeName: 'com.google.step_count.delta' }
                ],
                bucketByTime: { durationMillis: 86400000 },
                startTimeMillis,
                endTimeMillis
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            }
        );

        console.log(`[HealthService] [${email}] Raw Google API Response Status: ${response.status}`);
        const buckets = response.data.bucket;
        if (!buckets || buckets.length === 0) return { hr: null, spo2: null, steps: null };

        let hr = null;
        let spo2 = null;
        let steps = null;

        // Scan ALL buckets (not just the first) to find the latest non-empty data points
        for (const bucket of buckets) {
            if (!bucket.dataset) continue;
            bucket.dataset.forEach(ds => {
                const sourceId = ds.dataSourceId || '';
                if (!ds.point || ds.point.length === 0) return;

                const latestPoint = ds.point[ds.point.length - 1];
                const val = latestPoint.value?.[0];
                // Use explicit != null checks — 0 is a valid value for fpVal/intVal
                const numericVal = val?.fpVal != null ? val.fpVal : (val?.intVal != null ? val.intVal : null);

                if (numericVal == null) return;

                if (sourceId.includes('heart_rate')) hr = numericVal;
                if (sourceId.includes('oxygen_saturation')) spo2 = numericVal;
                if (sourceId.includes('step_count')) steps = numericVal;
            });
        }

        console.log(`[HealthService] [${email}] Extracted Vitals -> HR: ${hr}, SpO2: ${spo2}, Steps: ${steps}`);
        return { hr, spo2, steps };

    } catch (error) {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            throw error; // Let caller handle 401/403 (token refresh)
        }
        console.error(`[HealthService] [${email}] Google Fit API Error:`);
        if (error.response) {
            console.error(`  - Status: ${error.response.status}`);
            console.error(`  - Data:`, JSON.stringify(error.response.data));
        } else {
            console.error(`  - Message: ${error.message}`);
        }
        return { hr: null, spo2: null, steps: null };
    }
}

async function refreshGoogleToken(refreshToken, guestId) {
    if (!refreshToken) return null;
    try {
        const res = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        });
        const newAccessToken = res.data.access_token;
        if (newAccessToken && guestId) {
            const db = getDb();
            if (db) await db.ref(`guests/${guestId}`).update({ googleAccessToken: newAccessToken, updatedAt: Date.now() });
        }
        return newAccessToken;
    } catch (err) {
        console.error("[HealthService] Token refresh failed:", err.response?.data || err.message);
        return null;
    }
}

/**
 * Retrieve the latest health metrics for a given email.
 * First tries to pull from Google Fitness API dynamically if an access token exists.
 * Falls back to the in-memory metrics store.
 * @param {string} email
 * @returns {object|null}
 */
async function getLatestMetrics(email) {
    if (!email || typeof email !== 'string') return null;
    const key = email.toLowerCase().trim();

    console.log(`[HealthService] getLatestMetrics called for user: ${key}`);

    // 1. Try to fetch the user's Google Access Token from Firebase RTDB
    let googleAccessToken = null;
    let googleRefreshToken = null;
    let guestId = null;
    try {
        const db = getDb();
        if (db) {
            const guestsRef = db.ref('guests');
            const snapshot = await guestsRef.orderByChild('email').equalTo(key).once('value');

            if (snapshot.exists()) {
                const guests = snapshot.val();
                guestId = Object.keys(guests)[0];
                googleAccessToken = guests[guestId]?.googleAccessToken;
                googleRefreshToken = guests[guestId]?.googleRefreshToken;
                console.log(`[HealthService] Found DB profile for ${key}, accessToken present: ${!!googleAccessToken}`);
            } else {
                console.log(`[HealthService] No DB profile found for email: ${key}`);
            }
        }
    } catch (error) {
        console.error(`[HealthService] Failed to read RTDB for token: ${error.message}`);
    }

    // 2. If we have a token, fetch dynamically from Google Fitness REST API
    if (googleAccessToken) {
        let vitals = null;
        try {
            vitals = await fetchAllGoogleFitMetrics(googleAccessToken, key);
        } catch (err) {
            if (err.response && (err.response.status === 401 || err.response.status === 403) && googleRefreshToken) {
                console.log(`[HealthService] [${key}] Token expired/forbidden (${err.response.status}). Attempting refresh...`);
                const newAccessToken = await refreshGoogleToken(googleRefreshToken, guestId);
                if (newAccessToken) {
                    try {
                        vitals = await fetchAllGoogleFitMetrics(newAccessToken, key);
                    } catch (retryErr) {
                        console.error(`[HealthService] [${key}] Retry failed:`, retryErr.message);
                    }
                }
            }
        }

        if (vitals && (vitals.hr || vitals.spo2 || vitals.steps)) {
            // Update our in-memory store so it has the absolute latest and can be fallback later
            upsertMetrics(key, {
                heartRate: vitals.hr,
                spo2: vitals.spo2,
                steps: vitals.steps,
                source: 'Live Google Fit API'
            });
        }
    }

    // 3. Return from in-memory store (which now contains either the latest fetched data or previous pushed data)
    const result = metricsStore[key] || null;

    // 4. Dev-mode fallback: if still no data and running locally, return mock vitals
    if (!result && process.env.NODE_ENV !== 'production') {
        console.log(`[HealthService] [${key}] No real data — returning dev mock vitals`);
        const mockData = {
            userEmail: key,
            heartRate: 72 + Math.floor(Math.random() * 10),
            spo2: 96 + Math.floor(Math.random() * 3),
            steps: 2000 + Math.floor(Math.random() * 5000),
            source: 'Mock Data (Dev Mode — No Google Fit Token)',
            lastSynced: new Date().toISOString(),
        };
        return mockData;
    }

    return result;
}

module.exports = { upsertMetrics, getLatestMetrics };
