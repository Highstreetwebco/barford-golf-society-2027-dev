(() => {
 const client=window.BarfordSupabase; let session,legacyCandidate;
 const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
 const show=(id,on=true)=>document.getElementById(id)?.classList.toggle('hidden',!on);
  const ordinal = value => {
    const remainder = value % 100;
    if (remainder >= 11 && remainder <= 13) return `${value}th`;
    return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
  };
  const feedback = (stats, season = 2026) => {
    if (!stats) return "We could not find a matching name in the 2026 scores. If you are a new member, this is completely normal and your 2027 results will build here.";
    if (!stats.rounds) return "Your name is on the 2026 list, but no completed score was found. Your new 2027 results will appear here.";
    if (stats.position === 1) return `Outstanding season — you currently lead the ${season} table with ${stats.points} points from your best five rounds.`;
    if (stats.position <= 3) return `Excellent season — you are currently ${ordinal(stats.position)} with ${stats.points} points and ${stats.topThreeFinishes} top-three finish${stats.topThreeFinishes === 1 ? "" : "es"}.`;
    if (stats.best >= 36) return `Your best round is an excellent ${stats.best} points. You sit ${ordinal(stats.position)} overall with an average of ${stats.average}.`;
    return `You have completed ${stats.rounds} round${stats.rounds === 1 ? "" : "s"}, averaging ${stats.average} points. Your best score so far is ${stats.best}.`;
  };

  const showStats = (stats, season = 2026) => {
    document.getElementById("seasonDashboardCard")?.classList.remove("is-unavailable");
    document.getElementById("seasonDashboardCard")?.classList.remove("is-awaiting-match");
    show("dashboardRetry2026", false);
    set("legacyPlayerName", stats.name);
    set("legacyPosition", stats.position ? `#${stats.position}` : "N/A");
    set("legacyPoints", stats.points ?? "N/A");
    set("legacyBest", stats.best ?? "N/A");
    set("legacyAverage", stats.average ?? "N/A");
    set("legacyRounds", stats.rounds ?? "N/A");
    set("legacyHandicap", stats.handicap ?? "N/A");
    set("legacyWins", stats.wins ?? 0);
    set("legacyTopThree", stats.topThreeFinishes ?? 0);
    set("legacyTrend", Number.isFinite(stats.trend) ? `${stats.trend > 0 ? "+" : ""}${stats.trend} pts` : "N/A");
    set("legacyFeedback", feedback(stats, season));
  };

  const get2027Stats = async () => {
    const { data: ownScores, error } = await client.from("scores")
      .select("member_id,points,next_handicap,winner,runner_up,third_place,round_id,rounds!inner(season,round_number)")
      .eq("member_id", session.user.id)
      .eq("rounds.season", 2027)
      .eq("dnp", false);
    if (error || !ownScores?.length) return null;
    const { data: seasonScores } = await client.from("scores")
      .select("member_id,points,winner,rounds!inner(season)")
      .eq("rounds.season", 2027)
      .eq("dnp", false);
    const totals = new Map();
    (seasonScores || []).forEach(score => {
      if (!Number.isFinite(Number(score.points))) return;
      const current = totals.get(score.member_id) || { scores: [], wins: 0 };
      current.scores.push(Number(score.points));
      if (score.winner) current.wins += 1;
      totals.set(score.member_id, current);
    });
    const leaderboard = [...totals.entries()].map(([memberId, value]) => ({
      memberId,
      total: value.scores.sort((a, b) => b - a).slice(0, 5).reduce((sum, points) => sum + points, 0),
      wins: value.wins
    })).sort((a, b) => b.total - a.total || b.wins - a.wins);
    const rows = ownScores.filter(score => Number.isFinite(Number(score.points)))
      .sort((a, b) => Number(a.rounds?.round_number) - Number(b.rounds?.round_number));
    const points = rows.map(score => Number(score.points));
    const total = leaderboard.find(row => row.memberId === session.user.id);
    return {
      name: "Your 2027 performance",
      position: leaderboard.findIndex(row => row.memberId === session.user.id) + 1,
      points: total?.total || 0,
      best: Math.max(...points),
      average: Math.round((points.reduce((sum, value) => sum + value, 0) / points.length) * 10) / 10,
      rounds: rows.length,
      handicap: rows[rows.length - 1]?.next_handicap ?? "N/A",
      wins: rows.filter(row => row.winner).length,
      topThreeFinishes: rows.filter(row => row.winner || row.runner_up || row.third_place).length,
      trend: points[points.length - 1] - points[0],
      latestScore: points[points.length - 1]
    };
  };

  const loadLegacyStats = async () => {
    try {
      const currentSeason = await get2027Stats();
      if (currentSeason) {
        set("seasonDashboardEyebrow", "Your current season");
        set("seasonDashboardYear", "2027");
        set("dashboardDataSource", "Your live 2027 society results");
        show("legacyMatchPrompt", false);
        showStats(currentSeason, 2027);
        return;
      }
      const { data, error } = await client.functions.invoke("legacy-2026-stats", { body: { action: "suggest" } });
      if (error) throw error;
      if (data?.status === "confirm" && data.candidate?.name) {
        legacyCandidate = data.candidate.name;
        set("legacyMatchQuestion", `Are you ${legacyCandidate}?`);
        set("legacyPlayerName", "Confirm your 2026 player name");
        set("legacyFeedback", "Once confirmed, your previous-season figures will stay here until the first 2027 results are published.");
        show("legacyMatchPrompt");
        document.getElementById("seasonDashboardCard")?.classList.add("is-awaiting-match");
        return;
      }
      if (data?.status === "declined") {
        document.getElementById("seasonDashboardCard")?.classList.remove("is-awaiting-match");
        set("legacyPlayerName", "2026 results not linked");
        set("legacyFeedback", "No problem—your dashboard will begin building from your first 2027 event.");
        return;
      }
      const stats = data?.stats;
      if (!stats) {
        set("legacyPlayerName", "No 2026 score match");
        set("legacyFeedback", feedback(null));
        return;
      }
      show("legacyMatchPrompt", false);
      showStats(stats);
    } catch (error) {
      console.warn("The read-only 2026 season summary could not be loaded.", error);
      set("legacyPlayerName", "2026 data temporarily unavailable");
      set("legacyFeedback", "Your account is working, but the previous-season connection needs another try.");
      document.getElementById("seasonDashboardCard")?.classList.add("is-unavailable");
      show("dashboardRetry2026");
    }
  };

  const answerLegacyMatch = async confirmed => {
    const status = document.getElementById("legacyMatchStatus");
    document.getElementById("legacyMatchYes").disabled = true;
    document.getElementById("legacyMatchNo").disabled = true;
    if (status) status.textContent = "Saving your choice…";
    const { data, error } = await client.functions.invoke("legacy-2026-stats", {
      body: { action: confirmed ? "confirm" : "decline", legacyName: legacyCandidate }
    });
    if (error) {
      if (status) status.textContent = "We couldn’t save that just now. Please try again.";
      document.getElementById("legacyMatchYes").disabled = false;
      document.getElementById("legacyMatchNo").disabled = false;
      return;
    }
    show("legacyMatchPrompt", false);
    document.getElementById("seasonDashboardCard")?.classList.remove("is-awaiting-match");
    if (confirmed && data?.stats) showStats(data.stats);
    else {
      set("legacyPlayerName", "2026 results not linked");
      set("legacyFeedback", "No problem—your dashboard will start building when the first 2027 results are published.");
    }
  };


 const panel=document.getElementById('mySeasonDetails');let loaded=false;
 panel?.addEventListener('toggle',async()=>{if(!panel.open||loaded)return;try{const auth=await window.BarfordMemberFlow.request(client.auth.getSession());session=auth.session;if(!session)return;loaded=true;await loadLegacyStats();}catch{set('legacyPlayerName','Results could not be loaded');show('dashboardRetry2026');}});
 document.getElementById('legacyMatchYes')?.addEventListener('click',()=>answerLegacyMatch(true));
 document.getElementById('legacyMatchNo')?.addEventListener('click',()=>answerLegacyMatch(false));
 document.getElementById('dashboardRetry2026')?.addEventListener('click',loadLegacyStats);
})();
