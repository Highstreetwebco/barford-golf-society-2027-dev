const forecasts = new Map(), pending = new Map(), tickets = new WeakMap(), rendered = new WeakMap();
const conditions = {
  0: "Clear skies", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Showers",
  82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorms",
  96: "Thunderstorms with hail", 97: "Heavy thunderstorms", 99: "Thunderstorms with hail",
};
const number = value => typeof value === "number" && Number.isFinite(value);
export function clockMinutes(value) {
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value || ""));
  return match && Number(match[1]) < 24 ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function nearestForecast(forecast, eventDate, teeTime) {
  const start = clockMinutes(teeTime);
  if (start === null || forecast?.status !== "ready" || forecast.event_date !== eventDate
    || forecast.timezone !== "Europe/London" || !Array.isArray(forecast.hours)) return null;
  const hours = forecast.hours.flatMap(hour => {
    if (typeof hour?.time !== "string" || !hour.time.startsWith(eventDate + "T")) return [];
    const minutes = clockMinutes(hour.time.slice(11));
    return minutes === null ? [] : [{ ...hour, minutes }];
  }).sort((a, b) => a.minutes - b.minutes);
  const nearest = hours.reduce((best, hour) => !best || Math.abs(hour.minutes - start) < Math.abs(best.minutes - start) ? hour : best, null);
  return nearest && Math.abs(nearest.minutes - start) <= 60 ? nearest : null;
}

function weatherHTML(forecast, event, teeTime, b) {
  const e = b.escape, title = '<h3>Weather for your tee time</h3>';
  if (clockMinutes(teeTime) === null) return `${title}<p class="muted">Your forecast will appear here once your tee time is confirmed.</p>`;
  const heading = `${title}<p class="weather-when">${e(b.date(event.date))} · Your tee time: <strong>${e(teeTime.slice(0, 5))}</strong> <span>(UK time)</span></p>`;
  if (forecast.status === "too_early") return `${heading}<p class="muted">The forecast will appear here within 16 days of the event.</p>`;
  if (forecast.status === "closed") return `${heading}<p class="muted">This event has finished or been cancelled.</p>`;
  if (forecast.status === "no_location") return `${heading}<p class="muted">The committee needs to add the event’s postcode or map location before a forecast can be shown.</p>`;
  const hour = nearestForecast(forecast, event.date, teeTime);
  if (!hour) return `${heading}<p class="muted">The forecast for your tee time is unavailable right now.</p><button type="button" class="secondary" data-retry-weather>Try forecast again</button>`;
  const temperature = number(hour.temperature) ? `${Math.round(hour.temperature)}°C` : "—";
  const rain = number(hour.rain) && hour.rain >= 0 && hour.rain <= 100 ? `${Math.round(hour.rain)}%` : "—";
  const wind = number(hour.wind) && hour.wind >= 0 ? `${Math.round(hour.wind / 1.609344)} mph` : "—";
  const updated = Date.parse(forecast.updated_at);
  const stale = forecast.stale || Number.isFinite(updated) && Date.now() - updated > 6 * 3600000;
  return `${heading}<p class="weather-condition">${e(conditions[hour.code] || "Conditions unavailable")}</p>
    <dl class="weather-at-tee"><div><dt>Temperature</dt><dd>${temperature}</dd></div><div><dt>Chance of rain</dt><dd>${rain}</dd></div><div><dt>Wind</dt><dd>${wind}</dd></div></dl>
    <p class="weather-note">${e(hour.time.slice(11, 16))} hourly forecast, closest to your tee time.</p>
    ${stale ? '<p class="notice">Showing the last available forecast. A fresh update is currently unavailable.</p>' : ""}
    <p class="weather-source"><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>${Number.isFinite(updated) ? ` · Updated ${e(new Date(updated).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} UK time` : ""}</p>`;
}

export async function mountTeeWeather(area, event, teeTime, b, { force = false } = {}) {
  if (!area) return;
  const ticket = {}, e = b.escape;
  tickets.set(area, ticket);
  const key = JSON.stringify([event.id, event.date, event.address, event.place_id, event.latitude, event.longitude]);
  let forecast = {};
  if (clockMinutes(teeTime) !== null) {
    const saved = forecasts.get(key);
    if (!force && saved && Date.now() - saved.at < 15 * 60000) forecast = saved.data;
    else {
      area.innerHTML = `<h3>Weather for your tee time</h3><p class="muted">Checking the forecast for your ${e(teeTime.slice(0, 5))} tee time…</p>`;
      try {
        if (!pending.has(key)) {
          const task = b.service("weather", { event_id: event.id }).then(data => {
            if (data && ["ready", "too_early", "closed", "no_location"].includes(data.status)) forecasts.set(key, { at: Date.now(), data });
            return data || { status: "unavailable" };
          }).finally(() => pending.delete(key));
          pending.set(key, task);
        }
        forecast = await pending.get(key);
      } catch { forecast = { status: "unavailable" }; }
    }
  }
  if (!area.isConnected || tickets.get(area) !== ticket) return;
  const html = weatherHTML(forecast, event, teeTime, b);
  if (rendered.get(area) !== html || !area.querySelector(".weather-when")) {
    area.innerHTML = html;
    rendered.set(area, html);
  }
  const retry = area.querySelector("[data-retry-weather]");
  if (retry) retry.onclick = () => mountTeeWeather(area, event, teeTime, b, { force: true });
}
