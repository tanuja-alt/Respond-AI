# 🚨 RespondAI — Hotel Emergency Response System

RespondAI is a real-time emergency response platform built for hotels and large venues. When a guest is in danger, they hit the SOS button. Staff are notified instantly, an ambulance is dispatched, and the guest can track the ambulance live on a map — all from their phone.

---
(never committed)
│
└── frontend/
    └── src/
        ├── pages/
        │   ├── SOSPage.jsx           # Guest: SOS form + confirm screen + live map
        │   ├── Dashboard.jsx         # Admin: incident list + dispatch + chat
        │   ├── DriverDashboard.jsx   # Driver: accept incidents + GPS stream
        │   ├── Authpage.jsx          # Login / Register (email, Google, Apple)
        │   ├── GuestProfilePage.jsx  # Guest profile + guardians
        │   ├── SOSHistoryPage.jsx    # Guest's past SOS history
        │   ├── ChatHistoryPage.jsx   # Past chat transcripts
        │   └── SimulatePage.jsx      # Demo scenario trigger (admin only)
        │
        ├── components/
        │   ├── AmbulanceMap.jsx          # Leaflet map with ambulance + OSRM route
        │   ├── DashboardWithSOSListener.jsx  # Wraps Dashboard, adds alarm + silent SOS
        │   ├── AcousticDetectorPanel.jsx # Mic waveform + TF.js crisis sound detection
        │   ├── HealthMetricsCard.jsx     # Smartwatch vitals display
        │   ├── VitalsMonitorCard.jsx     # Admin-side live vitals panel
        │   ├── CrisisCompanion.jsx       # Gemini AI multi-turn chat companion
        │   ├── DisasterBanner.jsx        # Weather / disaster alert banner
        │   ├── LiveChat.jsx              # Real-time guest ↔ staff chat
        │   ├── SOSAlert.jsx              # Alarm overlay modal for new SOS
        │   ├── WeatherWidget.jsx         # Current weather for admin
        │   ├── LanguageSelector.jsx      # 16-language switcher
        │   └── SpeakButton.jsx           # Text-to-speech accessibility button
        │
        ├── services/
        │   ├── socketService.js          # Socket.io singleton + room management
        │   ├── acousticDetectorService.js # TF.js microphone + waveform analyser
        │   └── soundNotificationService.js # Alarm audio playback
        │
        ├── utils/
        │   ├── db.js                     # IndexedDB wrapper for offline SOSs
        │   └── sync-manager.js           # Background sync when back online
        │
        ├── i18n/
        │   ├── index.js                  # i18next setup
        │   └── locales/                  # 16 language JSON files
        │
        ├── firebase.js                   # All Firebase read/write functions
        └── App.js                        # Routes + auth guard + role detection
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- A Firebase project (Realtime Database enabled)
- A Google Cloud project with OAuth credentials (for Google Sign-In)
- Gemini API key (free at [aistudio.google.com](https://aistudio.google.com))
- Twilio account (optional, for WhatsApp guardian alerts)

### 1. Clone and install

```bash
git clone https://github.com/sarthakpcet27-code/RESPOND-AI.git
cd RESPOND-AI

# Install backend deps
cd backend && npm install

# Install frontend deps
cd ../frontend && npm install
```

### 2. Set up environment variables

**`backend/.env`**
```env
GEMINI_API_KEY=your_gemini_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
WEATHER_API_KEY=your_openweathermap_key
FRONTEND_URL=http://localhost:3000
PORT=3001
```

**`frontend/.env`**
```env
REACT_APP_FIREBASE_API_KEY=your_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id
REACT_APP_API_URL=http://localhost:3001
```

### 3. Run

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm start
```

Open `http://localhost:3000`.

---

## 🔄 Real-time Architecture

```
Browser (Guest/Admin/Driver)
        │
        │  Socket.io  (WebSocket)
        ▼
  backend/server.js
        │
        ├─ driver_location_update  →  getOSRMRoute()  →  ambulance_location_update
        │                                                   (broadcast to incident room)
        ├─ join_incident_room  →  joins Socket.io room, replays last known location
        ├─ driver:start_navigation  →  navigation_started broadcast + Firebase write
        └─ health:updated  →  broadcast vitals to admin room

Firebase Realtime DB  (persistent fallback)
        │
        └─ incidents/{id}  — driverLocation, routeEtaMinutes, navigating status
                             (guest reads this on reconnect if socket missed events)
```

The guest dashboard uses a **dual-channel** approach:
1. **Socket.io** — gets ambulance location updates within milliseconds
2. **HTTP polling** — calls `GET /api/ambulance/driver-location/:id` every 8 seconds as a fallback if the socket event was missed
3. **Firebase listener** — `listenToIncident()` catches any driver location that was persisted to the database

---

## 🗺️ User Roles

| Role | How to set | What they see |
|---|---|---|
| **Guest** | Default for all sign-ups | SOS page, ambulance tracking, chat, profile |
| **Admin / Staff** | Add email to `ADMIN_EMAILS` in `App.js` or set `role: 'admin'` in Firebase | Full dashboard, dispatch, all incidents |
| **Driver** | Set `role: 'driver'` in Firebase for that user's profile | Driver dashboard, assigned incidents, GPS navigation |

---

## 🌍 Languages Supported

English · Hindi · Arabic · French · Spanish · Portuguese · Chinese · Bengali · Gujarati · Kannada · Malayalam · Marathi · Odia · Tamil · Telugu · Urdu

Language files are in `frontend/src/i18n/locales/`. The language selector is available on the auth page and guest navbar.

---

## 🔑 Key API Endpoints

| Method | Endpoint | What it does |
|---|---|---|
| `POST` | `/api/classify` | Gemini AI classifies an incident description |
| `POST` | `/api/notify` | Sends WhatsApp alerts to the guest's guardians |
| `POST` | `/api/simulate` | Triggers a demo incident (fire/medical/security/flood) |
| `GET` | `/api/ambulance/route` | On-demand OSRM route between two coordinates |
| `GET` | `/api/ambulance/driver-location/:id` | Last known driver location for an incident |
| `GET` | `/api/alerts/nearby` | Disaster alerts near a lat/lng |
| `POST` | `/api/health/sync` | Ingest smartwatch vitals |
| `GET` | `/api/health/latest` | Fetch latest vitals for a user |
| `GET` | `/api/status` | Health check |

---

## 🧪 Testing the Full Flow (localhost)

1. **Register** as a guest at `localhost:3000/auth`
2. Tick **"Ambulance Required"**, describe the emergency, tap **SOS**
3. Open a second browser tab → sign in as admin → go to `/dashboard`
4. Admin sees the alert with alarm sound → click **"Accept & Auto-Dispatch Ambulance 🚑"**
5. Open a third tab → sign in as a driver account → go to `/driver/dashboard`
6. Driver clicks **"Accept & Start Navigation"**
7. Click **🧭 Simulate** (only visible on localhost) — fake GPS walks toward the victim
8. Watch the **ambulance emoji move on both the admin and guest maps** with ETA updating live

---

## 🛡️ Security Notes

- `.env` files and `serviceAccountKey.json` are gitignored — never committed
- Firebase Auth guards all routes — guests cannot see admin pages and vice versa
- Google Fit (fitness scopes) only requested during explicit re-auth, not on every sign-in — avoids the "Google hasn't verified this app" warning for normal users

---

## 📦 Built With

- [React](https://react.dev) · [Firebase](https://firebase.google.com) · [Socket.io](https://socket.io) · [Leaflet](https://leafletjs.com) · [OSRM](http://project-osrm.org) · [Google Gemini](https://aistudio.google.com) · [TensorFlow.js](https://www.tensorflow.org/js) · [Twil
## 📸 What it looks like

| Guest SOS Screen | Admin Dashboard | Driver Dashboard |
|---|---|---|
| Big red SOS button, AI response plan, live ambulance map | All active incidents, ambulance dispatch, live chat | Assigned emergencies, GPS navigation, simulate button |

---

## 🧠 How it works (simple version)

```
Guest taps SOS
    ↓
Firebase stores the incident
    ↓
Admin sees it instantly on dashboard (with alarm sound)
    ↓
Admin clicks "Dispatch Ambulance"
    ↓
Driver accepts → GPS streams to server via Socket.io
    ↓
Server calls OSRM for live route + ETA
    ↓
Admin map + Guest map both update in real time
    ↓
Incident resolved ✅
```

---

## ✨ Features

### 👤 For Guests (victims)

- **One-tap SOS** with a 3-second countdown (can cancel)
- Choose crisis type: 🔥 Fire · 🏥 Medical · 🔒 Security · 🌊 Flood · ⚠️ Other
- **AI Response Plan** — Gemini AI classifies the incident and gives step-by-step survival instructions
- **Live Ambulance Map** — see exactly where the ambulance is and how many minutes away
- **Live Chat** with hotel staff during the emergency
- **Silent SOS** — shake the phone 3 times in 2 seconds to fire a covert distress signal (for hostage/threat situations)
- **Acoustic Crisis Detection** — microphone listens for screams, gunshots, or glass breaking using TensorFlow.js
- **Offline Mode** — SOS is saved locally and auto-syncs when internet returns
- **Smartwatch Vitals** — live heart rate, SpO2, and step count from Google Fit displayed on the confirmation screen
- **Weather Alerts** — nearby severe weather warnings shown at the top
- **16 Languages** — English, Hindi, Arabic, French, Spanish, Portuguese, Chinese, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Tamil, Telugu, Urdu

### 🛡️ For Staff (admin)

- **Live incident feed** with severity colour coding (RED / YELLOW / GREEN)
- **Alarm sound** plays automatically when a new SOS arrives
- **Silent SOS section** — covert alerts appear separately so staff don't call back
- **AI Response Plan** — same Gemini classification shown on admin side
- **Ambulance Dispatch** — one click assigns a driver and starts live GPS tracking
- **Live Ambulance Map** with OSRM route polyline, distance, and ETA badge
- **Live Chat** with the guest
- **Patient Health Vitals panel** — shows the guest's smartwatch data in real time
- **Guardian notifications** — WhatsApp messages sent to emergency contacts via Twilio
- **Weather & Disaster Alerts** — USGS earthquakes, OpenWeatherMap severe weather, GDACS global events
- **Incident filters** — All / Active / RED / YELLOW / GREEN
- **Scenario Simulator** — trigger test incidents (fire, medical, security, flood) without a real guest

### 🚑 For Drivers

- **Assigned incidents list** — shows incidents dispatched to this driver's account
- **Accept & Navigate** — one tap starts GPS streaming to the server
- **Live navigation map** — Leaflet map centred on the victim with route overlay
- **🧭 Simulate button** (localhost only) — moves fake GPS coordinates toward the victim every 3 seconds for end-to-end testing without a real phone

---

## 🏗️ Tech Stack

### Frontend
| What | Tech |
|---|---|
| Framework | React 19 |
| Maps | Leaflet + React-Leaflet |
| Real-time | Socket.io client |
| Auth | Firebase Auth (Email, Google, Apple) |
| Database | Firebase Realtime Database |
| Routing | React Router v7 |
| Animations | Framer Motion |
| Notifications | react-hot-toast |
| AI (acoustic) | TensorFlow.js + Speech Commands model |
| Internationalisation | i18next (16 languages) |
| Offline storage | IndexedDB (custom `db.js` util) |

### Backend
| What | Tech |
|---|---|
| Server | Node.js + Express |
| Real-time | Socket.io |
| AI classification | Google Gemini (`gemini-3.5-flash`) |
| Routing | OSRM public API (no key needed) |
| Notifications | Twilio (WhatsApp) |
| Disaster alerts | USGS · OpenWeatherMap · GDACS |
| Health data | Google Fit REST API |
| Database | Firebase Admin SDK (Realtime DB) |

---

## 📁 Project Structure

```
rapid-crisis-response/
├── backend/
│   ├── server.js                 # Express server + all Socket.io handlers
│   ├── ambulanceService.js       # OSRM route calculation
│   ├── geminiservice.js          # Gemini AI incident classification
│   ├── crisisGuideService.js     # Gemini multi-turn crisis chat
│   ├── disasterAlertService.js   # USGS / OpenWeatherMap / GDACS
│   ├── healthservice.js          # Google Fit vitals + in-memory cache
│   ├── notifyService.js          # Twilio WhatsApp guardian alerts
│   └── .env                      # API keys io](https://www.twilio.com) · [Framer Motion](https://www.framer.com/motion)

---

*Built for rapid hotel emergency response. Every second counts.*
