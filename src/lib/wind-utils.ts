export function degToCompass16(deg: number): string {
  // Map wind direction to 16-point compass
  const compass16 = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  ];
  const idx = Math.floor((deg + 11.25) / 22.5) % 16;
  return compass16[idx] || 'N';
}

export function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Madrid'
  });
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });
}

export interface WindDataPoint {
  datetime: string;
  wind_speed_knots: number;
  max_wind_knots: number;
  wind_direction: number;
}

export interface WindDataResponse {
  data: WindDataPoint[];
  cached: boolean;
  timestamp: number;
  source?: 'controlmeteo' | 'weathercloud';
} 