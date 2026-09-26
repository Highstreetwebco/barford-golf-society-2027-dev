import {
  mountEventOperations,
  eventBrief,
} from "./operations.js?v=2027-refined-1";
import { mountMemberTees } from "./member-tees.js?v=2027-refined-1";
import {
  mountExperience,
  mountBuggy,
  updateSlots,
  londonToday,
} from "./event-experience.js?v=2027-refined-1";
const b = await window.barfordReady;
const { client: c, state, escape: e } = b;
let events = [],
  responses = [],
  counts = [],
  tees = [],
  filter = "upcoming";
const list = document.getElementById("eventList");
const today = londonToday;
const dedicated = location.pathname.endsWith("event.html");
const eventId = Number(new URLSearchParams(location.search).get("id"));
let experienceMounted = false;
let experienceKey = "";
const own = (id) =>
  responses.find((r) => r.event_id === id && r.user_id === state.user?.id);
const status = (r) =>
  r?.reserve
    ? "On the waiting list"
    : r?.attending
      ? "You’re booked"
      : "Not playing";
function youtube(value) {
  try {
    const url = new URL(value);
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : /(^|\.)youtube\.com$/.test(url.hostname)
          ? url.searchParams.get("v") || url.pathname.split("/embed/")[1]
          : null;
    return id && /^[\w-]{11}$/.test(id)
      ? "https://www.youtube-nocookie.com/embed/" + id
      : "";
  } catch {
    return "";
  }
}
async function load() {
  const requests = [
    c.from("events").select("*").order("date"),
    c.rpc("event_counts"),
    state.user
      ? c.from("tee_times").select("*").order("group_number")
      : Promise.resolve({ data: [], error: null }),
  ];
  if (state.user)
    requests.push(
      c
        .from("rsvps")
        .select(
          "id,event_id,user_id,name,attending,reserve,buggy,preferred_time,flexibility,terms_snapshot,created_at,requested_at",
        )
        .order("requested_at"),
    );
  const result = await Promise.all(requests);
  const failed = result.find((r) => r.error);
  if (failed) throw failed.error;
  events = result[0].data || [];
  counts = result[1].data || [];
  tees = result[2].data || [];
  responses = result[3]?.data || [];
  document.getElementById("memberNotice").hidden = !!state.user;
  await render();
}
async function render() {
  const visible = events.filter((ev) =>
    dedicated
      ? ev.id === eventId
      : filter === "past"
        ? ev.date < today()
        : ev.date >= today(),
  );
  if (!visible.length) {
    list.innerHTML =
      '<div class="panel">' +
      b.empty(
        filter === "past"
          ? "No past events yet."
          : "The next round is on its way.",
        filter === "past"
          ? "Completed 2027 golf days will appear here."
          : "The organisers are putting the 2027 calendar together. Check back for the first golf day.",
      ) +
      "</div>";
    return;
  }
  list.innerHTML = visible
    .map((ev) => {
      const d = new Date(ev.date + "T12:00:00"),
        r = own(ev.id),
        count = counts.find((v) => v.event_id === ev.id) || {
          playing: 0,
          waiting: 0,
        };
      const available =
        ev.max_players === null
          ? null
          : Math.max(0, ev.max_players - count.playing);
      const closed = ev.cancelled || ev.date < today();
      const slots = ev.cancelled
        ? "Event cancelled"
        : available === null
          ? `${count.playing} playing`
          : available === 0
            ? "Full · waiting list open"
            : `${available} of ${ev.max_players} places available`;
      if (!dedicated)
        return `<article class="panel event-card" id="event-${ev.id}"><div class="event-top"><div class="date-block"><b>${d.getDate()}</b><span>${d.toLocaleDateString("en-GB", { month: "short" })}</span></div><div class="event-title"><p class="eyebrow">${e(ev.first_time || "Tee time to follow")}</p><h2><a href="event.html?id=${ev.id}">${e(ev.name)}</a></h2><p>${e(ev.location)}</p></div></div><div class="event-meta"><span>${e(slots)}</span>${r ? `<span class="status-pill">${status(r)}</span>` : ""}</div><div class="event-body"><a class="button" href="event.html?id=${ev.id}">${r ? "View event & edit RSVP" : "View event & RSVP"}</a></div></article>`;
      const embed = youtube(ev.video_link);
      const holes = Object.entries(ev.per_hole_videos || {}).filter(([, url]) =>
        youtube(url),
      );
      return `<article class="panel event-card" id="event-${ev.id}"><div class="event-top"><div class="date-block"><b>${d.getDate()}</b><span>${d.toLocaleDateString("en-GB", { month: "short" })}</span></div><div class="event-title"><p class="eyebrow">${e(d.toLocaleDateString("en-GB", { weekday: "long" }))} · ${e(ev.first_time || "Tee time to follow")}</p><h2>${e(ev.name)}</h2><p>${e(ev.location)}</p></div>${ev.price ? `<div class="event-price">${e(ev.price)}</div>` : ""}</div><div class="event-meta"><span>${e(slots)}</span><span>${ev.cancelled ? '<span class="status-pill cancelled">Cancelled</span>' : r ? `<span class="status-pill ${r.reserve ? "waiting" : ""}">${status(r)}</span>` : closed ? "Event complete" : "RSVP when you’re ready"}</span></div><div class="event-body"><div id="response-${ev.id}">${r ? `<div class="saved-response"><div><h3>${status(r)}</h3>${r.attending || r.reserve ? `<p>${ev.event_type === "social" ? "Attendance saved" : `${r.buggy ? "Buggy requested" : "Walking"} · ${e(r.preferred_time ? r.preferred_time + " tee time preference" : "No tee time preference")}`}</p>` : ""}</div>${!closed ? `<button class="secondary" data-rsvp="${ev.id}">Change booking</button>${r.attending || r.reserve ? `<button class="secondary" data-withdraw="${ev.id}">Withdraw</button>` : ""}` : ""}</div>` : !closed ? `<div class="actions"><button data-rsvp="${ev.id}">${state.user ? "Save your RSVP" : "Sign in to RSVP"}</button></div>` : ""}</div><div id="form-${ev.id}" hidden></div><details class="event-details" open><summary>Event details &amp; players</summary>${roster(ev)}</details></div></article>`;
    })
    .join("");
  list
    .querySelectorAll("[data-rsvp]")
    .forEach(
      (button) =>
        (button.onclick = () => openForm(Number(button.dataset.rsvp))),
    );
  list.querySelectorAll("[data-withdraw]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        const id = Number(btn.dataset.withdraw),
          ev = events.find((x) => x.id === id);
        if (
          !confirm(
            "Withdraw from " +
              ev.name +
              "? Any fee or refund will be reviewed by an organiser.",
          )
        )
          return;
        btn.disabled = true;
        const { error } = await c.rpc("submit_rsvp", {
          payload: { event_id: id, attending: false },
        });
        if (error) {
          b.toast(error.message);
          btn.disabled = false;
          return;
        }
        await load();
        b.toast("Withdrawal saved.");
      }),
  );
  list.querySelectorAll("[data-hole]").forEach(
    (sel) =>
      (sel.onchange = () => {
        sel.nextElementSibling.innerHTML = sel.value
          ? `<iframe class="event-video" src="${e(sel.value)}" title="Hole preview" allowfullscreen></iframe>`
          : "";
      }),
  );
  if (dedicated && visible[0]) {
    const ev = visible[0];
    document.title = ev.name + " | Barford Golf Society";
    document.querySelector(".page-heading h1").textContent = ev.name;
    if (
      !document.getElementById("quickRsvp") &&
      !ev.cancelled &&
      ev.date >= today()
    ) {
      const action = document.createElement("button");
      action.id = "quickRsvp";
      action.textContent = "RSVP to this event";
      action.onclick = async () => {
        await openForm(ev.id);
        document
          .getElementById("form-" + ev.id)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      document.querySelector(".page-heading").append(action);
    }
    document.querySelector("[data-filter]").parentElement.hidden = true;
    document.querySelector(".page-heading .lede").textContent =
      "Your RSVP, course information and plans for the day.";
    document
      .querySelectorAll("[data-filter]")
      .forEach((x) => (x.hidden = true));
    if (!document.getElementById("eventExperience")) {
      const extra = document.createElement("div");
      extra.id = "eventExperience";
      list.before(extra);
      const buggy = document.createElement("section");
      buggy.id = "buggyPanel";
      buggy.className = "panel section";
      list.after(buggy);
    }
    const ownTime =
      !ev.tee_times_dirty &&
      tees.find(
        (t) =>
          t.event_id === ev.id &&
          t.players.some((p) => p.user_id === state.user?.id),
      )?.tee_time;
    const nextKey = JSON.stringify([ev, ownTime, state.user?.id]);
    if (!experienceMounted || nextKey !== experienceKey) {
      experienceKey = nextKey;
      experienceMounted = true;
      mountExperience(
        document.getElementById("eventExperience"),
        ev,
        ownTime,
      ).then(() => updateSlots(ev, document.getElementById("eventExperience")));
    }
    await updateSlots(ev, document.getElementById("eventExperience"));
    if (ev.event_type !== "social")
      await mountBuggy(document.getElementById("buggyPanel"), ev);
    else document.getElementById("buggyPanel").hidden = true;
    let brief = document.getElementById("dayBrief");
    if (!brief) {
      brief = document.createElement("div");
      brief.id = "dayBrief";
      document.getElementById("eventExperience").after(brief);
    }
    brief.innerHTML = eventBrief(ev);
    let ops = document.getElementById("eventOperations");
    if (!ops) {
      ops = document.createElement("section");
      ops.id = "eventOperations";
      ops.className = "panel section";
      list.after(ops);
    }
    if (!ops.contains(document.activeElement))
      await mountEventOperations(ops, ev);
    const teeArea = document.getElementById("memberTees-" + ev.id);
    if (teeArea) await mountMemberTees(teeArea, ev.id);
  }
}
function roster(ev) {
  if (!state.user)
    return '<p class="notice" style="margin-top:22px">Sign in to see the player list and tee times.</p>';
  const rows = responses.filter((r) => r.event_id === ev.id),
    playing = rows.filter((r) => r.attending && !r.reserve),
    waiting = rows.filter((r) => r.reserve),
    groups = tees.filter((t) => t.event_id === ev.id);
  let html = "";
  if (ev.event_type === "social") html += "";
  else if (dedicated)
    html += `<section id="memberTees-${ev.id}" class="section">Loading tee groups…</section>`;
  else if (ev.tee_times_dirty)
    html +=
      '<p class="notice" style="margin-top:22px">The player list has changed. The organisers are reviewing the tee times.</p>';
  else if (groups.length)
    html +=
      '<h3 class="section">Tee times</h3><div class="tee-grid">' +
      groups
        .map(
          (g) =>
            `<div class="tee-group"><h4>${e(g.tee_time)} · Group ${g.group_number}</h4><ol>${g.players.map((p) => `<li>${e(p.name)}${p.type === "buggy" ? " · Buggy" : ""}</li>`).join("")}</ol></div>`,
        )
        .join("") +
      "</div>";
  else
    html +=
      '<p class="muted">Tee times will appear here once the organisers publish them.</p>';
  html +=
    `<h3 class="section">${ev.event_type === "social" ? "Who’s attending" : "Who’s playing"} <span class="muted">(${playing.length})</span></h3>` +
    (playing.length
      ? '<ul class="roster">' +
        playing
          .map(
            (r) =>
              `<li>${e(r.name)}<span>${ev.event_type === "social" ? "Attending" : r.buggy ? "Buggy" : "Walking"}</span></li>`,
          )
          .join("") +
        "</ul>"
      : '<p class="muted">Be the first to save your RSVP.</p>');
  if (waiting.length)
    html += `<h3 class="section">Waiting list (${waiting.length})</h3><ol class="roster">${waiting.map((r, i) => `<li>${i + 1}. ${e(r.name)}</li>`).join("")}</ol>`;
  return html;
}
function radio(name, legend, options, selected) {
  return `<fieldset><legend>${legend}</legend><div class="choices">${options.map(([value, label]) => `<label><input type="radio" name="${name}" value="${value}" ${selected === value ? "checked" : ""} required><span>${label}</span></label>`).join("")}</div></fieldset>`;
}
async function openForm(id) {
  history.replaceState(null, "", "event.html?id=" + id + "#rsvp");
  if (!state.user) {
    if (!(await b.requireMember())) return;
    await load();
  }
  const ev = events.find((ev) => ev.id === id);
  if (!ev || ev.cancelled || ev.date < today()) return;
  const area = document.getElementById("form-" + id),
    r = own(id);
  area.hidden = false;
  document.getElementById("response-" + id).hidden = true;
  area.innerHTML = `<form class="rsvp-form"><h3>${r ? "Update your RSVP" : "Your RSVP"}</h3><p class="identity">For ${e(state.profile?.full_name || "your account")} · <a href="account.html">My details</a></p>${radio(
    "attending",
    ev.event_type === "social" ? "Attending?" : "Playing?",
    [
      [
        "yes",
        ev.event_type === "social" ? "Yes, I’m attending" : "Yes, I’m playing",
      ],
      ["no", "Not this time"],
    ],
    r ? (r.attending || r.reserve ? "yes" : "no") : null,
  )}<div data-playing>${radio(
    "buggy",
    "Buggy?",
    [
      ["yes", "Yes, please"],
      ["no", "No, I’ll walk"],
    ],
    r?.buggy ? "yes" : "no",
  )}${radio(
    "preferred_time",
    "Preferred tee time (optional)",
    [
      ["", "No preference"],
      ["First", "First"],
      ["Middle", "Middle"],
      ["End", "End"],
    ],
    r?.preferred_time || "",
  )}<label class="check"><input type="checkbox" name="flexibility" ${r?.flexibility === "walk" ? "checked" : ""}> Happy to walk if there is an odd number of buggy players</label><small>We’ll do our best to match your preference. A buggy request is subject to availability.</small></div>${ev.cancellation_terms ? `<div data-terms><p class="notice preserve-lines">${e(ev.cancellation_terms)}</p><label class="check"><input type="checkbox" name="accept_terms" ${r?.terms_snapshot === ev.cancellation_terms ? "checked" : ""}> I accept the cancellation terms</label></div>` : ""}<div class="actions"><button type="submit">${r ? "Save changes" : "Save RSVP"}</button><button type="button" class="secondary" data-cancel>Cancel</button></div><p class="form-status" role="status"></p></form>`;
  const form = area.querySelector("form");
  const toggle = () => {
    const off =
      form.elements.attending.value === "no" || ev.event_type === "social";
    const terms = form.querySelector("[name=accept_terms]");
    if (terms) {
      terms.required = form.elements.attending.value === "yes";
      form.querySelector("[data-terms]").hidden =
        form.elements.attending.value === "no";
    }
    const choices = area.querySelector("[data-playing]");
    choices.hidden = off;
    choices.querySelectorAll("input").forEach((i) => (i.disabled = off));
  };
  form
    .querySelectorAll("[name=attending]")
    .forEach((input) => (input.onchange = toggle));
  toggle();
  area.querySelector("[data-cancel]").onclick = () => {
    area.hidden = true;
    document.getElementById("response-" + id).hidden = false;
    document.querySelector(`[data-rsvp="${id}"]`)?.focus();
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    b.submit(form, async () => {
      const f = new FormData(form);
      const payload = {
        event_id: id,
        attending: f.get("attending") === "yes",
        buggy: f.get("buggy") === "yes",
        preferred_time: f.get("preferred_time") || null,
        flexibility: f.get("flexibility") ? "walk" : null,
        accept_terms: f.get("accept_terms") === "on",
      };
      const { data, error } = await c.rpc("submit_rsvp", { payload });
      if (error) throw error;
      await load();
      b.toast(
        data.reserve
          ? "Saved. You’re on the waiting list."
          : data.attending
            ? "Saved. You’re playing!"
            : "Saved. You’re not playing this time.",
      );
      document.querySelector(`[data-rsvp="${id}"]`)?.focus();
    });
  };
  form.querySelector("input")?.focus({ preventScroll: true });
}
document.querySelectorAll("[data-filter]").forEach(
  (button) =>
    (button.onclick = () => {
      filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((el) => {
        el.classList.toggle("active", el === button);
        el.setAttribute("aria-pressed", String(el === button));
      });
      render();
    }),
);
window.addEventListener("barford-signout", () => location.reload());
const initialHash = location.hash;
try {
  await load();
  const hash = initialHash;
  if (dedicated && hash === "#rsvp") await openForm(eventId);
  if (/^#event-\d+$/.test(hash))
    document.querySelector(hash)?.scrollIntoView({ block: "start" });
} catch (error) {
  list.innerHTML =
    '<div class="panel">' +
    b.empty(
      "Events could not load.",
      "Please refresh the page or try again shortly.",
    ) +
    "</div>";
}

setInterval(async () => {
  if (document.hidden) return;
  const ev = events.find((x) => x.id === eventId);
  if (dedicated && ev) {
    await updateSlots(ev, document.getElementById("eventExperience"));
    if (!document.querySelector(".rsvp-form")) {
      const latest = await c
        .from("events")
        .select("*")
        .eq("id", ev.id)
        .maybeSingle();
      const latestTees = state.user
        ? await c
            .from("tee_times")
            .select("*")
            .eq("event_id", ev.id)
            .order("group_number")
        : { data: [] };
      if (
        !latest.error &&
        !latestTees.error &&
        (JSON.stringify(latest.data) !== JSON.stringify(ev) ||
          JSON.stringify(latestTees.data) !==
            JSON.stringify(tees.filter((t) => t.event_id === ev.id)))
      )
        await load();
      else {
        if (ev.event_type !== "social")
          await mountBuggy(document.getElementById("buggyPanel"), ev);
        else document.getElementById("buggyPanel").hidden = true;
        let brief = document.getElementById("dayBrief");
        if (!brief) {
          brief = document.createElement("div");
          brief.id = "dayBrief";
          document.getElementById("eventExperience").after(brief);
        }
        brief.innerHTML = eventBrief(ev);
        let ops = document.getElementById("eventOperations");
        if (!ops) {
          ops = document.createElement("section");
          ops.id = "eventOperations";
          ops.className = "panel section";
          list.after(ops);
        }
        if (!ops.contains(document.activeElement))
          await mountEventOperations(ops, ev);
        const teeArea = document.getElementById("memberTees-" + ev.id);
        if (teeArea) await mountMemberTees(teeArea, ev.id);
      }
    }
  }
}, 25000);
window.addEventListener("focus", () => {
  const ev = events.find((x) => x.id === eventId);
  if (ev) updateSlots(ev, document.getElementById("eventExperience"));
});
