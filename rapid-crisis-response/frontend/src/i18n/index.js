// frontend/src/i18n/index.js
// i18next configuration — loaded once before <App /> renders (imported in index.js)
// Uses inline resources so no HTTP fetch is needed in dev or production.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';
import hi from './locales/hi.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import zh from './locales/zh.json';
import pt from './locales/pt.json';

import bn from './locales/bn.json';
import mr from './locales/mr.json';
import te from './locales/te.json';
import ta from './locales/ta.json';
import gu from './locales/gu.json';
import ur from './locales/ur.json';
import kn from './locales/kn.json';
import or from './locales/or.json';
import ml from './locales/ml.json';

const STORAGE_KEY = 'respondai-lang';

// Restore previously saved language, fall back to browser language, then 'en'
const savedLang    = localStorage.getItem(STORAGE_KEY);
const browserLang  = navigator.language?.split('-')[0];
const defaultLang  = savedLang || (Object.keys({ en, es, hi, fr, ar, zh, pt, bn, mr, te, ta, gu, ur, kn, or, ml }).includes(browserLang) ? browserLang : 'en');

// Apply RTL immediately (before React hydrates) to avoid layout flash
if (defaultLang === 'ar' || defaultLang === 'ur') {
  document.documentElement.dir = 'rtl';
} else {
  document.documentElement.dir = 'ltr';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      hi: { translation: hi },
      fr: { translation: fr },
      ar: { translation: ar },
      zh: { translation: zh },
      pt: { translation: pt },
      bn: { translation: bn },
      mr: { translation: mr },
      te: { translation: te },
      ta: { translation: ta },
      gu: { translation: gu },
      ur: { translation: ur },
      kn: { translation: kn },
      or: { translation: or },
      ml: { translation: ml },
    },
    lng:          defaultLang,
    fallbackLng:  'en',
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false }, // React already escapes
  });

export default i18n;
