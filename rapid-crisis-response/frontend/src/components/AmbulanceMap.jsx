// frontend/src/components/AmbulanceMap.jsx
// Live Leaflet map showing victim location, ambulance location, and OSRM route polyline.

import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";
import { joinIncidentRoom, onAmbulanceLocationChanged } from "../services/socketService";
import { useTranslation } from "react-i18next";

const API = process.env.REACT_APP_API_URL || "http://localhost:3001";

// Fix default Leaflet marker icon (broken in webpack builds)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Red victim marker
const victimIcon = L.divIcon({
  html: `<div style="background:#E24B4A;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 8px rgba(226,75,74,0.8)"></div>`,
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Ambulance marker
const ambulanceIcon = L.divIcon({
  html: `<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">&#x1F691;</div>`,
  className: "",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Force Leaflet to recalculate container dimensions to avoid gray/blank tiles
function MapFixer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 400);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

// Auto-fit map bounds to markers — only re-fit when the driver marker first appears,
// not on every GPS tick (which causes jarring map jumps during live tracking).
function FitBounds({ victimPos, driverPos }) {
  const map = useMap();
  const hasFittedRef = useRef(false);
  useEffect(() => {
    if (!victimPos) return;
    if (driverPos) {
      // Only auto-fit once when the driver first appears
      if (!hasFittedRef.current) {
        map.fitBounds([victimPos, driverPos], { padding: [60, 60], maxZoom: 16 });
        hasFittedRef.current = true;
      }
    } else {
      map.setView(victimPos, 15);
    }
  }, [victimPos, driverPos, map]);
  return null;
}

export default function AmbulanceMap({ incidentId, victimLocation, ambulanceLocation, routeCoordinates, etaMinutes }) {
  const { t } = useTranslation();
  const [driverPos, setDriverPos]   = useState(null);
  const [routeData, setRouteData]   = useState(null); // { polyline, distanceKm, etaMinutes }
  const routeFetchRef = useRef(null);

  const victimPos = victimLocation
    ? [victimLocation.lat ?? victimLocation.latitude, victimLocation.lng ?? victimLocation.longitude]
    : null;

  // Join socket room and listen for driver location updates and OSRM routes
  useEffect(() => {
    if (!incidentId) return;
    // If parent is already passing ambulanceLocation via props, skip internal listener
    // to avoid double-registering on the same socket event
    if (ambulanceLocation) return;

    joinIncidentRoom(incidentId);

    // HTTP fallback: immediately fetch cached driver location from server
    // This covers the case where the driver is already navigating when this component mounts
    axios.get(`${API}/api/ambulance/driver-location/${incidentId}`)
      .then(({ data }) => {
        if (data?.driverLocation) {
          setDriverPos([data.driverLocation.lat, data.driverLocation.lng]);
        }
        if (data?.routeData) {
          setRouteData(data.routeData);
        }
      })
      .catch(() => {}); // No cached data yet — that's fine, socket will deliver it

    const unsub = onAmbulanceLocationChanged((payload) => {
      if (payload.driverLocation) {
        setDriverPos([payload.driverLocation.lat, payload.driverLocation.lng]);
      }
      if (payload.routeData) {
        setRouteData(payload.routeData);
      }
    });
    return unsub;
  }, [incidentId, ambulanceLocation]);

  const currentDriverPos = ambulanceLocation || driverPos;
  const currentRoutePolyline = routeCoordinates || routeData?.polyline;
  const currentEta = etaMinutes || routeData?.etaMinutes;
  const currentDistance = routeData?.distanceKm;

  if (!victimPos) return (
    <div style={{ padding: "16px", textAlign: "center", color: "#6B7280", fontSize: "13px" }}>
      📍 {t('admin.waiting_victim_gps', 'Waiting for victim GPS...')}
    </div>
  );

  return (
    <div style={{ position: "relative" }}>
      {/* ETA badge */}
      {(currentEta != null) && (
        <div style={{
          position: "absolute", top: "10px", left: "50%", transform: "translateX(-50%)",
          zIndex: 1000, background: "rgba(10,10,15,0.92)",
          border: "1px solid rgba(16,185,129,0.4)", borderRadius: "12px",
          padding: "8px 18px", display: "flex", alignItems: "center", gap: "8px",
          backdropFilter: "blur(8px)", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          fontFamily: "'DM Sans',sans-serif",
        }}>
          <span style={{ fontSize: "16px" }}>🚑</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#34D399" }}>
              {t('admin.ambulance_arriving_in', 'Ambulance arriving in {{time}} min', { time: currentEta })}
            </div>
            {currentDistance && (
              <div style={{ fontSize: "11px", color: "#9CA3AF" }}>
                {t('admin.distance_away', '{{distance}} km away', { distance: currentDistance })}
              </div>
            )}
          </div>
        </div>
      )}

      {!currentDriverPos && (
        <div style={{
          position: "absolute", top: "10px", left: "50%", transform: "translateX(-50%)",
          zIndex: 1000, background: "rgba(10,10,15,0.92)",
          border: "1px solid rgba(245,158,11,0.4)", borderRadius: "12px",
          padding: "8px 18px", fontFamily: "'DM Sans',sans-serif",
          fontSize: "13px", color: "#FCD34D",
          backdropFilter: "blur(8px)",
        }}>
          ⏳ {t('admin.waiting_ambulance_navigation', 'Waiting for ambulance to start navigation...')}
        </div>
      )}

      <MapContainer
        center={victimPos}
        zoom={15}
        style={{ height: "320px", width: "100%", borderRadius: "14px", overflow: "hidden" }}
        zoomControl={false}
      >
        <MapFixer />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* Victim marker */}
        <Marker position={victimPos} icon={victimIcon}>
          <Popup>📍 {t('admin.victim_location', 'Victim Location')}</Popup>
        </Marker>

        {/* Driver marker */}
        {currentDriverPos && (
          <Marker position={currentDriverPos} icon={ambulanceIcon}>
            <Popup>🚑 {t('admin.ambulance', 'Ambulance')}</Popup>
          </Marker>
        )}

        {/* OSRM route polyline */}
        {currentRoutePolyline && (
          <Polyline
            positions={currentRoutePolyline}
            pathOptions={{ color: "#E24B4A", weight: 5, opacity: 0.85, dashArray: "8, 4" }}
          />
        )}

        <FitBounds victimPos={victimPos} driverPos={currentDriverPos} />
      </MapContainer>
    </div>
  );
}
