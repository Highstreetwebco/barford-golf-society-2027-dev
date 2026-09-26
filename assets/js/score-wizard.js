import {
  adjustment,
  roundAverage,
  handicapAt,
} from "./league-rules.js?v=2027-guests-1";
const b = await window.barfordReady,
  e = b.escape;
export function openScoreWizard({
  event,
  season,
  entries,
  winner,
  onSaved,
  onClose,
}) {
  const list = entries
    .map((x) => ({ ...x }))
    .sort((a, c) =>
      (
        season.players.find((p) => p.id === a.user_id)?.name || ""
      ).localeCompare(
        season.players.find((p) => p.id === c.user_id)?.name || "",
      ),
    );
  let index = list.findIndex((x) => x.status === "pending"),
    busy = false,
    changed = false;
  if (index < 0) index = list.length;
  const dialog = document.createElement("dialog");
  dialog.className = "score-wizard";
  dialog.setAttribute("aria-labelledby", "wizardTitle");
  document.body.append(dialog);
  dialog.addEventListener("cancel", (ev) => {
    ev.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose();
  });
  function close() {
    if (
      !busy &&
      (!changed ||
        confirm(
          "Discard this unconfirmed entry? Previously confirmed scores are saved.",
        ))
    )
      dialog.close();
  }
  function person(x) {
    return season.players.find((p) => p.id === x.user_id);
  }
  function preview(x, all) {
    const p = person(x),
      h = p ? handicapAt(p, event.round_number, season.rounds) : null,
      avg = roundAverage(all);
    if (h === null)
      return "Starting handicap not set. Set it before completing the round.";
    if (x.status === "dnp") return `Did not play · handicap stays ${h}.`;
    if (
      x.status !== "played" ||
      !Number.isInteger(x.points) ||
      x.points < 1 ||
      x.points > 108
    )
      return `Round handicap: ${h}. Enter a score to see the preview.`;
    if (avg === null)
      return `Round handicap: ${h}. Adjustment available after at least four played scores. The final adjustment needs every score.`;
    const adj = adjustment(x.points, avg, h),
      pending = all.some((a) => a.status === "pending");
    return `${pending ? "Provisional" : "Calculated"} change: ${adj > 0 ? "+" : ""}${adj} · next handicap ${Math.max(0, h + adj)}. Average so far: ${avg}.`;
  }
  async function save(publish) {
    busy = true;
    dialog
      .querySelectorAll("button,input,select")
      .forEach((x) => (x.disabled = true));
    try {
      const { data, error } = await b.client.rpc("league_save_round", {
        event: event.id,
        entries: list,
        chosen_winner: winner || null,
        publish,
        expected_revision: season.revision,
      });
      if (error) throw error;
      season = data;
      changed = false;
      onSaved(data);
      return true;
    } catch (error) {
      dialog.querySelector("[role=status]").textContent = error.message;
      return false;
    } finally {
      busy = false;
      dialog
        .querySelectorAll("button,input,select")
        .forEach((x) => (x.disabled = false));
      if (dialog.querySelector("#wizardDnp")?.checked)
        dialog.querySelector("#wizardPoints").disabled = true;
    }
  }
  function render() {
    changed = false;
    if (index >= list.length) {
      renderComplete();
      return;
    }
    const x = list[index],
      p = person(x);
    dialog.innerHTML = `<form><p class="eyebrow">ROUND ${event.round_number} · PLAYER ${index + 1} OF ${list.length}</p><h2 id="wizardTitle">${e(p?.name || "Member")}</h2><p class="muted">Confirm saves this entry privately and moves to the next player.</p><label for="wizardPoints">Stableford points</label><input id="wizardPoints" type="number" inputmode="numeric" min="0" max="108" step="1" value="${x.points ?? ""}" ${x.status === "dnp" ? "disabled" : ""}><label class="wizard-dnp"><input id="wizardDnp" type="checkbox" ${x.status === "dnp" ? "checked" : ""}>Did not play (DNP)</label><p id="wizardPreview" class="notice" aria-live="polite"></p><small>Adjustments depend on the whole field. Previews may change as the remaining scores are entered.</small><p role="status" class="form-status"></p><div class="actions"><button type="submit">Confirm &amp; next</button><button type="button" class="secondary" id="wizardBack" ${index === 0 ? "hidden" : ""}>Back</button><button type="button" class="text-button" id="wizardClose">Save &amp; close</button></div></form>`;
    const input = dialog.querySelector("#wizardPoints"),
      dnp = dialog.querySelector("#wizardDnp");
    function current() {
      const zero = input.value !== "" && Number(input.value) === 0;
      return {
        ...x,
        status:
          dnp.checked || zero
            ? "dnp"
            : input.value === ""
              ? "pending"
              : "played",
        points:
          dnp.checked || zero || input.value === ""
            ? null
            : Number(input.value),
      };
    }
    function update() {
      changed = true;
      input.disabled = dnp.checked;
      const row = current(),
        all = list.map((a, i) => (i === index ? row : a));
      dialog.querySelector("#wizardPreview").textContent = preview(row, all);
    }
    input.oninput = update;
    dnp.onchange = update;
    update();
    changed = false;
    dialog.querySelector("form").onsubmit = async (ev) => {
      ev.preventDefault();
      const row = current();
      if (row.status === "pending") {
        dialog.querySelector("[role=status]").textContent =
          "Enter a score or choose Did not play.";
        return;
      }
      list[index] = row;
      if (await save(false)) {
        index++;
        render();
      }
    };
    dialog.querySelector("#wizardBack").onclick = () => {
      if (!changed || confirm("Discard this unconfirmed entry and go back?")) {
        index--;
        render();
      }
    };
    dialog.querySelector("#wizardClose").onclick = async () => {
      if (!dialog.querySelector("form").reportValidity()) return;
      list[index] = current();
      if (await save(false)) dialog.close();
    };
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
  function renderComplete() {
    const absent = season.players.filter(
      (p) => !list.some((x) => x.user_id === p.id),
    );
    const played = list.filter((x) => x.status === "played"),
      high = Math.max(...played.map((x) => x.points)),
      leaders = played.filter((x) => x.points === high);
    dialog.innerHTML = `<form><p class="eyebrow">ROUND ${event.round_number} · FINAL REVIEW</p><h2 id="wizardTitle">Complete round ${event.round_number}</h2><p>Review the final adjustments below. Completing the round publishes the results and updates the leaderboard and next-round handicaps.</p>${season.rounds.some((r) => r.event_id === event.id && r.published_entries) ? '<p class="notice">This replaces the published results and recalculates subsequent rounds.</p>' : ""}<p class="notice">${played.length} played scores · ${list.filter((x) => x.status === "dnp").length + absent.length} DNP · round average ${roundAverage(list) ?? "not available"}</p><details><summary>Review all scores and final adjustments</summary><div class="wizard-review section">${list.map((x, i) => `<article><strong>${e(person(x)?.name || "Member")} · ${x.points ?? "DNP"}</strong><p>${e(preview(x, list))}</p><button type="button" class="text-button" data-review-player="${i}">Edit ${e(person(x)?.name || "player")}</button></article>`).join("")}</div></details><details><summary>${absent.length} ${absent.length === 1 ? "non-participant" : "non-participants"} automatically marked DNP</summary><p>${absent.map((p) => e(p.name)).join(", ") || "Everyone is included in the score sheet."}</p><p>No score counted and no handicap adjustment.</p></details>${leaders.length > 1 ? `<label for="wizardWinner">Round winner — tied on ${high} points</label><select id="wizardWinner" required><option value="">Choose after countback</option>${leaders.map((x) => `<option value="${x.user_id}" ${winner === x.user_id ? "selected" : ""}>${e(person(x)?.name)}</option>`).join("")}</select>` : ""}<p role="status" class="form-status"></p><div class="actions wizard-final-actions"><button type="submit">Complete round</button><button type="button" class="secondary" id="wizardClose">Close — keep draft</button></div></form>`;
    dialog.querySelectorAll("[data-review-player]").forEach(
      (btn) =>
        (btn.onclick = () => {
          index = Number(btn.dataset.reviewPlayer);
          render();
        }),
    );
    dialog.querySelector("#wizardWinner")?.addEventListener("change", (ev) => {
      winner = ev.target.value;
      changed = true;
    });
    dialog.querySelector("#wizardClose").onclick = async () => {
      if (changed) {
        if (await save(false)) dialog.close();
      } else dialog.close();
    };
    dialog.querySelector("form").onsubmit = async (ev) => {
      ev.preventDefault();
      if (await save(true)) {
        dialog.close();
        b.toast(
          `Round ${event.round_number} complete. Results and handicaps updated.`,
        );
      }
    };
  }
  render();
  dialog.showModal();
}
