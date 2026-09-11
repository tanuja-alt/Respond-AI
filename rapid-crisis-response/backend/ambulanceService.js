// backend/ambulanceService.js
// OSRM Route Utility — computes shortest driving path between driver and victim.
// Uses the free public OSRM demo server (no API key required).

const axios = require("axios");

const OSRM_BASE = "http://router.project-osrm.org/route/v1/driving";

/**
 * Fallback mock route for when OSRM API fails (e.g. timeout, rate limit)
 */
function mockFallbackRoute(driverLat, driverLng, victimLat, victimLng) {
    console.log("[AmbulanceService] Returning mock fallback route.");
    // Calculate rough crow-flies distance in km (very basic Euclidean approximation for demo)
    const dLat = driverLat - victimLat;
    const dLng = driverLng - victimLng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111; // 1 degree ~ 111km

    return {
        polyline: [[driverLat, driverLng], [victimLat, victimLng]],
        distanceKm: +(dist || 2.5).toFixed(2),
        etaMinutes: Math.max(1, Math.ceil((dist || 2.5) / 0.5)), // Mock ETA assuming ~30km/h
    };
}

/**
 * Fetch shortest driving route between driver and victim using OSRM.
 */
async function getOSRMRoute(driverLat, driverLng, victimLat, victimLng) {
    try {
        const url = `${OSRM_BASE}/${driverLng},${driverLat};${victimLng},${victimLat}`;
        const { data } = await axios.get(url, {
            params: { overview: "full", geometries: "geojson", steps: false },
            timeout: 8000,
        });

        if (!data.routes || data.routes.length === 0) {
            console.warn("[AmbulanceService] OSRM returned no routes");
            return mockFallbackRoute(driverLat, driverLng, victimLat, victimLng);
        }

        const route = data.routes[0];
        const distanceKm = +(route.distance / 1000).toFixed(2);
        const etaMinutes = +Math.ceil(route.duration / 60);
        // GeoJSON coords are [lng, lat] — flip to [lat, lng] for Leaflet
        const polyline = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

        console.log(`[AmbulanceService] Route: ${distanceKm} km, ETA: ${etaMinutes} min`);
        return { polyline, distanceKm, etaMinutes };
    } catch (err) {
        console.error("[AmbulanceService] OSRM fetch failed:", err?.message);
        return mockFallbackRoute(driverLat, driverLng, victimLat, victimLng);
    }
}

module.exports = { getOSRMRoute };

