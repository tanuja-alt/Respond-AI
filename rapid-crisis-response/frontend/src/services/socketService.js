// frontend/src/services/socketService.js
// Singleton Socket.io client for real-time ambulance tracking.

import { io } from "socket.io-client";

const API = process.env.REACT_APP_API_URL || "http://localhost:3001";

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(API, {
      transports: ["websocket", "polling"],
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });
    socket.on("connect", () => console.log("[Socket.io] Connected:", socket.id));
    socket.on("disconnect", () => console.log("[Socket.io] Disconnected"));
    socket.on("connect_error", (err) => console.warn("[Socket.io] Error:", err.message));
  }
  return socket;
}

export function joinIncidentRoom(incidentId) {
  getSocket().emit("join_incident_room", { incidentId });
}

export function emitAcceptDispatch(incidentId, userId) {
  getSocket().emit("incident:accept_dispatch", { incidentId, userId });
}

export function emitDriverOnline(driverData) {
  getSocket().emit("driver:online", driverData);
}

export function emitDriverLocation(incidentId, lat, lng, victimLat, victimLng) {
  getSocket().emit("driver_location_update", { incidentId, lat, lng, victimLat, victimLng });
}

export function emitStartNavigation(incidentId, driverId) {
  getSocket().emit("driver:start_navigation", { incidentId, driverId });
}

export function onNavigationStarted(callback) {
  getSocket().on("navigation_started", callback);
  return () => getSocket().off("navigation_started", callback);
}

export function onAmbulanceLocationChanged(callback) {
  getSocket().on("ambulance_location_update", callback);
  return () => getSocket().off("ambulance_location_update", callback);
}

export function joinHealthStream(email) {
  if (email) {
    getSocket().emit("join_health_stream", { email });
  }
}

export function onHealthUpdate(callback) {
  getSocket().on("health:updated", callback);
  return () => getSocket().off("health:updated", callback);
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
