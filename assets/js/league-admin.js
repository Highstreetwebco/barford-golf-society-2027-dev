import { openScoreWizard } from "./score-wizard.js?v=2027-groups-1";
import {
  adjustment,
  roundAverage,
  handicapAt,
  rulesHTML,
} from "./league-rules.js?v=2027-groups-1";
const b = await window.barfordReady,
  e = b.escape;
let state,
  event,
  responses = [],
  teeGroups = [],
  dirty = false,
  token = 0;
export function canLeaveLeague() {
  return (
    !dirty ||
    confirm("You have unsaved score or handicap changes. Leave without saving?")
  );
}
window.addEventListener("beforeunload", (ev) => {
  if (dirty) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});
const ids = {
  handicaps: "adminHandicaps",
  scoring: "adminScoring",
  scorecards: "adminScorecards",
};
export async function showLeagueTab(tab, selected) {
  dirty = false;
  if (!ids[tab]) {
    ++token;
    return;
  }
  const ticket = ++token,
    area = document.getElementById(ids[tab]);
  dirty = false;
  event = selected;
  area.innerHTML = "<p>Loading season…</p>";
  try {
    const { data, error } = await b.client.rpc("league_admin");
    if (error) throw error;
    if (ticket !== token) return;
    state = data;
    if (tab === "handicaps") {
      renderHandicaps(area);
      return;
    }
    if (!event?.round_number) {
      area.innerHTML = b.empty(
        "Choose a league event.",
        "Select an event above and set its round number in Event details.",
      );
      return;
    }
    const results = await Promise.all([
      b.client.from("rsvps").select("*").eq("event_id", event.id),
      b.client
        .from("tee_times")
        .select("*")
        .eq("event_id", event.id)
        .order("group_number"),
    ]);
    if (ticket !== token) return;
    for (const result of results) if (result.error) throw result.error;
    responses = results[0].data || [];
    teeGroups = results[1].data || [];
    if (tab === "scoring") renderScoring(area);
    else renderCards(area);
  } catch (err) {
    area.innerHTML = b.empty("Unable to load scoring.", err.message);
  }
}
function notice() {
  const missing = Array.from(
    { length: event.round_number - 1 },
    (_, i) => i + 1,
  ).filter(
    (n) =>
      !state.rounds.some((r) => r.round_number === n && r.published_entries),
  );
  return missing.length
    ? `<p class="notice">Provisional handicaps: round${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not published. Publish earlier results before preparing final scorecards or publishing this round.</p>`
    : "";
}
function wireNext(inputs) {
  inputs.forEach((input, i) =>
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        inputs[i + 1]?.focus();
        inputs[i + 1]?.select();
      }
    }),
  );
}
function renderHandicaps(area) {
  area.innerHTML = `<h2>Starting handicaps</h2><p>Set the season’s starting handicap for every registered player. Enter moves to the next name. Leave unknown handicaps blank.</p><p class="notice">Correcting a starting handicap recalculates every published round. These are starting values; event handicaps are calculated automatically.</p><form id="handicapForm"><div class="table-scroll"><table><thead><tr><th>Member</th><th>Starting HCP</th></tr></thead><tbody>${state.players.map((p) => `<tr><th scope="row"><label for="hcp-${p.id}">${e(p.name)}</label></th><td><input class="score-input" id="hcp-${p.id}" data-hcp="${p.id}" type="number" inputmode="decimal" min="0" max="54" step="0.1" value="${p.starting_handicap ?? ""}" aria-label="Starting handicap for ${e(p.name)}"></td></tr>`).join("")}</tbody></table></div><div class="actions section"><button ${state.players.length ? "" : "disabled"}>Save all starting handicaps</button><button type="button" class="secondary" id="reloadHandicaps">Reload</button></div><p class="form-status" role="status"></p></form>`;
  const form = area.querySelector("form"),
    inputs = [...area.querySelectorAll("[data-hcp]")];
  inputs.forEach((i) => (i.oninput = () => (dirty = true)));
  wireNext(inputs);
  area.querySelector("#reloadHandicaps").onclick = () => {
    if (canLeaveLeague()) showLeagueTab("handicaps", event);
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    b.submit(form, async () => {
      if (
        state.rounds.some((r) => r.published_entries) &&
        !confirm(
          "Recalculate all published rounds using these corrected starting handicaps?",
        )
      )
        return;
      const { data, error } = await b.client.rpc("league_save_handicaps", {
        entries: inputs.map((i) => ({
          user_id: i.dataset.hcp,
          handicap: i.value === "" ? null : Number(i.value),
        })),
        expected_revision: state.revision,
      });
      if (error) throw error;
      state = data;
      dirty = false;
      b.toast("Starting handicaps saved. Published rounds recalculated.");
    });
  };
}
function renderScoring(area) {
  const bulkOpen = area.querySelector("#bulkScoreEntry")?.open;
  const saved = state.rounds.find((r) => r.event_id === event.id);
  const entered = new Map(
    (saved?.draft || []).map((x) => [x.user_id, { ...x }]),
  );
  const confirmed = responses.filter((r) => r.attending && !r.reserve);
  for (const p of confirmed)
    if (!entered.has(p.user_id))
      entered.set(p.user_id, {
        user_id: p.user_id,
        status: "pending",
        points: null,
      });
  let chosen = saved?.draft_winner || saved?.winner || "";
  area.innerHTML = `<p class="eyebrow">ROUND ${event.round_number}${event.round_number >= 6 ? " · ADMIN ONLY" : ""}</p><h2>${e(event.name)} · Enter scores</h2>${notice()}<div class="actions"><button type="button" id="startScoreWizard">Input scores for round ${event.round_number}</button></div><p>Use guided entry above, or the score sheet below. Enter points and press Enter for the next player. Choose DNP for a non-starter or zero. Save a draft at any time; publish once every row is complete.</p>${saved?.published_entries ? '<p class="notice">This round is already published. Saving a draft keeps the published results unchanged. Publishing a correction recalculates later rounds.</p>' : ""}<details id="bulkScoreEntry" class="section"><summary>Edit full score sheet or paste scores</summary><div class="actions section"><label>Add a player<select id="addScorePlayer"><option value="">Choose registered member</option>${state.players.map((p) => `<option value="${p.id}">${e(p.name)}</option>`).join("")}</select></label><button type="button" class="secondary" id="reloadScores">Reload saved scores</button></div><details class="section"><summary>Paste scores from a spreadsheet</summary><p>One row per player: exact name, then a tab or comma, then points or DNP. Check the rows below before publishing.</p><textarea id="pasteScores" rows="4" placeholder="Player name&#9;32"></textarea><button type="button" class="secondary" id="applyPasted">Apply to score sheet</button><p id="pasteStatus" role="status"></p></details><form id="roundScoreForm"><div id="scoreRows" class="table-scroll section"></div><p id="scoreProgress" class="notice" aria-live="polite"></p><div id="winnerChoice"></div><div class="actions section"><button type="submit" name="action" value="draft" class="secondary">Save draft</button><button type="submit" name="action" value="publish">Publish round &amp; update handicaps</button></div><p class="form-status" role="status"></p></form></details>${rulesHTML}`;
  area.querySelector("#bulkScoreEntry").open = !!bulkOpen;
  area.querySelector("#startScoreWizard").onclick = () => {
    let savedInWizard = false;
    openScoreWizard({
      event,
      season: state,
      entries: entries(),
      winner: chosen,
      onSaved: (data) => {
        state = data;
        dirty = false;
        savedInWizard = true;
      },
      onClose: () => {
        if (savedInWizard) renderScoring(area);
      },
    });
  };
  const form = area.querySelector("form");
  function entries() {
    return [...entered.values()];
  }
  function progress() {
    const list = entries(),
      average = roundAverage(list),
      played = list.filter(
        (x) =>
          x.status === "played" && Number.isInteger(x.points) && x.points > 0,
      ),
      pending = list.filter((x) => x.status === "pending").length;
    const high = Math.max(...played.map((x) => x.points)),
      leaders = played.filter((x) => x.points === high);
    area.querySelector("#scoreProgress").textContent =
      `${played.length} scores · ${list.filter((x) => x.status === "dnp").length} DNP · ${pending} to enter${average === null ? " · Four played scores needed" : ` · Round average ${average}`}`;
    area.querySelector("#winnerChoice").innerHTML =
      leaders.length > 1
        ? `<label>Round winner — tied on ${high} points<select id="roundWinner" required><option value="">Choose after countback</option>${leaders.map((x) => `<option value="${x.user_id}" ${chosen === x.user_id ? "selected" : ""}>${e(state.players.find((p) => p.id === x.user_id)?.name)}</option>`).join("")}</select></label>`
        : leaders.length === 1
          ? `<p>🏆 Leading: <strong>${e(state.players.find((p) => p.id === leaders[0].user_id)?.name)}</strong> · ${high} points</p>`
          : "";
    const winner = area.querySelector("#roundWinner");
    if (winner)
      winner.onchange = () => {
        chosen = winner.value;
        dirty = true;
      };
    for (const x of list) {
      const p = state.players.find((p) => p.id === x.user_id),
        h = p ? handicapAt(p, event.round_number, state.rounds) : null;
      const cell = area.querySelector(`[data-preview="${x.user_id}"]`);
      if (cell) {
        const adj =
          average !== null && x.status === "played" && h !== null
            ? adjustment(x.points, average, h)
            : null;
        cell.textContent =
          h === null
            ? "Set starting HCP"
            : adj === null
              ? x.status === "dnp"
                ? String(h)
                : "—"
              : `${Math.max(0, h + adj)} (${adj > 0 ? "+" : ""}${adj})`;
      }
    }
  }
  function renderRows() {
    const list = entries().sort((a, c) =>
      (state.players.find((p) => p.id === a.user_id)?.name || "").localeCompare(
        state.players.find((p) => p.id === c.user_id)?.name || "",
      ),
    );
    area.querySelector("#scoreRows").innerHTML = list.length
      ? `<table class="score-entry-table"><thead><tr><th>Player</th><th>Round HCP</th><th>Points</th><th>DNP</th><th>Next HCP preview</th></tr></thead><tbody>${list
          .map((x) => {
            const p = state.players.find((p) => p.id === x.user_id);
            return `<tr><th scope="row">${e(p?.name || "Inactive account")}</th><td>${p ? (handicapAt(p, event.round_number, state.rounds) ?? "Not set") : "Not set"}</td><td><input class="score-input" data-score="${x.user_id}" type="number" inputmode="numeric" min="1" max="108" step="1" value="${x.points ?? ""}" ${x.status === "dnp" ? "disabled" : ""} aria-label="Points for ${e(p?.name)}"></td><td><input data-dnp="${x.user_id}" type="checkbox" ${x.status === "dnp" ? "checked" : ""} aria-label="DNP for ${e(p?.name)}"></td><td data-preview="${x.user_id}"></td></tr>`;
          })
          .join("")}</tbody></table>`
      : '<p class="muted">No confirmed RSVPs yet. Add any registered player who took part above.</p>';
    const inputs = [...area.querySelectorAll("[data-score]")];
    wireNext(inputs);
    for (const input of inputs)
      input.oninput = () => {
        const x = entered.get(input.dataset.score);
        x.points = input.value === "" ? null : Number(input.value);
        x.status = input.value === "" ? "pending" : "played";
        dirty = true;
        progress();
      };
    for (const check of area.querySelectorAll("[data-dnp]"))
      check.onchange = () => {
        const x = entered.get(check.dataset.dnp);
        x.status = check.checked ? "dnp" : "pending";
        x.points = null;
        dirty = true;
        renderRows();
      };
    progress();
  }
  area.querySelector("#addScorePlayer").onchange = (ev) => {
    const id = ev.target.value;
    if (id && !entered.has(id)) {
      entered.set(id, { user_id: id, status: "pending", points: null });
      dirty = true;
      renderRows();
    }
    ev.target.value = "";
  };
  area.querySelector("#reloadScores").onclick = () => {
    if (canLeaveLeague()) showLeagueTab("scoring", event);
  };
  area.querySelector("#applyPasted").onclick = () => {
    const status = area.querySelector("#pasteStatus");
    try {
      const updates = [],
        seen = new Set();
      for (const line of area
        .querySelector("#pasteScores")
        .value.trim()
        .split(/\r?\n/)) {
        const match = line.match(/^(.+?)[\t,]\s*(DNP|\d+)\s*$/i);
        if (!match)
          throw new Error(
            "Use one name and points (or DNP) per line, separated by a tab or comma.",
          );
        const player = state.players.find(
          (p) => p.name.toLowerCase() === match[1].trim().toLowerCase(),
        );
        if (!player)
          throw new Error(
            `No registered player matches “${match[1]}”. No rows changed.`,
          );
        if (seen.has(player.id))
          throw new Error("A player is repeated. No rows changed.");
        seen.add(player.id);
        const dnp = match[2].toUpperCase() === "DNP" || Number(match[2]) === 0,
          points = dnp ? null : Number(match[2]);
        if (points !== null && points > 108)
          throw new Error("Points must be 1 to 108. No rows changed.");
        updates.push({
          user_id: player.id,
          status: dnp ? "dnp" : "played",
          points,
        });
      }
      for (const x of updates) entered.set(x.user_id, x);
      dirty = true;
      renderRows();
      status.textContent = `${updates.length} rows added. Review before publishing.`;
    } catch (err) {
      status.textContent = err.message;
    }
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const publish = ev.submitter?.value === "publish";
    b.submit(form, async () => {
      if (
        publish &&
        saved?.published_entries &&
        !confirm(
          "Publish this correction and recalculate later round handicaps?",
        )
      )
        return;
      const { data, error } = await b.client.rpc("league_save_round", {
        event: event.id,
        entries: entries(),
        chosen_winner: chosen || null,
        publish,
        expected_revision: state.revision,
      });
      if (error) throw error;
      state = data;
      dirty = false;
      renderScoring(area);
      b.toast(
        publish
          ? "Round published. Leaderboard and handicaps updated."
          : "Draft saved. Members cannot see it.",
      );
    });
  };
  // Drafts can retain an unresolved tie; validation is enforced on publish by the server.
  form.noValidate = true;
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
        name: p?.name || r.name,
        handicap: p ? handicapAt(p, event.round_number, state.rounds) : null,
        tee: group?.tee_time || "",
        group: group?.group_number || 999,
        buggy: r.buggy,
      };
    })
    .sort((a, c) => a.group - c.group || a.name.localeCompare(c.name));
  const warning = notice(),
    missing = players.filter((p) => p.handicap === null).length;
  area.innerHTML = `<div class="scorecard-print"><p class="eyebrow">ROUND ${event.round_number} · ADMIN SCORECARD LIST</p><h2>Setup next round score cards</h2><h3>${e(event.name)}</h3><p>${e(b.date(event.date))} · ${players.length} confirmed players · ${e(event.location || "")}</p>${warning}${missing ? `<p class="notice">${missing} player${missing > 1 ? "s need" : " needs"} a starting handicap. Set this in Starting handicaps before writing the cards.</p>` : ""}${event.tee_times_dirty ? '<p class="notice">The RSVP list has changed since tee times were published. Check and republish tee groups.</p>' : ""}<p class="muted">Copy each name and society handicap onto their card. Waiting-list and declined players are excluded. ${teeGroups.length ? "Ordered by tee group." : "Tee groups have not been published; listed alphabetically."}</p><div class="table-scroll"><table class="scorecard-table"><thead><tr><th>Done</th><th>Member name</th><th>Round ${event.round_number} HCP</th><th>Tee time</th><th>Travel</th></tr></thead><tbody>${players.map((p) => `<tr><td><input type="checkbox" aria-label="Card written for ${e(p.name)}"></td><th scope="row">${e(p.name)}</th><td class="card-hcp">${p.handicap ?? "NOT SET"}</td><td>${e(p.tee || "Not assigned")}</td><td>${p.buggy ? "Buggy" : "Walking"}</td></tr>`).join("")}</tbody></table></div>${players.length ? "" : "<p>No confirmed players yet.</p>"}<small>Prepared ${e(new Date().toLocaleString("en-GB"))}. Refresh after changing RSVPs or scores.</small></div><div class="actions section"><button id="printScorecards" ${players.length ? "" : "disabled"}>Print scorecard list</button><button id="downloadScorecards" class="secondary" ${players.length ? "" : "disabled"}>Download CSV</button><button id="refreshScorecards" class="secondary">Refresh list</button></div>`;
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
