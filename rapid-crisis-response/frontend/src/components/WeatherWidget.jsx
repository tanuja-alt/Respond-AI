import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fetchLiveWeather } from '../services/weatherService';

export default function WeatherWidget({ onSevereWeather }) {
  const { t, i18n } = useTranslation();
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    const fetchFallback = async () => {
      console.warn("[WeatherWidget] Geolocation blocked/failed, using fallback location (Pimpri)");
      const data = await fetchLiveWeather(18.6298, 73.7997, i18n.language);
      if (data) {
        setWeather(data);
        if (data.isSevere && onSevereWeather) {
          onSevereWeather(data.alertMessage);
        }
      } else {
        // Mock fallback if API fails completely
        setWeather({
          city: t('weather.pimpri', 'Pimpri (Mock)'),
          description: t('weather.few_clouds', 'Few Clouds'),
          temp: 28,
          windSpeed: 2.5,
          humidity: 45,
          iconUrl: 'https://openweathermap.org/img/wn/02d@2x.png',
          isSevere: false
        });
      }
      setLoading(false);
    };

    if (!navigator.geolocation) {
      fetchFallback();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const data = await fetchLiveWeather(pos.coords.latitude, pos.coords.longitude, i18n.language);
        if (data) {
          setWeather(data);
          if (data.isSevere && onSevereWeather) {
            onSevereWeather(data.alertMessage);
          }
        } else {
          // Mock fallback if API fails
          setWeather({
            city: t('weather.pimpri', 'Pimpri (Mock)'),
            description: t('weather.few_clouds', 'Few Clouds'),
            temp: 28,
            windSpeed: 2.5,
            humidity: 45,
            iconUrl: 'https://openweathermap.org/img/wn/02d@2x.png',
            isSevere: false
          });
        }
        setLoading(false);
      },
      (err) => {
        fetchFallback();
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }, [onSevereWeather, i18n.language, t]);

  useEffect(() => {
    fetchWeather();
    
    // Refresh every 10 minutes
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchWeather, i18n.language]);

  // No need for error return blocks since we now use mock fallback
  
  // Use a placeholder if loading and no weather yet
  const displayWeather = weather || {
    city: t('weather.pimpri', 'Pimpri (Mock)'),
    description: t('weather.few_clouds', 'Few Clouds'),
    temp: 28,
    windSpeed: 2.5,
    humidity: 45,
    iconUrl: 'https://openweathermap.org/img/wn/02d@2x.png',
    isSevere: false
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: -10 }} 
      animate={{ opacity: 1, y: 0 }}
      style={containerStyle}
    >
      {/* Severe Weather Banner */}
      {displayWeather.isSevere && (
        <motion.div 
          animate={{ opacity: [1, 0.7, 1] }} 
          transition={{ repeat: Infinity, duration: 1.5 }}
          style={{
            background: '#E24B4A',
            color: '#fff',
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: 700,
            textAlign: 'center',
            borderBottom: '1px solid rgba(0,0,0,0.1)'
          }}
        >
          {weather.alertMessage}
        </motion.div>
      )}

      {/* Main Content */}
      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        
        {/* Left: Location & Condition */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {displayWeather.iconUrl && (
            <img 
              src={displayWeather.iconUrl} 
              alt={displayWeather.description} 
              style={{ width: '40px', height: '40px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }} 
            />
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#F3F4F6' }}>
              {displayWeather.city ? t(`weather.city_${displayWeather.city.toLowerCase().replace(/ \([^)]*\)/g, '').replace(/ /g, '_')}`, displayWeather.city) : t('weather.local_area', 'Local Area')}
            </div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', textTransform: 'capitalize' }}>
              {t(`weather.cond_${displayWeather.description.toLowerCase().replace(/ /g, '_')}`, displayWeather.description)}
            </div>
          </div>
        </div>

        {/* Right: Stats & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#34D399', fontFamily: "'Bebas Neue', cursive", letterSpacing: '1px' }}>
              {displayWeather.temp ? Math.round(displayWeather.temp) : '--'}{t('weather.unit_celsius', '°C')}
            </div>
            <div style={{ fontSize: '10px', color: '#6B7280' }}>
              {t('weather.wind', 'Wind')}: {displayWeather.windSpeed}{t('weather.unit_wind', 'm/s')} · {t('weather.humidity', 'Hum')}: {displayWeather.humidity}{t('weather.unit_humidity', '%')}
            </div>
          </div>
          <button 
            onClick={fetchWeather} 
            disabled={loading}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: loading ? 'wait' : 'pointer',
              color: '#D1D5DB'
            }}
            title={t('weather.refresh', 'Refresh Weather')}
          >
            <span style={{ fontSize: '14px', transform: loading ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
              ↻
            </span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

const containerStyle = {
  background: 'rgba(26,26,38,0.5)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '12px',
  overflow: 'hidden',
  marginBottom: '16px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  backdropFilter: 'blur(12px)'
};
