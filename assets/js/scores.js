await window.barfordReady;

const SUPABASE_URL = "https://xspzmthygrajzktydvvj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c";
const supabaseClient = window.barford.client;
let unlocked = false;
let currentRound = 1;
const maxRounds = 7;

let players = [];
let currentHcp = [];
let nextHcp = [];
let trophies = [];
let lastAdj = [];
let playerScores = [];
let playerHcpHistory = [];
let playerAdjHistory = [];
let playerNextHcpHistory = [];
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.opacity = 1;
  setTimeout(() => (t.style.opacity = 0), 2500);
}

function toCSV(arr) {
  if (!arr.length) return "";

  // ✅ Get column headers from keys
  const headers = Object.keys(arr[0]);

  // ✅ Header row
  const headerRow = headers.join(",");

  // ✅ Data rows
  const rows = arr.map((obj) =>
    headers
      .map((h) => `"${(obj[h] ?? "").toString().replace(/"/g, '""')}"`)
      .join(","),
  );

  return [headerRow, ...rows].join("\n");
}

function stablefordAdj(pts) {
  if (pts >= 43) return -3;
  if (pts >= 38) return -2;
  if (pts >= 31) return -1;
  if (pts >= 26) return 0;
  if (pts >= 21) return +1;
  if (pts >= 16) return +2;
  return +3;
}

async function loadData() {
  console.log("Loading players...");
  document.body.style.cursor = "wait";

  const { data: roster, error: rErr } = await supabaseClient
    .from("players")
    .select("name")
    .order("name", { ascending: true });

  console.log("roster data:", roster, "error:", rErr);

  if (rErr) {
    alert("Error loading players: " + rErr.message);
    document.body.style.cursor = "default";
    return;
  }

  players = (roster || []).map((r) => r.name);

  currentHcp = players.map(() => 0);
  nextHcp = players.map(() => null);
  trophies = players.map(() => 0);
  lastAdj = players.map(() => "");
  playerScores = players.map(() => Array(maxRounds).fill(null));
  playerHcpHistory = players.map(() => Array(maxRounds).fill(null));
  playerAdjHistory = players.map(() => Array(maxRounds).fill(null));
  playerNextHcpHistory = players.map(() => Array(maxRounds).fill(null));
  const { data: scores, error: sErr } = await supabaseClient
    .from("scores")
    .select("*");
  trophies = players.map(() => 0);

  (scores || []).forEach((r) => {
    if (r.winner) {
      const i = players.indexOf(r.player);
      if (i !== -1) {
        trophies[i]++;
      }
    }
  });

  if (sErr) {
    console.error("Error loading scores:", sErr);
    document.body.style.cursor = "default";
    return;
  }

  players.forEach((name, i) => {
    const rows = scores.filter((r) => r.player === name);
    rows.forEach((r) => {
      const idx = r.round - 1;
      playerScores[i][idx] = r.points;
      if (r.handicap != null) {
        playerHcpHistory[i][r.round - 1] = r.handicap;
      }
      if (r.next_handicap != null) {
        playerNextHcpHistory[i][r.round - 1] = r.next_handicap;

        // ✅ ADD THIS LINE
        nextHcp[i] = r.next_handicap;
      }

      if (r.adj != null) {
        playerAdjHistory[i][r.round - 1] = (r.adj > 0 ? "+" : "") + r.adj;
      }
    });
  });
  players.forEach((_, i) => {
    const prevRound = currentRound - 1;

    if (prevRound > 0 && playerNextHcpHistory[i][prevRound - 1] != null) {
      currentHcp[i] = playerNextHcpHistory[i][prevRound - 1];
    } else {
      currentHcp[i] = playerHcpHistory[i][0] ?? 0;
    }
  });

  // 🏆 TROPHY LOGIC (FIXED)

  // THEN RENDER
  document.getElementById("emptyScores").style.display = players.length
    ? "none"
    : "block";
  document.getElementById("tableContainer").style.display = players.length
    ? "block"
    : "none";
  renderLeaderboard();
  renderStatsGrid();
  renderHandicapHistory();
  document.body.style.cursor = "default";
}

function renderLeaderboard() {
  const tbody = document.getElementById("playersTable");
  tbody.innerHTML = "";

  const totals = players
    .map((name, i) => {
      const vals = playerScores[i]
        .filter((v) => v != null)
        .sort((a, b) => b - a)
        .slice(0, 5);
      const sum = vals.reduce((a, b) => a + b, 0);
      return { idx: i, name, total: sum };
    })
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total; // sort by score first
      }
      return trophies[b.idx] - trophies[a.idx]; // 🏆 tiebreaker
    });

  totals.forEach((p, rank) => {
    const i = p.idx;
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${rank < 3 ? ["🥇", "🥈", "🥉"][rank] : rank + 1}</td>
      <td>${window.barford.escape(players[i])}</td>
     <td><input type="number" id="hcp_${i}" value="${
       currentRound > 1
         ? (playerNextHcpHistory[i][currentRound - 2] ?? currentHcp[i])
         : (playerHcpHistory[i][0] ?? currentHcp[i])
     }" ${unlocked ? "" : "disabled"}></td>
      <td><input type="number" id="pts_${i}" value="${playerScores[i][currentRound - 1] ?? ""}" ${unlocked ? "" : "disabled"}></td>
      <td>${playerAdjHistory[i][currentRound - 1] ?? ""}</td>
<td>${playerNextHcpHistory[i][currentRound - 1] ?? ""}</td>
      <td>${p.total}</td>
      <td>
        <input type="checkbox" disabled
          ${playerScores[i][currentRound - 1] == null || lastAdj[i] === "DNP" ? "checked" : ""}
        >
      </td>
      <td>🏆 ${trophies[i]}</td>
    `;

    tbody.appendChild(tr);
  });

  if (!unlocked)
    tbody.querySelectorAll('input[type="number"]').forEach((input) => {
      const span = document.createElement("span");
      span.textContent = input.value || "—";
      input.replaceWith(span);
    });
  // Render round navigation

  document.getElementById("roundHeader").innerText =
    `Round ${currentRound} of ${maxRounds}`;
  document.getElementById("hcpHeader").innerText = `Round ${currentRound} HCP`;
  document.getElementById("progressFill").style.width =
    `${(currentRound / maxRounds) * 100}%`;

  // SECRET ROUNDS (6 & 7)
  const wrap = document.getElementById("playersTableWrap");
  const secretNotice = document.getElementById("secretNotice");
  if ((currentRound === 6 || currentRound === 7) && !unlocked) {
    wrap.classList.add("table-secret");
    secretNotice.hidden = false;
  } else {
    wrap.classList.remove("table-secret");
    secretNotice.hidden = true;
  }
} // ✅ THIS CLOSES renderLeaderboard()

function nextRound() {
  if (currentRound < maxRounds) {
    currentRound++;
    console.log("Moved to next round:", currentRound);

    for (let i = 0; i < players.length; i++) {
      const prevRound = currentRound - 1;

      if (playerNextHcpHistory[i][prevRound] != null) {
        currentHcp[i] = playerNextHcpHistory[i][prevRound];
      }
      lastAdj[i] = "";
    }

    renderLeaderboard();
  } else {
    showToast("⛳ Already at final round");
  }
}

async function unlockInputs() {
  if (!(await window.barford.requireAdmin())) return;
  unlocked = true;
  document.getElementById("scoreAdminActions").hidden = false;
  [
    "exportLeaderboardBtn",
    "exportAllBtn",
    "exportStatsBtn",
    "clearLeagueBtn",
    "removePlayerBtn",
  ].forEach(
    (id) => (document.getElementById(id).style.display = "inline-block"),
  );
  renderLeaderboard();
  showToast("✅ Admin unlocked");
}

function lockInputs() {
  unlocked = false;
  document.getElementById("scoreAdminActions").hidden = true;

  [
    "exportLeaderboardBtn",
    "exportAllBtn",
    "exportStatsBtn",
    "clearLeagueBtn",
    "removePlayerBtn",
  ].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = "none";
  });

  renderLeaderboard();
  showToast("🔒 Admin locked");
}

function prevRound() {
  if (currentRound > 1) {
    currentRound--;
    renderLeaderboard();
  } else {
    showToast("🔙 Already at round 1");
  }
}

function changePassword() {}

async function addPlayer() {
  if (!unlocked) return alert("Unlock first");

  const name = prompt("Enter player name:");
  if (!name) return;

  const { error } = await supabaseClient.from("players").upsert({ name });

  if (error) {
    alert("Error adding player: " + error.message);
  } else {
    showToast("✅ Player added");
    await loadData();
  }
}

async function removePlayer() {
  if (!unlocked) return alert("Unlock first");

  const name = prompt("Enter player name to remove:");
  if (!name) return;

  if (!confirm(`Remove ${name}?`)) return;

  const { error } = await supabaseClient
    .from("players")
    .delete()
    .eq("name", name);

  if (error) {
    alert("Error removing player: " + error.message);
  } else {
    showToast("✅ Player removed");
    await loadData();
  }
}

async function confirmReset() {
  if (!unlocked) return alert("Unlock first");

  if (!(await window.barford.requireAdmin())) return;

  if (!confirm("Reset ALL scores?")) return;

  const { error } = await supabaseClient.rpc("reset_scores");

  if (error) {
    alert("Reset failed: " + error.message);
  } else {
    showToast("✅ League reset");
    currentRound = 1;
    await loadData();
  }
}

async function calculateHandicaps() {
  if (!unlocked) return alert("Unlock required");
  console.log("=== CalculateHandicaps Round", currentRound);

  // ✅ FIX 1 — ADD average calculation
  let roundScores = [];
  for (let i = 0; i < players.length; i++) {
    const ptsVal = parseInt(document.getElementById(`pts_${i}`)?.value);
    if (!isNaN(ptsVal)) {
      roundScores.push(ptsVal);
    }
  }

  if (roundScores.length < 4) {
    return alert("Minimum 4 players required for handicap calculation");
  }

  // ✅ REMOVE OUTLIERS (highest & lowest)

  let trimmedScores = [...roundScores];

  // Only trim if enough players
  if (trimmedScores.length > 4) {
    trimmedScores.sort((a, b) => a - b);
    trimmedScores = trimmedScores.slice(1, -1); // remove lowest & highest
  }

  const avg = Math.round(
    trimmedScores.reduce((a, b) => a + b, 0) / trimmedScores.length,
  );
  console.log("Round Average:", avg);

  for (let i = 0; i < players.length; i++) {
    const hcpVal = parseFloat(document.getElementById(`hcp_${i}`)?.value) || 0;
    const ptsVal = parseInt(document.getElementById(`pts_${i}`)?.value);
    console.log("Player:", players[i], "hcp:", hcpVal, "pts:", ptsVal);

    if (!isNaN(ptsVal)) {
      // 🟡 DNP RULE
      if (ptsVal === 0) {
        lastAdj[i] = "DNP";
        nextHcp[i] = hcpVal; // no change
        playerScores[i][currentRound - 1] = null; // no score counted
        currentHcp[i] = hcpVal;
        continue; // skip rest of logic
      }

      const diff = ptsVal - avg;

      let baseAdj = 0;

      if (diff >= 10) baseAdj = -4;
      else if (diff >= 8) baseAdj = -3;
      else if (diff >= 6) baseAdj = -2;
      else if (diff >= 4) baseAdj = -1;
      else if (diff >= 2) baseAdj = -0.5;
      else if (diff >= -1) baseAdj = 0;
      else if (diff >= -3) baseAdj = +0.5;
      else if (diff >= -5) baseAdj = +1;
      else if (diff >= -7) baseAdj = +2;
      else if (diff >= -9) baseAdj = +3;
      else baseAdj = +4;

      let multiplier = 1;
      if (hcpVal <= 9) multiplier = 0.5;
      else if (hcpVal <= 18) multiplier = 0.75;
      else if (hcpVal <= 28) multiplier = 1.0;
      else multiplier = 1.25;

      let adj = baseAdj * multiplier;

      adj = Math.round(adj);

      if (adj < -3) adj = -3;
      if (adj > 2) adj = 2;

      lastAdj[i] = adj > 0 ? `+${adj}` : `${adj}`;
      nextHcp[i] = Math.max(0, hcpVal + adj);
      playerAdjHistory[i][currentRound - 1] = lastAdj[i];
      playerNextHcpHistory[i][currentRound - 1] = nextHcp[i];
      playerScores[i][currentRound - 1] = ptsVal;
      currentHcp[i] = hcpVal;
      playerHcpHistory[i][currentRound - 1] = hcpVal;
    }
  }

  // 🏆 DETERMINE WINNER FIRST

  let winnerIndex = null;

  let topScore = -Infinity;
  let winners = [];

  for (let i = 0; i < players.length; i++) {
    const pts = playerScores[i][currentRound - 1];

    if (pts != null) {
      if (pts > topScore) {
        topScore = pts;
        winners = [i];
      } else if (pts === topScore) {
        winners.push(i);
      }
    }
  }

  // SINGLE WINNER
  if (winners.length === 1) {
    winnerIndex = winners[0];
  }

  // TIE → prompt
  else if (winners.length > 1) {
    let message = `Round ${currentRound} tie!\nSelect winner:\n\n`;

    winners.forEach((i, idx) => {
      message += `${idx + 1}. ${window.barford.escape(players[i])} (${topScore} pts)\n`;
    });

    let choice = prompt(message);
    winnerIndex = winners[parseInt(choice) - 1];
  }

  // APPLY TROPHY
  if (winnerIndex != null) {
    trophies[winnerIndex]++;
    showToast(`🏆 ${players[winnerIndex]} wins Round ${currentRound}!`);
  }
  const updates = players.map((name, i) => {
    const vals = playerScores[i]
      .filter((v) => v != null)
      .sort((a, b) => b - a)
      .slice(0, 5);
    const total = vals.reduce((a, b) => a + b, 0);
    return {
      player: name,
      round: currentRound,
      handicap: currentHcp[i],
      points: playerScores[i][currentRound - 1],
      adj: lastAdj[i] === "DNP" ? null : parseInt(lastAdj[i]),
      next_handicap: nextHcp[i],
      total: total,
      winner: winnerIndex === i, // ✅ THIS LINE
    };
  });

  const { data, error } = await supabaseClient
    .from("scores")
    .upsert(updates, { onConflict: "player,round" });

  if (error) {
    console.error("Upsert error:", error);
    alert("⚠️ Error saving data: " + error.message);
  } else {
    showToast("✅ Scores & handicaps updated");
  }

  await loadData();
}

async function exportAllCSV() {
  const { data } = await supabaseClient.from("scores").select("*");
  downloadCSV("all_scores", toCSV(data || []));
}

async function exportLeaderboardCSV() {
  const rows = players.map((name, i) => {
    const vals = playerScores[i]
      .filter((v) => v != null)
      .sort((a, b) => b - a)
      .slice(0, 5);

    return {
      Player: name,
      Total: vals.reduce((a, b) => a + b, 0),
      Trophies: trophies[i],
    };
  });

  // ✅ SORT BY TOTAL (DESCENDING)
  rows.sort((a, b) => b.Total - a.Total);

  downloadCSV("leaderboard", toCSV(rows));
}

function exportStatsCSV() {
  const rows = players.map((name, i) => {
    const vals = playerScores[i].filter((v) => v != null);
    return {
      Player: name,
      Rounds: vals.length,
      Average: vals.length
        ? (vals.reduce((a, b) => a + b) / vals.length).toFixed(1)
        : "",
      Best: vals.length ? Math.max(...vals) : "",
      Worst: vals.length ? Math.min(...vals) : "",
      Trophies: trophies[i],
    };
  });
  downloadCSV("stats", toCSV(rows));
}

function downloadCSV(name, csv) {
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

function renderStatsGrid() {
  const grid = document.getElementById("statsGrid");
  grid.innerHTML = "";

  players.forEach((name, i) => {
    const vals = playerScores[i].filter((v) => v != null);

    const card = document.createElement("div");
    card.className = "stats-card";

    card.innerHTML = `
      <h4>${window.barford.escape(name)}</h4>
      <p>Rounds: ${vals.length}</p>
      <p>Avg: ${vals.length ? (vals.reduce((a, b) => a + b) / vals.length).toFixed(1) : "-"}</p>
      <p>Best: ${vals.length ? Math.max(...vals) : "-"}</p>
      <p>Worst: ${vals.length ? Math.min(...vals) : "-"}</p>
      <p>🏆 ${trophies[i]}</p>
    `;

    grid.appendChild(card);
  });
}

loadData();

window.showToast = showToast;
window.toCSV = toCSV;
window.stablefordAdj = stablefordAdj;
window.loadData = loadData;
window.renderLeaderboard = renderLeaderboard;
window.nextRound = nextRound;
window.unlockInputs = unlockInputs;
window.lockInputs = lockInputs;
window.prevRound = prevRound;
window.changePassword = changePassword;
window.addPlayer = addPlayer;
window.removePlayer = removePlayer;
window.confirmReset = confirmReset;
window.calculateHandicaps = calculateHandicaps;
window.exportAllCSV = exportAllCSV;
window.exportLeaderboardCSV = exportLeaderboardCSV;
window.exportStatsCSV = exportStatsCSV;
window.downloadCSV = downloadCSV;
window.renderStatsGrid = renderStatsGrid;

function renderHandicapHistory() {
  const area = document.getElementById("handicapHistory");
  area.innerHTML = players.length
    ? '<div class="table-scroll"><table><thead><tr><th>Player</th>' +
      Array.from({ length: 7 }, (_, i) => "<th>R" + (i + 1) + "</th>").join(
        "",
      ) +
      "</tr></thead><tbody>" +
      players
        .map(
          (name, i) =>
            "<tr><th>" +
            window.barford.escape(name) +
            "</th>" +
            playerHcpHistory[i]
              .map((h) => "<td>" + (h ?? "—") + "</td>")
              .join("") +
            "</tr>",
        )
        .join("") +
      "</tbody></table></div>"
    : '<p class="muted">Handicap history will appear after scores are recorded.</p>';
}
