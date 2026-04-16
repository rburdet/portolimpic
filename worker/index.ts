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

type DataSource = 'controlmeteo' | 'weathercloud';

// ─── Shared utilities ─────────────────────────────────────────────

function kmhToKnots(kmh: number): number {
  return kmh * 0.539957;
}

function msToKnots(ms: number): number {
  return ms * 1.94384;
}

function formatDateForUrl(date: Date): string {
  const barcelonaDate = new Date(date.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  const day = barcelonaDate.getDate().toString().padStart(2, '0');
  const month = (barcelonaDate.getMonth() + 1).toString().padStart(2, '0');
  const year = barcelonaDate.getFullYear();
  return `${day}%2F${month}%2F${year}`;
}

function getDateKey(date: Date): string {
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
  const dateMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!dateMatch) throw new Error('Invalid date format');

  const [, day, month, year, hour, minute] = dateMatch;
  const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
  const localDate = new Date(isoString);

  const isWinter = (localDate.getMonth() < 2 || localDate.getMonth() > 9) ||
                   (localDate.getMonth() === 2 && localDate.getDate() < 25) ||
                   (localDate.getMonth() === 9 && localDate.getDate() > 25);
  const offsetHours = isWinter ? 1 : 2;

  return new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));
}

// ─── Controlmeteo (original source) ──────────────────────────────

async function fetchControlmeteoData(startDate: Date, endDate: Date, limit: number = 400): Promise<WindDataPoint[]> {
  const fechaIni = formatDateForUrl(startDate);
  const fechaFin = formatDateForUrl(endDate);
  const limitParam = limit ? `&limit=${limit}` : "";
  const url = `https://controlmeteo.com/mkiii/h_estacion_if.php?id=4&accion=BUSCAR&fecha_ini=${fechaIni}&fecha_fin=${fechaFin}${limitParam}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const html = await response.text();
  const tableMatch = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
  if (!tableMatch || tableMatch.length < 2) {
    return []; // No data table — station likely offline
  }

  const dataTable = tableMatch[1];
  const rowMatches = dataTable.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!rowMatches) return [];

  const data: WindDataPoint[] = [];
  for (const row of rowMatches) {
    const cellMatches = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!cellMatches || cellMatches.length < 7) continue;

    const cells = cellMatches.map(cell => cell.replace(/<[^>]*>/g, '').trim());
    try {
      const dt = parseBarcelonaDateTime(cells[0]);
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
    } catch {
      continue;
    }
  }
  return data;
}

// ─── WeatherCloud ─────────────────────────────────────────────────

const WEATHERCLOUD_DEVICE_CODE = '9415750150';
const WC_PAGE_URL = `https://app.weathercloud.net/p${WEATHERCLOUD_DEVICE_CODE}`;

// TTL jitter: adds 0–maxJitter seconds to a base TTL to spread out refetches
function jitteredTtl(baseSecs: number, maxJitterSecs: number): number {
  // Cloudflare KV minimum expirationTtl is 60 seconds
  return Math.max(60, baseSecs + Math.floor(Math.random() * maxJitterSecs));
}

// Full browser-like headers for all WeatherCloud requests
const WC_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9,es;q=0.8,ca;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// ── CSRF token, cached in KV to avoid hitting the page on every request ──

const CSRF_CACHE_KEY = 'wc_csrf_session';

async function getWeatherCloudSession(env: Env): Promise<{ csrfToken: string; cookies: string }> {
  // Check KV cache first
  try {
    const cached = await env.WIND_DATA.get(CSRF_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  // Fetch fresh token from the page
  const response = await fetch(WC_PAGE_URL, {
    headers: {
      ...WC_BROWSER_HEADERS,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
  });

  if (!response.ok) {
    throw new Error(`WeatherCloud page fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const csrfMatch = html.match(/WEATHERCLOUD_CSRF_TOKEN:"([^"]+)"/);
  if (!csrfMatch) {
    throw new Error('Could not extract CSRF token from WeatherCloud page');
  }

  const cookies = response.headers.get('set-cookie') || '';
  const session = { csrfToken: csrfMatch[1], cookies };

  // Cache for 25–35 min (jittered)
  await env.WIND_DATA.put(CSRF_CACHE_KEY, JSON.stringify(session), {
    expirationTtl: jitteredTtl(25 * 60, 10 * 60),
  });

  return session;
}

// ── Fetch lock: coalesce concurrent requests ──
// Only one worker invocation fetches from WeatherCloud at a time.
// Others see the lock and serve whatever is in cache (even if slightly stale).

const FETCH_LOCK_KEY = 'wc_fetch_lock';
const FETCH_LOCK_TTL = 60; // seconds — auto-expires if worker crashes (KV minimum is 60)

async function acquireFetchLock(env: Env): Promise<boolean> {
  const existing = await env.WIND_DATA.get(FETCH_LOCK_KEY);
  if (existing) return false; // another worker is fetching
  await env.WIND_DATA.put(FETCH_LOCK_KEY, Date.now().toString(), {
    expirationTtl: FETCH_LOCK_TTL,
  });
  return true;
}

async function releaseFetchLock(env: Env): Promise<void> {
  try { await env.WIND_DATA.delete(FETCH_LOCK_KEY); } catch {}
}

interface WeatherCloudCurrentValues {
  epoch: number;
  wspd: number;      // current wind speed m/s
  wspdavg: number;   // average wind speed m/s
  wspdhi: number;    // max wind gust m/s
  wdir: number;      // current wind direction degrees
  wdiravg: number;   // average wind direction degrees
  temp: number;
  hum: number;
  bar: number;
  [key: string]: number;
}

async function fetchWeatherCloudCurrentValues(csrfToken: string, cookies: string): Promise<WeatherCloudCurrentValues> {
  const encodedToken = encodeURIComponent(csrfToken);
  const url = `https://app.weathercloud.net/device/values?code=${WEATHERCLOUD_DEVICE_CODE}&WEATHERCLOUD_CSRF_TOKEN=${encodedToken}&_=${Date.now()}`;

  const response = await fetch(url, {
    headers: {
      ...WC_BROWSER_HEADERS,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': WC_PAGE_URL,
      'Cookie': cookies,
    },
  });

  if (!response.ok) {
    throw new Error(`WeatherCloud values fetch failed: ${response.status}`);
  }

  return response.json() as Promise<WeatherCloudCurrentValues>;
}

interface WeatherCloudEvolutionResponse {
  status: string;
  data: {
    values: Record<string, Record<string, {
      samples: number;
      stats: {
        sum?: number;
        min?: number;
        min_time?: number;
        max?: number;
        max_time?: number;
        sectors?: Record<string, number>;
      };
    }>>;
  };
}

// ── Evolution data, cached separately with longer TTL (hourly data barely changes) ──

const EVOLUTION_CACHE_KEY = 'wc_evolution';

async function getWeatherCloudEvolution(env: Env, csrfToken: string, cookies: string): Promise<WeatherCloudEvolutionResponse> {
  // Check cache — evolution data only needs refreshing every ~15min
  try {
    const cached = await env.WIND_DATA.get(EVOLUTION_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  const encodedToken = encodeURIComponent(csrfToken);

  const response = await fetch('https://app.weathercloud.net/pro/evolution', {
    method: 'POST',
    headers: {
      ...WC_BROWSER_HEADERS,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': WC_PAGE_URL,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
    },
    body: `code=${WEATHERCLOUD_DEVICE_CODE}&variable=wind&period=10min&WEATHERCLOUD_CSRF_TOKEN=${encodedToken}`,
  });

  if (!response.ok) {
    throw new Error(`WeatherCloud evolution fetch failed: ${response.status}`);
  }

  const data = await response.json() as WeatherCloudEvolutionResponse;

  // Cache for 12–18 min (jittered)
  await env.WIND_DATA.put(EVOLUTION_CACHE_KEY, JSON.stringify(data), {
    expirationTtl: jitteredTtl(12 * 60, 6 * 60),
  });

  return data;
}

/**
 * Convert WeatherCloud evolution response to WindDataPoint[].
 * Variable codes in the response:
 *   521 = max wind gust (wspdhi) in m/s
 *   541 = average wind speed (wspdavg) in m/s
 *   641 = wind direction (sectors + vector sum)
 *
 * Each hourly bucket contains min/min_time, max/max_time, sum, and samples.
 * We extract up to 3 points per bucket (at min_time, max_time, and bucket
 * midpoint) so the chart looks continuous instead of showing 1 dot per hour.
 */
function parseWeatherCloudEvolution(evolution: WeatherCloudEvolutionResponse): WindDataPoint[] {
  const pointMap = new Map<number, WindDataPoint>(); // dedup by epoch

  function addPoint(epoch: number, windKn: number, gustKn: number, dir: number) {
    const existing = pointMap.get(epoch);
    if (existing) {
      // Average wind, keep higher gust
      existing.wind_speed_knots = (existing.wind_speed_knots + windKn) / 2;
      existing.max_wind_knots = Math.max(existing.max_wind_knots, gustKn);
    } else {
      pointMap.set(epoch, {
        datetime: new Date(epoch * 1000).toISOString(),
        wind_speed_knots: windKn,
        max_wind_knots: gustKn,
        wind_direction: dir,
      });
    }
  }

  for (const [epochStr, variables] of Object.entries(evolution.data.values)) {
    const bucketEpoch = parseInt(epochStr);
    const gustData = variables['521'];
    const windData = variables['541'];
    const dirData = variables['641'];

    if (!windData?.stats || !gustData?.stats) continue;

    const avgWindMs = windData.stats.sum! / windData.samples;
    const avgGustMs = gustData.stats.sum! / gustData.samples;

    // Calculate wind direction from the vector sum
    let windDirection = 0;
    if (dirData?.stats) {
      const dirStats = dirData.stats as any;
      if (dirStats.sum?.x !== undefined && dirStats.sum?.y !== undefined) {
        let degrees = Math.atan2(dirStats.sum.x, dirStats.sum.y) * (180 / Math.PI);
        degrees = (degrees + 360) % 360;
        windDirection = Math.round(degrees);
      } else if (dirStats.sectors) {
        const sectors = dirStats.sectors as Record<string, number>;
        let maxCount = 0;
        let dominantSector = 0;
        for (const [sector, count] of Object.entries(sectors)) {
          if (count > maxCount) {
            maxCount = count;
            dominantSector = parseInt(sector);
          }
        }
        windDirection = dominantSector * 22.5;
      }
    }

    // Point 1: at min_time with min wind speed
    if (windData.stats.min_time && windData.stats.min != null) {
      addPoint(
        windData.stats.min_time,
        msToKnots(windData.stats.min),
        msToKnots(gustData.stats.min ?? avgGustMs),
        windDirection,
      );
    }

    // Point 2: at max_time with max wind speed
    if (windData.stats.max_time && windData.stats.max != null) {
      addPoint(
        windData.stats.max_time,
        msToKnots(windData.stats.max),
        msToKnots(gustData.stats.max ?? avgGustMs),
        windDirection,
      );
    }

    // Point 3: at bucket midpoint with average values
    const midEpoch = bucketEpoch + 1800; // +30min = middle of the hour
    addPoint(midEpoch, msToKnots(avgWindMs), msToKnots(avgGustMs), windDirection);
  }

  const data = Array.from(pointMap.values());
  data.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  return data;
}

function weatherCloudCurrentToDataPoint(values: WeatherCloudCurrentValues): WindDataPoint {
  // WeatherCloud API returns wind values in m/s
  return {
    datetime: new Date(values.epoch * 1000).toISOString(),
    wind_speed_knots: msToKnots(values.wspdavg),
    max_wind_knots: msToKnots(values.wspdhi),
    wind_direction: values.wdiravg,
  };
}

// ─── KV-based readings store ──────────────────────────────────────
// Accumulates individual WeatherCloud readings so we build granular history

async function storeWeatherCloudReadings(env: Env, points: WindDataPoint[]): Promise<void> {
  if (points.length === 0) return;

  // Group points by date to minimize KV ops (one GET+PUT per date)
  const byDate = new Map<string, WindDataPoint[]>();
  for (const point of points) {
    const dateKey = getDateKey(new Date(point.datetime));
    const group = byDate.get(dateKey) ?? [];
    group.push(point);
    byDate.set(dateKey, group);
  }

  for (const [dateKey, newPoints] of byDate) {
    const kvKey = `wc_readings_${dateKey}`;
    try {
      const existing = await env.WIND_DATA.get(kvKey);
      const readings: WindDataPoint[] = existing ? JSON.parse(existing) : [];

      for (const point of newPoints) {
        const pointTime = new Date(point.datetime).getTime();
        // Station updates ~every 60s. If we already have a reading with the
        // same epoch, average the values to smooth out noise.
        const existingIdx = readings.findIndex(r => new Date(r.datetime).getTime() === pointTime);
        if (existingIdx !== -1) {
          const prev = readings[existingIdx];
          readings[existingIdx] = {
            datetime: prev.datetime,
            wind_speed_knots: (prev.wind_speed_knots + point.wind_speed_knots) / 2,
            max_wind_knots: Math.max(prev.max_wind_knots, point.max_wind_knots),
            wind_direction: point.wind_direction,
          };
        } else {
          readings.push(point);
        }
      }

      readings.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

      // Keep readings for 30 days
      await env.WIND_DATA.put(kvKey, JSON.stringify(readings), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
    } catch (error) {
      console.error('Error storing WeatherCloud readings:', error);
    }
  }
}

async function getStoredWeatherCloudReadings(env: Env, dateKey: string): Promise<WindDataPoint[]> {
  try {
    const data = await env.WIND_DATA.get(`wc_readings_${dateKey}`);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// ─── Caching layer ────────────────────────────────────────────────

async function getCachedDayData(env: Env, dateKey: string): Promise<{ data: WindDataPoint[], source: DataSource, timestamp: number } | null> {
  try {
    const cachedData = await env.WIND_DATA.get(`day_${dateKey}`);
    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      return { data: parsed.data, source: parsed.source || 'controlmeteo', timestamp: parsed.timestamp ?? 0 };
    }
  } catch (error) {
    console.error('Error reading day cache:', error);
  }
  return null;
}

async function cacheDayData(env: Env, dateKey: string, data: WindDataPoint[], source: DataSource): Promise<void> {
  try {
    const cacheData = { data, timestamp: Date.now(), dateKey, source };
    // Current day: 60–90s jittered. Historical: 7 days + up to 1h jitter.
    const ttl = isToday(new Date(dateKey)) ? jitteredTtl(60, 30) : jitteredTtl(7 * 24 * 60 * 60, 3600);
    await env.WIND_DATA.put(`day_${dateKey}`, JSON.stringify(cacheData), {
      expirationTtl: ttl
    });
  } catch (error) {
    console.error('Error caching day data:', error);
  }
}

// ─── Main data fetching with fallback ─────────────────────────────

async function fetchDayData(
  env: Env,
  date: Date,
  limit: number,
): Promise<{ data: WindDataPoint[], source: DataSource }> {
  const barcelonaDate = new Date(date.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  const startOfDay = new Date(barcelonaDate.getFullYear(), barcelonaDate.getMonth(), barcelonaDate.getDate());
  const endOfDay = new Date(barcelonaDate.getFullYear(), barcelonaDate.getMonth(), barcelonaDate.getDate(), 23, 59, 59);

  // 1) Try controlmeteo first
  try {
    const controlData = await fetchControlmeteoData(startOfDay, endOfDay, limit);
    if (controlData.length > 0) {
      return { data: controlData, source: 'controlmeteo' };
    }
    console.log('Controlmeteo returned no data, falling back to WeatherCloud');
  } catch (error) {
    console.error('Controlmeteo fetch failed, falling back to WeatherCloud:', error);
  }

  // 2) Fallback to WeatherCloud
  try {
    const dateKey = getDateKey(barcelonaDate);
    const storedReadings = await getStoredWeatherCloudReadings(env, dateKey);

    // Coalesce: only one worker fetches at a time; others serve stored data
    const gotLock = await acquireFetchLock(env);
    if (!gotLock && storedReadings.length > 0) {
      console.log('WeatherCloud fetch lock held by another worker, serving stored readings');
      return { data: storedReadings, source: 'weathercloud' };
    }

    try {
    // Get cached or fresh session
    const { csrfToken, cookies } = await getWeatherCloudSession(env);

    // Fetch current value and store it
    const currentValues = await fetchWeatherCloudCurrentValues(csrfToken, cookies);
    const currentPoint = weatherCloudCurrentToDataPoint(currentValues);

    // Fetch evolution data (cached separately, ~15min TTL)
    const evolution = await getWeatherCloudEvolution(env, csrfToken, cookies);
    const evolutionData = parseWeatherCloudEvolution(evolution);

    // Store current + all evolution points in one batch (one GET+PUT per date instead of N)
    await storeWeatherCloudReadings(env, [currentPoint, ...evolutionData]);

    // Merge evolution data with stored readings (stored readings have more granularity over time)
    const allReadings = [...storedReadings];
    const existingTimes = new Set(allReadings.map(r => new Date(r.datetime).getTime()));

    for (const point of evolutionData) {
      const t = new Date(point.datetime).getTime();
      if (!existingTimes.has(t)) {
        allReadings.push(point);
        existingTimes.add(t);
      }
    }

    // Add current point if not already there
    const currentTime = new Date(currentPoint.datetime).getTime();
    if (!existingTimes.has(currentTime)) {
      allReadings.push(currentPoint);
    }

    // Filter to only this day
    const dayStart = startOfDay.getTime();
    const dayEnd = endOfDay.getTime();
    const dayData = allReadings
      .filter(p => {
        const t = new Date(p.datetime).getTime();
        return t >= dayStart && t <= dayEnd;
      })
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    return { data: dayData, source: 'weathercloud' };
    } finally {
      if (gotLock) await releaseFetchLock(env);
    }
  } catch (error) {
    console.error('WeatherCloud fetch also failed:', error);
    // If we have stored readings, return those even on error
    const dateKey = getDateKey(barcelonaDate);
    const fallbackReadings = await getStoredWeatherCloudReadings(env, dateKey);
    return { data: fallbackReadings, source: 'weathercloud' };
  }
}

async function getCurrentDayData(
  env: Env,
  limit: number,
): Promise<{ data: WindDataPoint[], cached: boolean, source: DataSource }> {
  const now = new Date();
  const barcelonaNow = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  const todayKey = getDateKey(barcelonaNow);

  // Check cache
  const cached = await getCachedDayData(env, todayKey);
  if (cached) {
    const cacheAge = Date.now() - cached.timestamp;
    if (cacheAge < 60_000) { // 1 min — matches station update cadence
      return { data: cached.data, cached: true, source: cached.source };
    }
  }

  const result = await fetchDayData(env, barcelonaNow, limit);
  await cacheDayData(env, todayKey, result.data, result.source);
  return { data: result.data, cached: false, source: result.source };
}

async function getHistoricalData(
  env: Env,
  startDate: Date,
  endDate: Date,
  limit: number,
): Promise<{ data: WindDataPoint[], cached: boolean, source: DataSource }> {
  const allData: WindDataPoint[] = [];
  let anyCached = false;
  let anyFresh = false;
  let primarySource: DataSource = 'controlmeteo';

  const dates: Date[] = [];
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log(`Fetching data for ${dates.length} dates from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  for (const date of dates) {
    const dateKey = getDateKey(date);

    if (isToday(date)) {
      const result = await getCurrentDayData(env, Math.floor(limit / dates.length));
      allData.push(...result.data);
      if (result.source === 'weathercloud') primarySource = 'weathercloud';
      if (result.cached) anyCached = true;
      else anyFresh = true;
    } else {
      const cached = await getCachedDayData(env, dateKey);

      if (cached) {
        allData.push(...cached.data);
        if (cached.source === 'weathercloud') primarySource = 'weathercloud';
        anyCached = true;
      } else {
        const result = await fetchDayData(env, date, 4000);
        allData.push(...result.data);
        if (result.source === 'weathercloud') primarySource = 'weathercloud';
        await cacheDayData(env, dateKey, result.data, result.source);
        anyFresh = true;
      }
    }
  }

  allData.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  const limitedData = allData.slice(0, limit);

  console.log(`Total: ${allData.length} points, returning ${limitedData.length}, source: ${primarySource}`);

  return {
    data: limitedData,
    cached: anyCached && !anyFresh,
    source: primarySource,
  };
}

// ─── HTTP handler ─────────────────────────────────────────────────

async function handleWindDataRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const daysParam = searchParams.get('days') || '7';
  const hoursParam = searchParams.get('hours');
  const limitParam = searchParams.get('limit') || '400';
  const forceRefreshParam = searchParams.get('refresh') === 'true';

  const days = parseInt(daysParam);
  const limit = parseInt(limitParam);
  const hours = hoursParam ? parseInt(hoursParam) : null;

  if (isNaN(days) || days < 1 || days > 30) {
    return Response.json({ error: 'Days parameter must be between 1 and 30' }, { status: 400 });
  }

  const now = new Date();
  const barcelonaNow = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  const endDate = new Date(barcelonaNow.getFullYear(), barcelonaNow.getMonth(), barcelonaNow.getDate(), 23, 59, 59);
  const startDate = new Date(barcelonaNow.getFullYear(), barcelonaNow.getMonth(), barcelonaNow.getDate() - days + 1, 0, 0, 0);

  console.log(`Request: days=${days}, hours=${hours}, limit=${limit}, refresh=${forceRefreshParam}`);

  if (forceRefreshParam) {
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateKey = getDateKey(currentDate);
      try { await env.WIND_DATA.delete(`day_${dateKey}`); } catch {}
      try { await env.WIND_DATA.delete(`wc_readings_${dateKey}`); } catch {}
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  try {
    const result = await getHistoricalData(env, startDate, endDate, limit);

    // If hours param is set, filter to only the requested time window
    let filteredData = result.data;
    if (hours && hours < days * 24) {
      const cutoff = new Date(barcelonaNow.getTime() - hours * 60 * 60 * 1000);
      filteredData = result.data.filter(p => new Date(p.datetime) >= cutoff);
    }

    return Response.json({
      data: filteredData,
      cached: result.cached,
      timestamp: Date.now(),
      source: result.source,
    });
  } catch (error) {
    console.error('Error fetching wind data:', error);
    return Response.json({
      error: 'Failed to fetch wind data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// ─── Cron job ─────────────────────────────────────────────────────

async function handleCron(env: Env): Promise<void> {
  try {
    // Fetch latest wind data from WeatherCloud (since controlmeteo is offline)
    const { csrfToken, cookies } = await getWeatherCloudSession(env);
    const currentValues = await fetchWeatherCloudCurrentValues(csrfToken, cookies);
    const dataPoint = weatherCloudCurrentToDataPoint(currentValues);

    // Store the reading for history
    await storeWeatherCloudReadings(env, [dataPoint]);

    // Send notifications if thresholds exceeded
    const notificationService = new NotificationService(env);
    await notificationService.checkAndSendNotifications({
      wind_speed_knots: dataPoint.wind_speed_knots,
      max_wind_knots: dataPoint.max_wind_knots,
      datetime: dataPoint.datetime,
      location: 'default',
    });
  } catch (error) {
    console.error('Cron job error:', error);
  }
}

// ─── Worker entry point ───────────────────────────────────────────

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env));
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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
      if (path === '/api/notifications/settings') {
        if (request.method === 'POST') {
          const response = await notificationService.handleSubscriptionSave(request);
          return new Response(response.body, {
            status: response.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (request.method === 'GET') {
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

      if (path === '/api/notifications/trigger' && request.method === 'POST') {
        await handleCron(env);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (path === '/api/wind-data') {
        const response = await handleWindDataRequest(request, env);
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
