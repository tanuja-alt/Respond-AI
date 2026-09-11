// frontend/src/components/LanguageSelector.jsx
// Compact dropdown for switching app language.
// Persists choice to localStorage and updates document direction for RTL.

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { code: 'en', flag: '🇺🇸', label: 'English',   dir: 'ltr' },
  { code: 'es', flag: '🇪🇸', label: 'Español',   dir: 'ltr' },
  { code: 'hi', flag: '🇮🇳', label: 'हिन्दी',    dir: 'ltr' },
  { code: 'fr', flag: '🇫🇷', label: 'Français',  dir: 'ltr' },
  { code: 'ar', flag: '🇦🇪', label: 'العربية',   dir: 'rtl' },
  { code: 'zh', flag: '🇨🇳', label: '中文',       dir: 'ltr' },
  { code: 'pt', flag: '🇧🇷', label: 'Português', dir: 'ltr' },
  { code: 'bn', flag: '🇮🇳', label: 'বাংলা', dir: 'ltr' },
  { code: 'mr', flag: '🇮🇳', label: 'मराठी', dir: 'ltr' },
  { code: 'te', flag: '🇮🇳', label: 'తెలుగు', dir: 'ltr' },
  { code: 'ta', flag: '🇮🇳', label: 'தமிழ்', dir: 'ltr' },
  { code: 'gu', flag: '🇮🇳', label: 'ગુજરાતી', dir: 'ltr' },
  { code: 'ur', flag: '🇮🇳', label: 'اردو', dir: 'rtl' },
  { code: 'kn', flag: '🇮🇳', label: 'ಕನ್ನಡ', dir: 'ltr' },
  { code: 'or', flag: '🇮🇳', label: 'ଓଡ଼ିଆ', dir: 'ltr' },
  { code: 'ml', flag: '🇮🇳', label: 'മലയാളം', dir: 'ltr' },
];

const STORAGE_KEY = 'respondai-lang';

export default function LanguageSelector({ compact = false }) {
  const { i18n }            = useTranslation();
  const [open, setOpen]     = useState(false);
  const ref                 = useRef(null);

  const current = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const handleSelect = (lang) => {
    i18n.changeLanguage(lang.code);
    localStorage.setItem(STORAGE_KEY, lang.code);
    document.documentElement.dir = lang.dir;
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', zIndex: 200 }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select language"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: compact ? '5px 9px' : '7px 12px',
          borderRadius: '10px',
          border: open
            ? '1px solid rgba(226,75,74,0.5)'
            : '1px solid rgba(255,255,255,0.1)',
          background: open
            ? 'rgba(226,75,74,0.08)'
            : 'rgba(255,255,255,0.05)',
          color: '#E5E7EB',
          fontSize: compact ? '12px' : '13px',
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: compact ? '14px' : '16px', lineHeight: 1 }}>{current.flag}</span>
        {!compact && (
          <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {current.label}
          </span>
        )}
        {/* Chevron */}
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', opacity: 0.6 }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label="Available languages"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: '160px',
            background: 'rgba(20,20,30,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(16px)',
            overflow: 'hidden',
            padding: '4px',
          }}
        >
          {LANGUAGES.map((lang) => {
            const isSelected = lang.code === i18n.language;
            return (
              <button
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(lang)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isSelected ? 'rgba(226,75,74,0.15)' : 'transparent',
                  color: isSelected ? '#F87171' : '#D1D5DB',
                  fontSize: '13px',
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: isSelected ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                  direction: 'ltr', // keep flag+label always ltr in dropdown
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>{lang.flag}</span>
                <span>{lang.label}</span>
                {isSelected && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', color: '#E24B4A' }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
