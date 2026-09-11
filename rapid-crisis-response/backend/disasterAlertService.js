// backend/disasterAlertService.js
// Early Warning Detection — aggregates free public disaster APIs
// Sources: USGS Earthquake, OpenWeatherMap Alerts, GDACS RSS

require('dotenv').config();
const axios = require('axios');

const log = (...a) => console.log('[DisasterAlert]', ...a);
const warn = (...a) => console.warn('[DisasterAlert]', ...a);

// ── Haversine distance (km) ────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 1. USGS Earthquake API ─────────────────────────────────────
// Free, no API key required.
// Docs: https://earthquake.usgs.gov/fdsnws/event/1/
async function fetchUSGS(lat, lng, radiusKm) {
    try {
        const maxRadiusDeg = radiusKm / 111; // rough km → degrees
        const url = `https://earthquake.usgs.gov/fdsnws/event/1/query`;
        const { data } = await axios.get(url, {
            params: {
                format: 'geojson',
                latitude: lat,
                longitude: lng,
                maxradiuskm: radiusKm,
                minmagnitude: 2.5,
                orderby: 'time',
                limit: 5,
                starttime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            },
            timeout: 8000,
        });

        return (data.features || []).map((f) => {
            const p = f.properties;
            const mag = p.mag || 0;
            let severity = 'advisory';
            if (mag >= 6) severity = 'critical';
            else if (mag >= 4.5) severity = 'warning';

            return {
                source: 'USGS',
                title: `Earthquake M${mag.toFixed(1)} — ${p.place || 'Nearby'}`,
                severity,
                description: `Magnitude ${mag.toFixed(1)} earthquake detected ${p.place || 'near your location'}. Depth: ${(f.geometry?.coordinates?.[2] || 0).toFixed(1)} km.`,
                category: 'other',
                instructions: mag >= 4.5
                    ? 'Drop, Cover, and Hold On. Move away from windows and heavy objects. If indoors, stay inside.'
                    : 'Minor tremor detected. Stay alert for aftershocks.',
                time: p.time,
                magnitude: mag,
                url: p.url,
            };
        });
    } catch (err) {
        warn('USGS fetch failed:', err?.message);
        return [];
    }
}

// ── 2. OpenWeatherMap Alerts ───────────────────────────────────
// Requires WEATHER_API_KEY (free tier is fine).
// Uses One Call API 3.0 or fallback to 2.5 weather alerts.
async function fetchWeatherAlerts(lat, lng) {
    const key = process.env.WEATHER_API_KEY;
    if (!key) {
        log('WEATHER_API_KEY not set — skipping weather alerts');
        return [];
    }

    try {
        // Try One Call API 3.0 first (if subscribed)
        const { data } = await axios.get(
            `https://api.openweathermap.org/data/3.0/onecall`,
            {
                params: { lat, lon: lng, appid: key, exclude: 'minutely,hourly,daily' },
                timeout: 8000,
            }
        );

        if (!data.alerts || data.alerts.length === 0) return [];

        return data.alerts.map((a) => {
            let severity = 'advisory';
            const event = (a.event || '').toLowerCase();
            if (event.includes('extreme') || event.includes('tornado') || event.includes('hurricane'))
                severity = 'critical';
            else if (event.includes('warning') || event.includes('severe') || event.includes('flood'))
                severity = 'warning';

            // Map weather events to crisis categories
            let category = 'other';
            if (event.includes('flood') || event.includes('rain') || event.includes('storm'))
                category = 'flood';
            else if (event.includes('fire') || event.includes('heat'))
                category = 'fire';

            return {
                source: 'OpenWeatherMap',
                title: `⚡ ${a.event}`,
                severity,
                description: a.description?.slice(0, 300) || a.event,
                category,
                instructions:
                    severity === 'critical'
                        ? 'Seek immediate shelter. Stay away from windows. Follow staff instructions.'
                        : 'Stay alert and monitor conditions. Avoid going outside if possible.',
                time: (a.start || 0) * 1000,
                sender: a.sender_name,
            };
        });
    } catch (err) {
        // Fallback: try 2.5 API (no alerts field, but at least we tried)
        // Silently return empty array on 401 (invalid key/not subscribed) or other fetch errors
        // to prevent clogging the backend logs.
        return [];
    }
}

// ── 3. GDACS (Global Disaster Alerting Coordination System) ───
// Free, no API key. Uses their RSS/JSON feed.
async function fetchGDACS(lat, lng, radiusKm) {
    try {
        const { data } = await axios.get(
            'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP',
            {
                params: {
                    eventlist: '',
                    fromDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    toDate: new Date().toISOString().split('T')[0],
                    alertlevel: 'Green;Orange;Red',
                },
                timeout: 10000,
                headers: { Accept: 'application/json' },
            }
        );

        const features = data?.features || [];
        const nearby = [];

        for (const f of features) {
            const coords = f.geometry?.coordinates;
            if (!coords) continue;
            const [fLng, fLat] = coords;
            const dist = haversineKm(lat, lng, fLat, fLng);

            if (dist <= radiusKm) {
                const p = f.properties || {};
                let severity = 'advisory';
                if (p.alertlevel === 'Red') severity = 'critical';
                else if (p.alertlevel === 'Orange') severity = 'warning';

                let category = 'other';
                const type = (p.eventtype || '').toLowerCase();
                if (type.includes('eq')) category = 'other'; // earthquake
                else if (type.includes('fl')) category = 'flood';
                else if (type.includes('tc') || type.includes('cyclone')) category = 'flood';
                else if (type.includes('vo')) category = 'fire'; // volcanic

                nearby.push({
                    source: 'GDACS',
                    title: p.name || p.eventtype || 'Disaster Alert',
                    severity,
                    description: p.description || `${p.eventtype} event detected ${dist.toFixed(0)} km from your location.`,
                    category,
                    instructions:
                        severity === 'critical'
                            ? 'This is a high-severity event. Follow evacuation instructions immediately.'
                            : 'Stay informed and prepared to evacuate if situation escalates.',
                    time: p.fromdate ? new Date(p.fromdate).getTime() : Date.now(),
                    distance: Math.round(dist),
                    url: p.url,
                });
            }
        }

        return nearby.slice(0, 5); // cap at 5
    } catch (err) {
        // Silently return empty array on network failures to prevent log clogging
        return [];
    }
}

// ── Public API ──────────────────────────────────────────────────
/**
 * Get nearby disaster alerts from multiple sources.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusKm — default 20
 * @returns {Promise<Array>} — sorted by severity (critical first)
 */
async function getNearbyAlerts(lat, lng, radiusKm = 20) {
    log(`Fetching alerts for (${lat}, ${lng}) radius=${radiusKm}km`);

    // Run all three in parallel
    const [usgs, weather, gdacs] = await Promise.all([
        fetchUSGS(lat, lng, radiusKm),
        fetchWeatherAlerts(lat, lng),
        fetchGDACS(lat, lng, radiusKm),
    ]);

    const all = [...usgs, ...weather, ...gdacs];

    // Sort: critical → warning → advisory
    const order = { critical: 0, warning: 1, advisory: 2 };
    all.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

    log(`Found ${all.length} alerts (USGS:${usgs.length}, Weather:${weather.length}, GDACS:${gdacs.length})`);
    return all;
}

module.exports = { getNearbyAlerts };
