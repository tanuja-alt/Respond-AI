require("dotenv").config();
const http    = require("http");
const express = require("express");
const cors    = require("cors");
const { Server } = require("socket.io");

const { classifyIncident }  = require("./geminiService");
const { notifyContacts }    = require("./notifyService");
const { chatCrisisGuide }   = require("./crisisGuideService");
const { getNearbyAlerts }   = require("./disasterAlertService");
const { getOSRMRoute }      = require("./ambulanceService");
const { upsertMetrics, getLatestMetrics } = require("./healthService");

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || "http://localhost:3000", methods: ["GET","POST"] },
});

const driverLocations = {};
const driversPool = {}; // driverId -> { status, socketId }

io.on("connection", (socket) => {
  console.log(`[Socket.io] Connected: ${socket.id}`);

  socket.on("driver:online", (driverData) => {
    if (!driverData || !driverData.driverId) return;
    const { driverId } = driverData;
    socket.driverId = driverId;
    driversPool[driverId] = { status: "available", socketId: socket.id };
    console.log(`[Socket.io] Driver online: ${driverId}`);
  });

  socket.on("incident:accept_dispatch", ({ incidentId, userId }) => {
    if (!incidentId || !userId) return;
    const room = `incident_${incidentId}`;
    socket.join(room);
    console.log(`[Socket.io] ${socket.id} (user ${userId}) accepted incident ${incidentId}`);
  });

  socket.on("join_health_stream", ({ email }) => {
    if (!email) return;
    const room = `health_${email.toLowerCase().trim()}`;
    socket.join(room);
    console.log(`[Socket.io] ${socket.id} joined health stream: ${room}`);
  });

  socket.on("join_incident_room", ({ incidentId }) => {
    if (!incidentId) return;
    const room = `incident_${incidentId}`;
    socket.join(room);
    console.log(`[Socket.io] ${socket.id} joined room: ${room}`);
    if (driverLocations[incidentId]) {
      // Emit the full cached payload to the late joiner immediately
      socket.emit("ambulance_location_update", driverLocations[incidentId]);
    }
  });

  socket.on("driver:start_navigation", async ({ incidentId, driverId }) => {
    if (!incidentId) return;
    const room = `incident_${incidentId}`;
    socket.join(room);
    console.log(`[Socket.io] Driver ${driverId || socket.id} started navigation for incident ${incidentId}`);

    // Broadcast to all room participants (admin, guest, driver)
    io.to(room).emit("navigation_started", { incidentId, driverId, startedAt: Date.now() });

    // Persist navigation status to Firebase so listeners pick it up even without sockets
    try {
      const admin = require('firebase-admin');
      if (admin.apps.length > 0) {
        const fbDb = admin.database();
        await fbDb.ref(`incidents/${incidentId}`).update({ navigating: true, status: 'navigating', navigationStartedAt: Date.now() });
        console.log(`[Socket.io] Firebase updated: incident ${incidentId} → navigating`);
      }
    } catch (err) {
      console.warn(`[Socket.io] Could not update Firebase navigation status:`, err.message);
    }
  });

  socket.on("driver_location_update", async ({ incidentId, lat, lng, victimLat, victimLng }) => {
    if (!incidentId || lat == null || lng == null) return;
    const driverLocation = { lat, lng, updatedAt: Date.now() };
    console.log(`[Socket.io] Driver location update: incident=${incidentId} lat=${lat} lng=${lng}`);

    let routeData = null;
    if (victimLat != null && victimLng != null) {
      routeData = await getOSRMRoute(lat, lng, victimLat, victimLng);
    }

    const payload = { incidentId, driverLocation, routeData };
    driverLocations[incidentId] = payload;

    io.to(`incident_${incidentId}`).emit("ambulance_location_update", payload);

    // Persist driver location to Firebase so it survives page refreshes
    try {
      const admin = require('firebase-admin');
      if (admin.apps.length > 0) {
        await admin.database().ref(`incidents/${incidentId}`).update({
          driverLocation,
          ...(routeData ? { routeEtaMinutes: routeData.etaMinutes, routeDistanceKm: routeData.distanceKm } : {}),
        });
      }
    } catch (fbErr) {
      // Non-fatal — socket broadcast is the primary channel
      console.warn(`[Socket.io] Could not persist driver location to Firebase:`, fbErr.message);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Socket.io] Disconnected: ${socket.id}`);
    if (socket.driverId && driversPool[socket.driverId]) {
      delete driversPool[socket.driverId];
    }
  });
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
console.log("──────────────────────────────────────────");
console.log("[Server] Starting backend...");
console.log("[Server] PORT:", PORT);
console.log("[Server] GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");
console.log("[Server] FRONTEND_URL:", process.env.FRONTEND_URL || "not set");
console.log("[Server] GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET");
console.log("[Server] GOOGLE_CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "SET" : "NOT SET");
console.log("──────────────────────────────────────────");

app.post("/api/classify", async (req, res) => {
  try { res.json(await classifyIncident(req.body.description, req.body.floor, req.body.crisisType)); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/notify", async (req, res) => {
  try {
    const { incidentId, incidentData } = req.body;
    if (!incidentId) return res.status(400).json({ error: "incidentId is required" });
    res.json(await notifyContacts(incidentId, incidentData || {}));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/simulate", async (req, res) => {
  try {
    const scenarios = {
      fire:     { description:"Smoke smell floor 3 room 302", floor:"3", room:"302", crisisType:"fire" },
      medical:  { description:"Guest collapsed in lobby unconscious", floor:"1", room:"Lobby", crisisType:"medical" },
      security: { description:"Aggressive intruder at main entrance", floor:"G", room:"Entrance", crisisType:"security" }
    };
    const scene = scenarios[req.body.type] || scenarios.fire;
    res.json({ ...scene, ...await classifyIncident(scene.description, scene.floor, scene.crisisType) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/chat/crisis-guide", async (req, res) => {
  try {
    const { messages, userMessage, context, language } = req.body;
    if (!userMessage) return res.status(400).json({ error: "userMessage is required" });
    res.json(await chatCrisisGuide(messages || [], userMessage, context || {}, language || "en"));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/alerts/nearby", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "lat and lng required" });
    const alerts = await getNearbyAlerts(lat, lng, parseFloat(req.query.radius) || 20);
    res.json({ alerts, count: alerts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/ambulance/route", async (req, res) => {
  try {
    const { driverLat, driverLng, victimLat, victimLng } = req.query;
    if (!driverLat || !driverLng || !victimLat || !victimLng)
      return res.status(400).json({ error: "driverLat, driverLng, victimLat, victimLng all required" });
    const route = await getOSRMRoute(parseFloat(driverLat), parseFloat(driverLng), parseFloat(victimLat), parseFloat(victimLng));
    if (!route) return res.status(503).json({ error: "OSRM unavailable" });
    res.json(route);
  } catch (err) { res.status(500).json({ error: err.message }); }
});



app.get("/api/ambulance/driver-location/:incidentId", (req, res) => {
  const loc = driverLocations[req.params.incidentId];
  if (!loc) return res.status(404).json({ error: "No driver location yet" });
  res.json(loc);
});

// ── Health Status Check ──────────────────────────────────────────
app.get("/api/status", (_, res) => res.json({ status: "ok", port: PORT, socketio: true }));

// ── Health Metrics Telemetry ──────────────────────────────────────
// POST /api/health/sync — ingest smartwatch vitals from Google Fit / Health Connect (Fallback/Push)
app.post("/api/health/sync", (req, res) => {
  try {
    const { userEmail, heartRate, spo2, steps, source } = req.body;
    if (!userEmail) return res.status(400).json({ error: "userEmail is required" });
    const record = upsertMetrics(userEmail, { heartRate, spo2, steps, source });
    // Broadcast real-time update to specific admin room for this patient
    const room = `health_${record.userEmail.toLowerCase().trim()}`;
    io.to(room).emit("health:updated", record);
    console.log(`[Health] Synced vitals for ${record.userEmail} — HR:${record.heartRate} SpO2:${record.spo2} Steps:${record.steps}`);
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health/latest — fetch latest vitals for a specific user via Google Fit REST API
app.get("/api/health/latest", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "email query parameter is required" });
    const record = await getLatestMetrics(email);
    if (!record) return res.status(404).json({ error: "No health data found for this user" });
    res.json(record);
  } catch (err) {
    console.error("[Health API Error]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/health/force-sync — force a sync from Google Fit API and broadcast update
app.post("/api/health/force-sync", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });
    
    const record = await getLatestMetrics(email);
    if (!record) return res.status(404).json({ error: "No health data found for this user" });
    
    const room = `health_${record.userEmail.toLowerCase().trim()}`;
    io.to(room).emit("health:updated", record);
    console.log(`[Health] Force synced vitals for ${record.userEmail}`);
    
    res.json({ success: true, data: record });
  } catch (err) {
    console.error("[Health API Error]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Authentication ────────────────────────────────────────────────
const axios = require('axios');
app.post("/api/auth/google", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Authorization code required" });

  try {
    // 1. Exchange code for tokens (access_type: 'offline' ensures refresh_token is returned)
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:3000/auth/google/callback',
      access_type: 'offline',
    });

    const { access_token, refresh_token } = tokenResponse.data;

    // 2. Fetch user profile
    const profileResponse = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const profile = profileResponse.data;

    // 3. Initialize Firebase Admin if needed
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = require('./serviceAccountKey.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DB_URL || 'https://rapid-crisis-response-default-rtdb.firebaseio.com',
      });
    }

    // 4. Fetch or Create Firebase User
    let uid;
    try {
      const userRecord = await admin.auth().getUserByEmail(profile.email);
      uid = userRecord.uid;
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        const newUser = await admin.auth().createUser({
          email: profile.email,
          emailVerified: true,
          displayName: profile.name,
          photoURL: profile.picture,
        });
        uid = newUser.uid;
      } else {
        throw error;
      }
    }

    // 5. Save/Update Guest Profile in RTDB with Tokens
    const db = admin.database();
    const guestRef = db.ref(`guests/${uid}`);
    const snap = await guestRef.once('value');
    
    if (!snap.exists()) {
      await guestRef.set({
        name: profile.name || profile.email.split('@')[0],
        email: profile.email,
        photoURL: profile.picture || null,
        phone: '',
        guardians: [],
        createdAt: Date.now(),
        role: 'guest',
        provider: 'google',
        googleAccessToken: access_token,
        googleRefreshToken: refresh_token || null,
      });
    } else {
      const updates = {
        name: profile.name || snap.val()?.name,
        photoURL: profile.picture || snap.val()?.photoURL,
        googleAccessToken: access_token,
        updatedAt: Date.now(),
      };
      if (refresh_token) updates.googleRefreshToken = refresh_token;
      await guestRef.update(updates);
    }

    // 6. Generate Firebase Custom Token
    const customToken = await admin.auth().createCustomToken(uid);

    res.json({ firebaseCustomToken: customToken, user: profile });
  } catch (error) {
    console.error("[Auth API Error]", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.error_description || error.message });
  }
});

server.listen(PORT, () => console.log(`✅ Backend + Socket.io running on http://localhost:${PORT}`));
