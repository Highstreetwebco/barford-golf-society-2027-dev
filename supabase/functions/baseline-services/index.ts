// Isolated 2027 services. Public requests validate the project API key;
// organiser operations additionally validate a current GoTrue user and database role.
import { prepareCourseMapping } from "./course-mapping.ts";
import { findCourseScorecards } from "./course-scorecard.ts";
const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PUBLISHABLE = "sb_publishable_XLM39PjQf4XdTVfNHFOzAQ_i4re6w_c".replace(
  "XLM",
  "xLM",
);
const GOOGLE = Deno.env.get("GOOGLE_MAPS_API_KEY");
const YOUTUBE = Deno.env.get("YOUTUBE_API_KEY") || GOOGLE;
const courseCardCache = new Map<string, { at: number; result: Awaited<ReturnType<typeof findCourseScorecards>> }>();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: cors });
async function get(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
  if (!r.ok)
    throw new Error("The connected service is temporarily unavailable.");
  return r.json();
}
async function db(path: string, method = "GET", body?: unknown) {
  return get(URL_BASE + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: "Bearer " + SERVICE,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function budget(bucket: string, seconds: number, maximum: number) {
  return await db("rpc/baseline_take_budget", "POST", {
    bucket,
    seconds,
    maximum,
  });
}
async function digest(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function admin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const r = await fetch(URL_BASE + "/auth/v1/user", {
    headers: { apikey: ANON, Authorization: auth },
  });
  if (!r.ok) throw new Error("Organiser sign-in required.");
  const u = await r.json();
  const p = await db("profiles?select=is_admin&id=eq." + u.id);
  if (!p[0]?.is_admin) throw new Error("Organiser access required.");
  const account = await db("baseline_member_accounts?select=disabled&user_id=eq." + u.id);
  if (!account[0] || account[0].disabled) throw new Error("Active organiser account required.");
}
async function courseDetails(id: unknown) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{5,256}$/.test(id))
    throw new Error("Choose a course from the search results.");
  if (!GOOGLE) throw new Error("Course lookup is temporarily unavailable.");
  return get("https://places.googleapis.com/v1/places/" + encodeURIComponent(id), {
    headers: {
      "X-Goog-Api-Key": GOOGLE,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location,websiteUri,nationalPhoneNumber,internationalPhoneNumber,googleMapsUri",
    },
  });
}
async function place(id: string) {
  if (!GOOGLE) return null;
  return get(
    "https://places.googleapis.com/v1/places/" + encodeURIComponent(id),
    {
      headers: {
        "X-Goog-Api-Key": GOOGLE,
        "X-Goog-FieldMask":
          "id,displayName,formattedAddress,location,editorialSummary,websiteUri,googleMapsUri,rating,userRatingCount,photos,reviews",
      },
    },
  );
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  if (![PUBLISHABLE, ANON].includes(req.headers.get("apikey") || ""))
    return reply({ error: "Invalid application key" }, 401);
  try {
    if (Number(req.headers.get("content-length") || 0) > 10000)
      return reply({ error: "Request too large" }, 413);
    const body = await req.json();
    if (body.action === "admin_reset_password") {
      await admin(req);
      const target = String(body.target || "");
      const password = String(body.password || "");
      if (
        !/^[0-9a-f-]{36}$/i.test(target) ||
        password.length < 12 ||
        password.length > 128
      )
        return reply(
          { error: "Choose an account and a password of 12–128 characters." },
          400,
        );
      const person = (await db("profiles?select=full_name&id=eq." + target))[0];
      if (
        !person ||
        String(body.confirmation_name || "").trim() !== person.full_name
      )
        return reply(
          { error: "Account details have changed. Refresh and try again." },
          400,
        );
      const account = (
        await db(
          "baseline_member_accounts?select=disabled&user_id=eq." + target,
        )
      )[0];
      if (!account || account.disabled)
        return reply(
          { error: "Resolve this account’s name claim first." },
          400,
        );
      await get(URL_BASE + "/auth/v1/admin/users/" + target, {
        method: "PUT",
        headers: {
          apikey: SERVICE,
          Authorization: "Bearer " + SERVICE,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      return reply({ updated: true });
    }
    if (body.action === "capabilities") {
      let youtube = false;
      if (YOUTUBE && (await budget("youtube-capability-check", 86400, 3))) {
        try {
          await get(
            "https://www.googleapis.com/youtube/v3/search?" +
              new URLSearchParams({
                key: YOUTUBE,
                part: "snippet",
                type: "video",
                maxResults: "1",
                q: "Warwickshire golf course flyover",
              }),
          );
          youtube = true;
        } catch {}
      }
      let course = false;
      if (GOOGLE && (await budget("google-capability-check", 86400, 3))) {
        try {
          const data = await get(
            "https://places.googleapis.com/v1/places:searchText",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": GOOGLE,
                "X-Goog-FieldMask": "places.id",
              },
              body: JSON.stringify({
                textQuery: "The Warwickshire golf course",
                maxResultCount: 1,
                regionCode: "GB",
              }),
            },
          );
          course = !!data.places?.length;
        } catch {}
      }
      return reply({
        course_lookup: course,
        youtube_search: youtube,
        weather: true,
      });
    }
    if (body.action === "login") {
      const name = String(body.username || "").trim();
      const password = String(body.password || "");
      if (name.length > 150 || password.length > 256 || !name || !password)
        return reply({ error: "Check your username and password." }, 400);
      const hash = await digest(name.toLowerCase());
      const ip = await digest(
        req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
      );
      if (
        !(await budget("login-name:" + hash, 900, 15)) ||
        !(await budget("login-ip:" + ip, 900, 60))
      )
        return reply(
          {
            error: "Too many sign-in attempts. Please try again in 15 minutes.",
          },
          429,
        );
      const escaped = name.replace(/[\\%_]/g, "\\$&");
      const members = await db(
        "baseline_members?select=id&name=ilike." +
          encodeURIComponent(escaped) +
          "&limit=2",
      );
      let email = "unknown-" + hash + "@members.barford2027.invalid";
      let allowed = false;
      if (members.length === 1) {
        const a = await db(
          "baseline_member_accounts?select=user_id,disabled&member_id=eq." +
            members[0].id,
        );
        if (a[0] && !a[0].disabled) {
          const p = await db("profiles?select=email&id=eq." + a[0].user_id);
          if (p[0]) {
            email = p[0].email;
            allowed = true;
          }
        }
      }
      const r = await fetch(URL_BASE + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(12000),
      });
      const session = await r.json();
      if (!r.ok || !allowed)
        return reply({ error: "Check your username and password." }, 400);
      return reply({ session });
    }
    if (body.action === "search_course") {
      await admin(req);
      if (!GOOGLE)
        return reply(
          {
            error:
              "Course search needs the Google Maps API key configured by the organiser.",
          },
          503,
        );
      const query = String(body.query || "").trim();
      if (query.length < 3 || query.length > 160)
        return reply({ error: "Enter a course name." }, 400);
      if (!(await budget("course-search", 86400, 100)))
        return reply({ error: "Course search daily limit reached." }, 429);
      const data = await get(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location",
          },
          body: JSON.stringify({
            textQuery: query + " golf course",
            maxResultCount: 5,
            regionCode: "GB",
          }),
        },
      );
      return reply({ places: data.places || [] });
    }
    if (body.action === "course_details") {
      await admin(req);
      if (!(await budget("course-setup-details", 86400, 150)))
        return reply({ error: "Course lookup daily limit reached. Please try again tomorrow." }, 429);
      return reply({ place: await courseDetails(body.place_id) });
    }
    if (body.action === "prepare_course") {
      await admin(req);
      if (!(await budget("course-preparation", 86400, 40)))
        return reply({ error: "Course preparation daily limit reached. Please try again tomorrow." }, 429);
      const p = await courseDetails(body.place_id);
      const course = {
        place_id: p.id,
        name: p.displayName?.text || "Golf course",
        address: p.formattedAddress || "",
        latitude: p.location?.latitude,
        longitude: p.location?.longitude,
        tee_name: "",
      };
      if (!Number.isFinite(course.latitude) || !Number.isFinite(course.longitude))
        return reply({ error: "This course did not supply a map location. Choose another course match." }, 422);
      // These credentials stay inside this Edge Function; they never enter its response.
      const cached = courseCardCache.get(course.place_id);
      const discovery = cached && Date.now() - cached.at < 180000 ? cached.result : await (async () => {
        let apiKey = Deno.env.get("UK_GOLF_API_KEY");
        if (!apiKey) {
          try { apiKey = (await db("integration_secrets?select=secret_value&name=eq.UK_GOLF_API_KEY&limit=1"))[0]?.secret_value; }
          catch { /* The public scorecard provider remains available. */ }
        }
        return findCourseScorecards(course, { apiKey });
      })();
      if (discovery.cards.length) {
        if (courseCardCache.size >= 20) courseCardCache.delete(courseCardCache.keys().next().value!);
        courseCardCache.set(course.place_id, { at: Date.now(), result: discovery });
      }
      const candidates = await Promise.all(discovery.cards.map(async card => ({
        key: await digest(JSON.stringify([card.source_url, card.course_name, card.tee_name])), card,
      })));
      const choices = candidates.map(({ key, card }) => ({ key, course_name: card.course_name, tee_name: card.tee_name }));
      const base = { scorecards: choices, warnings: discovery.warnings, draft: null };
      if (!candidates.length) return reply({ ...base, status: "unavailable", message: "A complete scorecard for this course could not be verified. No GPS layout has been created." });
      const selected = body.scorecard_key
        ? candidates.filter(c => c.key === body.scorecard_key)
        : candidates.length === 1 ? candidates : [];
      if (selected.length !== 1) return reply({ ...base, status: "choice_required", message: body.scorecard_key ? "The available scorecards have changed. Choose the course and tees again." : "Choose the course and tees you are playing so its 18 holes can be matched accurately." });
      const chosen = selected[0];
      try {
        const draft = await prepareCourseMapping({ ...course, tee_name: chosen.card.tee_name, layout_name: chosen.card.course_name }, { scorecard: chosen.card });
        if (draft.source.validation?.status !== "verified") throw new Error("The course map did not pass all position checks.");
        return reply({ ...base, status: "ready", selected_key: chosen.key, draft: { ...draft, source: { ...draft.source, selected_scorecard: { course_name: chosen.card.course_name, tee_name: chosen.card.tee_name, source_url: chosen.card.source_url } } }, message: "All 18 numbered holes match mapped tee and green areas and the selected scorecard. Preview the maps, then confirm them." });
      } catch (error) {
        return reply({ ...base, status: "unavailable", selected_key: chosen.key, message: `${error instanceof Error ? error.message : "The course positions could not be verified."} No GPS layout has been created.` });
      }
    }
    const eventId = Number(body.event_id);
    if (!Number.isSafeInteger(eventId) || eventId <= 0)
      return reply({ error: "Choose an event." }, 400);
    const ev = (await db("baseline_events?select=*&id=eq." + eventId))[0];
    if (!ev) return reply({ error: "Event not found." }, 404);
    if (body.action === "course") {
      if (!(await budget("course-details:" + eventId, 86400, 200)))
        return reply(
          { error: "Course preview is temporarily unavailable." },
          429,
        );
      const result: any = {};
      if (GOOGLE && ev.place_id) {
        const p = await place(ev.place_id);
        result.name = p.displayName?.text;
        result.address = p.formattedAddress;
        result.description = p.editorialSummary?.text;
        result.maps_url = p.googleMapsUri;
        result.rating = p.rating;
        result.review_count = p.userRatingCount;
        result.latitude = p.location?.latitude;
        result.longitude = p.location?.longitude;
        result.reviews = (p.reviews || []).slice(0, 2).map((r: any) => ({
          text: (r.text?.text || "").split(/\s+/).slice(0, 20).join(" "),
          author: r.authorAttribution?.displayName,
          author_url: r.authorAttribution?.uri,
          url: r.googleMapsUri,
          rating: r.rating,
        }));
        const photo = p.photos?.[0];
        if (photo) {
          const media = await get(
            "https://places.googleapis.com/v1/" +
              photo.name +
              "/media?maxWidthPx=1400&skipHttpRedirect=true&key=" +
              encodeURIComponent(GOOGLE),
          );
          result.photo_url = media.photoUri;
          result.photo_authors = photo.authorAttributions;
          result.photo_source = photo.googleMapsUri || p.googleMapsUri;
        }
      }
      if (
        YOUTUBE &&
        !(ev.video_link || "").match(/(?:youtu\.be\/|[?&]v=)[\w-]{11}/)
      ) {
        const p = new URLSearchParams({
          key: YOUTUBE,
          part: "snippet",
          type: "video",
          videoEmbeddable: "true",
          maxResults: "1",
          q:
            (ev.course_name || ev.location || ev.name) + " golf course flyover",
        });
        try {
          const data = await get(
            "https://www.googleapis.com/youtube/v3/search?" + p,
          );
          const v = data.items?.[0];
          if (v)
            result.video = {
              id: v.id.videoId,
              title: v.snippet.title,
              channel: v.snippet.channelTitle,
            };
        } catch {
          result.video_unavailable = true;
        }
      }
      return reply(result);
    }
    if (body.action === "weather") {
      const now = new Date();
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/London",
      }).format(now);
      const days = Math.round(
        (Date.parse(ev.date) - Date.parse(day)) / 86400000,
      );
      if (days < 0 || ev.cancelled) return reply({ status: "closed" });
      if (days > 15)
        return reply({
          status: "too_early",
          message: "Forecasts become available within 16 days of the event.",
        });
      const saved = (await db("baseline_weather?event_id=eq." + eventId))[0];
      const cached = saved?.forecast?.event_date === ev.date ? saved : null;
      if (
        cached &&
        Date.now() - Date.parse(cached.updated_at) < 20 * 3600000 &&
        cached.forecast.event_date === ev.date
      )
        return reply({ ...cached.forecast, updated_at: cached.updated_at });
      if (!(await budget("weather:" + eventId, 3600, 2)))
        return cached
          ? reply({
              ...cached.forecast,
              updated_at: cached.updated_at,
              stale: true,
            })
          : reply({ status: "unavailable" });
      let lat = ev.latitude,
        lon = ev.longitude;
      if ((lat == null || lon == null) && GOOGLE && ev.place_id) {
        const p = await place(ev.place_id);
        lat = p?.location?.latitude;
        lon = p?.location?.longitude;
      }
      if (lat == null || lon == null)
        return reply({
          status: "no_location",
          message:
            "The organiser needs to set the course map location before a forecast can be shown.",
        });
      try {
        const p = new URLSearchParams({
          latitude: String(lat),
          longitude: String(lon),
          hourly:
            "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
          timezone: "Europe/London",
          forecast_days: "16",
        });
        const data = await get("https://api.open-meteo.com/v1/forecast?" + p);
        const hours = data.hourly.time.flatMap((t: string, i: number) =>
          t.startsWith(ev.date)
            ? [
                {
                  time: t,
                  temperature: data.hourly.temperature_2m[i],
                  rain: data.hourly.precipitation_probability[i],
                  code: data.hourly.weather_code[i],
                  wind: data.hourly.wind_speed_10m[i],
                },
              ]
            : [],
        );
        const forecast = {
          status: hours.length ? "ready" : "unavailable",
          event_date: ev.date,
          hours,
          source: "Open-Meteo",
          timezone: "Europe/London",
        };
        const updated_at = new Date().toISOString();
        await db("baseline_weather", "POST", {
          event_id: eventId,
          forecast,
          updated_at,
        });
        return reply({ ...forecast, updated_at });
      } catch {
        if (cached)
          return reply({
            ...cached.forecast,
            updated_at: cached.updated_at,
            stale: true,
          });
        return reply({
          status: "unavailable",
          message: "The forecast service is temporarily unavailable.",
        });
      }
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (error) {
    return reply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete this request.",
      },
      400,
    );
  }
});
