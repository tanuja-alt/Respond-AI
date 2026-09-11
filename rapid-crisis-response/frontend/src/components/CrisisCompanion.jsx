// frontend/src/components/CrisisCompanion.jsx
// Floating AI Panic Assistant — multi-turn Gemini chat with voice I/O

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function CrisisCompanion({ crisisType, floor, room, location, severity }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);     // UI display messages
  const [history, setHistory] = useState([]);        // Gemini conversation history
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false); // auto-read AI replies aloud
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  // Speak text using Web Speech API
  const speakText = useCallback((text) => {
    if (!voiceMode || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    // Map i18n language code to BCP-47 for TTS
    const langMap = { en: 'en-US', es: 'es-ES', hi: 'hi-IN', fr: 'fr-FR', ar: 'ar-SA', zh: 'zh-CN', pt: 'pt-BR' };
    utterance.lang = langMap[i18n.language] || 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, [voiceMode, i18n.language]);

  // Send message to backend
  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await axios.post(`${API}/api/chat/crisis-guide`, {
        messages: history,
        userMessage: text.trim(),
        context: { crisisType, floor, room, location, severity },
        language: i18n.language,
      }, { timeout: 15000 });

      const aiMsg = { role: 'ai', text: data.reply };
      setMessages(prev => [...prev, aiMsg]);
      setHistory(data.history);

      // Auto TTS
      speakText(data.reply);
    } catch (err) {
      console.error('[CrisisCompanion] Error:', err);
      const errorMsg = { role: 'ai', text: t('aiCompanion.error') };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // Voice input via Web Speech API
  const startVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      const errorMsg = { role: 'ai', text: t('aiCompanion.voiceNotSupported') };
      setMessages(prev => [...prev, errorMsg]);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    const langMap = { en: 'en-US', es: 'es-ES', hi: 'hi-IN', fr: 'fr-FR', ar: 'ar-SA', zh: 'zh-CN', pt: 'pt-BR' };
    recognition.lang = langMap[i18n.language] || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      sendMessage(transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  // Cleanup
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  // ── Greeting on first open ──
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: 'ai', text: t('aiCompanion.greeting') }]);
    }
  }, [open, messages.length, t]);

  return (
    <>
      {/* ── Floating Action Button ── */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setOpen(true)}
            style={{
              position: 'fixed',
              bottom: '80px',
              right: '20px',
              zIndex: 500,
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
              border: '2px solid rgba(139,92,246,0.4)',
              boxShadow: '0 4px 24px rgba(139,92,246,0.4), 0 0 0 4px rgba(139,92,246,0.1)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '26px',
            }}
            aria-label={t('aiCompanion.title')}
          >
            🤖
            {/* Pulse ring */}
            <div style={{
              position: 'absolute', inset: '-6px', borderRadius: '50%',
              border: '2px solid rgba(139,92,246,0.4)',
              animation: 'companion-pulse 2s ease-in-out infinite',
            }} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Chat Panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.9 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{
              position: 'fixed',
              bottom: '16px',
              right: '16px',
              zIndex: 600,
              width: 'min(380px, calc(100vw - 32px))',
              height: 'min(520px, calc(100vh - 100px))',
              borderRadius: '20px',
              background: 'rgba(12,12,20,0.97)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(139,92,246,0.25)',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.1)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '14px 16px',
              borderBottom: '1px solid rgba(139,92,246,0.15)',
              background: 'rgba(139,92,246,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '18px',
                }}>🤖</div>
                <div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#E5E7EB', fontFamily: "'DM Sans',sans-serif" }}>
                    {t('aiCompanion.title')}
                  </p>
                  <p style={{ margin: 0, fontSize: '11px', color: '#8B5CF6', fontFamily: "'DM Sans',sans-serif" }}>
                    {t('aiCompanion.subtitle')}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {/* Voice mode toggle */}
                <button
                  onClick={() => setVoiceMode(v => !v)}
                  title={t('aiCompanion.voiceToggle')}
                  style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: voiceMode ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                    border: voiceMode ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '15px', transition: 'all 0.15s',
                  }}
                >
                  {voiceMode ? '🔊' : '🔇'}
                </button>
                {/* Close */}
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer', color: '#6B7280', fontSize: '14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '14px',
              display: 'flex', flexDirection: 'column', gap: '12px',
            }}>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user'
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                    background: msg.role === 'user'
                      ? '#E24B4A'
                      : 'rgba(139,92,246,0.12)',
                    border: msg.role === 'user'
                      ? 'none'
                      : '1px solid rgba(139,92,246,0.2)',
                    color: msg.role === 'user' ? '#fff' : '#D1D5DB',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    fontFamily: "'DM Sans',sans-serif",
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.text}
                  </div>
                </motion.div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{ display: 'flex', gap: '4px', padding: '8px 12px' }}
                >
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: '#8B5CF6',
                      animation: `typing-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </motion.div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: '12px',
              borderTop: '1px solid rgba(139,92,246,0.12)',
              background: 'rgba(10,10,15,0.8)',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexShrink: 0,
            }}>
              {/* Voice input button */}
              <button
                onClick={startVoiceInput}
                disabled={isListening || loading}
                style={{
                  width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                  background: isListening ? 'rgba(226,75,74,0.2)' : 'rgba(255,255,255,0.05)',
                  border: isListening ? '1px solid rgba(226,75,74,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  cursor: isListening || loading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '18px', transition: 'all 0.15s',
                }}
                aria-label={t('aiCompanion.voiceInput')}
              >
                {isListening ? (
                  <span style={{ animation: 'mic-pulse 1s ease-in-out infinite' }}>🎤</span>
                ) : '🎤'}
              </button>

              {/* Text input */}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
                placeholder={isListening ? t('aiCompanion.listening') : t('aiCompanion.placeholder')}
                disabled={loading || isListening}
                style={{
                  flex: 1,
                  padding: '11px 14px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  color: '#E5E7EB',
                  fontSize: '14px',
                  outline: 'none',
                  fontFamily: "'DM Sans',sans-serif",
                }}
              />

              {/* Send button */}
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                style={{
                  width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                  background: input.trim() && !loading
                    ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)'
                    : 'rgba(255,255,255,0.05)',
                  border: 'none',
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', transition: 'all 0.15s',
                  color: '#fff',
                }}
                aria-label={t('aiCompanion.send')}
              >
                ➤
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyframe styles */}
      <style>{`
        @keyframes companion-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.25); opacity: 0; }
        }
        @keyframes typing-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes mic-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
      `}</style>
    </>
  );
}
