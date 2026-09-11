// frontend/src/pages/DriverDashboard.jsx
// Driver View — accepts incidents, streams GPS, shows Leaflet navigation map.

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { auth, db } from "../firebase";
import { ref, query, orderByChild, equalTo, onValue, update } from "firebase/database";
import { emitDriverLocation, joinIncidentRoom, emitDriverOnline, emitStartNavigation } from "../services/socketService";
import AmbulanceMap from "../components/AmbulanceMap";
import toast from "react-hot-toast";

export default function DriverDashboard() {
  const [incidents, setIncidents]   = useState([]);
  const [accepted,  setAccepted]    = useState(null); // currently active incident
  const [navigating, setNavigating] = useState(false);
  const watchRef = useRef(null);
  const simRef = useRef(null);

  const user = auth.currentUser;

  useEffect(() => {
    if (!user?.uid) return;
    emitDriverOnline({ driverId: user.uid });
    const q = query(ref(db, "incidents"), orderByChild("assignedDriverUid"), equalTo(user.uid));
    const unsub = onValue(q, (snap) => {
      const val = snap.val();
      if (!val) { setIncidents([]); return; }
      const list = Object.values(val).filter(i => i.status !== "resolved");
      setIncidents(list);
    }, () => {});
    return () => unsub();
  }, [user?.uid]);

  const handleAccept = (incident) => {
    setAccepted(incident);
    joinIncidentRoom(incident.id);
    // Mark accepted in Firebase
    update(ref(db, `incidents/${incident.id}`), { driverAccepted: true, driverAcceptedAt: Date.now() });
    toast.success("Incident accepted! Starting navigation...");
    startNavigation(incident);
  };

  const startNavigation = (incident) => {
    setNavigating(true);

    // Emit explicit navigation-started signal via socket (immediate broadcast)
    const driverId = auth.currentUser?.uid || null;
    emitStartNavigation(incident.id, driverId);

    // Also persist to Firebase so onValue listeners pick it up
    update(ref(db, `incidents/${incident.id}`), {
      navigating: true,
      status: 'navigating',
      navigationStartedAt: Date.now(),
    }).catch((err) => console.warn('[Driver] Firebase navigation update failed:', err.message));

    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const victimLat = incident.location?.lat ?? incident.location?.latitude;
        const victimLng = incident.location?.lng ?? incident.location?.longitude;
        emitDriverLocation(incident.id, coords.latitude, coords.longitude, victimLat, victimLng);
      },
      (err) => console.warn("[Driver] GPS error:", err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  };

  const simulateNavigation = (incident) => {
    setNavigating(true);
    setAccepted(incident);
    joinIncidentRoom(incident.id);
    
    const driverId = auth.currentUser?.uid || null;
    emitStartNavigation(incident.id, driverId);

    update(ref(db, `incidents/${incident.id}`), {
      navigating: true,
      status: 'navigating',
      navigationStartedAt: Date.now(),
      driverAccepted: true,
    }).catch(console.warn);

    const victimLat = incident.location?.lat ?? incident.location?.latitude;
    const victimLng = incident.location?.lng ?? incident.location?.longitude;
    
    if (victimLat == null || victimLng == null) {
      toast.error('❌ Cannot simulate: guest location not available yet.');
      return;
    }
    
    // Start ~5km away
    let currentLat = victimLat - 0.045;
    let currentLng = victimLng - 0.045;

    // Immediately emit first position
    emitDriverLocation(incident.id, currentLat, currentLng, victimLat, victimLng);

    simRef.current = setInterval(() => {
      // Move 10% closer every 3 seconds
      currentLat += (victimLat - currentLat) * 0.1;
      currentLng += (victimLng - currentLng) * 0.1;
      emitDriverLocation(incident.id, currentLat, currentLng, victimLat, victimLng);
      
      // Stop if extremely close (within ~10 meters)
      if (Math.abs(victimLat - currentLat) < 0.0001 && Math.abs(victimLng - currentLng) < 0.0001) {
        clearInterval(simRef.current);
        simRef.current = null;
        toast.success("Arrived at destination");
      }
    }, 3000);
    
    toast.success("Simulation started. Moving towards victim...");
  };

  const stopNavigation = () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (simRef.current != null) clearInterval(simRef.current);
    watchRef.current = null;
    simRef.current = null;
    setNavigating(false);
    setAccepted(null);
    toast("Navigation ended.");
  };

  // Cleanup on unmount
  useEffect(() => () => { 
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); 
    if (simRef.current != null) clearInterval(simRef.current);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F", padding: "20px", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: "500px", margin: "0 auto" }}>

        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ textAlign: "center", paddingBottom: "20px" }}>
          <h1 style={{ fontFamily: "'Bebas Neue',cursive", fontSize: "36px", letterSpacing: "3px", color: "#fff", margin: "0 0 4px" }}>
            🚑 DRIVER <span style={{ color: "#E24B4A" }}>DASHBOARD</span>
          </h1>
          <p style={{ color: "#6B7280", fontSize: "13px", margin: 0 }}>
            {user?.displayName || user?.email || "Driver"} · {navigating ? "🟢 Navigating" : "🟡 Standby"}
          </p>
        </motion.div>

        {/* Active Navigation View */}
        {accepted && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: "rgba(226,75,74,0.08)", border: "1px solid rgba(226,75,74,0.3)", borderRadius: "16px", padding: "16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#F87171" }}>🚨 Active Emergency</div>
                <div style={{ fontSize: "12px", color: "#9CA3AF" }}>
                  {accepted.crisisType?.toUpperCase()} · Floor {accepted.floor} · Room {accepted.room}
                </div>
                <div style={{ fontSize: "11px", color: "#6B7280", marginTop: "2px" }}>
                  Victim: {accepted.guestName || "Unknown"}
                </div>
              </div>
              <button onClick={stopNavigation}
                style={{ padding: "8px 14px", background: "rgba(107,114,128,0.15)", color: "#9CA3AF", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>
                Stop
              </button>
            </div>
            <AmbulanceMap incidentId={accepted.id} victimLocation={accepted.location} />
          </motion.div>
        )}

        {/* Pending Incidents List */}
        {!accepted && (
          <>
            <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Assigned Incidents ({incidents.length})
            </p>
            <AnimatePresence>
              {incidents.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ textAlign: "center", padding: "40px 20px", color: "#374151" }}>
                  <div style={{ fontSize: "40px", marginBottom: "12px" }}>🛑</div>
                  <p style={{ fontSize: "14px" }}>No incidents assigned yet</p>
                  <p style={{ fontSize: "12px", color: "#4B5563" }}>Wait for an admin to dispatch you</p>
                </motion.div>
              ) : incidents.map(inc => (
                <motion.div key={inc.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  style={{ background: "rgba(26,26,38,0.8)", border: "1px solid rgba(226,75,74,0.25)", borderRadius: "14px", padding: "16px", marginBottom: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#E5E7EB" }}>
                        {inc.crisisType === "fire" ? "🔥" : inc.crisisType === "medical" ? "🏥" : "⚠️"} {inc.crisisType?.toUpperCase()} EMERGENCY
                      </div>
                      <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>
                        Floor {inc.floor || "?"} · Room {inc.room || "?"}
                      </div>
                      <div style={{ fontSize: "12px", color: "#8B5CF6", marginTop: "2px" }}>
                        👤 {inc.guestName || "Unknown Guest"}
                      </div>
                    </div>
                    <span style={{ padding: "3px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, background: inc.severity === "RED" ? "rgba(226,75,74,0.2)" : "rgba(245,158,11,0.2)", color: inc.severity === "RED" ? "#F87171" : "#FCD34D" }}>
                      {inc.severity}
                    </span>
                  </div>

                  {inc.location && (
                    <div style={{ fontSize: "11px", color: "#6B7280", marginBottom: "12px" }}>
                      📍 {inc.location.lat?.toFixed(5)}, {inc.location.lng?.toFixed(5)}
                    </div>
                  )}

                  <div style={{ fontSize: "12px", color: "#D1D5DB", background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "8px 10px", marginBottom: "12px" }}>
                    {inc.description?.slice(0, 120) || "No description"}
                  </div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={() => handleAccept(inc)}
                      style={{ flex: 1, padding: "12px", background: "linear-gradient(135deg,#E24B4A,#c73534)", color: "#fff", border: "none", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 700, letterSpacing: "0.5px", boxShadow: "0 4px 16px rgba(226,75,74,0.35)" }}>
                      🚀 ACCEPT (REAL GPS)
                    </button>
                    <button onClick={() => simulateNavigation(inc)}
                      style={{ flex: 1, padding: "12px", background: "linear-gradient(135deg,#8B5CF6,#6D28D9)", color: "#fff", border: "none", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 700, letterSpacing: "0.5px", boxShadow: "0 4px 16px rgba(139,92,246,0.35)" }}>
                      🎮 SIMULATE RIDE
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
