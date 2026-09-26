const b = await window.barfordReady;
const e = b.escape;
export const londonToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date(),
  );
export function directions(ev) {
  const dest =
    ev.latitude != null && ev.longitude != null
      ? `${ev.latitude},${ev.longitude}`
      : ev.address || ev.location || ev.course_name || ev.name;
  const q = encodeURIComponent(dest);
  return `<div class="event-links"><a href="https://www.google.com/maps/dir/?api=1&destination=${q}" target="_blank" rel="noopener">Google Maps ↗</a><a href="https://maps.apple.com/?daddr=${q}&dirflg=d" target="_blank" rel="noopener">Apple Maps ↗</a><a href="https://waze.com/ul?${ev.latitude != null && ev.longitude != null ? "ll=" : "q="}${q}&navigate=yes" target="_blank" rel="noopener">Waze ↗</a></div>`;
}
export function slots(ev, count) {
  return ev.cancelled
    ? "Event cancelled"
    : ev.max_players == null
      ? `${count} players confirmed`
      : `${Math.max(0, ev.max_players - count)} of ${ev.max_players} places available${count >= ev.max_players ? " · waiting list open" : ""}`;
}
function videoId(url) {
  try {
    const u = new URL(url);
    const id =
      u.hostname === "youtu.be"
        ? u.pathname.slice(1)
        : /(^|\.)youtube\.com$/.test(u.hostname)
          ? u.searchParams.get("v") || u.pathname.split("/embed/")[1]
          : null;
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
function videoHTML(id, title, channel = "YouTube") {
  return `<button class="video-preview secondary" data-play-video="${e(id)}" aria-label="Play ${e(title)}"><img src="https://i.ytimg.com/vi/${e(id)}/hqdefault.jpg" alt="" loading="lazy"><span class="play-icon" aria-hidden="true">▶</span><span><strong>${e(title)}</strong><small>${e(channel)} · Click to play</small></span></button><small>Playing loads YouTube. Its privacy and cookie policies apply.</small>`;
}
function bindVideo(area) {
  area.querySelector("[data-play-video]")?.addEventListener("click", (ev) => {
    const id = ev.currentTarget.dataset.playVideo;
    ev.currentTarget.outerHTML = `<iframe class="event-video" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1" title="Course video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  });
}
function londonUTC(date, time) {
  let guess = Date.parse(date + "T" + time + ":00Z");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(guess));
  const offset = parts
    .find((p) => p.type === "timeZoneName")
    .value.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (offset)
    guess -=
      (offset[1] === "+" ? 1 : -1) *
      (Number(offset[2]) * 60 + Number(offset[3] || 0)) *
      60000;
  return new Date(guess);
}
const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(".000", "");
const icsEscape = (s) =>
  String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
function fold(line) {
  const enc = new TextEncoder();
  let lines = [],
    part = "";
  for (const ch of line) {
    if (enc.encode(part + ch).length > 73) {
      lines.push(part);
      part = " " + ch;
    } else part += ch;
  }
  lines.push(part);
  return lines.join("\r\n");
}
export function calendar(ev, ownTime) {
  const time = ownTime || ev.first_time;
  const timed = /^\d{2}:\d{2}/.test(time || "");
  const start = timed
    ? londonUTC(ev.date, time.slice(0, 5))
    : new Date(ev.date + "T00:00:00Z");
  const end = new Date(
    start.getTime() + (timed ? (ev.round_hours || 5) * 3600000 : 86400000),
  );
  const dates = timed
    ? icsDate(start) + "/" + icsDate(end)
    : ev.date.replaceAll("-", "") +
      "/" +
      end.toISOString().slice(0, 10).replaceAll("-", "");
  const description = [
    ev.description,
    ownTime
      ? "Your published tee time: " + ownTime
      : "First tee time: " + (ev.first_time || "to follow"),
    timed
      ? "End time is an estimate. Check the event page for updates."
      : "Tee time to be confirmed.",
    new URL("event.html?id=" + ev.id, location.href).href,
  ]
    .filter(Boolean)
    .join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Barford Golf Society//2027//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:barford-2027-" + ev.id + "@barfordgolf.co.uk",
    "DTSTAMP:" + icsDate(new Date()),
    "SUMMARY:" + icsEscape(ev.name),
    "LOCATION:" + icsEscape(ev.address || ev.location),
    "DESCRIPTION:" + icsEscape(description),
    timed
      ? "DTSTART:" + icsDate(start)
      : "DTSTART;VALUE=DATE:" + ev.date.replaceAll("-", ""),
    timed
      ? "DTEND:" + icsDate(end)
      : "DTEND;VALUE=DATE:" +
        end.toISOString().slice(0, 10).replaceAll("-", ""),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return {
    ics: lines.map(fold).join("\r\n") + "\r\n",
    google:
      "https://calendar.google.com/calendar/render?" +
      new URLSearchParams({
        action: "TEMPLATE",
        text: ev.name,
        dates,
        location: ev.address || ev.location || "",
        details: description,
        ctz: "Europe/London",
      }),
  };
}
export async function mountExperience(area, ev, ownTime) {
  area.innerHTML = `<div class="course-cover"><div class="cover-placeholder"><span class="eyebrow">YOUR NEXT ROUND</span><strong>${e(ev.course_name || ev.location || ev.name)}</strong><span>Course photograph will appear when available</span></div></div><div class="experience-grid"><section class="panel"><p class="eyebrow">THE DAY AT A GLANCE</p><h2>${e(ev.course_name || ev.location || ev.name)}</h2><dl class="event-facts"><div><dt>Date</dt><dd>${e(b.date(ev.date))}</dd></div><div><dt>First tee</dt><dd>${e(ev.first_time || "To be confirmed")}</dd></div>${ownTime ? `<div><dt>Your tee time</dt><dd>${e(ownTime)}</dd></div>` : ""}<div><dt>Availability</dt><dd data-live-slots>Checking places…</dd></div>${ev.price ? `<div><dt>Price</dt><dd>${e(ev.price)}</dd></div>` : ""}</dl><p class="address">${e(ev.address || ev.location || "Course address to follow")}</p><div data-directions>${directions(ev)}</div><div class="actions"><button class="secondary" data-calendar>Add to phone calendar</button><a data-google-calendar target="_blank" rel="noopener">Google Calendar ↗</a></div><small>A calendar copy won’t update automatically when the event changes.</small></section><section class="panel" data-weather><p class="eyebrow">WEATHER FOR YOUR ROUND</p><h2>Looking ahead.</h2><p>Loading forecast…</p></section><section class="panel" data-course><p class="eyebrow">GET TO KNOW THE COURSE</p><h2>What to expect</h2><p class="event-description">${e(ev.description || "The organiser will add details about the golf day here.")}</p><div data-course-live></div>${b.safeUrl(ev.course_link) ? `<a href="${b.safeUrl(ev.course_link)}" target="_blank" rel="noopener">Course website ↗</a>` : ""}</section><section class="panel" data-video><p class="eyebrow">A LOOK AROUND</p><h2>Course preview</h2><div data-video-content>Finding a course video…</div></section></div>`;
  const cal = calendar(ev, ownTime);
  area.querySelector("[data-google-calendar]").href = cal.google;
  area.querySelector("[data-calendar]").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([cal.ics], { type: "text/calendar;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "barford-" + ev.id + ".ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const showCover = (url, credit) => {
    if (!b.safeUrl(url)) return;
    const wrap = area.querySelector(".course-cover");
    wrap.innerHTML = `<img src="${b.safeUrl(url)}" alt="${e(ev.course_name || ev.location || ev.name)} golf course"><div class="cover-caption">${credit}</div>`;
    wrap.querySelector("img").onerror = () => {
      wrap.innerHTML = `<div class="cover-placeholder"><strong>${e(ev.course_name || ev.location || ev.name)}</strong><span>Course photograph unavailable</span></div>`;
    };
  };
  if (ev.cover_url) showCover(ev.cover_url, e(ev.cover_credit || ""));
  const video = area.querySelector("[data-video-content]"),
    id = videoId(ev.video_link);
  const renderVideo = (id, title, channel) => {
    video.innerHTML = videoHTML(id, title, channel);
    bindVideo(video);
  };
  if (id)
    renderVideo(id, "Explore " + (ev.course_name || ev.location || ev.name));
  const holes = Object.entries(ev.per_hole_videos || {}).filter(([, url]) =>
    videoId(url),
  );
  if (ev.video_type === "per-hole" && holes.length) {
    const box = document.createElement("div");
    box.className = "section";
    box.innerHTML = `<label for="courseHole">Preview a hole</label><select id="courseHole"><option value="">Choose a hole</option>${holes.map(([name, url]) => `<option value="${videoId(url)}">${e(name.replace("hole", "Hole "))}</option>`).join("")}</select><div class="hole-preview"></div>`;
    area.querySelector("[data-video]").append(box);
    box.querySelector("select").onchange = (event) => {
      const id = event.target.value;
      const target = box.querySelector(".hole-preview");
      target.innerHTML = id ? videoHTML(id, "Hole preview") : "";
      bindVideo(target);
    };
  }
  const weatherPromise = b
    .service("weather", { event_id: ev.id })
    .then((w) =>
      renderWeather(area.querySelector("[data-weather]"), w, ev, ownTime),
    )
    .catch(() =>
      renderWeather(
        area.querySelector("[data-weather]"),
        { status: "unavailable" },
        ev,
        ownTime,
      ),
    );
  try {
    const info = await b.service("course", { event_id: ev.id });
    if (!ev.cover_url && info.photo_url)
      showCover(
        info.photo_url,
        `Photo: ${(info.photo_authors || []).map((a) => `<a href="${b.safeUrl(a.uri) || "#"}" target="_blank" rel="noopener">${e(a.displayName)}</a>`).join(", ")} · <a href="${b.safeUrl(info.photo_source) || "#"}" target="_blank" rel="noopener">Google Maps</a>`,
      );
    if (info.address) {
      area.querySelector(".address").textContent = info.address;
      area.querySelector("[data-directions]").innerHTML = directions({
        ...ev,
        address: info.address,
        latitude: info.latitude,
        longitude: info.longitude,
      });
    }
    area.querySelector("[data-course-live]").innerHTML =
      `${info.description ? `<p>${e(info.description)}</p>` : ""}${info.rating ? `<p><strong>${e(info.rating)} / 5</strong> · ${e(info.review_count)} Google reviews</p>` : ""}${(info.reviews || []).map((r) => `<blockquote><p>“${e(r.text)}…”</p><cite><a href="${b.safeUrl(r.url || r.author_url) || "#"}" target="_blank" rel="noopener">${e(r.author)} · ${e(r.rating)} / 5</a></cite></blockquote>`).join("")}${info.maps_url ? `<p><a href="${b.safeUrl(info.maps_url)}" target="_blank" rel="noopener">Google Maps · Read course reviews ↗</a></p><small>Selected review excerpts reflect individual experiences.</small>` : ""}`;
    if (!id) {
      if (info.video?.id && /^[\w-]{11}$/.test(info.video.id))
        renderVideo(info.video.id, info.video.title, info.video.channel);
      else
        video.innerHTML =
          '<p class="muted">A course video has not been added yet.</p>';
    }
  } catch {
    if (!id)
      video.innerHTML =
        '<p class="muted">Course preview is temporarily unavailable.</p>';
  }
  await weatherPromise;
}
function conditions(code) {
  if (code == null) return "conditions not yet available";
  return code === 0
    ? "clear skies"
    : code <= 3
      ? "cloudy spells"
      : code <= 48
        ? "fog"
        : code <= 67
          ? "rain"
          : code <= 77
            ? "snow"
            : code <= 82
              ? "showers"
              : code <= 86
                ? "snow showers"
                : "thunderstorms";
}
function renderWeather(area, w, ev, ownTime) {
  const heading =
    '<p class="eyebrow">WEATHER FOR YOUR ROUND</p><h2>Looking ahead.</h2>';
  if (w.status !== "ready") {
    area.innerHTML =
      heading +
      `<p>${e(w.message || { too_early: "A useful forecast will appear within 16 days of the event.", closed: "This event is closed.", no_location: "The course map location is needed for a forecast." }[w.status] || "Forecast temporarily unavailable. Please check again later.")}</p><small>Updated daily as the event approaches. Forecasts can change.</small>`;
    return;
  }
  const time = ownTime || ev.first_time || "09:00",
    start = Number(time.slice(0, 2)) + Number(time.slice(3, 5)) / 60,
    duration = ev.round_hours || 5;
  const hours = (w.hours || []).filter(
    (h) =>
      Number(h.time.slice(11, 13)) >= Math.floor(start) &&
      Number(h.time.slice(11, 13)) < Math.ceil(start + duration),
  );
  const valid = hours.filter((h) => h.rain != null);
  const peak = valid.reduce((a, h) => (!a || h.rain > a.rain ? h : a), null);
  const middle = hours[Math.floor(hours.length / 2)];
  const text = hours.length
    ? `Expect ${conditions(hours[0].code)} around the start${middle?.rain != null ? `, with ${middle.rain}% rain probability around ${middle.time.slice(11, 16)}, roughly halfway through` : ""}.${peak ? ` The highest hourly rain probability during your estimated round is ${peak.rain}%.` : ""}`
    : "Hourly data is not available for this tee time yet.";
  area.innerHTML =
    heading +
    `<p class="weather-summary">${e(text)}</p><p class="muted">${ownTime ? "Based on your published tee time" : ev.first_time ? "Based on the first tee time; your own time will replace it once published" : "Using 09:00 until a tee time is announced"} · ${e(time)} · estimated ${duration}-hour round.</p><div class="weather-hours">${hours.map((h) => `<div><strong>${e(h.time.slice(11, 16))}</strong><span>${h.temperature == null ? "—" : Math.round(h.temperature) + "°C"}</span><small>${h.rain == null ? "Rain data unavailable" : h.rain + "% rain"}</small></div>`).join("")}</div><small>${w.stale ? "Last available forecast · " : ""}Updated ${e(new Date(w.updated_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }))} UK time · <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Daily updates; hourly probabilities are forecasts, not a guarantee.</small>`;
}
export async function updateSlots(ev, root = document) {
  const { data, error } = await b.client.rpc("event_counts");
  if (error) {
    root
      .querySelectorAll("[data-live-slots]")
      .forEach(
        (x) =>
          (x.textContent =
            "Availability could not refresh. Try again shortly."),
      );
    return;
  }
  const count = (data || []).find((x) => x.event_id === ev.id)?.playing || 0;
  root
    .querySelectorAll("[data-live-slots]")
    .forEach((x) => (x.textContent = slots(ev, count)));
}
export async function mountBuggy(area, ev) {
  if (!b.state.user) {
    area.innerHTML = "";
    return;
  }
  const { data: r, error: re } = await b.client
    .from("rsvps")
    .select("attending,reserve,buggy")
    .eq("event_id", ev.id)
    .eq("user_id", b.state.user.id)
    .maybeSingle();
  if (re || !r?.buggy || !r.attending || r.reserve) {
    area.innerHTML = "";
    return;
  }
  const { data, error } = await b.client.rpc("buggy_details", { event: ev.id });
  area.innerHTML =
    '<p class="eyebrow">YOUR BUGGY</p><h2>Make a plan together.</h2>';
  if (error) {
    area.innerHTML += "<p>Buggy details could not load. Please refresh.</p>";
    return;
  }
  if (data.status !== "paired") {
    area.innerHTML +=
      "<p>The organisers will pair you with another buggy player when tee times are published. If there’s an odd number, they’ll arrange your buggy separately.</p>";
    return;
  }
  area.innerHTML += `<p>Your partner is <strong>${e(data.partner_name)}</strong>.</p><p class="notice">${data.booking_name ? (data.booking_me ? "You’re booking the buggy. Your partner can see this." : `${e(data.booking_name)} is booking the buggy.`) : "Neither partner has taken responsibility for booking yet."}</p>${data.partner_phone ? `<p>Need to contact your partner? <a href="tel:${e(data.partner_phone.replace(/[^+0-9]/g, ""))}">${e(data.partner_phone)}</a></p>` : "<p>Your partner has not added a mobile number. Contact an organiser.</p>"}<form class="form-stack">${!data.booking_name ? "<button>I’ll book the buggy</button>" : data.booking_me ? '<button class="secondary">Release booking responsibility</button>' : ""}<p role="status"></p></form><small>This records who will contact the course. It does not make or pay for a buggy booking.</small>`;
  area.querySelector("form").onsubmit = (event) => {
    event.preventDefault();
    b.submit(event.target, async () => {
      const result = await b.client.rpc("buggy_details", {
        event: ev.id,
        claim: !data.booking_name,
        release: !!data.booking_me,
      });
      if (result.error) throw result.error;
      await mountBuggy(area, ev);
    });
  };
}
