// frontend/src/components/SpeakButton.jsx
// Reads a given text string aloud using the Web Speech API.
// Gracefully hidden if the browser does not support speechSynthesis.

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// BCP-47 language codes for speechSynthesis
const LANG_TO_BCP47 = {
  en: 'en-US',
  es: 'es-ES',
  hi: 'hi-IN',
  fr: 'fr-FR',
  ar: 'ar-SA',
  zh: 'zh-CN',
  pt: 'pt-BR',
};

export default function SpeakButton({ text, style = {} }) {
  const { i18n } = useTranslation();
  const [speaking, setSpeaking] = useState(false);

  // Hide button entirely if browser has no speech support
  if (!window.speechSynthesis) return null;

  const handleSpeak = useCallback(() => {
    // Cancel any in-progress speech first
    window.speechSynthesis.cancel();

    if (speaking) {
      setSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang  = LANG_TO_BCP47[i18n.language] || 'en-US';
    utterance.rate  = 0.95;
    utterance.pitch = 1;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend   = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [text, i18n.language, speaking]);

  return (
    <button
      type="button"
      onClick={handleSpeak}
      title={speaking ? 'Stop reading' : 'Read aloud'}
      aria-label={speaking ? 'Stop reading' : 'Read page aloud'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        border: speaking
          ? '1px solid rgba(226,75,74,0.6)'
          : '1px solid rgba(255,255,255,0.1)',
        background: speaking
          ? 'rgba(226,75,74,0.15)'
          : 'rgba(255,255,255,0.05)',
        color: speaking ? '#E24B4A' : '#9CA3AF',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        flexShrink: 0,
        padding: 0,
        ...style,
      }}
    >
      {speaking ? (
        // Stop / pulsing wave icon
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" rx="1"/>
          <rect x="14" y="5" width="4" height="14" rx="1"/>
        </svg>
      ) : (
        // Speaker / volume icon
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      )}
    </button>
  );
}
