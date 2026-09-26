import {
  operationTabs,
  showOperations,
} from "./operations-admin.js?v=2027-operations-1";
import { operation } from "./operations.js?v=2027-operations-1";
import {
  mountEventFields,
  eventFields,
  updateEventType,
} from "./event-fields.js?v=2027-operations-1";
import {
  showLeagueTab,
  canLeaveLeague,
} from "./league-admin.js?v=2027-operations-1";
import { loadAccounts } from "./account-admin.js?v=2027-operations-1";
import { packPlayers } from "./tee-groups.js?v=2027-operations-1";
const b = await window.barfordReady;
const { client: c, escape: e } = b;
const gate = document.getElementById("adminGate"),
  content = document.getElementById("adminContent");
let events = [],
  selected = null,
  rows = [],
  groups = [];
const form = document.getElementById("eventForm"),
  picker = document.getElementById("adminEvent");
if (!b.state.admin) {
  gate.innerHTML = `<h2>Organiser access</h2><p>${b.state.user ? "Your account does not have organiser access." : "Sign in with your organiser account to manage the society."}</p><a class="button section" href="account.html?next=admin.html">${b.state.user ? "My account" : "Sign in"}</a>`;
} else {
  for (const [tab, title] of Object.entries(operationTabs)) {
    const button = document.createElement("button");
    button.dataset.tab = tab;
    button.textContent = title;
    document.querySelector(".admin-tabs").append(button);
    const panel = document.createElement("section");
    panel.id = "adminOp-" + tab;
    panel.className = "panel";
    panel.hidden = true;
    document.getElementById("adminAccounts").before(panel);
  }
  mountEventFields(form);
  const ready = await init();
  if (ready) {
    gate.hidden = true;
    content.hidden = false;
  }
  const initialTab = new URLSearchParams(location.search).get("tab");
  if (
    [
      "scoring",
      "scorecards",
      "handicaps",
      ...Object.keys(operationTabs),
    ].includes(initialTab)
  )
    document.querySelector(`[data-tab="${initialTab}"]`)?.click();
}
async function init() {
  const { data, error } = await c.from("events").select("*").order("date");
  if (error) {
    gate.hidden = false;
    gate.textContent = error.message;
    return false;
  }
  events = data;
  picker.innerHTML =
    '<option value="">New event</option>' +
    events
      .map(
        (ev) =>
          `<option value="${ev.id}">${ev.round_number ? "R" + ev.round_number + " · " : ""}${e(ev.name)} · ${e(b.date(ev.date))}</option>`,
      )
      .join("");
  picker.value = selected?.id || "";
  const holes = document.getElementById("holeVideoInputs");
  holes.innerHTML = Array.from(
    { length: 18 },
    (_, i) =>
      `<label>Hole ${i + 1}<input name="hole${i + 1}" type="url" placeholder="YouTube URL"></label>`,
  ).join("");
  picker.onchange = async () => {
    if (!canLeaveLeague()) {
      picker.value = selected?.id || "";
      return;
    }
    selected = events.find((ev) => ev.id === Number(picker.value)) || null;
    groups = [];
    document.getElementById("teeEditor").innerHTML = "";
    await fillEvent();
  };
  document.getElementById("videoType").onchange = () =>
    (holes.hidden = form.elements.video_type.value !== "per-hole");
  document.querySelectorAll("[data-tab]").forEach(
    (button) =>
      (button.onclick = () => {
        if (!canLeaveLeague()) return;
        document.getElementById("eventToolbar").hidden = [
          "accounts",
          "handicaps",
          "adjustments",
          "committee",
        ].includes(button.dataset.tab);
        document
          .querySelectorAll("[data-tab]")
          .forEach((btn) => btn.classList.toggle("active", btn === button));
        [
          "accounts",
          "details",
          "responses",
          "tees",
          "handicaps",
          "scoring",
          "scorecards",
        ].forEach(
          (tab) =>
            (document.getElementById(
              "admin" +
                {
                  handicaps: "Handicaps",
                  scoring: "Scoring",
                  scorecards: "Scorecards",
                  accounts: "Accounts",
                  details: "Details",
                  responses: "Responses",
                  tees: "Tees",
                }[tab],
            ).hidden = tab !== button.dataset.tab),
        );
        for (const tab of Object.keys(operationTabs))
          document.getElementById("adminOp-" + tab).hidden =
            tab !== button.dataset.tab;
        showLeagueTab(button.dataset.tab, selected);
        showOperations(button.dataset.tab, selected);
      }),
  );
  form.onsubmit = (ev) => {
    ev.preventDefault();
    b.submit(form, async () => {
      const f = new FormData(form),
        name = String(f.get("name")).trim();
      if (!name) throw new Error("Enter an event name.");
      const updates = {
        ...eventFields(form),
        name,
        round_number: f.get("round_number")
          ? Number(f.get("round_number"))
          : null,
        course_name: String(f.get("course_name") || "").trim() || null,
        place_id: f.get("place_id") || null,
        address: String(f.get("address") || "").trim() || null,
        latitude: f.get("latitude") !== "" ? Number(f.get("latitude")) : null,
        longitude:
          f.get("longitude") !== "" ? Number(f.get("longitude")) : null,
        cover_url: f.get("cover_url") || null,
        cover_credit: f.get("cover_credit") || null,
        round_hours: Number(f.get("round_hours") || 5),
        date: f.get("date"),
        location: String(f.get("location")).trim(),
        price: String(f.get("price")).trim() || null,
        first_time: f.get("first_time") || null,
        max_players: f.get("max_players") ? Number(f.get("max_players")) : null,
        description: f.get("description"),
        course_link: f.get("course_link"),
        weather_link: f.get("weather_link"),
        video_type: f.get("video_type"),
        video_link: f.get("video_link"),
        per_hole_videos:
          f.get("video_type") === "per-hole"
            ? Object.fromEntries(
                Array.from({ length: 18 }, (_, i) => [
                  "hole" + (i + 1),
                  f.get("hole" + (i + 1)),
                ]),
              )
            : null,
      };
      if (selected?.max_players !== updates.max_players && selected) {
        const confirmed = rows.filter((r) => r.attending && !r.reserve).length;
        if (updates.max_players !== null && updates.max_players < confirmed)
          throw new Error(
            `There are already ${confirmed} confirmed players. Set capacity to at least ${confirmed}.`,
          );
      }
      const query = selected
        ? c.from("events").update(updates).eq("id", selected.id)
        : c.from("events").insert(updates);
      const { data, error } = await query.select().single();
      if (error) throw error;
      selected = data;
      await init();
      await fillEvent();
      b.toast("Event saved.");
    });
  };
  document.getElementById("cancelEvent").onclick = async () => {
    if (!selected) return;
    if (
      !confirm(
        selected.cancelled
          ? "Reopen this event?"
          : "Cancel this event? Members will see it as cancelled.",
      )
    )
      return;
    const { error } = await c
      .from("events")
      .update({ cancelled: !selected.cancelled })
      .eq("id", selected.id);
    if (error) return b.toast(error.message);
    selected.cancelled = !selected.cancelled;
    await fillEvent();
    b.toast(selected.cancelled ? "Event cancelled." : "Event reopened.");
  };
  document.getElementById("deleteEvent").onclick = async () => {
    if (
      !selected ||
      !confirm("Permanently delete this event and its RSVPs and tee times?")
    )
      return;
    const { error } = await c.from("events").delete().eq("id", selected.id);
    if (error) return b.toast(error.message);
    selected = null;
    await init();
    await fillEvent();
    b.toast("Event deleted.");
  };
  document.getElementById("generateTees").onclick = generate;
  document.getElementById("loadTees").onclick = loadGroups;
  document.getElementById("saveTees").onclick = saveGroups;
  await fillEvent();
  await loadEnquiries();
  await loadMemberRecovery();
  await loadAccounts();
  document.getElementById("findCourse").onclick = async () => {
    const button = document.getElementById("findCourse"),
      status = document.getElementById("courseLookupStatus");
    button.disabled = true;
    status.textContent = "Finding courses…";
    try {
      const result = await b.service("search_course", {
        query: document.getElementById("courseQuery").value,
      });
      status.textContent = result.places.length
        ? "Choose the correct course. Photo and review data are supplied live by Google Maps."
        : "No matching courses found.";
      const area = document.getElementById("courseResults");
      area.innerHTML = result.places
        .map(
          (p, i) =>
            `<button class="secondary" type="button" data-course="${i}">${e(p.displayName?.text)}<br><small>${e(p.formattedAddress)}</small></button>`,
        )
        .join("");
      area.querySelectorAll("[data-course]").forEach(
        (btn) =>
          (btn.onclick = () => {
            const p = result.places[Number(btn.dataset.course)];
            form.elements.place_id.value = p.id;
            form.elements.course_name.value = document
              .getElementById("courseQuery")
              .value.trim();
            status.textContent =
              "Matched " +
              p.displayName.text +
              ". Save the event to keep this course match.";
            area.innerHTML = "";
          }),
      );
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  return true;
}
async function fillEvent() {
  form.reset();
  for (const [key, value] of Object.entries(selected || {})) {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  }
  for (let i = 1; i <= 18; i++)
    form.elements["hole" + i].value =
      selected?.per_hole_videos?.["hole" + i] || "";
  document.getElementById("holeVideoInputs").hidden =
    form.elements.video_type.value !== "per-hole";
  document.getElementById("cancelEvent").hidden = !selected;
  document.getElementById("deleteEvent").hidden = !selected;
  document.getElementById("cancelEvent").textContent = selected?.cancelled
    ? "Reopen event"
    : "Cancel event";
  if (selected?.first_time && /^\d{2}:\d{2}$/.test(selected.first_time))
    document.getElementById("teeStart").value = selected.first_time;
  document.getElementById("teeGap").value = selected?.tee_interval || 8;
  updateEventType(form);
  await loadResponses();
  await showOperations(
    document.querySelector("[data-tab].active")?.dataset.tab,
    selected,
  );
  await showLeagueTab(
    document.querySelector("[data-tab].active")?.dataset.tab,
    selected,
  );
}
async function loadResponses() {
  const area = document.getElementById("adminRsvps");
  if (!selected) {
    rows = [];
    area.innerHTML =
      '<p class="muted">Choose an existing event to see responses.</p>';
    return;
  }
  const { data, error } = await c
    .from("rsvps")
    .select("*,baseline_rsvp_contacts(phone)")
    .eq("event_id", selected.id)
    .order("requested_at");
  if (error) {
    area.textContent = error.message;
    return;
  }
  rows = data || [];
  if (!rows.length) {
    area.innerHTML = '<p class="muted">No responses yet.</p>';
    return;
  }
  area.innerHTML =
    `<p class="notice">${rows.filter((r) => r.attending && !r.reserve).length} playing · ${rows.filter((r) => r.reserve).length} waiting · ${rows.filter((r) => !r.attending && !r.reserve).length} not playing</p>` +
    rows
      .map(
        (r) =>
          `<form class="response-row" data-member="${r.user_id}"><div><strong>${e(r.name)}</strong><small>${e(r.baseline_rsvp_contacts?.phone || "No phone number saved")}</small></div><label>Status<select name="status"><option value="playing" ${r.attending ? "selected" : ""}>Playing</option><option value="waiting" ${r.reserve ? "selected" : ""}>Waiting list</option><option value="no" ${!r.attending && !r.reserve ? "selected" : ""}>Not playing</option></select></label><label>Buggy<select name="buggy"><option value="no">No</option><option value="yes" ${r.buggy ? "selected" : ""}>Yes</option></select></label><label class="check"><input name="flexibility" type="checkbox" ${r.flexibility === "walk" ? "checked" : ""}> Can walk if needed</label><label>Tee preference<select name="preferred_time"><option value="">No preference</option>${["First", "Middle", "End"].map((x) => `<option ${r.preferred_time === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><button>Save</button><p class="form-status full" role="status"></p></form>`,
      )
      .join("");
  area.querySelectorAll("form").forEach(
    (form) =>
      (form.onsubmit = (ev) => {
        ev.preventDefault();
        b.submit(form, async () => {
          const f = new FormData(form);
          const { data, error } = await c.rpc("submit_rsvp", {
            payload: {
              event_id: selected.id,
              user_id: form.dataset.member,
              attending: f.get("status") !== "no",
              reserve: f.get("status") === "waiting",
              buggy: f.get("buggy") === "yes",
              preferred_time: f.get("preferred_time") || null,
              flexibility: f.get("flexibility") ? "walk" : null,
            },
          });
          if (error) throw error;
          await loadResponses();
          b.toast(
            data.reserve
              ? "Response saved on the waiting list."
              : "Member response updated.",
          );
        });
      }),
  );
}
async function generate() {
  if (!selected) return b.toast("Choose an event first.");
  if (selected.event_type === "social")
    return b.toast("Social events do not use tee groups.");
  await loadResponses();
  const players = rows.filter((r) => r.attending && !r.reserve);
  if (!players.length) return b.toast("There are no confirmed players yet.");
  const start = document.getElementById("teeStart").value,
    gap = Number(document.getElementById("teeGap").value);
  if (!start || gap < 1 || gap > 60)
    return b.toast("Enter a start time and a gap from 1 to 60 minutes.");
  const [h, m] = start.split(":").map(Number);
  const pairData = await operation("admin", { event_id: selected.id });
  const packed = packPlayers(
    players,
    pairData.pairs.filter((p) => p.status === "confirmed"),
  );
  if (h * 60 + m + Math.max(0, packed.length - 1) * gap >= 1440)
    return b.toast(
      "The tee times would run into the next day. Adjust the start time or gap.",
    );
  groups = packed.map((people, i) => {
    const mins = h * 60 + m + i * gap;
    return {
      time:
        String(Math.floor(mins / 60)).padStart(2, "0") +
        ":" +
        String(mins % 60).padStart(2, "0"),
      players: people.map((p) => p.user_id),
    };
  });
  renderGroups();
  document.getElementById("teeMessage").textContent =
    "Draft groups generated. Review buggy pairs and preferences before publishing.";
}
async function loadGroups() {
  if (!selected) return b.toast("Choose an event first.");
  if (selected.event_type === "social")
    return b.toast("Social events do not use tee groups.");
  await loadResponses();
  const { data, error } = await c
    .from("tee_times")
    .select("*")
    .eq("event_id", selected.id)
    .order("group_number");
  if (error) return b.toast(error.message);
  groups = (data || []).map((g) => ({
    time: g.tee_time,
    players: g.players
      .map((p) => p.user_id)
      .filter((id) =>
        rows.some((r) => r.user_id === id && r.attending && !r.reserve),
      ),
  }));
  if (!groups.length)
    return b.toast("No saved tee groups. Generate groups first.");
  const assigned = new Set(groups.flatMap((g) => g.players)),
    extra = rows.filter(
      (r) => r.attending && !r.reserve && !assigned.has(r.user_id),
    );
  for (const r of extra) {
    let g = groups.find((g) => g.players.length < 4);
    if (!g) {
      g = { time: "", players: [] };
      groups.push(g);
    }
    g.players.push(r.user_id);
  }
  renderGroups();
  document.getElementById("teeMessage").textContent =
    "Saved groups loaded. Review any player changes, then publish.";
}
function renderGroups() {
  const area = document.getElementById("teeEditor");
  area.innerHTML = groups
    .map(
      (g, i) =>
        `<section class="tee-group"><div class="section-heading"><h3>Group ${i + 1}</h3><label>Tee time<input type="time" value="${e(g.time)}" data-time="${i}"></label></div>${g.players
          .map((id) => {
            const r = rows.find((r) => r.user_id === id);
            if (!r) return "";
            return `<div class="tee-player"><span>${e(r.name)}<small>${r.buggy ? "Buggy" : "Walking"}${r.flexibility === "walk" ? " (can walk if needed)" : ""} · ${e(r.preferred_time || "No tee time")} preference</small></span><label class="visually-hidden" for="group-${id}">Group for ${e(r.name)}</label><select id="group-${id}" data-player="${id}" data-from="${i}">${groups.map((_, j) => `<option value="${j}" ${j === i ? "selected" : ""}>Group ${j + 1}</option>`).join("")}<option value="new">New group</option></select></div>`;
          })
          .join(
            "",
          )}${g.players.filter((id) => rows.find((r) => r.user_id === id)?.buggy).length % 2 !== 0 ? '<p class="muted">Check buggy pairing for this group.</p>' : ""}${g.players.length > 4 ? '<p class="error">Maximum four players per group.</p>' : ""}</section>`,
    )
    .join("");
  area
    .querySelectorAll("[data-time]")
    .forEach(
      (input) =>
        (input.onchange = () =>
          (groups[Number(input.dataset.time)].time = input.value)),
    );
  area.querySelectorAll("[data-player]").forEach(
    (sel) =>
      (sel.onchange = () => {
        const from = Number(sel.dataset.from),
          id = sel.dataset.player;
        groups[from].players = groups[from].players.filter((x) => x !== id);
        if (sel.value === "new") groups.push({ time: "", players: [id] });
        else groups[Number(sel.value)].players.push(id);
        renderGroups();
      }),
  );
}
async function saveGroups() {
  if (!selected) return b.toast("Choose an event first.");
  if (!groups.length) return b.toast("Generate or load tee groups first.");
  const odd = groups.filter(
    (g) =>
      g.players.filter((id) => rows.find((r) => r.user_id === id)?.buggy)
        .length %
        2 ===
      1,
  );
  if (odd.length > 1)
    return b.toast(
      "There are unpaired buggy players in different groups. Move them into pairs before publishing.",
    );
  const button = document.getElementById("saveTees");
  button.disabled = true;
  try {
    const old = await c
      .from("tee_times")
      .select("*")
      .eq("event_id", selected.id);
    if (old.error) throw old.error;
    const moves = [];
    for (const g of groups)
      for (const id of g.players) {
        const prev = old.data.find((t) =>
          t.players.some((p) => p.user_id === id),
        );
        if (
          prev &&
          (prev.tee_time !== g.time ||
            JSON.stringify(prev.players.map((p) => p.user_id).sort()) !==
              JSON.stringify([...g.players].sort()))
        )
          moves.push(
            `${rows.find((r) => r.user_id === id)?.name}: ${prev.tee_time} → ${g.time}${prev.tee_time === g.time ? " (group changed)" : ""}`,
          );
      }
    if (!(await reviewPublication(moves, groups))) return;
    const { error } = await c.rpc("save_tee_times", {
      event: selected.id,
      groups: groups.filter((g) => g.players.length),
    });
    if (error) throw error;
    document.getElementById("teeMessage").textContent =
      "Tee times published. Members can view them on the event.";
    b.toast("Tee times published.");
    const refreshed = await c
      .from("events")
      .select("*")
      .eq("id", selected.id)
      .single();
    if (!refreshed.error) selected = refreshed.data;
    let copy = document.getElementById("copyTeeUpdate");
    if (!copy) {
      copy = document.createElement("button");
      copy.id = "copyTeeUpdate";
      copy.className = "secondary";
      copy.textContent = "Copy latest tee update for WhatsApp";
      document.getElementById("teeMessage").after(copy);
    }
    copy.onclick = async () => {
      const lines = [
        selected.name + " · " + b.date(selected.date),
        "Latest tee groups — UK times",
        ...groups
          .filter((g) => g.players.length)
          .map(
            (g) =>
              g.time +
              " — " +
              g.players
                .map((id) => rows.find((r) => r.user_id === id)?.name)
                .join(", "),
          ),
        new URL("event.html?id=" + selected.id, location.href).href,
      ];
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        b.toast("Copied. Review and paste into your society chat.");
      } catch {
        document.getElementById("teeMessage").textContent = lines.join("\n");
      }
    };
  } catch (error) {
    document.getElementById("teeMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
async function loadEnquiries() {
  const area = document.getElementById("enquiries");
  const { data, error } = await c
    .from("signups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    area.textContent = error.message;
    return;
  }
  area.innerHTML = data.length
    ? data
        .map(
          (row) =>
            `<div class="panel"><strong>${e(row.name)}</strong><p>${e(row.email)} · ${e(row.phone)}</p><button data-approve-enquiry="${row.id}">Approve name for signup</button><button class="secondary" data-enquiry="${row.id}">Mark handled</button></div>`,
        )
        .join("")
    : '<p class="muted">No outstanding enquiries. New members can create their own accounts.</p>';
  area.querySelectorAll("[data-approve-enquiry]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        btn.disabled = true;
        try {
          await operation("approve_enquiry", {
            id: Number(btn.dataset.approveEnquiry),
          });
          await loadEnquiries();
          b.toast("Name approved. Ask the applicant to create their account.");
        } catch (error) {
          b.toast(error.message);
          btn.disabled = false;
        }
      }),
  );
  area.querySelectorAll("[data-enquiry]").forEach(
    (button) =>
      (button.onclick = async () => {
        const { error } = await c
          .from("signups")
          .delete()
          .eq("id", Number(button.dataset.enquiry));
        if (error) return b.toast(error.message);
        await loadEnquiries();
      }),
  );
}

async function loadMemberRecovery() {
  const { data, error } = await c.rpc("member_roster");
  const select = document.getElementById("claimedNames");
  if (error) {
    select.innerHTML = '<option value="">Unable to load names</option>';
    return;
  }
  const names = (data || []).filter((m) => m.claimed);
  select.innerHTML =
    '<option value="">Select claimed name</option>' +
    names
      .map((m) => `<option value="${e(m.id)}">${e(m.name)}</option>`)
      .join("");
  document.getElementById("releaseMember").onsubmit = (ev) => {
    ev.preventDefault();
    b.submit(ev.target, async () => {
      const member = names.find((m) => m.id === select.value);
      if (
        !member ||
        !confirm(
          "Release " +
            member.name +
            "? This blocks the claimed account from RSVPs and cancels its future places. Only continue after checking with the member.",
        )
      )
        return;
      const result = await c.rpc("release_member", { who: member.id });
      if (result.error) throw result.error;
      await loadMemberRecovery();
      b.toast("Name released. The member can now create their account.");
    });
  };
}

function reviewPublication(moves, groups) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<h2>Review tee publication</h2><p>${groups.filter((g) => g.players.length).length} groups · ${groups.reduce((n, g) => n + g.players.length, 0)} players</p>${moves.length ? `<p>${moves.length} existing players affected:</p><ul>${moves.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : "<p>No existing player times or groups changed.</p>"}<p>Members will see the current sheet and a notice if their group changes. No messages are sent automatically.</p><div class="actions"><button data-publish>Publish tee times</button><button class="secondary" data-back>Back to editing</button></div>`;
    document.body.append(dialog);
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector("[data-publish]").onclick = () => finish(true);
    dialog.querySelector("[data-back]").onclick = () => finish(false);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    dialog.showModal();
  });
}
