(() => {
  "use strict";
  const client = window.BarfordSupabase;
  if (!client || !document.getElementById("accountContent")) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const getProfile = async userId => {
    const { data } = await client.from("profiles").select("id,full_name,playing_category,handicap,photo_url").eq("id", userId).maybeSingle();
    return data;
  };

  const openOnboarding = async (user, profile) => {
    if (!profile) return;
    const needsCategory = !profile.playing_category;
    const photoSkipped = localStorage.getItem("barford-onboarding-photo-skipped") === "1";
    const suggestPhoto = !profile.photo_url && !photoSkipped;
    if (!needsCategory && !suggestPhoto) return;

    const dialog = document.createElement("dialog");
    dialog.className = "member-onboarding-dialog";
    dialog.innerHTML = `<form class="member-onboarding-card" method="dialog">
      <p class="eyebrow">One-time setup</p><h2>Finish your golf details</h2><p>These details make tee groups and live scoring work properly. You only need to do this once.</p>
      <div class="member-onboarding-progress"><span class="done"></span><span class="${needsCategory ? "" : "done"}"></span><span class="done"></span></div>
      <div class="member-onboarding-fields">
        <label>Playing category<select id="onboardingCategory" ${needsCategory ? "required" : ""}><option value="">Select…</option><option value="men">Men’s — yellow tees</option><option value="women">Women’s — red tees</option></select><small>Chooses the correct tee card automatically.</small></label>
        <p>Society handicap: ${profile.handicap == null ? "Awaiting admin. The committee will set this for you." : esc(profile.handicap)}</p>
        ${suggestPhoto ? `<div class="onboarding-photo-choice"><strong>Profile photo</strong><p>A photo makes four-ball groups easier to recognise. It is useful, but not compulsory.</p><label><input id="onboardingSkipPhoto" type="checkbox"> I’ll add a photo later</label></div>` : ""}
      </div>
      <div class="member-onboarding-actions"><button id="onboardingSave" class="button button-primary" type="button">Save and continue</button>${suggestPhoto ? '<button id="onboardingAddPhoto" class="button button-outline" type="button">Add photo now</button>' : ""}</div>
      <p id="onboardingStatus" class="form-status" aria-live="polite"></p>
    </form>`;
    document.body.appendChild(dialog);
    const category = dialog.querySelector("#onboardingCategory");
    category.value = profile.playing_category || "";
    dialog.showModal();

    dialog.querySelector("#onboardingAddPhoto")?.addEventListener("click", () => {
      if (category.value && category.value !== profile.playing_category) {
        client.from("profiles").update({ playing_category: category.value, updated_at: new Date().toISOString() }).eq("id", user.id);
      }
      dialog.close();
      document.getElementById("profile-photo")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => document.querySelector('label[for="accountPhotoInput"]')?.click(), 350);
    });

    dialog.querySelector("#onboardingSave")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const status = dialog.querySelector("#onboardingStatus");
      const selectedCategory = category.value;
      if (!selectedCategory) { status.textContent = "Choose Men’s or Women’s playing category."; return; }
      button.disabled = true; button.textContent = "Saving…"; status.textContent = "";
      const changes = {};
      if (selectedCategory !== profile.playing_category) changes.playing_category = selectedCategory;
      if (Object.keys(changes).length) {
        changes.updated_at = new Date().toISOString();
        const { error } = await client.from("profiles").update(changes).eq("id", user.id);
        if (error) { status.textContent = error.message; button.disabled = false; button.textContent = "Save and continue"; return; }
      }
      if (dialog.querySelector("#onboardingSkipPhoto")?.checked) localStorage.setItem("barford-onboarding-photo-skipped", "1");
      status.textContent = "✓ Account ready.";
      document.getElementById("accountPlayingCategory").value = selectedCategory;
      await wait(450); dialog.close(); dialog.remove();
    });
  };

  const addSeasonStory = async userId => {
    const panel = document.querySelector(".account-scores-panel");
    if (!panel || panel.querySelector(".account-season-story")) return;
    const { data, error } = await client.from("scores").select("points,winner,runner_up,third_place,next_handicap,rounds(round_number)").eq("member_id", userId);
    if (error) return;
    const scores = (data || []).filter(item => item.points != null);
    const best = scores.length ? Math.max(...scores.map(item => Number(item.points))) : null;
    const podiums = scores.filter(item => item.winner || item.runner_up || item.third_place).length;
    const latest = [...scores].sort((a,b) => Number(a.rounds?.round_number || 0) - Number(b.rounds?.round_number || 0)).at(-1);
    const card = document.createElement("section");
    card.className = "account-season-story";
    card.innerHTML = scores.length ? `<p class="eyebrow">Your season so far</p><h3>${scores.length === 1 ? "First card on the board" : `${scores.length} rounds into 2027`}</h3><p>Your season builds here automatically as each round is completed.</p><div class="season-story-stats"><div><strong>${best}</strong><span>Best points</span></div><div><strong>${podiums}</strong><span>Podiums</span></div><div><strong>${latest?.next_handicap ?? "—"}</strong><span>Current HCP</span></div></div>` : `<p class="eyebrow">Your 2027 story</p><h3>Ready for the first round</h3><p>Your best score, podium finishes and handicap journey will appear here automatically once the season starts.</p>`;
    panel.appendChild(card);
  };

  const start = async () => {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    for (let i=0;i<20;i+=1) {
      if (!document.getElementById("accountContent")?.classList.contains("hidden")) break;
      await wait(100);
    }
    const profile = await getProfile(session.user.id);
    await addSeasonStory(session.user.id);
    await openOnboarding(session.user, profile);
  };
  start();
})();
