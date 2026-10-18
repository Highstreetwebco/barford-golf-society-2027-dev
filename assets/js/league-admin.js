import { adjustment, roundAverage, handicapAt, rulesHTML } from "./league-rules.js?v=2027-simple-1";
const b = await window.barfordReady, e = b.escape;
let state, event, responses = [], teeGroups = [], dirty = false, busy = false, token = 0;

export function clearLeagueAdmin() {
  ++token; state = null; event = null; responses = []; teeGroups = []; dirty = false; busy = false;
}
export function canLeaveLeague() {
  if (busy) { b.toast("Please wait until the scores have finished saving."); return false; }
  if (dirty && !confirm("You have unsaved scores or handicaps. Leave without saving?")) return false;
  dirty = false;
  return true;
}
window.addEventListener("beforeunload", ev => {
  if (dirty || busy) { ev.preventDefault(); ev.returnValue = ""; }
});
const ids = { handicaps: "adminHandicaps", scoring: "adminScoring", scorecards: "adminScorecards" };
export async function showLeagueTab(tab, selected) {
  const ticket = ++token;
  dirty = false;
  if (!ids[tab]) return;
  const area = document.getElementById(ids[tab]);
  event = selected;
  area.innerHTML = '<p class="muted" role="status">Loading…</p>';
  try {
    const { data, error } = await b.client.rpc("league_admin");
    if (error) throw error;
    if (ticket !== token) return;
    state = data;
    if (tab === "handicaps") { renderHandicaps(area); return; }
    if (!event?.round_number) {
      area.innerHTML = b.empty("Choose a league round.", "Select an event above. Its round number is set in Event details.");
      return;
    }
    const results = await Promise.all([
      b.client.from("rsvps").select("*").eq("event_id", event.id),
      b.client.from("tee_times").select("*").eq("event_id", event.id).order("group_number"),
    ]);
    if (ticket !== token) return;
    for (const result of results) if (result.error) throw result.error;
    responses = results[0].data || [];
    teeGroups = results[1].data || [];
    if (tab === "scoring") renderScoring(area);
    else renderCards(area);
  } catch (error) {
    if (ticket !== token) return;
    area.innerHTML = b.empty("Could not load this section.", error.message) + '<button class="secondary" type="button" data-retry-league>Try again</button>';
    area.querySelector("[data-retry-league]").onclick = () => showLeagueTab(tab, selected);
  }
}
function missingEarlierRounds() {
  return Array.from({ length: Math.max(0, (event?.round_number || 1) - 1) }, (_, i) => i + 1)
    .filter(n => !state.rounds.some(r => r.round_number === n && r.published_entries));
}
function notice() {
  const missing = missingEarlierRounds();
  return missing.length ? `<p class="notice">Complete round${missing.length > 1 ? "s" : ""} ${missing.join(", ")} first. You can save these scores as a draft while you finish earlier rounds.</p>` : "";
}
function wireNext(inputs) {
  inputs.forEach((input, i) => input.addEventListener("keydown", ev => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const next = inputs.slice(i + 1).find(x => !x.disabled);
      next?.focus(); next?.select();
    }
  }));
}
export function updateHandicapSetup(data) {
  const missing = data.players.filter(p => p.starting_handicap == null).length;
  const label = document.getElementById("handicapSetupLabel");
  if (label) label.textContent = missing ? `Starting handicaps · ${missing} to set` : "Starting handicaps · all set";
  const setup = document.getElementById("handicapSetup");
  if (setup && missing) setup.open = true;
}
async function saveForm(form, work) {
  if (busy) return;
  busy = true;
  const status = form.querySelector(".form-status");
  const buttons = [...form.querySelectorAll("button")].map(button => ({ button, disabled: button.disabled }));
  buttons.forEach(({ button }) => button.disabled = true);
  form.inert = true;
  form.setAttribute("aria-busy", "true");
  if (status) { status.textContent = "Saving… Please wait."; status.classList.remove("success"); }
  try { await work(); }
  catch (error) {
    if (status) status.textContent = error.message || "Nothing was saved. Please try again.";
  } finally {
    busy = false;
    form.inert = false;
    form.removeAttribute("aria-busy");
    buttons.forEach(({ button, disabled }) => button.disabled = disabled);
  }
}
function renderHandicaps(area, feedback = "") {
  updateHandicapSetup(state);
  const missing = state.players.filter(p => p.starting_handicap == null);
  if (!missing.length) {
    area.innerHTML = `<p class="success">${e(feedback || "Every member has a starting handicap.")}</p><p class="muted">To correct an existing starting handicap, choose Edit member below.</p>`;
    return;
  }
  area.innerHTML = `<p>Set the season starting handicap for these members. Press Enter for the next name. Leave unknown values blank.</p><form id="handicapForm"><div class="table-scroll"><table><thead><tr><th>Member</th><th>Starting handicap</th></tr></thead><tbody>${missing.map(p => `<tr><th scope="row"><label for="hcp-${p.id}">${e(p.name)}</label></th><td><input class="score-input" id="hcp-${p.id}" data-hcp="${p.id}" type="number" inputmode="decimal" min="0" max="36" step="0.1" aria-label="Starting handicap for ${e(p.name)}"></td></tr>`).join("")}</tbody></table></div><div class="actions section"><button type="submit">Save starting handicaps</button><span id="handicapSaveState" class="save-state" role="status">${e(feedback || "No changes")}</span></div><p class="form-status" role="status"></p></form>`;
  const form = area.querySelector("form"), inputs = [...area.querySelectorAll("[data-hcp]")];
  inputs.forEach(input => input.oninput = () => {
    dirty = true;
    area.querySelector("#handicapSaveState").textContent = "Unsaved changes";
    area.querySelector("#handicapSaveState").dataset.state = "unsaved";
  });
  wireNext(inputs);
  form.onsubmit = ev => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const entries = inputs.filter(input => input.value !== "").map(input => ({ user_id: input.dataset.hcp, handicap: Number(input.value) }));
    if (!entries.length) { form.querySelector(".form-status").textContent = "Enter at least one handicap to save."; return; }
    saveForm(form, async () => {
      const { data, error } = await b.client.rpc("league_save_handicaps", { entries, expected_revision: state.revision });
      if (error) throw error;
      state = data; dirty = false;
      renderHandicaps(area, "Starting handicaps saved.");
      b.toast("Starting handicaps saved.");
      window.dispatchEvent(new CustomEvent("barford:members-updated"));
    });
  };
}
function renderScoring(area, feedback = "") {
  const saved = state.rounds.find(r => r.event_id === event.id);
  const entered = new Map((saved?.draft || saved?.published_entries || []).map(x => [x.user_id, { ...x }]));
  const confirmed = responses.filter(r => r.attending && !r.reserve);
  for (const p of confirmed) if (!entered.has(p.user_id)) entered.set(p.user_id, { user_id: p.user_id, status: "pending", points: null });
  let chosen = saved?.draft_winner || saved?.winner || "";
  function leaderKey(list) {
    const valid = list.filter(x => x.status === "played" && Number.isInteger(x.points) && x.points >= 1 && x.points <= 108);
    const high = valid.length ? Math.max(...valid.map(x => x.points)) : null;
    return `${high}:${valid.filter(x => x.points === high).map(x => x.user_id).sort().join(",")}`;
  }
  let previousLeaderKey = leaderKey([...entered.values()]);
  const privateRound = event.round_number >= 6;
  const draftDiffers = saved?.published_entries && JSON.stringify(saved.draft) !== JSON.stringify(saved.published_entries);
  const savedLabel = feedback || (saved ? draftDiffers ? "Draft saved · round has earlier completed results" : saved.published_entries ? "Round complete" : "Draft saved" : "Not saved yet");
  area.innerHTML = `<div class="section-heading"><div><p class="eyebrow">ROUND ${event.round_number}${privateRound ? " · ADMIN ONLY" : ""}</p><h2>Enter scores</h2><p class="muted">${e(event.name)} · ${e(b.date(event.date))}</p></div><span id="scoreSaveState" class="save-state" role="status">${e(savedLabel)}</span></div>
    <p>Enter each player's total Stableford points for all 18 holes. Press Enter for the next player. Tick <strong>Did not play / zero</strong> for a non-starter or zero, following the society rules.</p>
    ${privateRound ? '<p class="notice private-round-notice">These results stay private to admins, including their effect on the leaderboard and handicaps.</p>' : ""}
    ${notice()}${event.cancelled ? '<p class="notice">This event is cancelled. Reopen it in Event details before saving scores.</p>' : ""}
    ${saved?.published_entries ? '<p class="muted">This round is already complete. You can save draft corrections before updating the completed round.</p>' : ""}
    <div class="score-tools"><label for="addScorePlayer">Add a member who played<select id="addScorePlayer"><option value="">Choose member</option></select></label><button type="button" class="text-button" id="reloadScores">Reload saved scores</button></div>
    <form id="roundScoreForm" novalidate><div id="scoreRows" class="table-scroll"></div><p id="scoreProgress" class="score-progress" aria-live="polite"></p><div id="winnerChoice"></div><p id="completionHelp" class="muted" aria-live="polite"></p><div class="actions admin-save-bar"><button type="submit" name="action" value="draft" class="secondary" id="saveRoundDraft">Save draft</button><button type="submit" name="action" value="publish" id="completeRound">${saved?.published_entries ? "Update completed round" : "Complete round"}</button></div><p class="form-status" role="status"></p></form>${rulesHTML}`;
  const form = area.querySelector("#roundScoreForm");
  const entries = () => [...entered.values()];
  const player = id => state.players.find(p => p.id === id);
  function markDirty() {
    dirty = true;
    area.querySelector("#scoreSaveState").textContent = "Unsaved changes";
    area.querySelector("#scoreSaveState").dataset.state = "unsaved";
  }
  function assessment() {
    const list = entries();
    const invalid = list.filter(x => x.status === "played" && (!Number.isInteger(x.points) || x.points < 1 || x.points > 108));
    const badInput = [...area.querySelectorAll("[data-score]")].some(input => input.validity.badInput);
    const played = list.filter(x => x.status === "played" && Number.isInteger(x.points) && x.points >= 1 && x.points <= 108);
    const pending = list.filter(x => x.status === "pending");
    const missing = list.filter(x => x.status === "played" && player(x.user_id)?.starting_handicap == null);
    const unknown = list.filter(x => !player(x.user_id));
    const high = played.length ? Math.max(...played.map(x => x.points)) : null;
    const leaders = played.filter(x => x.points === high);
    const currentLeaderKey = leaderKey(list);
    if (currentLeaderKey !== previousLeaderKey || leaders.length < 2 || (chosen && !leaders.some(x => x.user_id === chosen))) chosen = "";
    previousLeaderKey = currentLeaderKey;
    const reasons = [];
    if (event.cancelled) reasons.push("Reopen this event before saving scores.");
    if (invalid.length || badInput) reasons.push("Use whole numbers from 1 to 108. Tick Did not play / zero for zero.");
    if (pending.length) reasons.push(`${pending.length} player${pending.length === 1 ? " still needs" : "s still need"} a score or Did not play.`);
    if (played.length < 4) reasons.push("At least four played scores are needed to complete a round.");
    if (missing.length) reasons.push(`Set the starting handicap for ${missing.length} player${missing.length === 1 ? "" : "s"} in Members.`);
    if (unknown.length) reasons.push("A listed player does not have an active member account. Check Members before completing.");
    const earlier = missingEarlierRounds();
    if (earlier.length) reasons.push(`Complete earlier round${earlier.length === 1 ? "" : "s"} ${earlier.join(", ")} first.`);
    if (leaders.length > 1 && !chosen) reasons.push("Choose the tied winner after checking countback.");
    return { list, invalid, badInput, played, pending, high, leaders, reasons, unknown };
  }
  function progress() {
    const check = assessment(), average = check.invalid.length || check.badInput ? null : roundAverage(check.list);
    area.querySelector("#scoreProgress").textContent = `${check.played.length} scores entered · ${check.list.filter(x => x.status === "dnp").length} did not play / zero · ${check.pending.length} left`;
    area.querySelector("#winnerChoice").innerHTML = check.leaders.length > 1
      ? `<label class="winner-choice">Round winner — tied on ${check.high} points<select id="roundWinner"><option value="">Choose after countback</option>${check.leaders.map(x => `<option value="${x.user_id}" ${chosen === x.user_id ? "selected" : ""}>${e(player(x.user_id)?.name || "Inactive account")}</option>`).join("")}</select></label><p class="muted">Check the tied players' cards and select the winner. A tied total alone cannot decide countback.</p>`
      : check.leaders.length === 1 ? `<p class="round-leading">Leading: <strong>${e(player(check.leaders[0].user_id)?.name || "Inactive account")}</strong> · ${check.high} points</p>` : "";
    const winner = area.querySelector("#roundWinner");
    if (winner) winner.onchange = () => { chosen = winner.value; markDirty(); progress(); };
    const help = area.querySelector("#completionHelp");
    help.textContent = check.reasons.length ? check.reasons.join(" ") : privateRound ? "Ready to complete. Scores and handicaps will update for admins only." : "Ready to complete. Scores, the leaderboard and handicaps will update together.";
    help.classList.toggle("success", check.reasons.length === 0);
    area.querySelector("#completeRound").disabled = check.reasons.length > 0;
    area.querySelector("#saveRoundDraft").disabled = !check.list.length || !!check.invalid.length || check.badInput || !!check.unknown.length || !!event.cancelled;
    for (const x of check.list) {
      const p = player(x.user_id), h = p ? handicapAt(p, event.round_number, state.rounds) : null;
      const cell = area.querySelector(`[data-preview="${x.user_id}"]`);
      const input = area.querySelector(`[data-score="${x.user_id}"]`);
      const invalid = x.status === "played" && (!Number.isInteger(x.points) || x.points < 1 || x.points > 108);
      if (input) input.setAttribute("aria-invalid", String(invalid || input.validity.badInput));
      if (!cell) continue;
      const adj = average !== null && x.status === "played" && !invalid && h !== null ? adjustment(x.points, average, h) : null;
      cell.textContent = h === null ? "Set in Members" : adj === null ? x.status === "dnp" ? String(h) : "—" : `${Math.max(0, h + adj)} (${adj > 0 ? "+" : ""}${adj})`;
    }
  }
  function renderRows() {
    const list = entries().sort((a, z) => (player(a.user_id)?.name || "").localeCompare(player(z.user_id)?.name || ""));
    area.querySelector("#scoreRows").innerHTML = list.length
      ? `<table class="score-entry-table"><thead><tr><th>Player</th><th>Handicap</th><th>18-hole points</th><th>Did not play / zero</th><th class="next-hcp-col">Next handicap <small>(preview)</small></th></tr></thead><tbody>${list.map(x => { const p = player(x.user_id); return `<tr><th scope="row">${e(p?.name || responses.find(r => r.user_id === x.user_id)?.name || "Inactive account")}</th><td>${p ? (handicapAt(p, event.round_number, state.rounds) ?? "Not set") : "Not set"}</td><td><input class="score-input" data-score="${x.user_id}" type="number" inputmode="numeric" min="1" max="108" step="1" value="${x.points ?? ""}" ${x.status === "dnp" ? "disabled" : ""} aria-label="18-hole Stableford points for ${e(p?.name || "player")}"></td><td><label class="dnp-choice"><input data-dnp="${x.user_id}" type="checkbox" ${x.status === "dnp" ? "checked" : ""} aria-label="Did not play or zero for ${e(p?.name || "player")}"><span class="visually-hidden">Did not play / zero</span></label></td><td class="next-hcp-col" data-preview="${x.user_id}"></td></tr>`; }).join("")}</tbody></table>`
      : '<p class="notice">No confirmed players yet. Add a member who played using the list above.</p>';
    const select = area.querySelector("#addScorePlayer");
    select.innerHTML = '<option value="">Choose member</option>' + state.players.filter(p => !entered.has(p.id)).map(p => `<option value="${p.id}">${e(p.name)}</option>`).join("");
    const inputs = [...area.querySelectorAll("[data-score]")];
    wireNext(inputs);
    for (const input of inputs) input.oninput = () => {
      const row = entered.get(input.dataset.score);
      row.points = input.value === "" ? null : Number(input.value);
      row.status = input.value === "" ? "pending" : "played";
      markDirty(); progress();
    };
    for (const check of area.querySelectorAll("[data-dnp]")) check.onchange = () => {
      const row = entered.get(check.dataset.dnp);
      row.status = check.checked ? "dnp" : "pending"; row.points = null;
      markDirty(); renderRows();
      area.querySelector(`[data-dnp="${check.dataset.dnp}"]`)?.focus();
    };
    progress();
  }
  area.querySelector("#addScorePlayer").onchange = ev => {
    const id = ev.target.value;
    if (id && !entered.has(id)) { entered.set(id, { user_id: id, status: "pending", points: null }); markDirty(); renderRows(); area.querySelector(`[data-score="${id}"]`)?.focus(); }
  };
  area.querySelector("#reloadScores").onclick = () => { if (canLeaveLeague()) showLeagueTab("scoring", event); };
  form.onsubmit = ev => {
    ev.preventDefault();
    if (busy) return;
    const publish = ev.submitter?.value === "publish", check = assessment();
    const status = form.querySelector(".form-status");
    if (check.invalid.length || check.badInput || check.unknown.length || event.cancelled || !check.list.length || (publish && check.reasons.length)) {
      status.textContent = check.reasons.join(" ") || "Add at least one player before saving."; return;
    }
    if (publish && saved?.published_entries && !confirm("Update this completed round? Later handicaps and the leaderboard will be recalculated.")) return;
    const payload = { event: event.id, entries: entries(), chosen_winner: chosen || null, publish, expected_revision: state.revision };
    saveForm(form, async () => {
      const { data, error } = await b.client.rpc("league_save_round", payload);
      if (error) throw error;
      state = data; dirty = false;
      const message = publish ? privateRound ? "Round complete · visible to admins only" : "Round complete · scores and handicaps updated" : "Draft saved · members cannot see draft changes";
      renderScoring(area, message);
      b.toast(message + ".");
    });
  };
  renderRows();
}

function renderCards(area) {
  const players = responses
    .filter((r) => r.attending && !r.reserve)
    .map((r) => {
      const p = state.players.find((p) => p.id === r.user_id),
        group = teeGroups.find((g) =>
          g.players.some((x) => x.user_id === r.user_id),
        );
      return {
        name: r.guest_host_id ? r.name : p?.name || r.name,
        handicap: p ? handicapAt(p, event.round_number, state.rounds) : null,
        tee: group?.tee_time || "",
        group: group?.group_number || 999,
        buggy: r.buggy,
      };
    })
    .sort((a, c) => a.group - c.group || a.name.localeCompare(c.name));
  const warning = notice(),
    missing = players.filter((p) => p.handicap === null).length;
  area.innerHTML = `<div class="scorecard-print"><p class="eyebrow">ROUND ${event.round_number} · SCORECARD LIST</p><h2>Names and handicaps for scorecards</h2><h3>${e(event.name)}</h3><p>${e(b.date(event.date))} · ${players.length} confirmed players · ${e(event.location || "")}</p>${warning}${missing ? `<p class="notice">${missing} player${missing > 1 ? "s need" : " needs"} a starting handicap. Set this in Members before writing the cards.</p>` : ""}${event.tee_times_dirty ? '<p class="notice">The RSVP list has changed since tee times were published. Check and republish tee groups.</p>' : ""}<p class="muted">Copy each name and society handicap onto their card. Waiting-list and declined players are excluded. ${teeGroups.length ? "Ordered by tee group." : "Tee groups have not been published; listed alphabetically."}</p><div class="table-scroll"><table class="scorecard-table"><thead><tr><th>Done</th><th>Member name</th><th>Round ${event.round_number} HCP</th><th>Tee time</th><th>Travel</th></tr></thead><tbody>${players.map((p) => `<tr><td><input type="checkbox" aria-label="Card written for ${e(p.name)}"></td><th scope="row">${e(p.name)}</th><td class="card-hcp">${p.handicap ?? "NOT SET"}</td><td>${e(p.tee || "Not assigned")}</td><td>${p.buggy ? "Buggy" : "Walking"}</td></tr>`).join("")}</tbody></table></div>${players.length ? "" : "<p>No confirmed players yet.</p>"}<small>Prepared ${e(new Date().toLocaleString("en-GB"))}. Refresh after changing RSVPs or scores.</small></div><div class="actions section"><button id="printScorecards" ${players.length ? "" : "disabled"}>Print scorecard list</button><button id="downloadScorecards" class="secondary" ${players.length ? "" : "disabled"}>Download CSV</button><button id="refreshScorecards" class="secondary">Refresh list</button></div>`;
  area.querySelector("#refreshScorecards").onclick = () =>
    showLeagueTab("scorecards", event);
  area.querySelector("#printScorecards").onclick = () => {
    document.body.classList.add("printing-scorecards");
    window.print();
  };
  window.addEventListener(
    "afterprint",
    () => document.body.classList.remove("printing-scorecards"),
    { once: true },
  );
  area.querySelector("#downloadScorecards").onclick = () => {
    const rows = [
      ["Event", event.name],
      ["Round", event.round_number],
      ["Date", event.date],
      [
        "Status",
        warning || missing
          ? "PROVISIONAL — check earlier rounds and missing handicaps"
          : "Ready",
      ],
      ["Name", "Round handicap", "Tee time", "Travel"],
      ...players.map((p) => [
        p.name,
        p.handicap ?? "NOT SET",
        p.tee,
        p.buggy ? "Buggy" : "Walking",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (x) =>
              '"' +
              String(x)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
        new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `barford-round-${event.round_number}-scorecards.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
