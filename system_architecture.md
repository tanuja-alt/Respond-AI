# RespondAI — Technical Flow & System Architecture

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph "Frontend — React SPA :3000"
        AUTH["AuthPage.jsx<br/>Email / Google / Apple Login"]
        SOS["SOSPage.jsx<br/>SOS Button + AI Chat + Map"]
        DASH["Dashboard.jsx<br/>Admin/Staff Panel"]
        DRIVER["DriverDashboard.jsx<br/>Ambulance Navigation"]
        PROFILE["GuestProfilePage.jsx<br/>Guardian Setup"]
        HISTORY["SOSHistoryPage.jsx<br/>ChatHistoryPage.jsx"]
        SIM["SimulatePage.jsx<br/>GPS Simulation"]
    end

    subgraph "Shared Services — Frontend"
        FB_CLIENT["firebase.js<br/>Auth + RTDB Client"]
        SOCKET_CLIENT["socketService.js<br/>Socket.io Client"]
        SOUND["soundNotificationService.js<br/>Audio Alerts"]
        I18N["i18n + react-i18next<br/>Multi-language"]
    end

    subgraph "Backend — Node.js + Express :3001"
        SERVER["server.js<br/>Express + Socket.io Server"]
        GEMINI["geminiService.js<br/>Google Gemini AI"]
        NOTIFY["notifyService.js<br/>Twilio WhatsApp"]
        AMBULANCE["ambulanceService.js<br/>OSRM Routing"]
        CRISIS["crisisGuideService.js<br/>AI Crisis Chat"]
        DISASTER["disasterAlertService.js<br/>Weather + Seismic"]
        HEALTH["healthService.js<br/>Google Fit Vitals"]
    end

    subgraph "External Services"
        FIREBASE["Firebase<br/>Auth + Realtime DB"]
        TWILIO["Twilio API<br/>WhatsApp SOS"]
        GEMINI_API["Google Gemini 2.0<br/>Flash / Pro"]
        OSRM["OSRM<br/>Route Engine"]
        GFIT["Google Fit API<br/>Heart Rate / SpO₂"]
        WEATHER["OpenWeatherMap<br/>+ USGS Earthquake"]
        LEAFLET["OpenStreetMap<br/>Leaflet Tiles"]
    end

    AUTH --> FB_CLIENT
    SOS --> FB_CLIENT
    SOS --> SOCKET_CLIENT
    DASH --> FB_CLIENT
    DASH --> SOCKET_CLIENT
    DRIVER --> SOCKET_CLIENT
    PROFILE --> FB_CLIENT

    FB_CLIENT --> FIREBASE
    SOCKET_CLIENT --> SERVER

    SERVER --> GEMINI
    SERVER --> NOTIFY
    SERVER --> AMBULANCE
    SERVER --> CRISIS
    SERVER --> DISASTER
    SERVER --> HEALTH

    GEMINI --> GEMINI_API
    NOTIFY --> TWILIO
    AMBULANCE --> OSRM
    CRISIS --> GEMINI_API
    DISASTER --> WEATHER
    HEALTH --> GFIT
    SOS --> LEAFLET

    style AUTH fill:#1a1a26,stroke:#8B5CF6,color:#C4B5FD
    style SOS fill:#1a1a26,stroke:#E24B4A,color:#F87171
    style DASH fill:#1a1a26,stroke:#E24B4A,color:#F87171
    style DRIVER fill:#1a1a26,stroke:#10B981,color:#34D399
    style SERVER fill:#0f172a,stroke:#3B82F6,color:#93C5FD
    style FIREBASE fill:#0d1117,stroke:#F59E0B,color:#FCD34D
    style GEMINI_API fill:#0d1117,stroke:#8B5CF6,color:#C4B5FD
```

---

## 2. SOS Alert Flow (End-to-End)

```mermaid
sequenceDiagram
    participant Guest as 👤 Guest App
    participant Firebase as 🔥 Firebase RTDB
    participant Server as 🖥️ Backend Server
    participant Gemini as 🤖 Gemini AI
    participant Twilio as 📱 Twilio WhatsApp
    participant Admin as 🛡️ Admin Dashboard
    participant Driver as 🚑 Driver Dashboard

    Guest->>Guest: Press SOS Button
    Guest->>Guest: navigator.geolocation.watchPosition()
    Guest->>Firebase: createIncident({ type, location, description })
    Firebase-->>Admin: onValue("incidents") → new incident appears
    Admin->>Admin: soundService.playSOSAlert() 🔊

    Guest->>Server: POST /api/classify-incident
    Server->>Gemini: Classify severity (RED/YELLOW/GREEN) + SOP
    Gemini-->>Server: { severity, sop[], summary }
    Server-->>Guest: AI Response Plan

    Server->>Firebase: Update incident with AI results
    Firebase-->>Admin: Real-time severity + SOP update

    Note over Server,Twilio: Guardian Notification
    Server->>Firebase: Fetch guardians[] from guests/{uid}
    Server->>Twilio: Send WhatsApp SOS to each guardian
    Twilio-->>Server: Delivery status
    Server->>Firebase: Update guardiansNotified count

    Note over Admin,Driver: Ambulance Dispatch
    Admin->>Firebase: assignedDriverUid = admin.uid
    Admin->>Server: socket.emit("incident:accept_dispatch")
    Firebase-->>Driver: onValue() → incident assigned
    Driver->>Driver: Accept → watchPosition() or Simulate
    Driver->>Server: socket.emit("driver_location_update")
    Server->>Server: getOSRMRoute(driver → victim)
    Server-->>Admin: socket.emit("ambulance_location_update")
    Server-->>Guest: socket.emit("ambulance_location_update")
    Server->>Firebase: Persist driverLocation to RTDB
```

---

## 3. Live Ambulance Tracking Flow

```mermaid
flowchart LR
    subgraph "Driver Device"
        GPS["watchPosition()<br/>enableHighAccuracy: true<br/>maximumAge: 0"]
        EMIT["emitDriverLocation()<br/>{ incidentId, lat, lng,<br/>victimLat, victimLng }"]
    end

    subgraph "Backend Server"
        RECV["socket.on<br/>driver_location_update"]
        ROUTE["getOSRMRoute()<br/>OSRM API Call"]
        CACHE["driverLocations[id]<br/>In-Memory Cache"]
        BROADCAST["io.to(room).emit<br/>ambulance_location_update"]
        PERSIST["Firebase RTDB<br/>incidents/{id}/driverLocation"]
    end

    subgraph "Admin Dashboard"
        ADMIN_SOCKET["onAmbulanceLocationChanged()"]
        ADMIN_MAP["AmbulanceMap.jsx<br/>Leaflet Marker + Polyline"]
    end

    subgraph "Guest SOS Page"
        GUEST_SOCKET["onAmbulanceLocationChanged()"]
        GUEST_FB["listenToIncident() fallback"]
        GUEST_MAP["AmbulanceMap.jsx<br/>Ambulance Marker + ETA"]
    end

    GPS -->|every ~3s| EMIT
    EMIT -->|Socket.io| RECV
    RECV --> ROUTE
    ROUTE --> CACHE
    CACHE --> BROADCAST
    RECV --> PERSIST
    BROADCAST -->|room: incident_{id}| ADMIN_SOCKET
    BROADCAST -->|room: incident_{id}| GUEST_SOCKET
    PERSIST -->|onValue listener| GUEST_FB
    ADMIN_SOCKET --> ADMIN_MAP
    GUEST_SOCKET --> GUEST_MAP
    GUEST_FB --> GUEST_MAP

    style GPS fill:#064e3b,stroke:#10B981,color:#A7F3D0
    style ROUTE fill:#1e1b4b,stroke:#8B5CF6,color:#C4B5FD
    style BROADCAST fill:#7f1d1d,stroke:#E24B4A,color:#FCA5A5
    style PERSIST fill:#78350f,stroke:#F59E0B,color:#FCD34D
```

---

## 4. Firebase Realtime Database Schema

```mermaid
erDiagram
    GUESTS {
        string uid PK
        string name
        string email
        string phone
        string[] guardians
        string role
        string provider
        string googleAccessToken
        number createdAt
    }

    INCIDENTS {
        string id PK
        string guestUid FK
        string guestName
        string guestEmail
        string guestPhone
        string crisisType
        string description
        string status
        string severity
        object location
        boolean requiresAmbulance
        boolean silentAlert
        string assignedDriverUid
        boolean navigating
        object driverLocation
        number routeEtaMinutes
        number routeDistanceKm
        string[] sop
        string summary
        number guardiansNotified
        string weatherAlert
        object chat
        number created_at
    }

    HEALTH_METRICS {
        string email PK
        number heartRate
        number spo2
        number steps
        number lastSynced
    }

    GUESTS ||--o{ INCIDENTS : "reports"
```

---

## 5. Component Dependency Map

```mermaid
graph TD
    APP["App.jsx<br/>React Router"]

    APP --> AUTH_PAGE["AuthPage.jsx<br/>Login / Register"]
    APP --> GUEST_HOME["SOSPage.jsx<br/>Guest Home + SOS"]
    APP --> ADMIN_WRAP["DashboardWithSOSListener.jsx"]
    APP --> DRIVER_DASH["DriverDashboard.jsx"]
    APP --> GUEST_PROFILE["GuestProfilePage.jsx"]
    APP --> SOS_HISTORY["SOSHistoryPage.jsx"]
    APP --> CHAT_HISTORY["ChatHistoryPage.jsx"]
    APP --> GOOGLE_CB["GoogleCallback.jsx"]

    ADMIN_WRAP --> DASHBOARD["Dashboard.jsx"]
    ADMIN_WRAP --> SOS_ALERT["SOSAlert.jsx"]
    ADMIN_WRAP --> SOUND_SVC["soundNotificationService.js"]

    DASHBOARD --> AMBULANCE_MAP["AmbulanceMap.jsx"]
    DASHBOARD --> WEATHER["WeatherWidget.jsx"]
    DASHBOARD --> VITALS["VitalsMonitorCard.jsx"]
    DASHBOARD --> LANG["LanguageSelector.jsx"]

    GUEST_HOME --> AMBULANCE_MAP
    GUEST_HOME --> COMPANION["CrisisCompanion.jsx<br/>AI Chat"]
    GUEST_HOME --> ACOUSTIC["AcousticDetectorPanel.jsx<br/>🎤 Scream Detection"]
    GUEST_HOME --> SPEAK["SpeakButton.jsx<br/>🗣️ Voice Input"]
    GUEST_HOME --> OFFLINE["OfflineBanner.jsx"]
    GUEST_HOME --> DISASTER_BNR["DisasterBanner.jsx"]

    DRIVER_DASH --> AMBULANCE_MAP

    style APP fill:#1a1a26,stroke:#fff,color:#fff
    style GUEST_HOME fill:#1a1a26,stroke:#E24B4A,color:#F87171
    style DASHBOARD fill:#1a1a26,stroke:#E24B4A,color:#F87171
    style DRIVER_DASH fill:#1a1a26,stroke:#10B981,color:#34D399
    style AMBULANCE_MAP fill:#064e3b,stroke:#10B981,color:#A7F3D0
    style COMPANION fill:#1e1b4b,stroke:#8B5CF6,color:#C4B5FD
    style ACOUSTIC fill:#7f1d1d,stroke:#E24B4A,color:#FCA5A5
```

---

## 6. Technology Stack Summary

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend Framework** | React 18 + Create React App | SPA with component-based architecture |
| **Routing** | React Router v6 | Client-side page navigation |
| **State Management** | React useState/useEffect + Firebase onValue | Real-time reactive state |
| **Styling** | Inline styles + CSS Modules + Framer Motion | Dark glassmorphic UI with animations |
| **Maps** | Leaflet + react-leaflet + OpenStreetMap | Interactive map tiles and markers |
| **Internationalization** | react-i18next | Multi-language support (EN, HI, MR, etc.) |
| **Backend Runtime** | Node.js + Express | REST API server |
| **Real-time Transport** | Socket.io (WebSocket + polling fallback) | Live ambulance tracking & event broadcasting |
| **Database** | Firebase Realtime Database | NoSQL JSON tree — incidents, guests, health |
| **Authentication** | Firebase Auth (Email, Google, Apple) | Multi-provider user authentication |
| **AI / Classification** | Google Gemini 2.0 Flash | Incident severity classification + SOP generation |
| **AI Chat** | Google Gemini Pro | Crisis companion conversational AI |
| **Notifications** | Twilio WhatsApp API (Sandbox) | Guardian SOS alerts via WhatsApp |
| **Routing Engine** | OSRM (Open Source Routing Machine) | Driving distance, ETA, and polyline calculation |
| **Health Monitoring** | Google Fit REST API | Heart rate, SpO₂, step count telemetry |
| **Weather / Disaster** | OpenWeatherMap + USGS Earthquake API | Severe weather alerts + seismic monitoring |
| **Audio Detection** | Web Audio API (AudioWorklet) | Real-time scream/explosion detection |
| **Voice Input** | Web Speech API (SpeechRecognition) | Hands-free SOS via voice command |
| **PWA / Offline** | Service Worker + Background Sync | Offline SOS queuing and network resilience |

---

## 7. API Endpoints

| Method | Route | Handler | Description |
|---|---|---|---|
| `POST` | `/api/classify-incident` | `geminiService.classifyIncident` | AI severity classification + SOP |
| `POST` | `/api/crisis-guide` | `crisisGuideService.chatCrisisGuide` | AI crisis companion chat |
| `GET` | `/api/disaster-alerts` | `disasterAlertService.getNearbyAlerts` | Weather + earthquake alerts |
| `GET` | `/api/ambulance/driver-location/:id` | In-memory cache lookup | Cached driver GPS position |
| `POST` | `/api/health/sync` | `healthService.upsertMetrics` | Sync Google Fit vitals |
| `GET` | `/api/health/:email` | `healthService.getLatestMetrics` | Fetch latest health metrics |
| `POST` | `/api/health/force-sync` | `healthService` | Force re-fetch from Google Fit |

## 8. Socket.io Events

| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `join_incident_room` | Client → Server | `{ incidentId }` | Join a room for incident updates |
| `driver:online` | Client → Server | `{ driverId }` | Register driver as available |
| `incident:accept_dispatch` | Client → Server | `{ incidentId, userId }` | Accept ambulance dispatch |
| `driver:start_navigation` | Client → Server | `{ incidentId, driverId }` | Signal navigation has started |
| `driver_location_update` | Client → Server | `{ incidentId, lat, lng, victimLat, victimLng }` | Stream driver GPS |
| `ambulance_location_update` | Server → Client | `{ incidentId, driverLocation, routeData }` | Broadcast ambulance position + route |
| `navigation_started` | Server → Client | `{ incidentId, driverId, startedAt }` | Notify all that navigation began |
| `join_health_stream` | Client → Server | `{ email }` | Subscribe to health vitals updates |
| `health:updated` | Server → Client | `{ heartRate, spo2, steps }` | Real-time vitals push |
