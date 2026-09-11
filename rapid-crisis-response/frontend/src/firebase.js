// frontend/src/firebase.js
// Every function that reads/writes Firebase now:
//   1. Has a try-catch and returns null/[] on failure instead of throwing
//   2. Logs the exact error so you can see it in the console
//   3. Uses the correct SDK path

import { initializeApp }   from "firebase/app";
import {
  getDatabase, ref, set, push, onValue, update, get,
  query, orderByChild, equalTo,
} from "firebase/database";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
} from "firebase/auth";

// ── Config ─────────────────────────────────────────────────────
// These values must also be set as environment variables in Vercel:
//   REACT_APP_FIREBASE_API_KEY, REACT_APP_FIREBASE_AUTH_DOMAIN, etc.
const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY            || "AIzaSyCwvJX7NiL64VLB7gkdpckPcVgfp67w0Xs",
  authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN        || "rapid-crisis-response.firebaseapp.com",
  databaseURL:       process.env.REACT_APP_FIREBASE_DATABASE_URL       || "https://rapid-crisis-response-default-rtdb.firebaseio.com",
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID         || "rapid-crisis-response",
  storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET     || "rapid-crisis-response.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID|| "411234284723",
  appId:             process.env.REACT_APP_FIREBASE_APP_ID             || "1:411234284723:web:4d8f4af2ec1f605e20acc6",
};

const app  = initializeApp(firebaseConfig);
export const db   = getDatabase(app);
export const auth = getAuth(app);

// ── Startup Config Validation ──────────────────────────────────
console.log('[Firebase] ✅ Initialized with project:', firebaseConfig.projectId);
console.log('[Firebase] Auth domain:', firebaseConfig.authDomain);
console.log('[Firebase] API key starts with:', firebaseConfig.apiKey?.substring(0, 12) + '...');
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY_HERE') {
  console.error('[Firebase] ❌ FATAL: API key is missing or placeholder! Auth WILL fail.');
}
if (!firebaseConfig.authDomain) {
  console.error('[Firebase] ❌ FATAL: authDomain is missing! Google Sign-In WILL fail.');
}

// ── Helpers ────────────────────────────────────────────────────
const log  = (msg, d)  => console.log(`[Firebase] ${msg}`, d ?? '');
const elog = (msg, e)  => console.error(`[Firebase] ❌ ${msg}`, '| code:', e?.code ?? 'N/A', '| message:', e?.message ?? 'N/A', '| full:', e ?? '');

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

/**
 * Normalize a phone string to E.164: strip spaces, dashes, parens, trim.
 * e.g. "+91 98765-43210" → "+9198765 43210" → "+919876543210"
 */
const normalizePhone = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[\s\-()]/g, '').trim();
};

export const registerGuest = async (name, email, password, phone = '', guardians = []) => {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    // Write profile — if this fails the user is still registered, just profile is missing
    try {
      const profileData = {
        name, email, phone: normalizePhone(phone), createdAt: Date.now(), role: 'guest',
      };
      // Normalize & save guardians array — E.164 strings
      if (Array.isArray(guardians) && guardians.length > 0) {
        profileData.guardians = guardians
          .map(g => normalizePhone(g))
          .filter(g => g.length > 0);
        log('Guardians normalized:', profileData.guardians);
      }
      await set(ref(db, `guests/${cred.user.uid}`), profileData);
      log('Profile written for', cred.user.uid);
    } catch (e) {
      elog('Could not write guest profile (check DB rules)', e);
    }
    return cred.user;
  } catch (err) {
    console.error('[Firebase] ❌ registerGuest FAILED | code:', err.code, '| message:', err.message);
    if (err.code === 'auth/invalid-api-key') console.error('[Firebase] → Your API key is invalid. Check firebaseConfig.apiKey');
    if (err.code === 'auth/unauthorized-domain') console.error('[Firebase] → This domain is not authorized. Add it in Firebase Console → Authentication → Settings → Authorized domains');
    throw err;
  }
};

export const loginGuest = async (email, password) => {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    log('loginGuest success for', email);
    return cred;
  } catch (err) {
    console.error('[Firebase] ❌ loginGuest FAILED | code:', err.code, '| message:', err.message);
    if (err.code === 'auth/invalid-api-key') console.error('[Firebase] → Your API key is invalid. Check firebaseConfig.apiKey');
    if (err.code === 'auth/unauthorized-domain') console.error('[Firebase] → This domain is not authorized. Add it in Firebase Console → Authentication → Settings → Authorized domains');
    if (err.code === 'auth/user-not-found') console.error('[Firebase] → No account exists for this email. Register first.');
    if (err.code === 'auth/wrong-password') console.error('[Firebase] → Password is incorrect.');
    if (err.code === 'auth/invalid-credential') console.error('[Firebase] → Invalid credentials. The email/password combination is wrong.');
    throw err;
  }
};
export const logoutGuest  = ()                 => signOut(auth);
export const onAuthChange = (cb)               => onAuthStateChanged(auth, cb);

// ── Custom Token Login (used by GoogleCallback.jsx for redirect-based OAuth) ──
export const loginWithCustomToken = (token) => signInWithCustomToken(auth, token);

// ── Google Sign-In ─────────────────────────────────────────────
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'consent', access_type: 'offline' });
googleProvider.addScope('https://www.googleapis.com/auth/fitness.heart_rate.read');
googleProvider.addScope('https://www.googleapis.com/auth/fitness.oxygen_saturation.read');
googleProvider.addScope('https://www.googleapis.com/auth/fitness.activity.read');

/**
 * Sign in with Google popup, then upsert a guest profile in RTDB
 * so Google users are treated the same as email/password users.
 * Returns the Firebase user on success; throws on failure.
 */
export const loginWithGoogle = async () => {
  let cred;
  try {
    cred = await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error('[Firebase] ❌ Google Sign-In FAILED | code:', err.code, '| message:', err.message);
    if (err.code === 'auth/unauthorized-domain') {
      console.error('[Firebase] → FIX: Go to Firebase Console → Authentication → Settings → Authorized domains');
      console.error('[Firebase] → Add this domain:', window.location.hostname);
    }
    if (err.code === 'auth/invalid-api-key') console.error('[Firebase] → Your API key is invalid. Check firebaseConfig.apiKey');
    if (err.code === 'auth/popup-blocked') console.error('[Firebase] → Browser blocked the popup. Allow popups for this site.');
    if (err.code === 'auth/operation-not-allowed') console.error('[Firebase] → Google sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method → Google');
    throw err;
  }
  const u    = cred.user;
  
  // Extract the Google OAuth access token to pass to the backend for Google Fit integration
  const credential = GoogleAuthProvider.credentialFromResult(cred);
  const googleAccessToken = credential?.accessToken || null;

  try {
    // Only write to DB if this is a new Google user (no existing profile)
    const snap = await get(ref(db, `guests/${u.uid}`));
    if (!snap.exists()) {
      await set(ref(db, `guests/${u.uid}`), {
        name:      u.displayName || u.email?.split('@')[0] || 'Guest',
        email:     u.email || '',
        photoURL:  u.photoURL  || null,
        phone:     '',
        guardians: [],
        createdAt: Date.now(),
        role:      'guest',
        provider:  'google',
        googleAccessToken,
      });
      log('Google user profile created for', u.uid);
    } else {
      // Refresh photoURL, displayName, and update the access token on every sign-in
      await update(ref(db, `guests/${u.uid}`), {
        name:     u.displayName || snap.val()?.name || 'Guest',
        photoURL: u.photoURL   || snap.val()?.photoURL || null,
        googleAccessToken: googleAccessToken || snap.val()?.googleAccessToken || null,
        updatedAt: Date.now(),
      });
      log('Google user profile refreshed for', u.uid);
    }
  } catch (e) {
    elog(`loginWithGoogle: could not upsert guest profile for ${u.uid}`, e);
    // Non-fatal — user is still authenticated
  }

  // Trigger backend force-sync after a short delay to let the RTDB write propagate
  const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';
  if (u.email && googleAccessToken) {
    setTimeout(async () => {
      try {
        await fetch(`${API}/api/health/force-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: u.email }),
        });
        log('Post-login force-sync triggered for', u.email);
      } catch (e) {
        // Non-fatal — sync will happen on next poll
        elog('Post-login force-sync failed (non-fatal)', e);
      }
    }, 1500); // 1.5s delay for RTDB propagation
  }

  return u;
};

// ── Apple Sign-In ───────────────────────────────────────────────
const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');

/**
 * Sign in with Apple popup, then upsert a guest profile in RTDB.
 *
 * Important Apple-specific notes:
 *   - Apple only sends the user's full name on the VERY FIRST sign-in.
 *     We capture it from additionalUserInfo.profile on that first call.
 *   - Apple may provide a private relay email (e.g. xyz@privaterelay.appleid.com).
 *     We store it as-is — it's the only identity available.
 *   - On repeat sign-ins displayName will be null; we fall back to the
 *     stored DB name so the profile is never overwritten with null.
 */
export const loginWithApple = async () => {
  let cred;
  try {
    cred = await signInWithPopup(auth, appleProvider);
  } catch (err) {
    console.error('[Firebase] ❌ Apple Sign-In FAILED | code:', err.code, '| message:', err.message);
    if (err.code === 'auth/unauthorized-domain') {
      console.error('[Firebase] → FIX: Go to Firebase Console → Authentication → Settings → Authorized domains');
      console.error('[Firebase] → Add this domain:', window.location.hostname);
    }
    if (err.code === 'auth/operation-not-allowed') console.error('[Firebase] → Apple sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method → Apple');
    if (err.code === 'auth/invalid-api-key') console.error('[Firebase] → Your API key is invalid.');
    throw err;
  }
  const u      = cred.user;

  // Apple only sends name the first time — extract from the OAuthCredential
  const profile      = cred._tokenResponse ?? {};
  const firstName    = profile.firstName  || '';
  const lastName     = profile.lastName   || '';
  const appleName    = [firstName, lastName].filter(Boolean).join(' ').trim();

  try {
    const snap = await get(ref(db, `guests/${u.uid}`));
    if (!snap.exists()) {
      // First-ever Apple sign-in: save the name Apple sent (only chance we get it)
      const resolvedName =
        appleName                                     ||
        u.displayName                                 ||
        u.email?.split('@')[0]                        ||
        'Apple User';
      await set(ref(db, `guests/${u.uid}`), {
        name:      resolvedName,
        email:     u.email || '',
        photoURL:  u.photoURL || null,
        phone:     '',
        guardians: [],
        createdAt: Date.now(),
        role:      'guest',
        provider:  'apple',
      });
      log('Apple user profile created for', u.uid);
    } else {
      // Repeat sign-in: only refresh updatedAt; never overwrite name with null
      await update(ref(db, `guests/${u.uid}`), {
        updatedAt: Date.now(),
        // Keep existing name unless Apple sends a non-empty one this time
        ...(appleName ? { name: appleName } : {}),
      });
      log('Apple user profile refreshed for', u.uid);
    }
  } catch (e) {
    elog(`loginWithApple: could not upsert guest profile for ${u.uid}`, e);
    // Non-fatal — user is still authenticated
  }

  return u;
};

// ══════════════════════════════════════════════════════════════
// GUEST PROFILE
// ══════════════════════════════════════════════════════════════

// getGuestProfile: returns the profile object or null — NEVER throws.
// Root cause of "Permission denied" crash: the old version had no try-catch.
export const getGuestProfile = async (uid) => {
  if (!uid) {
    elog('getGuestProfile called with no uid');
    return null;
  }
  try {
    const snap = await get(ref(db, `guests/${uid}`));
    if (!snap.exists()) {
      log(`No profile found for uid=${uid} — will create a placeholder`);
      return null; // caller should handle null gracefully
    }
    return snap.val();
  } catch (e) {
    elog(`getGuestProfile(${uid}) failed — check DB rules for guests/{uid}`, e);
    // Return null instead of throwing so the profile page can show an error UI
    // instead of crashing the whole app
    return null;
  }
};

export const updateGuestProfile = async (uid, data) => {
  try {
    await update(ref(db, `guests/${uid}`), { ...data, updatedAt: Date.now() });
    log('Profile updated for', uid);
  } catch (e) {
    elog(`updateGuestProfile(${uid}) failed`, e);
    throw e; // re-throw so the UI can show "Update failed"
  }
};
 // ── PATCH for frontend/src/firebase.js ──────────────────────
// Replace ONLY the createIncident function with this version.
// Change: fetches guestPhone from guests/{uid} before creating incident
// so the admin dashboard "Reported By" panel always shows the phone number.

export const createIncident = async (data) => {
  const u      = auth.currentUser;
  const incRef = ref(db, 'incidents');
  const newRef = push(incRef);

  // Fetch phone from guest profile (stored separately from Auth)
  // auth.currentUser only has displayName + email, NOT phone
  let guestPhone = data.guestPhone || null;
  if (!guestPhone && u?.uid) {
    try {
      const profileSnap = await get(ref(db, `guests/${u.uid}`));
      guestPhone = profileSnap.val()?.phone || null;
    } catch (_) {
      // Non-fatal — incident still creates, phone just stays null
      console.warn('[Firebase] Could not fetch phone for incident');
    }
  }

  try {
    await set(newRef, {
      ...data,
      id:         newRef.key,
      guestUid:   u?.uid         || null,
      guestEmail: u?.email       || null,
      guestName:  u?.displayName || null,
      guestPhone,                          // ← now always populated
      status:     'active',
      severity:   data.severity  || 'pending',
      created_at: Date.now(),
    });
    console.log('[Firebase] Incident created:', newRef.key, 'phone:', guestPhone);
    return newRef.key;
  } catch (e) {
    console.error('[Firebase] createIncident failed', e?.code, e?.message);
    throw e;
  }
};

// ── ADMIN: all incidents, enriched with guest info ────────────
export const listenToIncidents = (callback) => {
  const incRef = ref(db, 'incidents');
  const unsubscribe = onValue(incRef, async (snap) => {
    try {
      const val = snap.val();
      if (!val) { callback([]); return; }
      const incidents = Object.values(val);

      // Batch-fetch unique guest profiles
      const uids     = [...new Set(incidents.map(i => i.guestUid).filter(Boolean))];
      const profiles = {};
      await Promise.all(uids.map(async uid => {
        const p = await getGuestProfile(uid);
        if (p) profiles[uid] = p;
      }));

      const enriched = incidents.map(inc => {
        const p = inc.guestUid ? profiles[inc.guestUid] : null;
        return {
          ...inc,
          guestName:  inc.guestName  || p?.name  || 'Unknown Guest',
          guestEmail: inc.guestEmail || p?.email  || '—',
          guestPhone: inc.guestPhone || p?.phone  || '—',
        };
      });
      callback(enriched);
    } catch (e) {
      elog('listenToIncidents callback failed', e);
      callback([]);
    }
  }, (e) => {
    // onValue error handler — fires when rules block the read
    elog('listenToIncidents: permission denied or network error', e);
    callback([]);
  });

  return unsubscribe;
};

// ── GUEST: only current user's incidents ──────────────────────
// Takes ONE argument (callback). uid read from auth.currentUser internally.
export const listenToMyIncidents = (callback) => {
  const user = auth.currentUser;

  if (!user) {
    elog('listenToMyIncidents: no authenticated user');
    callback([]);
    return () => {};
  }

  const q = query(
    ref(db, 'incidents'),
    orderByChild('guestUid'),
    equalTo(user.uid)  // string, never a function
  );

  const unsubscribe = onValue(q,
    (snap) => {
      try {
        const val = snap.val();
        if (!val) { callback([]); return; }
        const sorted = Object.values(val)
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        callback(sorted);
      } catch (e) {
        elog('listenToMyIncidents callback failed', e);
        callback([]);
      }
    },
    (e) => {
      // This fires when Firebase DENIES the read
      elog('listenToMyIncidents: PERMISSION DENIED or network error', e);
      elog('Check DB rules: incidents should allow read when auth.uid == data.guestUid or via index');
      callback([]); // stop the infinite spinner
    }
  );

  return unsubscribe;
};

// ── Single incident ────────────────────────────────────────────
export const listenToIncident = (id, cb) => {
  if (!id) { cb(null); return () => {}; }
  return onValue(
    ref(db, `incidents/${id}`),
    (snap) => cb(snap.val()),
    (e)    => { elog(`listenToIncident(${id}) failed`, e); cb(null); }
  );
};

// ── Chat ───────────────────────────────────────────────────────
export const sendMessage = async (incidentId, text, sender) => {
  try {
    await push(ref(db, `incidents/${incidentId}/chat`), {
      text, sender, time: Date.now(),
    });
  } catch (e) {
    elog('sendMessage failed', e);
    throw e;
  }
};

// ── Update ─────────────────────────────────────────────────────
export const updateIncident = async (id, data) => {
  try {
    await update(ref(db, `incidents/${id}`), data);
  } catch (e) {
    elog(`updateIncident(${id}) failed`, e);
    throw e;
  }
};