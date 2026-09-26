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
  gate.hidden = true;
  content.hidden = false;
  await init();
}
async function init() {
  const { data, error } = await c.from("events").select("*").order("date");
  if (error) {
    gate.hidden = false;
    gate.textContent = error.message;
    return;
  }
  events = data;
  picker.innerHTML =
    '<option value="">New event</option>' +
    events
      .map(
        (ev) =>
          `<option value="${ev.id}">${e(ev.name)} · ${e(b.date(ev.date))}</option>`,
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
        document
          .querySelectorAll("[data-tab]")
          .forEach((btn) => btn.classList.toggle("active", btn === button));
        ["details", "responses", "tees"].forEach(
          (tab) =>
            (document.getElementById(
              "admin" +
                { details: "Details", responses: "Responses", tees: "Tees" }[
                  tab
                ],
            ).hidden = tab !== button.dataset.tab),
        );
      }),
  );
  form.onsubmit = (ev) => {
    ev.preventDefault();
    b.submit(form, async () => {
      const f = new FormData(form),
        name = String(f.get("name")).trim();
      if (!name) throw new Error("Enter an event name.");
      const updates = {
        name,
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
  await loadResponses();
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
          `<form class="response-row" data-member="${r.user_id}"><div><strong>${e(r.name)}</strong><small>${e(r.baseline_rsvp_contacts?.phone || "No phone number saved")}</small></div><label>Status<select name="status"><option value="playing" ${r.attending ? "selected" : ""}>Playing</option><option value="waiting" ${r.reserve ? "selected" : ""}>Waiting list</option><option value="no" ${!r.attending && !r.reserve ? "selected" : ""}>Not playing</option></select></label><label>Buggy<select name="buggy"><option value="no">No</option><option value="yes" ${r.buggy ? "selected" : ""}>Yes</option></select></label><label>Tee preference<select name="preferred_time">${["First", "Middle", "End"].map((x) => `<option ${r.preferred_time === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><button>Save</button><p class="form-status full" role="status"></p></form>`,
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
              preferred_time: f.get("preferred_time"),
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
  await loadResponses();
  const players = rows.filter((r) => r.attending && !r.reserve);
  if (!players.length) return b.toast("There are no confirmed players yet.");
  const start = document.getElementById("teeStart").value,
    gap = Number(document.getElementById("teeGap").value);
  if (!start || gap < 1 || gap > 60)
    return b.toast("Enter a start time and a gap from 1 to 60 minutes.");
  const rank = { First: 0, Middle: 1, End: 2 };
  players.sort(
    (a, z) =>
      (rank[a.preferred_time] ?? 1) - (rank[z.preferred_time] ?? 1) ||
      Number(z.buggy) - Number(a.buggy) ||
      a.name.localeCompare(z.name),
  );
  const [h, m] = start.split(":").map(Number);
  groups = [];
  for (let i = 0; i < players.length; i += 4) {
    const mins = h * 60 + m + (i / 4) * gap;
    if (mins >= 1440)
      return b.toast(
        "The tee times would run into the next day. Adjust the start time or gap.",
      );
    groups.push({
      time:
        String(Math.floor(mins / 60)).padStart(2, "0") +
        ":" +
        String(mins % 60).padStart(2, "0"),
      players: players.slice(i, i + 4).map((p) => p.user_id),
    });
  }
  renderGroups();
  document.getElementById("teeMessage").textContent =
    "Draft groups generated. Review buggy pairs and preferences before publishing.";
}
async function loadGroups() {
  if (!selected) return b.toast("Choose an event first.");
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
            return `<div class="tee-player"><span>${e(r.name)}<small>${r.buggy ? "Buggy" : "Walking"} · ${e(r.preferred_time)} preference</small></span><label class="visually-hidden" for="group-${id}">Group for ${e(r.name)}</label><select id="group-${id}" data-player="${id}" data-from="${i}">${groups.map((_, j) => `<option value="${j}" ${j === i ? "selected" : ""}>Group ${j + 1}</option>`).join("")}<option value="new">New group</option></select></div>`;
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
  const button = document.getElementById("saveTees");
  button.disabled = true;
  try {
    const { error } = await c.rpc("save_tee_times", {
      event: selected.id,
      groups: groups.filter((g) => g.players.length),
    });
    if (error) throw error;
    document.getElementById("teeMessage").textContent =
      "Tee times published. Members can view them on the event.";
    b.toast("Tee times published.");
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
            `<div class="panel"><strong>${e(row.name)}</strong><p>${e(row.email)} · ${e(row.phone)}</p><button class="secondary" data-enquiry="${row.id}">Mark handled</button></div>`,
        )
        .join("")
    : '<p class="muted">No outstanding enquiries. New members can now create their own accounts.</p>';
  area.querySelectorAll("[data-enquiry]").forEach(
    (button) =>
      (button.onclick = async () => {
        const { error } = await c
          .from("signups")
          .delete()
          .eq("id", Number(button.dataset.enquiry));
        if (error) return b.toast(error.message);
        await loadEnquiries();
        await loadMemberRecovery();
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
