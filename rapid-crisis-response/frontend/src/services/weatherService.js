const API_KEY = 'c57b4d4f66ce90c8663f173a9e4e0269';
const BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';

export const fetchLiveWeather = async (lat, lon, lang = 'en') => {
  try {
    const response = await fetch(`${BASE_URL}?lat=${lat}&lon=${lon}&units=metric&lang=${lang}&appid=${API_KEY}`);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    
    const temp = data.main?.temp;
    const condition = data.weather?.[0]?.main;
    const description = data.weather?.[0]?.description;
    const city = data.name;
    const humidity = data.main?.humidity;
    const windSpeed = data.wind?.speed;
    const iconId = data.weather?.[0]?.icon;
    const iconUrl = iconId ? `https://openweathermap.org/img/wn/${iconId}@2x.png` : null;

    // High alert logic
    let isSevere = false;
    let alertMessage = null;

    const lowerDesc = description?.toLowerCase() || '';
    
    if (
      condition === 'Thunderstorm' || 
      condition === 'Extreme' || 
      lowerDesc.includes('heavy rain') || 
      lowerDesc.includes('extreme') ||
      (temp && temp > 40)
    ) {
      isSevere = true;
      alertMessage = `⚠️ HIGH ALERT: Severe weather (${description || condition}) detected in ${city || 'your area'}!`;
    }

    return {
      temp,
      condition,
      description,
      city,
      humidity,
      windSpeed,
      iconUrl,
      isSevere,
      alertMessage
    };
  } catch (error) {
    console.error('[WeatherService] Error fetching weather:', error);
    return null;
  }
};
