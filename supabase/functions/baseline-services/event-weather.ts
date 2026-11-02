type Event = { id: number; date: string; cancelled?: boolean; address?: string; place_id?: string; latitude?: number; longitude?: number };
type Services = {
  get: (url: string) => Promise<any>;
  db: (path: string, method?: string, body?: unknown) => Promise<any>;
  budget: (bucket: string, seconds: number, maximum: number) => Promise<boolean>;
  place: (id: string) => Promise<any>;
  now?: Date;
};
const validPoint = (lat: unknown, lon: unknown) => typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90
  && typeof lon === "number" && Number.isFinite(lon) && Math.abs(lon) <= 180;

export function weatherLocationKey(event: Event) {
  return JSON.stringify([event.address || "", event.latitude ?? null, event.longitude ?? null, event.place_id || ""]);
}

export async function weatherLocation(event: Event, services: Pick<Services, "get" | "place">) {
  if (validPoint(event.latitude, event.longitude)) return { latitude: event.latitude, longitude: event.longitude };
  if (event.place_id) {
    try {
      const found = await services.place(event.place_id);
      if (validPoint(found?.location?.latitude, found?.location?.longitude)) return found.location;
    } catch { /* A saved UK address can still supply a forecast location. */ }
  }
  const postcode = String(event.address || "").match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i)?.[0].replace(/\s/g, "").toUpperCase();
  if (!postcode) return null;
  const found = await services.get("https://api.postcodes.io/postcodes/" + encodeURIComponent(postcode));
  return found.status === 200 && validPoint(found.result?.latitude, found.result?.longitude)
    ? { latitude: found.result.latitude, longitude: found.result.longitude } : null;
}

export async function eventWeather(event: Event, services: Services) {
  const now = services.now || new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
  const days = Math.round((Date.parse(event.date) - Date.parse(today)) / 86400000);
  if (days < 0 || event.cancelled) return { status: "closed" };
  if (days > 15) return { status: "too_early", message: "Forecasts become available within 16 days of the event." };
  const saved = (await services.db("baseline_weather?event_id=eq." + event.id))[0];
  const locationKey = weatherLocationKey(event);
  const cached = saved?.forecast?.event_date === event.date && saved.forecast.location_key === locationKey
    && saved.forecast.status === "ready" && saved.forecast.hours?.length ? saved : null;
  const age = cached ? now.valueOf() - Date.parse(cached.updated_at) : Infinity;
  const fallback = () => cached && age >= 0 && age < 24 * 3600000
    ? { ...cached.forecast, updated_at: cached.updated_at, stale: true }
    : { status: "unavailable", message: "The forecast service is temporarily unavailable." };
  if (cached && age >= 0 && age < 3 * 3600000) return { ...cached.forecast, updated_at: cached.updated_at };
  if (!(await services.budget("weather:" + event.id, 3600, 2))) return fallback();
  try {
    const location = await weatherLocation(event, services);
    if (!location) return { status: "no_location", message: "Add the event’s postcode or map location to show a forecast." };
    const params = new URLSearchParams({
      latitude: String(location.latitude), longitude: String(location.longitude),
      hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
      timezone: "Europe/London", forecast_days: "16", temperature_unit: "celsius", wind_speed_unit: "kmh",
    });
    const data = await services.get("https://api.open-meteo.com/v1/forecast?" + params);
    const hourly = data.hourly;
    if (!Array.isArray(hourly?.time)) return fallback();
    const metric = (values: unknown[], i: number) => typeof values?.[i] === "number" && Number.isFinite(values[i]) ? values[i] : null;
    const hours = hourly.time.flatMap((time: unknown, i: number) => typeof time === "string" && time.startsWith(event.date + "T") ? [{
      time, temperature: metric(hourly.temperature_2m, i), rain: metric(hourly.precipitation_probability, i),
      code: metric(hourly.weather_code, i), wind: metric(hourly.wind_speed_10m, i),
    }] : []);
    if (!hours.length) return fallback();
    const forecast = { status: "ready", event_date: event.date, hours, source: "Open-Meteo", timezone: "Europe/London", location_key: locationKey };
    const updated_at = now.toISOString();
    await services.db("baseline_weather", "POST", { event_id: event.id, forecast, updated_at });
    return { ...forecast, updated_at };
  } catch { return fallback(); }
}
