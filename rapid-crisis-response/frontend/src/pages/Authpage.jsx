import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, User, Phone, Shield } from 'lucide-react';

import { registerGuest, loginGuest, loginWithGoogle, loginWithApple } from '../firebase';
import LanguageSelector from '../components/LanguageSelector';
import SpeakButton from '../components/SpeakButton';

export default function AuthPage() {
  const { t, i18n } = useTranslation();

  const [mode,          setMode]          = useState('login'); // 'login' | 'register'
  const [loading,       setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading,  setAppleLoading]  = useState(false);
  const [form,          setForm]          = useState({
    name: '', email: '', password: '', phone: '',
    guardian1: '', guardian2: '', guardian3: '',
  });

  const isRTL    = i18n.language === 'ar';
  const anyBusy  = loading || googleLoading || appleLoading;
  const set      = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  // ── Email / Password ──────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error(t('auth.errors.emailRequired')); return; }
    if (mode === 'register' && !form.name) { toast.error(t('auth.errors.nameRequired')); return; }
    if (form.password.length < 6) { toast.error(t('auth.errors.passwordShort')); return; }

    setLoading(true);
    try {
      if (mode === 'register') {
        const guardians = [form.guardian1, form.guardian2, form.guardian3]
          .map(g => g.replace(/[\s\-()]/g, '').trim())
          .filter(g => g.length > 0);
        await registerGuest(form.name, form.email, form.password, form.phone, guardians);
        toast.success(t('auth.success.welcome', { name: form.name }));
      } else {
        await loginGuest(form.email, form.password);
        toast.success(t('auth.success.welcomeBack'));
      }
    } catch (err) {
      const msg =
        err.code === 'auth/email-already-in-use' ? t('auth.errors.emailInUse')
        : err.code === 'auth/user-not-found'     ? t('auth.errors.userNotFound')
        : err.code === 'auth/wrong-password'     ? t('auth.errors.wrongPassword')
        : err.code === 'auth/invalid-email'      ? t('auth.errors.invalidEmail')
        : err.message;
      toast.error(msg);
    }
    setLoading(false);
  };

  // ── Google ────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      toast.success(t('auth.success.signedInGoogle'));
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        toast(t('auth.errors.popupCancelled'), { icon: '✖️' });
      } else if (err.code === 'auth/popup-blocked') {
        toast.error(t('auth.errors.popupBlocked'));
      } else if (err.code === 'auth/network-request-failed') {
        toast.error(t('auth.errors.networkError'));
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/internal-error' || err.message?.includes('OAuth')) {
        toast.error("To enable live smartwatch telemetry, please click Advanced -> Proceed when signing in with Google.", { duration: 6000 });
      } else {
        toast.error(t('auth.errors.googleFailed'));
      }
    }
    setGoogleLoading(false);
  };

  // ── Apple ─────────────────────────────────────────────────────
  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    try {
      await loginWithApple();
      toast.success(t('auth.success.signedInApple'));
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        toast(t('auth.errors.popupCancelled'), { icon: '✖️' });
      } else if (err.code === 'auth/popup-blocked') {
        toast.error(t('auth.errors.popupBlocked'));
      } else if (err.code === 'auth/network-request-failed') {
        toast.error(t('auth.errors.networkError'));
      } else if (err.code === 'auth/operation-not-allowed') {
        toast.error(t('auth.errors.appleNotEnabled'));
      } else {
        toast.error(t('auth.errors.appleFailed'));
      }
    }
    setAppleLoading(false);
  };

  // ── Styles ────────────────────────────────────────────────────
  const inputWrapStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  };
  const iconStyle = {
    position: 'absolute',
    [isRTL ? 'right' : 'left']: '14px',
    color: '#4B5563',
    pointerEvents: 'none',
    display: 'flex',
  };
  const inputStyle = {
    width: '100%',
    padding: isRTL ? '12px 44px 12px 16px' : '12px 16px 12px 44px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px', color: '#E5E7EB',
    fontSize: '14px', outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
    direction: isRTL ? 'rtl' : 'ltr',
  };
  const labelStyle = {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '12px', color: '#6B7280', marginBottom: '6px',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    fontFamily: "'DM Sans', sans-serif",
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0A0A0F',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      direction: isRTL ? 'rtl' : 'ltr',
    }}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        style={{ width: '100%', maxWidth: '420px' }}
      >
        {/* ── Language selector row ── */}
        <div style={{
          display: 'flex',
          justifyContent: isRTL ? 'flex-start' : 'flex-end',
          marginBottom: '16px',
        }}>
          <LanguageSelector />
        </div>

        {/* ── Logo + heading ── */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '16px',
            background: '#E24B4A', display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 14px', fontSize: '28px',
          }}>🆘</div>

          {/* Title row with TTS button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <h1 style={{
              fontFamily: "'Bebas Neue', cursive", fontSize: '32px',
              letterSpacing: '3px', color: '#fff', margin: 0,
            }}>
              Respond<span style={{ color: '#E24B4A' }}>AI</span>
            </h1>
            <SpeakButton text={t('tts.authHeading')} />
          </div>
          <p style={{ color: '#6B7280', fontSize: '13px', margin: '6px 0 0' }}>
            {t('auth.subtitle')}
          </p>
        </div>

        {/* ── Tab switch ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px',
          background: 'rgba(255,255,255,0.04)', borderRadius: '12px',
          padding: '5px', marginBottom: '24px',
        }}>
          {['login', 'register'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '10px', borderRadius: '9px', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
              transition: 'all 0.15s',
              background: mode === m ? '#E24B4A' : 'transparent',
              color:       mode === m ? '#fff'    : '#6B7280',
            }}>
              {m === 'login' ? t('auth.signIn') : t('auth.signUp')}
            </button>
          ))}
        </div>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit}>
          <div style={{
            background: 'rgba(26,26,38,0.8)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
          }}>

            {/* Full Name — register only */}
            <AnimatePresence>
              {mode === 'register' && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <label style={labelStyle}>
                    <User size={11} /> {t('auth.labels.fullName')}
                  </label>
                  <div style={inputWrapStyle}>
                    <span style={iconStyle}><User size={16} /></span>
                    <input style={inputStyle} placeholder={t('auth.placeholders.name')} value={form.name} onChange={set('name')} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email */}
            <div>
              <label style={labelStyle}>
                <Mail size={11} /> {t('auth.labels.email')}
              </label>
              <div style={inputWrapStyle}>
                <span style={iconStyle}><Mail size={16} /></span>
                <input style={inputStyle} type="email" placeholder={t('auth.placeholders.email')} value={form.email} onChange={set('email')} />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={labelStyle}>
                <Lock size={11} /> {t('auth.labels.password')}
              </label>
              <div style={inputWrapStyle}>
                <span style={iconStyle}><Lock size={16} /></span>
                <input style={inputStyle} type="password" placeholder={t('auth.placeholders.password')} value={form.password} onChange={set('password')} />
              </div>
            </div>

            {/* Phone — register only */}
            <AnimatePresence>
              {mode === 'register' && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <label style={labelStyle}>
                    <Phone size={11} /> {t('auth.labels.phone')}
                  </label>
                  <div style={inputWrapStyle}>
                    <span style={iconStyle}><Phone size={16} /></span>
                    <input style={inputStyle} placeholder={t('auth.placeholders.phone')} value={form.phone} onChange={set('phone')} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Guardian Contacts — register only */}
            <AnimatePresence>
              {mode === 'register' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
                >
                  <div style={{
                    background: 'rgba(139,92,246,0.06)',
                    border: '1px solid rgba(139,92,246,0.15)',
                    borderRadius: '12px', padding: '14px',
                  }}>
                    <p style={{
                      fontSize: '11px', fontWeight: 600, color: '#A78BFA',
                      margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px',
                      fontFamily: "'DM Sans', sans-serif",
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                      <Shield size={12} /> {t('auth.labels.guardians')}
                    </p>
                    <p style={{
                      fontSize: '11px', color: '#6B7280', margin: '0 0 12px',
                      fontFamily: "'DM Sans', sans-serif", lineHeight: 1.4,
                    }}>
                      {t('auth.labels.guardiansNote')}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {[
                        { key: 'guardian1', label: t('auth.labels.guardian1') },
                        { key: 'guardian2', label: t('auth.labels.guardian2') },
                        { key: 'guardian3', label: t('auth.labels.guardian3') },
                      ].map(g => (
                        <div key={g.key}>
                          <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '4px' }}>
                            <Phone size={10} /> {g.label}
                          </label>
                          <div style={inputWrapStyle}>
                            <span style={iconStyle}><Phone size={15} /></span>
                            <input
                              style={{ ...inputStyle, padding: isRTL ? '10px 44px 10px 14px' : '10px 14px 10px 44px', fontSize: '13px' }}
                              placeholder={t('auth.placeholders.guardian')}
                              value={form[g.key]}
                              onChange={set(g.key)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={anyBusy}
              style={{
                width: '100%', padding: '14px',
                background: loading ? '#4B5563' : '#E24B4A',
                border: 'none', borderRadius: '12px',
                color: '#fff', fontSize: '15px', fontWeight: 700,
                cursor: anyBusy ? 'not-allowed' : 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                transition: 'all 0.2s',
                boxShadow: loading ? 'none' : '0 0 20px rgba(226,75,74,0.3)',
              }}
            >
              {loading ? t('auth.pleaseWait') : mode === 'login' ? t('auth.signInBtn') : t('auth.createAccount')}
            </motion.button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '4px 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
              <span style={{
                fontSize: '11px', color: '#4B5563', fontFamily: "'DM Sans', sans-serif",
                textTransform: 'uppercase', letterSpacing: '0.8px', whiteSpace: 'nowrap',
              }}>{t('auth.orContinueWith')}</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
            </div>

            {/* Google button */}
            <GoogleSignInButton
              label={t('auth.signInWithGoogle')}
              loadingLabel={t('auth.connectingGoogle')}
              loading={googleLoading}
              disabled={anyBusy}
              onClick={handleGoogleSignIn}
            />

            {/* Apple button */}
            <AppleSignInButton
              label={t('auth.signInWithApple')}
              loadingLabel={t('auth.connectingApple')}
              loading={appleLoading}
              disabled={anyBusy}
              onClick={handleAppleSignIn}
            />
          </div>
        </form>

        {/* Footer note */}
        <p style={{
          textAlign: 'center', fontSize: '12px', color: '#374151',
          marginTop: '16px', fontFamily: "'DM Sans', sans-serif",
        }}>
          {t('auth.footerNote')}
        </p>
      </motion.div>
    </div>
  );
}

// ── Google Sign-In Button ──────────────────────────────────────
function GoogleSignInButton({ label, loadingLabel, loading, disabled, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.button
      type="button" whileTap={{ scale: 0.97 }} onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', padding: '13px 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: '10px',
        background: hovered && !disabled ? 'rgba(226,75,74,0.08)' : 'rgba(255,255,255,0.04)',
        border: hovered && !disabled ? '1px solid rgba(226,75,74,0.4)' : '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px', color: disabled ? '#4B5563' : '#E5E7EB',
        fontSize: '14px', fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s ease',
        boxShadow: hovered && !disabled ? '0 0 18px rgba(226,75,74,0.15)' : 'none',
      }}
    >
      {loading ? (
        <>
          <div style={{ width:'18px', height:'18px', border:'2px solid rgba(255,255,255,0.15)', borderTopColor:'#E24B4A', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
          <span>{loadingLabel}</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          <span>{label}</span>
        </>
      )}
    </motion.button>
  );
}

// ── Apple Sign-In Button ───────────────────────────────────────
function AppleSignInButton({ label, loadingLabel, loading, disabled, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.button
      type="button" whileTap={{ scale: 0.97 }} onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', padding: '13px 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: '10px',
        background: disabled ? 'rgba(255,255,255,0.04)' : hovered ? '#1a1a1a' : '#000000',
        border: hovered && !disabled ? '1px solid rgba(226,75,74,0.35)' : '1px solid rgba(255,255,255,0.12)',
        borderRadius: '12px', color: disabled ? '#4B5563' : '#FFFFFF',
        fontSize: '14px', fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s ease',
        boxShadow: hovered && !disabled ? '0 0 18px rgba(226,75,74,0.12)' : 'none',
      }}
    >
      {loading ? (
        <>
          <div style={{ width:'18px', height:'18px', border:'2px solid rgba(255,255,255,0.15)', borderTopColor:'#E24B4A', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
          <span>{loadingLabel}</span>
        </>
      ) : (
        <>
          <svg width="17" height="20" viewBox="0 0 814 1000" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
            style={{ fill: disabled ? '#4B5563' : '#FFFFFF', flexShrink: 0 }}>
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.3-166.8-114.3S0 372.8 0 270.5 41.2 92.4 99.1 54.5c49.8-33 107.1-50.8 164-50.8 61.2 0 115.3 36.4 152.5 36.4 35.7 0 93.7-40.8 161.6-40.8 21.4 0 107.4 2.6 178.3 81.5zm-97.6-95.7c30.4-35.7 52.1-85.5 52.1-135.3 0-6.5-.6-13-1.9-18.5-49.2 1.9-108.2 32.4-142.1 73.3-26.5 30.4-52.1 80.8-52.1 131.3 0 7.1 1.3 14.3 1.9 16.5 3.2.6 8.4 1.3 13.6 1.3 44.4 0 99.8-29.1 128.5-68.6z"/>
          </svg>
          <span>{label}</span>
        </>
      )}
    </motion.button>
  );
}