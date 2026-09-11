// frontend/src/pages/GuestProfilePage.jsx
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { auth, db, getGuestProfile, updateGuestProfile, logoutGuest } from '../firebase';
import { ref, get, update } from 'firebase/database';

export default function GuestProfilePage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name:'', phone:'' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guardians, setGuardians] = useState(['', '', '']);
  const [guardianLoading, setGuardianLoading] = useState(false);
  const [guardianSaving, setGuardianSaving] = useState(false);

  const user = auth.currentUser;

  useEffect(() => {
    if (!user) { setError(t('common.notLoggedIn')); setLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const p = await getGuestProfile(user.uid);
        if (cancelled) return;
        if (p === null) {
          console.warn('[Profile] getGuestProfile returned null — using Auth fallback');
          setProfile({ name: user.displayName||'', email: user.email||'', phone: '', createdAt: null });
          setForm({ name: user.displayName||'', phone: '' });
        } else {
          setProfile(p);
          setForm({ name: p.name||'', phone: p.phone||'' });
        }
        try {
          setGuardianLoading(true);
          const snap = await get(ref(db, `guests/${user.uid}/guardians`));
          const val = snap.val();
          if (Array.isArray(val)) setGuardians([val[0]||'', val[1]||'', val[2]||'']);
          else setGuardians(['','','']);
        } catch (ge) { console.warn('[Profile] Could not load guardians:', ge); setGuardians(['','','']); }
        finally { setGuardianLoading(false); }
      } catch (e) {
        if (cancelled) return;
        console.error('[Profile] Fatal load error:', e);
        setError(e?.code==='PERMISSION_DENIED'||e?.message?.includes('Permission')
          ? 'Permission denied — your account may not have access to this profile. Try signing out and back in.'
          : `Could not load profile: ${e?.message||'Unknown error'}`);
      } finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  const saveProfile = async () => {
    if (!form.name.trim()) { toast.error(t('profile.nameEmpty')); return; }
    try {
      await updateGuestProfile(user.uid, { name: form.name, phone: form.phone });
      setProfile(p => ({ ...p, name: form.name, phone: form.phone }));
      setEditing(false); toast.success(t('profile.profileUpdated'));
    } catch (e) {
      console.error('[Profile] Update failed:', e);
      toast.error(e?.code==='PERMISSION_DENIED' ? t('profile.permissionDenied') : t('profile.updateFailed'));
    }
  };

  const saveGuardians = async () => {
    setGuardianSaving(true);
    try {
      const cleaned = guardians
        .map(g => g.replace(/[\s\-()]/g, '').trim())
        .filter(g => g.length > 0);
      console.log('[Profile] Saving normalized guardians:', cleaned);
      await update(ref(db, `guests/${user.uid}`), { guardians: cleaned.length > 0 ? cleaned : null, updatedAt: Date.now() });
      toast.success(cleaned.length > 0 ? t('profile.guardiansSaved', { count: cleaned.length }) : t('profile.guardiansCleared'));
    } catch (e) { console.error('[Profile] Guardian save failed:', e); toast.error(t('profile.guardianSaveFailed')); }
    finally { setGuardianSaving(false); }
  };

  const setGuardian = (i, v) => setGuardians(prev => { const n=[...prev]; n[i]=v; return n; });
  const handleLogout = async () => { await logoutGuest(); toast.success(t('nav.signingOut')); };

  const inputStyle = { width:'100%', padding:'11px 14px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px', color:'#E5E7EB', fontSize:'14px', outline:'none', fontFamily:"'DM Sans',sans-serif", boxSizing:'border-box' };
  const cardStyle = { background:'rgba(26,26,38,0.8)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:'16px', padding:'20px', marginBottom:'12px' };
  const sLabel = { display:'block', fontSize:'11px', color:'#6B7280', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.5px', fontFamily:"'DM Sans',sans-serif" };

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#0A0A0F', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <motion.div animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:'linear' }}
        style={{ width:'44px', height:'44px', borderRadius:'50%', border:'3px solid #2A2A3A', borderTopColor:'#E24B4A' }} />
    </div>
  );

  if (error) return (
    <div style={{ minHeight:'100vh', background:'#0A0A0F', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
      <div style={{ maxWidth:'400px', textAlign:'center' }}>
        <div style={{ fontSize:'48px', marginBottom:'16px' }}>🔒</div>
        <h2 style={{ fontFamily:"'Bebas Neue',cursive", fontSize:'24px', color:'#F87171', margin:'0 0 12px', letterSpacing:'1px' }}>{t('profile.unavailable')}</h2>
        <p style={{ fontSize:'14px', color:'#6B7280', fontFamily:"'DM Sans',sans-serif", lineHeight:1.6, marginBottom:'20px' }}>{error}</p>
        <div style={{ display:'flex', gap:'10px', justifyContent:'center', flexWrap:'wrap' }}>
          <button onClick={() => { setError(null); setLoading(true); }} style={{ padding:'10px 20px', background:'rgba(226,75,74,0.15)', border:'1px solid rgba(226,75,74,0.3)', borderRadius:'10px', color:'#F87171', fontSize:'13px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.retry')}</button>
          <button onClick={handleLogout} style={{ padding:'10px 20px', background:'transparent', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px', color:'#6B7280', fontSize:'13px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.signOut')}</button>
        </div>
        <p style={{ fontSize:'11px', color:'#374151', marginTop:'16px', fontFamily:'monospace' }}>{t('profile.debugNote')}</p>
      </div>
    </div>
  );

  const displayName = profile?.name || user?.displayName || 'Guest';

  return (
    <div style={{ minHeight:'100vh', background:'#0A0A0F', padding:'20px' }}>
      <div style={{ maxWidth:'460px', margin:'0 auto' }}>
        {/* Header */}
        <motion.div initial={{ y:-15, opacity:0 }} animate={{ y:0, opacity:1 }} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'24px' }}>
          <h1 style={{ fontFamily:"'Bebas Neue',cursive", fontSize:'28px', letterSpacing:'2px', color:'#fff', margin:0 }}>{t('profile.title')}</h1>
          <button onClick={handleLogout} style={{ padding:'7px 14px', background:'rgba(226,75,74,0.1)', border:'1px solid rgba(226,75,74,0.25)', borderRadius:'10px', color:'#F87171', fontSize:'12px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.signOut')}</button>
        </motion.div>

        {/* Avatar */}
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.1 }} style={{ textAlign:'center', marginBottom:'24px' }}>
          <div style={{ width:'72px', height:'72px', borderRadius:'50%', background:'rgba(226,75,74,0.15)', border:'2px solid rgba(226,75,74,0.3)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 10px', fontSize:'26px', fontWeight:600, color:'#F87171', fontFamily:"'DM Sans',sans-serif" }}>{displayName[0]?.toUpperCase()||'?'}</div>
          <p style={{ color:'#E5E7EB', fontSize:'16px', fontWeight:500, margin:'0 0 3px', fontFamily:"'DM Sans',sans-serif" }}>{displayName}</p>
          <p style={{ color:'#6B7280', fontSize:'12px', margin:0, fontFamily:"'DM Sans',sans-serif" }}>
            {profile?.createdAt
              ? t('profile.memberSince', { date: new Date(profile.createdAt).toLocaleDateString(undefined, { month:'long', year:'numeric' }) })
              : user?.email}
          </p>
        </motion.div>

        {/* Personal Information */}
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.15 }} style={cardStyle}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
            <span style={{ fontSize:'13px', fontWeight:500, color:'#E5E7EB', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.personalInfo')}</span>
            {!editing
              ? <button onClick={() => setEditing(true)} style={{ padding:'5px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px', color:'#9CA3AF', fontSize:'12px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.edit')}</button>
              : <div style={{ display:'flex', gap:'6px' }}>
                  <button onClick={saveProfile} style={{ padding:'5px 12px', background:'rgba(16,185,129,0.15)', border:'1px solid rgba(16,185,129,0.3)', borderRadius:'8px', color:'#34D399', fontSize:'12px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.save')}</button>
                  <button onClick={() => setEditing(false)} style={{ padding:'5px 12px', background:'transparent', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px', color:'#6B7280', fontSize:'12px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.cancel')}</button>
                </div>
            }
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div>
              <label style={sLabel}>{t('profile.fullName')}</label>
              {editing ? <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({...f, name:e.target.value}))} placeholder={t('profile.namePlaceholder')} />
                : <p style={{ margin:0, fontSize:'14px', color:'#E5E7EB', fontFamily:"'DM Sans',sans-serif" }}>{profile?.name||user?.displayName||'—'}</p>}
            </div>
            <div>
              <label style={sLabel}>{t('profile.email')}</label>
              <p style={{ margin:0, fontSize:'14px', color:'#6B7280', fontFamily:"'DM Sans',sans-serif" }}>{user?.email}</p>
            </div>
            <div>
              <label style={sLabel}>{t('profile.phone')}</label>
              {editing ? <input style={inputStyle} value={form.phone} onChange={e => setForm(f => ({...f, phone:e.target.value}))} placeholder={t('profile.phonePlaceholder')} />
                : <p style={{ margin:0, fontSize:'14px', color:profile?.phone?'#E5E7EB':'#4B5563', fontFamily:"'DM Sans',sans-serif" }}>{profile?.phone || t('profile.notSet')}</p>}
            </div>
          </div>
        </motion.div>

        {/* Guardian Contacts */}
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.18 }}
          style={{ ...cardStyle, background:'rgba(139,92,246,0.04)', border:'1px solid rgba(139,92,246,0.15)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px', flexWrap:'wrap', gap:'8px' }}>
            <div>
              <p style={{ fontSize:'13px', fontWeight:600, color:'#A78BFA', margin:'0 0 2px', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.guardianContacts')}</p>
              <p style={{ fontSize:'11px', color:'#6B7280', margin:0, fontFamily:"'DM Sans',sans-serif" }}>{t('profile.guardianNote')}</p>
            </div>
            <button onClick={saveGuardians} disabled={guardianSaving} style={{ padding:'6px 14px', background:guardianSaving?'rgba(107,114,128,0.15)':'rgba(139,92,246,0.15)', border:`1px solid ${guardianSaving?'rgba(107,114,128,0.3)':'rgba(139,92,246,0.3)'}`, borderRadius:'8px', color:guardianSaving?'#6B7280':'#A78BFA', fontSize:'12px', cursor:guardianSaving?'not-allowed':'pointer', fontFamily:"'DM Sans',sans-serif", fontWeight:500 }}>
              {guardianSaving ? t('profile.saving') : t('profile.saveGuardians')}
            </button>
          </div>
          {guardianLoading ? (
            <p style={{ fontSize:'12px', color:'#6B7280', margin:0, textAlign:'center', padding:'12px 0', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.loadingGuardians')}</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              {[t('profile.guardian1'), t('profile.guardian2'), t('profile.guardian3')].map((label, i) => (
                <div key={i}>
                  <label style={{ ...sLabel, fontSize:'10px', marginBottom:'4px' }}>{label}</label>
                  <input style={{ ...inputStyle, padding:'10px 14px', fontSize:'13px' }} placeholder={t('profile.guardianPlaceholder')} value={guardians[i]} onChange={e => setGuardian(i, e.target.value)} />
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Account Details */}
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.2 }} style={cardStyle}>
          <p style={{ fontSize:'13px', fontWeight:500, color:'#E5E7EB', margin:'0 0 14px', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.accountDetails')}</p>
          {[
            { label: t('profile.role'),     value: t('profile.roleValue') },
            { label: t('profile.authType'), value: t('profile.authTypeValue') },
            { label: t('profile.userId'),   value: user?.uid ? `${user.uid.slice(0,14)}...` : '—' },
          ].map((row, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:i<2?'1px solid rgba(255,255,255,0.04)':'none' }}>
              <span style={{ fontSize:'12px', color:'#6B7280', fontFamily:"'DM Sans',sans-serif" }}>{row.label}</span>
              <span style={{ fontSize:'12px', color:'#9CA3AF', fontFamily:'monospace' }}>{row.value}</span>
            </div>
          ))}
        </motion.div>

        {/* Sign out */}
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.25 }}>
          <button onClick={handleLogout} style={{ width:'100%', padding:'13px', background:'rgba(226,75,74,0.08)', border:'1px solid rgba(226,75,74,0.2)', borderRadius:'12px', color:'#F87171', fontSize:'13px', fontWeight:500, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{t('profile.signOut')}</button>
        </motion.div>
      </div>
    </div>
  );
}