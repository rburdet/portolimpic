import { NotificationService } from './notification-service';

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_EMAIL: string;
  RESEND_API_KEY?: string;
  WIND_DATA: KVNamespace;
}

interface WindDataPoint {
  datetime: string;
  wind_speed_knots: number;
  max_wind_knots: number;
  wind_direction: number;
}

function kmhToKnots(kmh: number): number {
  return kmh * 0.539957;
}

function formatDateForUrl(date: Date): string {
  // Convert to Barcelona timezone for the API request
  const barcelonaDate = new Date(date.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  const day = barcelonaDate.getDate().toString().padStart(2, '0');
  const month = (barcelonaDate.getMonth() + 1).toString().padStart(2, '0');
  const year = barcelonaDate.getFullYear();
  return `${day}%2F${month}%2F${year}`;
}

function getDateKey(date: Date): string {
  // Use the date directly without timezone conversion for consistency
  // The date should already be in the correct timezone context when passed here
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  const barcelonaNow = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  
  return date.getFullYear() === barcelonaNow.getFullYear() &&
         date.getMonth() === barcelonaNow.getMonth() &&
         date.getDate() === barcelonaNow.getDate();
}

function parseBarcelonaDateTime(dateStr: string): Date {
  // Parse date string as Barcelona time and convert to UTC
  const dateMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!dateMatch) throw new Error('Invalid date format');
  
  const [, day, month, year, hour, minute] = dateMatch;
  
  // Create an ISO string for the Barcelona time
  const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
  
  // Parse as local time first
  const localDate = new Date(isoString);
  
  // Get the timezone offset for Barcelona at this date
  // We'll use a simple approach: Barcelona is UTC+1 in winter, UTC+2 in summer
  const isWinter = (localDate.getMonth() < 2 || localDate.getMonth() > 9) || 
                   (localDate.getMonth() === 2 && localDate.getDate() < 25) ||
                   (localDate.getMonth() === 9 && localDate.getDate() > 25);
  
  const offsetHours = isWinter ? 1 : 2;
  
  // Convert to UTC by subtracting the Barcelona offset
  return new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));
}

async function fetchWindDataFromSource(startDate: Date, endDate: Date, limit: number = 400): Promise<WindDataPoint[]> {
  const fechaIni = formatDateForUrl(startDate);
  const fechaFin = formatDateForUrl(endDate);
  
  const limitParam = limit ? `&limit=${limit}` : "";
  const url = `https://controlmeteo.com/mkiii/h_estacion_if.php?id=4&accion=BUSCAR&fecha_ini=${fechaIni}&fecha_fin=${fechaFin}${limitParam}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    
    // Parse HTML to extract table data
    const tableMatch = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
    if (!tableMatch || tableMatch.length < 2) {
      throw new Error('Could not find data table in response');
    }

    // Get the second table (index 1) which contains the data
    const dataTable = tableMatch[1];
    const rowMatches = dataTable.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
    
    if (!rowMatches) {
      throw new Error('No table rows found');
    }

    const data: WindDataPoint[] = [];
    
    for (const row of rowMatches) {
      const cellMatches = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (!cellMatches || cellMatches.length < 7) continue;

      // Extract cell contents
      const cells = cellMatches.map(cell => 
        cell.replace(/<[^>]*>/g, '').trim()
      );

      const dateStr = cells[0];
      
      // Try to parse the date using Barcelona timezone
      try {
        const dt = parseBarcelonaDateTime(dateStr);
        
        const windSpeed = parseFloat(cells[5].replace(',', '.'));
        const maxWind = parseFloat(cells[6].replace(',', '.'));
        const windDir = parseFloat(cells[4]);

        if (!isNaN(windSpeed) && !isNaN(maxWind) && !isNaN(windDir)) {
          data.push({
            datetime: dt.toISOString(),
            wind_speed_knots: kmhToKnots(windSpeed),
            max_wind_knots: kmhToKnots(maxWind),
            wind_direction: windDir
          });
        }
      } catch (error) {
        console.error('Error parsing row:', error);
        continue;
      }
    }

    return data;
  } catch (error) {
    console.error('Error fetching wind data:', error);
    throw error;
  }
}

async function getCachedDayData(env: Env, dateKey: string): Promise<WindDataPoint[] | null> {
  try {
    const cachedData = await env.WIND_DATA.get(`day_${dateKey}`);
    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      return parsed.data;
    }
  } catch (error) {
    console.error('Error reading day cache:', error);
  }
  return null;
}

async function cacheDayData(env: Env, dateKey: string, data: WindDataPoint[]): Promise<void> {
  try {
    const cacheData = {
      data,
      timestamp: Date.now(),
      dateKey
    };
    
    // Cache complete days for 7 days, current day for 10 minutes
    const ttl = isToday(new Date(dateKey)) ? 10 * 60 : 7 * 24 * 60 * 60;
    
    await env.WIND_DATA.put(`day_${dateKey}`, JSON.stringify(cacheData), {
      expirationTtl: ttl
    });
  } catch (error) {
    console.error('Error caching day data:', error);
  }
}

async function getCurrentDayData(env: Env, limit: number): Promise<{ data: WindDataPoint[], cached: boolean }> {
  const now = new Date();
  const barcelonaNow = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  const todayKey = getDateKey(barcelonaNow);
  
  // Check cache for current day (short TTL)
  const cachedData = await getCachedDayData(env, todayKey);
  if (cachedData) {
    // Check if cache is less than 10 minutes old for current day
    try {
      const cacheInfo = await env.WIND_DATA.get(`day_${todayKey}`);
      if (cacheInfo) {
        const parsed = JSON.parse(cacheInfo);
        const cacheAge = Date.now() - parsed.timestamp;
        if (cacheAge < 10 * 60 * 1000) { // 10 minutes
          return { data: cachedData, cached: true };
        }
      }
    } catch (error) {
      console.error('Error checking cache age:', error);
    }
  }
  
  // Fetch fresh data for current day in Barcelona timezone
  const startOfDay = new Date(barcelonaNow.getFullYear(), barcelonaNow.getMonth(), barcelonaNow.getDate());
  const endOfDay = new Date(barcelonaNow.getFullYear(), barcelonaNow.getMonth(), barcelonaNow.getDate(), 23, 59, 59);
  
  const freshData = await fetchWindDataFromSource(startOfDay, endOfDay, limit);
  
  // Cache the fresh data
  await cacheDayData(env, todayKey, freshData);
  
  return { data: freshData, cached: false };
}

async function getHistoricalData(env: Env, startDate: Date, endDate: Date, limit: number): Promise<{ data: WindDataPoint[], cached: boolean }> {
  const allData: WindDataPoint[] = [];
  let anyCached = false;
  let anyFresh = false;
  
  // Generate list of dates to fetch in Barcelona timezone
  const dates: Date[] = [];
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  console.log(`Fetching data for ${dates.length} dates from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  // Process each date
  for (const date of dates) {
    const dateKey = getDateKey(date);
    console.log(`Processing date: ${date.toISOString()}, dateKey: ${dateKey}`);
    
    if (isToday(date)) {
      // Handle current day with short cache
      const result = await getCurrentDayData(env, Math.floor(limit / dates.length));
      allData.push(...result.data);
      console.log(`Current day data: ${result.data.length} points, cached: ${result.cached}`);
      if (result.cached) anyCached = true;
      else anyFresh = true;
    } else {
      // Handle historical days with long cache
      let dayData = await getCachedDayData(env, dateKey);
      
      if (!dayData) {
        // Fetch complete day data - use Barcelona timezone for day boundaries
        const barcelonaDate = new Date(date.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
        const startOfDay = new Date(barcelonaDate.getFullYear(), barcelonaDate.getMonth(), barcelonaDate.getDate());
        const endOfDay = new Date(barcelonaDate.getFullYear(), barcelonaDate.getMonth(), barcelonaDate.getDate(), 23, 59, 59);
        
        console.log(`Fetching fresh data for ${dateKey} from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
        dayData = await fetchWindDataFromSource(startOfDay, endOfDay, 4000); // Get full day
        console.log(`Fetched ${dayData.length} data points for ${dateKey}`);
        await cacheDayData(env, dateKey, dayData);
        anyFresh = true;
      } else {
        console.log(`Using cached data for ${dateKey}: ${dayData.length} points`);
        anyCached = true;
      }
      
      allData.push(...dayData);
    }
  }
  
  console.log(`Total data points before sorting: ${allData.length}`);
  
  // Sort by datetime and limit results
  allData.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  const limitedData = allData.slice(0, limit);
  
  console.log(`Final data points after limit: ${limitedData.length}`);
  
  return { 
    data: limitedData, 
    cached: anyCached && !anyFresh 
  };
}

async function handleWindDataRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  
  const daysParam = searchParams.get('days') || '7';
  const limitParam = searchParams.get('limit') || '400';
  const forceRefreshParam = searchParams.get('refresh') === 'true';
  
  const days = parseInt(daysParam);
  const limit = parseInt(limitParam);
  
  if (isNaN(days) || days < 1 || days > 30) {
    return Response.json({ error: 'Days parameter must be between 1 and 30' }, { status: 400 });
  }

  // Use Barcelona timezone for date calculations
  const now = new Date();
  const barcelonaNow = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  
  // Calculate start date in Barcelona timezone - go back the specified number of days
  const endDate = new Date(barcelonaNow.getFullYear(), barcelonaNow.getMonth(), barcelonaNow.getDate(), 23, 59, 59);
  const startDate = new Date(barcelonaNow.getFullYear(), barcelonaNow.getMonth(), barcelonaNow.getDate() - days + 1, 0, 0, 0);
  
  console.log(`Request: days=${days}, limit=${limit}, refresh=${forceRefreshParam}`);
  console.log(`Barcelona now: ${barcelonaNow.toISOString()}`);
  console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  // If force refresh, clear relevant caches
  if (forceRefreshParam) {
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateKey = getDateKey(currentDate);
      try {
        await env.WIND_DATA.delete(`day_${dateKey}`);
        console.log(`Cleared cache for ${dateKey}`);
      } catch (error) {
        console.error('Error clearing cache:', error);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  try {
    const result = await getHistoricalData(env, startDate, endDate, limit);
    
    return Response.json({
      data: result.data,
      cached: result.cached,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching wind data:', error);
    return Response.json({ 
      error: 'Failed to fetch wind data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export default {
  // Cron trigger - runs every 5 minutes
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env));
  },

  // HTTP requests
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const notificationService = new NotificationService(env);

    try {
      // API Routes
      if (path === '/api/notifications/settings') {
        if (request.method === 'POST') {
          const response = await notificationService.handleSubscriptionSave(request);
          return new Response(response.body, {
            status: response.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        if (request.method === 'GET') {
          // Return user's current settings
          return new Response(JSON.stringify({
            enabled: false,
            windSpeedThreshold: 20,
            gustThreshold: 25,
            pushEnabled: false
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      if (path === '/api/notifications/test' && request.method === 'POST') {
        const response = await notificationService.handleTestNotification(request);
        return new Response(response.body, {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Manual trigger for testing
      if (path === '/api/notifications/trigger' && request.method === 'POST') {
        await handleCron(env);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (path === '/api/wind-data') {
        const response = await handleWindDataRequest(request, env);
        // Add CORS headers to the response
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        return response;
      }

      if (path.startsWith("/api/")) {
        return Response.json({
          name: "Port Olímpic Wind Data API",
          endpoints: {
            "/api/wind-data": "Get wind data with optional query params: ?days=7&limit=400&refresh=true"
          }
        }, { headers: corsHeaders });
      }

      return new Response('Not Found', { 
        status: 404,
        headers: corsHeaders
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

async function handleCron(env: Env): Promise<void> {
  try {
    // Fetch latest wind data
    const windData = await fetchLatestWindData();
    
    if (windData) {
      const notificationService = new NotificationService(env);
      await notificationService.checkAndSendNotifications(windData);
    }
  } catch (error) {
    console.error('Cron job error:', error);
  }
}

async function fetchLatestWindData(): Promise<any> {
  try {
    // Replace with your actual wind data API
    const response = await fetch('YOUR_WIND_DATA_API_ENDPOINT');
    const data = await response.json();
    
    // Transform to expected format
    return {
      wind_speed_knots: data.wind_speed,
      max_wind_knots: data.gust_speed,
      datetime: data.timestamp || new Date().toISOString(),
      location: 'default'
    };
  } catch (error) {
    console.error('Failed to fetch wind data:', error);
    return null;
  }
}
