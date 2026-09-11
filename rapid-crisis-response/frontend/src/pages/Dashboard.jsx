import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { auth, listenToIncidents, listenToIncident, sendMessage, updateIncident } from '../firebase';
import { emitAcceptDispatch, emitDriverLocation, emitStartNavigation, joinIncidentRoom } from '../services/socketService';
import AmbulanceMap from '../components/AmbulanceMap';
import WeatherWidget from '../components/WeatherWidget';
import LanguageSelector from '../components/LanguageSelector';
import VitalsMonitorCard from '../components/VitalsMonitorCard';
import { useTranslation } from 'react-i18next';

const SEV_COLOR    = { RED:'#E24B4A', YELLOW:'#F59E0B', GREEN:'#10B981', pending:'#6B7280' };
const CRISIS_ICONS = { fire:'🔥', medical:'🏥', security:'🔒', flood:'🌊', other:'⚠️', 'acoustic-detection':'🔊' };
const safeStr = (v, fb='—') => { if (v==null) return fb; if (typeof v==='object') return fb; return String(v); };
const fmtLoc  = (loc) => { if (!loc||typeof loc!=='object') return null; const lat=loc.lat??loc.latitude; const lng=loc.lng??loc.longitude; if (lat==null) return null; return { lat:Number(lat), lng:Number(lng) }; };
const getSevClass = (s) => s==='RED'?'severity-red':s==='YELLOW'?'severity-yellow':s==='GREEN'?'severity-green':'severity-pending';

// AssignDriverForm removed in favor of auto-dispatch button

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [incidents,setIncidents]=useState([]);
  const [selected,setSelected]=useState(null);
  const [chatMsg,setChatMsg]=useState('');
  const [chatLog,setChatLog]=useState([]);
  const [filter,setFilter]=useState('all');
  const chatEndRef=useRef(null);
  const watchRef = useRef(null);
  const simRef = useRef(null);

  useEffect(()=>{ const u=listenToIncidents(d=>{ const s=[...d].sort((a,b)=>(b.created_at||0)-(a.created_at||0)); setIncidents(s); setSelected(prev => { if (!prev && s.length > 0) return s[0]; if (prev) { const updated = s.find(i => i.id === prev.id); if (updated) return updated; } return prev; }); }); return()=>typeof u==='function'&&u(); },[]);
  useEffect(()=>{ if(!selected)return; const u=listenToIncident(selected.id,d=>{ setChatLog(d?.chat?Object.values(d.chat).sort((a,b)=>a.time-b.time):[]); /* CRITICAL: sync latest location & fields from Firebase into selected */ if(d?.location){ setSelected(prev=>prev&&prev.id===d.id?{...prev,...d}:prev); } }); return()=>typeof u==='function'&&u(); },[selected?.id]);
  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:'smooth'}); },[chatLog]);

  // Join socket room for the selected incident so we receive ambulance updates
  useEffect(() => {
    if (selected?.id) {
      joinIncidentRoom(selected.id);
    }
  }, [selected?.id]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const assigned = incidents.find(i => i.assignedDriverUid === user.uid && i.status !== 'resolved');
    
    if (assigned && !watchRef.current) {
      if (!navigator.geolocation) {
        toast.error("Geolocation not supported by this browser.");
        return;
      }
      toast.success("Starting live GPS tracking...");
      watchRef.current = navigator.geolocation.watchPosition(
        ({ coords }) => {
          const victimLat = assigned.location?.lat ?? assigned.location?.latitude;
          const victimLng = assigned.location?.lng ?? assigned.location?.longitude;
          emitDriverLocation(assigned.id, coords.latitude, coords.longitude, victimLat, victimLng);
        },
        (err) => console.warn("[Dashboard] GPS error:", err.message),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    } else if (!assigned && watchRef.current) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, [incidents]);

  useEffect(() => {
    return () => {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
      }
      if (simRef.current != null) {
        clearInterval(simRef.current);
      }
    };
  }, []);

  const sendChat=()=>{ if(!chatMsg.trim()||!selected)return; sendMessage(selected.id,chatMsg,'staff'); setChatMsg(''); };
  const markResolved=()=>{ if(!selected)return; updateIncident(selected.id,{status:'resolved',severity:'GREEN'}); toast.success('Resolved'); };
  const assignDriver = async () => {
    if (!selected || !auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      // Join the socket room IMMEDIATELY so we receive broadcasts from the start
      joinIncidentRoom(selected.id);
      await updateIncident(selected.id, { assignedDriverUid: uid, status: 'dispatched', navigating: true, dispatchedAt: Date.now() });
      emitAcceptDispatch(selected.id, uid);
      emitStartNavigation(selected.id, uid);
      toast.success(`🚑 You have been assigned as the driver!`);

      // Emit an IMMEDIATE first location so tracking starts right away
      // (watchPosition may take a few seconds for its first fix)
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            const victimLat = selected.location?.lat ?? selected.location?.latitude;
            const victimLng = selected.location?.lng ?? selected.location?.longitude;
            console.log('[Dashboard] Immediate GPS emit:', coords.latitude, coords.longitude, '→ victim:', victimLat, victimLng);
            emitDriverLocation(selected.id, coords.latitude, coords.longitude, victimLat, victimLng);
          },
          (err) => console.warn('[Dashboard] Immediate GPS failed:', err.message),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
        );
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const simulateDriver = async () => {
    if (!selected || !auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      joinIncidentRoom(selected.id);
      await updateIncident(selected.id, { assignedDriverUid: uid, status: 'dispatched', navigating: true, dispatchedAt: Date.now() });
      emitAcceptDispatch(selected.id, uid);
      emitStartNavigation(selected.id, uid);
      
      const victimLat = selected.location?.lat ?? selected.location?.latitude;
      const victimLng = selected.location?.lng ?? selected.location?.longitude;
      
      if (victimLat == null || victimLng == null) {
        toast.error('❌ Cannot simulate: guest location not available yet. Wait for GPS fix.');
        return;
      }
      
      // Start ~5km away
      let currentLat = victimLat - 0.045;
      let currentLng = victimLng - 0.045;

      console.log(`[Dashboard] Simulate: incident=${selected.id} start=(${currentLat},${currentLng}) victim=(${victimLat},${victimLng})`);
      emitDriverLocation(selected.id, currentLat, currentLng, victimLat, victimLng);

      if (simRef.current) clearInterval(simRef.current);
      simRef.current = setInterval(() => {
        currentLat += (victimLat - currentLat) * 0.1;
        currentLng += (victimLng - currentLng) * 0.1;
        emitDriverLocation(selected.id, currentLat, currentLng, victimLat, victimLng);
        
        if (Math.abs(victimLat - currentLat) < 0.0001 && Math.abs(victimLng - currentLng) < 0.0001) {
          clearInterval(simRef.current);
          simRef.current = null;
          toast.success("Simulation arrived at destination");
        }
      }, 3000);
      
      toast.success(`🎮 Simulation started for incident ${selected.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const active=incidents.filter(i=>i.status!=='resolved');
  const critical=incidents.filter(i=>i.severity==='RED');
  const resolved=incidents.filter(i=>i.status==='resolved');
  const filtered=filter==='all'?incidents:filter==='active'?active:incidents.filter(i=>i.severity===filter);

  // Guardian notification display helper
  const getGuardianText = (inc) => {
    const count = inc?.guardiansNotified;
    if (count == null) return t('admin.pending_guardians', 'Pending…');
    if (count === 0) return t('admin.no_guardians_notified', 'No guardians notified');
    return t('admin.guardians_notified', '{{count}} guardian(s) alerted via WhatsApp ✓', { count });
  };
  const getGuardianColor = (inc) => {
    const count = inc?.guardiansNotified;
    if (count == null) return '#6B7280';
    return count > 0 ? '#34D399' : '#F87171';
  };

  return (
    <div key={i18n.language} style={{minHeight:'100vh',background:'#0A0A0F',display:'flex',flexDirection:'column'}}>
      <header style={{padding:'16px 20px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
        <div>
          <h1 style={{margin:0,fontSize:'24px',fontWeight:700,color:'#fff',fontFamily:"'Bebas Neue',cursive",letterSpacing:'1px'}}>{t('admin.respond_ai', 'Respond AI')}</h1>
          <p style={{margin:0,fontSize:'12px',color:'#6B7280'}}>{t('admin.staff_dashboard', 'Staff Dashboard')}</p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
          <LanguageSelector compact />
          <button onClick={()=>auth.signOut()} style={{padding:'8px 16px',background:'rgba(226,75,74,0.1)',color:'#F87171',border:'1px solid rgba(226,75,74,0.2)',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:600}}>{t('admin.sign_out', 'Sign Out')}</button>
        </div>
      </header>

      <motion.div initial={{y:-20,opacity:0}} animate={{y:0,opacity:1}} style={{padding:'16px 20px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
        {[{label:t('admin.stats.active','Active'),value:active.length,color:'#E24B4A',icon:'🔴'},{label:t('admin.stats.critical','Critical'),value:critical.length,color:'#F59E0B',icon:'⚠️'},{label:t('admin.stats.resolved','Resolved'),value:resolved.length,color:'#10B981',icon:'✅'},{label:t('admin.stats.total','Total'),value:incidents.length,color:'#6B7280',icon:'📋'}].map((s,i)=>(
          <motion.div key={i} initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} transition={{delay:i*0.05}} className="glass-card" style={{padding:'14px',textAlign:'center'}}>
            <div style={{fontSize:'20px',marginBottom:'4px'}}>{s.icon}</div>
            <div style={{fontSize:'28px',fontWeight:700,fontFamily:"'Bebas Neue',cursive",color:s.color,lineHeight:1}}>{s.value}</div>
            <div style={{fontSize:'11px',color:'#6B7280',marginTop:'4px',textTransform:'uppercase',letterSpacing:'0.5px'}}>{s.label}</div>
          </motion.div>
        ))}
      </motion.div>

      <div style={{display:'grid',gridTemplateColumns:'320px 1fr',flex:1,padding:'0 20px 20px',gap:'16px'}}>
        <motion.div initial={{x:-30,opacity:0}} animate={{x:0,opacity:1}} transition={{delay:0.1}} style={{display:'flex',flexDirection:'column'}}>
          <WeatherWidget />
          <div className="glass-card" style={{overflow:'hidden',display:'flex',flexDirection:'column',flex:1}}>
            <div style={{padding:'12px',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {['all','active','RED','YELLOW','GREEN'].map(f=>(
              <button key={f} onClick={()=>setFilter(f)} style={{padding:'4px 10px',borderRadius:'8px',border:'none',cursor:'pointer',fontSize:'11px',fontWeight:500,fontFamily:"'DM Sans',sans-serif",background:filter===f?'rgba(226,75,74,0.15)':'transparent',color:filter===f?'#F87171':'#6B7280'}}>
                {f==='all'?t('admin.filters.all','All'):f==='active'?t('status.active','Active'):t(`urgency.${f.toLowerCase()}`, f)}
              </button>
            ))}
          </div>
          <div style={{overflowY:'auto',flex:1,padding:'8px'}}>
            {filtered.length===0?(
              <div style={{padding:'40px 20px',textAlign:'center',color:'#374151'}}><div style={{fontSize:'32px',marginBottom:'8px'}}>🔍</div><p style={{fontSize:'13px',margin:0}}>{t('admin.misc.no_incidents', 'No incidents')}</p></div>
            ):filtered.map(inc=>(
              <motion.div key={inc.id} layout onClick={()=>setSelected(inc)} style={{padding:'12px',marginBottom:'6px',cursor:'pointer',borderRadius:'12px',border:selected?.id===inc.id?'1px solid rgba(226,75,74,0.4)':'1px solid rgba(255,255,255,0.06)',background:selected?.id===inc.id?'rgba(226,75,74,0.05)':'rgba(26,26,38,0.5)',borderLeft:`3px solid ${SEV_COLOR[inc.severity||'pending']}`,transition:'all 0.15s'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'3px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                    <span style={{fontSize:'14px'}}>{CRISIS_ICONS[inc.crisisType]||'⚠️'}</span>
                    <span style={{fontSize:'13px',fontWeight:600,color:'#E5E7EB'}}>{t(`emergency.types.${inc.crisisType?.toLowerCase()}`, safeStr(inc.crisisType,'UNKNOWN').toUpperCase())}</span>
                  </div>
                  <span className={getSevClass(inc.severity||'pending')}>{t(`urgency.${inc.severity?.toLowerCase()}`, safeStr(inc.severity, t('urgency.pending', 'pending')))}</span>
                </div>
                {inc.requiresAmbulance&&<span style={{display:'inline-block',padding:'2px 8px',borderRadius:'6px',background:'rgba(226,75,74,0.15)',color:'#F87171',fontSize:'10px',fontWeight:700,fontFamily:"'DM Sans',sans-serif",marginBottom:'3px'}}>🚑 {t('admin.ambulance_required', 'AMBULANCE REQUIRED')}</span>}
                {inc.crisisType==='acoustic-detection'&&<span style={{display:'inline-block',padding:'2px 8px',borderRadius:'6px',background:'rgba(226,75,74,0.2)',color:'#FCA5A5',fontSize:'10px',fontWeight:700,fontFamily:"'DM Sans',sans-serif",marginBottom:'3px',border:'1px solid rgba(226,75,74,0.3)',animation:'pulse-dot 1s ease-in-out infinite'}}>🔊 AUTO-DETECTED: {(inc.acousticType||'unknown').toUpperCase()} ({inc.audioConfidence||'?'}% Confidence)</span>}
                {inc.guestName&&<p style={{fontSize:'11px',color:'#8B5CF6',margin:'0 0 2px',fontFamily:"'DM Sans',sans-serif"}}>👤 {inc.guestName}</p>}
                <p style={{fontSize:'11px',color:'#6B7280',margin:'0 0 2px'}}>{t('admin.floor', 'Floor')} {safeStr(inc.floor,'?')} · {t('admin.room', 'Room')} {safeStr(inc.room,'?')}</p>
                <p style={{fontSize:'10px',color:'#374151',margin:0}}>{inc.created_at?new Date(inc.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—'}</p>
              </motion.div>
            ))}
          </div>
        </div>
        </motion.div>

        <motion.div initial={{x:30,opacity:0}} animate={{x:0,opacity:1}} transition={{delay:0.15}} style={{display:'flex',flexDirection:'column',gap:'12px',overflowY:'auto'}}>
          {!selected?(
            <div className="glass-card" style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'12px'}}>
              <div style={{fontSize:'48px'}}>📡</div><p style={{color:'#6B7280',fontSize:'14px',margin:0}}>{t('admin.misc.select_incident', 'Select an incident')}</p>
            </div>
          ):(
            <>
              <div className="glass-card" style={{padding:'16px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px'}}>
                      <span style={{fontSize:'20px'}}>{CRISIS_ICONS[selected.crisisType]||'⚠️'}</span>
                      <h2 style={{margin:0,fontSize:'20px',fontWeight:700,color:'#fff',fontFamily:"'Bebas Neue',cursive",letterSpacing:'1px'}}>{t(`emergency.types.${selected.crisisType?.toLowerCase()}`, safeStr(selected.crisisType,'UNKNOWN').toUpperCase())} — {t('admin.floor', 'Floor')} {safeStr(selected.floor,'?')}</h2>
                    </div>
                    <p style={{margin:0,fontSize:'12px',color:'#6B7280'}}>{t('admin.room', 'Room')} {safeStr(selected.room,'?')} · {selected.created_at?new Date(selected.created_at).toLocaleString('en-IN'):'—'}</p>
                  </div>
                  <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                    <span className={getSevClass(selected.severity||'pending')}>{t(`urgency.${selected.severity?.toLowerCase()}`, safeStr(selected.severity, t('urgency.pending', 'Analysing...')))}</span>
                    <button onClick={markResolved} style={{padding:'7px 14px',background:'rgba(16,185,129,0.15)',color:'#34D399',border:'1px solid rgba(16,185,129,0.3)',borderRadius:'10px',cursor:'pointer',fontSize:'12px',fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>✓ {t('admin.resolve', 'Resolve')}</button>
                  </div>
                </div>
                <div style={{background:'rgba(255,255,255,0.03)',borderRadius:'10px',padding:'10px 12px',marginBottom:'10px'}}>
                  <span style={{fontSize:'11px',color:'#6B7280'}}>{t('admin.misc.report', 'Report:')} </span>
                  <span style={{fontSize:'13px',color:'#D1D5DB'}}>{safeStr(selected.description, t('admin.misc.no_description', 'No description'))}</span>
                </div>

                {/* Acoustic Auto-Detection Banner */}
                {selected.crisisType==='acoustic-detection'&&(
                  <div style={{background:'rgba(226,75,74,0.1)',border:'1px solid rgba(226,75,74,0.35)',borderRadius:'10px',padding:'12px 14px',marginBottom:'10px',display:'flex',alignItems:'center',gap:'10px'}}>
                    <span style={{fontSize:'24px',filter:'drop-shadow(0 0 6px rgba(226,75,74,0.5))'}}>🔊</span>
                    <div>
                      <div style={{fontSize:'13px',fontWeight:700,color:'#FCA5A5',fontFamily:"'DM Sans',sans-serif",textTransform:'uppercase',letterSpacing:'0.5px'}}>
                        [CRITICAL RED] Auto-Detected: {(selected.acousticType||'Unknown').charAt(0).toUpperCase()+(selected.acousticType||'unknown').slice(1)}
                      </div>
                      <div style={{fontSize:'11px',color:'#F87171',fontFamily:"'DM Sans',sans-serif",marginTop:'2px'}}>
                        Confidence: {selected.audioConfidence||'?'}% · Triggered: {selected.timestamp?new Date(selected.timestamp).toLocaleTimeString('en-IN'):'—'}
                      </div>
                    </div>
                  </div>
                )}

                {/* GUEST INFO — visible to admin — now includes guardian notification */}
                <div style={{background:'rgba(139,92,246,0.06)',border:'1px solid rgba(139,92,246,0.2)',borderRadius:'10px',padding:'12px 14px'}}>
                  <p style={{fontSize:'11px',fontWeight:700,color:'#A78BFA',margin:'0 0 10px',textTransform:'uppercase',letterSpacing:'0.5px'}}>👤 {t('admin.reported_by', 'REPORTED BY')}</p>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                    <div>
                      <p style={{fontSize:'10px',color:'#6B7280',margin:'0 0 3px',textTransform:'uppercase',letterSpacing:'0.3px'}}>{t('admin.name', 'NAME')}</p>
                      <p style={{fontSize:'13px',color:'#C4B5FD',margin:0,fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{safeStr(selected.guestName, t('admin.misc.unknown_guest', 'Unknown Guest'))}</p>
                    </div>
                    <div>
                      <p style={{fontSize:'10px',color:'#6B7280',margin:'0 0 3px',textTransform:'uppercase',letterSpacing:'0.3px'}}>{t('admin.email', 'EMAIL')}</p>
                      <p style={{fontSize:'11px',color:'#C4B5FD',margin:0,fontFamily:'monospace',wordBreak:'break-all'}}>{safeStr(selected.guestEmail,'—')}</p>
                    </div>
                    <div>
                      <p style={{fontSize:'10px',color:'#6B7280',margin:'0 0 3px',textTransform:'uppercase',letterSpacing:'0.3px'}}>{t('admin.phone', 'PHONE')}</p>
                      <p style={{fontSize:'13px',color:'#C4B5FD',margin:0,fontFamily:"'DM Sans',sans-serif"}}>{safeStr(selected.guestPhone,'—')}</p>
                    </div>
                    <div>
                      <p style={{fontSize:'10px',color:'#6B7280',margin:'0 0 3px',textTransform:'uppercase',letterSpacing:'0.3px'}}>{t('admin.guardians_notified', 'GUARDIANS NOTIFIED')}</p>
                      <p style={{fontSize:'12px',color:getGuardianColor(selected),margin:0,fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{getGuardianText(selected)}</p>
                    </div>
                  </div>
                </div>

                {selected.summary&&<div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(226,75,74,0.06)',borderRadius:'8px',borderLeft:'3px solid #E24B4A'}}><span style={{fontSize:'12px',color:'#F87171',fontStyle:'italic'}}>{safeStr(selected.summary)}</span></div>}
                
                {selected.weatherAlert && (
                  <div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(245,158,11,0.1)',borderRadius:'8px',borderLeft:'3px solid #F59E0B'}}>
                    <p style={{fontSize:'11px',fontWeight:700,color:'#F59E0B',margin:'0 0 4px'}}>🌩️ {t('admin.misc.severe_alert', 'SEVERE CLIMATE ALERT (AT SCENE)')}</p>
                    <span style={{fontSize:'12px',color:'#FCD34D'}}>{safeStr(selected.weatherAlert)}</span>
                  </div>
                )}
              </div>

              {Array.isArray(selected.sop)&&selected.sop.length>0&&(
                <div style={{background:'rgba(99,60,255,0.06)',border:'1px solid rgba(99,60,255,0.2)',borderRadius:'16px',padding:'16px'}}>
                  <p style={{fontSize:'13px',fontWeight:700,color:'#A78BFA',margin:'0 0 12px',textTransform:'uppercase',letterSpacing:'0.5px'}}>🤖 {t('admin.ai_response_plan', 'AI RESPONSE PLAN')}</p>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'8px'}}>
                    {selected.sop.map((s,i)=>(<div key={i} style={{background:'rgba(99,60,255,0.08)',border:'1px solid rgba(99,60,255,0.15)',borderRadius:'10px',padding:'10px 12px',display:'flex',gap:'8px'}}><span style={{fontFamily:"'Bebas Neue',cursive",fontSize:'18px',color:'#7C3AED',flexShrink:0,lineHeight:1.2}}>{i+1}</span><span style={{fontSize:'12px',color:'#C4B5FD',lineHeight:1.5}}>{t(`admin.ai_plan.step_${i+1}`, safeStr(s))}</span></div>))}
                  </div>
                </div>
              )}

              {(()=>{ const loc=fmtLoc(selected.location); if(!loc)return null; return (
                <div className="glass-card" style={{padding:'16px'}}>
                  <p style={{fontSize:'13px',fontWeight:600,color:'#34D399',margin:'0 0 10px'}}>📍 {t('admin.incident_location', 'Incident Location')}</p>
                  <div style={{background:'rgba(16,185,129,0.06)',border:'1px solid rgba(16,185,129,0.2)',borderRadius:'10px',padding:'12px',display:'flex',gap:'16px',alignItems:'center'}}>
                    <div><p style={{fontSize:'11px',color:'#6B7280',margin:'0 0 2px'}}>{t('admin.latitude', 'Latitude')}</p><p style={{fontSize:'13px',color:'#34D399',margin:0,fontFamily:'monospace'}}>{loc.lat.toFixed(6)}</p></div>
                    <div><p style={{fontSize:'11px',color:'#6B7280',margin:'0 0 2px'}}>{t('admin.longitude', 'Longitude')}</p><p style={{fontSize:'13px',color:'#34D399',margin:0,fontFamily:'monospace'}}>{loc.lng.toFixed(6)}</p></div>
                    <a href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer" style={{marginLeft:'auto',padding:'7px 12px',background:'rgba(16,185,129,0.15)',color:'#34D399',border:'1px solid rgba(16,185,129,0.3)',borderRadius:'8px',textDecoration:'none',fontSize:'12px',fontWeight:600}}>{t('admin.open_maps', 'Open Maps ↗')}</a>
                  </div>
                </div>
              ); })()}

              {/* Ambulance Dispatch Section */}
              {selected.requiresAmbulance && (
                <div className="glass-card" style={{padding:'16px',border:'1px solid rgba(226,75,74,0.3)'}}>
                  <p style={{fontSize:'13px',fontWeight:700,color:'#F87171',margin:'0 0 12px'}}>🚑 {t('admin.ambulance_dispatch', 'Ambulance Dispatch')}</p>
                  {selected.assignedDriverUid ? (
                    <>
                      <p style={{fontSize:'12px',color:'#34D399',margin:'0 0 12px'}}>✅ {t('admin.dispatched_to_driver', 'Dispatched to driver:')} <code style={{background:'rgba(255,255,255,0.06)',padding:'2px 6px',borderRadius:'4px'}}>{selected.assignedDriverUid}</code></p>
                      {selected.assignedDriverUid === auth.currentUser?.uid && (
                        <button onClick={simulateDriver} style={{ marginBottom: '12px', width: '100%', padding: '10px', background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>
                          🎮 SIMULATE RIDE (LOCALHOST TESTING)
                        </button>
                      )}
                      <AmbulanceMap incidentId={selected.id} victimLocation={selected.location} />
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={assignDriver} style={{ flex: 1, padding: '12px', background: '#E24B4A', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>Accept (Real GPS)</button>
                      <button onClick={simulateDriver} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>🎮 Simulate Ride</button>
                    </div>
                  )}
                </div>
              )}

              {/* Patient Live Health Vitals — Ambulance Telemetry */}
              {selected.guestEmail && (
                <VitalsMonitorCard incident={selected} />
              )}

              <div className="glass-card" style={{overflow:'hidden'}}>
                <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:'13px',fontWeight:600,color:'#E5E7EB'}}>💬 {t('admin.chat.header', 'Live Chat with Guest')}</span>
                  <span style={{fontSize:'11px',color:'#6B7280'}}>{t('admin.chat.messages', '{{count}} messages', { count: chatLog.length })}</span>
                </div>
                <div style={{padding:'12px',maxHeight:'200px',minHeight:'80px',overflowY:'auto'}}>
                  {chatLog.length===0?<p style={{color:'#374151',fontSize:'12px',textAlign:'center',marginTop:'20px'}}>{t('admin.chat.no_messages', 'No messages yet')}</p>:chatLog.map((m,i)=>(
                    <div key={i} style={{textAlign:m.sender==='staff'?'right':'left',marginBottom:'8px'}}>
                      <div style={{display:'inline-block',padding:'7px 12px',borderRadius:'12px',fontSize:'12px',maxWidth:'75%',textAlign:'left',background:m.sender==='staff'?'#E24B4A':'rgba(255,255,255,0.06)',color:m.sender==='staff'?'#fff':'#D1D5DB',border:m.sender==='staff'?'none':'1px solid rgba(255,255,255,0.08)'}}>{safeStr(m.text)}</div>
                      <div style={{fontSize:'10px',color:'#374151',margin:'2px 4px 0'}}>{m.sender==='staff'?t('admin.chat.staff', 'Staff'):t('admin.chat.guest', 'Guest')}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef}/>
                </div>
                <div style={{display:'flex',borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                  <input value={chatMsg} onChange={e=>setChatMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder={t('admin.chat.reply_placeholder', 'Reply to guest...')} style={{flex:1,padding:'12px 14px',background:'transparent',border:'none',outline:'none',color:'#E5E7EB',fontSize:'13px',fontFamily:"'DM Sans',sans-serif"}}/>
                  <button onClick={sendChat} style={{padding:'0 20px',background:'#E24B4A',color:'#fff',border:'none',cursor:'pointer',fontWeight:600,fontSize:'13px'}}>{t('admin.chat.send', 'Send')}</button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}