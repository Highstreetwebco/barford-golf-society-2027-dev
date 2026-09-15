(() => {
  "use strict";
  const client = window.BarfordSupabase;
  if (!client) return;

  const login = document.querySelector("#adminLoginPanel");
  const dashboard = document.querySelector("#adminDashboard");
  const denied = document.querySelector("#adminDenied");
  const status = document.querySelector("#adminLoginStatus");
  const dialog = document.querySelector("#adminAccessDialog");
  const confirmCheck = document.querySelector("#adminAccessConfirmCheck");
  const confirmButton = document.querySelector("#adminAccessConfirm");
  let signedInProfile;
  let pendingChange;
  let adminEvents = [];
  let adminRounds = [];
  let teeGroups = [];
  let editingRsvp;
  let currentRsvpEventId;
  let cancellingEvent;
  let courseSearchTimer;
  let selectedCourse;

  const initials = name => String(name || "BG").split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0].toUpperCase()).join("");
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const setStatus = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };
  const timeValue = value => value ? String(value).slice(0, 5) : "";
  const cancelMarker = "[BARFORD_CANCEL_REASON] ";
  const cancellationReasonFromNotes = notes => {
    const text = String(notes || "");
    const index = text.lastIndexOf(cancelMarker);
    return index >= 0 ? text.slice(index + cancelMarker.length).trim() : "";
  };
  const notesWithoutCancellation = notes => {
    const text = String(notes || "");
    const index = text.lastIndexOf(cancelMarker);
    return (index >= 0 ? text.slice(0, index) : text).trim() || null;
  };
  const localDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const activeEvents = () => adminEvents.filter(event => event.event_date >= localDate());
  const nextRoundNumber = () => {
    const used = new Set(adminRounds.map(round => Number(round.round_number)).filter(Number.isFinite));
    for (let round = 1; round <= 7; round += 1) if (!used.has(round)) return round;
    return Math.max(0, ...used) + 1;
  };
  const eventOptions = () => `<option value="">Select event</option>${activeEvents().map(event =>
    `<option value="${event.id}">${escapeHtml(event.name)} · ${escapeHtml(event.event_date)}</option>`
  ).join("")}`;

  document.querySelectorAll("[data-admin-view]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-admin-view]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-admin-panel]").forEach(panel =>
      panel.classList.toggle("hidden", panel.dataset.adminPanel !== button.dataset.adminView)
    );
  }));

  const resetEventForm = () => {
    document.querySelector("#adminEventForm")?.reset();
    document.querySelector("#adminEventId").value = "";
    const search = document.querySelector("#adminCourseSearch");
    if (search) search.value = "";
    selectedCourse = null;
  };

  const loadEvents = async () => {
    const { data, error } = await client.from("events").select("*").order("event_date");
    if (error) {
      setStatus("#adminEventStatus", error.message);
      return;
    }
    adminEvents = data || [];
    const upcoming = activeEvents();
    const past = adminEvents.filter(event => event.event_date < localDate());
    document.querySelector("#adminEventCount").textContent = `${upcoming.length} active`;
    document.querySelector("#adminRsvpEvent").innerHTML = eventOptions();
    document.querySelector("#adminTeeEvent").innerHTML = eventOptions();
    document.querySelector("#adminDropoutEvent").innerHTML = eventOptions();
    refreshRoundEventOptions();
    const list = document.querySelector("#adminEventList");
    const eventRow = (event, isPast = false) => `
      <article class="${event.status === "cancelled" ? "admin-cancelled-event" : ""} ${isPast ? "admin-past-event" : ""}">
        <div><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(event.event_date)} · ${escapeHtml(event.venue)}</small>${event.status === "cancelled" ? `<span class="cancelled-pill">CANCELLED</span>${event.cancel_reason || cancellationReasonFromNotes(event.notes) ? `<small>${escapeHtml(event.cancel_reason || cancellationReasonFromNotes(event.notes))}</small>` : ""}` : ""}</div>
        <div class="admin-row-actions">
          <button type="button" data-edit-event="${event.id}">Edit</button>
          ${isPast ? "" : `<button type="button" data-toggle-event="${event.id}">${event.status === "cancelled" ? "Restore" : "Cancel event"}</button>`}
          <button class="danger-link" type="button" data-delete-event="${event.id}">Delete</button>
        </div>
      </article>`;
    list.innerHTML = upcoming.length ? upcoming.map(event => eventRow(event)).join("") : "<p>No upcoming events. Create the next event here.</p>";
    const pastList = document.querySelector("#adminPastEventList");
    document.querySelector("#adminPastEventCount").textContent = `(${past.length})`;
    pastList.innerHTML = past.length ? [...past].reverse().map(event => eventRow(event, true)).join("") : "<p>No past events yet.</p>";
    [list, pastList].forEach(container => container.querySelectorAll("[data-edit-event]").forEach(button => button.addEventListener("click", () => {
      const event = adminEvents.find(item => item.id === button.dataset.editEvent);
      if (!event) return;
      selectedCourse = { latitude: event.latitude ?? null, longitude: event.longitude ?? null };
      document.querySelector("#adminCourseSearch").value = event.venue || event.name || "";
      document.querySelector("#adminEventId").value = event.id;
      document.querySelector("#adminEventName").value = event.name || "";
      document.querySelector("#adminEventVenue").value = event.venue || "";
      document.querySelector("#adminEventAddress").value = event.address || "";
      document.querySelector("#adminEventDate").value = event.event_date || "";
      document.querySelector("#adminEventFirstTee").value = timeValue(event.first_tee_time);
      document.querySelector("#adminEventPrice").value = event.price ?? "";
      document.querySelector("#adminEventGuestPrice").value = event.guest_price ?? "";
      document.querySelector("#adminEventCourseMemberPrice").value = event.course_member_price ?? "";
      document.querySelector("#adminEventCapacity").value = event.capacity ?? "";
      document.querySelector("#adminEventVideo").value = event.course_video_url || "";
      document.querySelector("#adminEventNotes").value = notesWithoutCancellation(event.notes) || "";
      document.querySelector("#adminEventForm").scrollIntoView({ behavior: "smooth", block: "start" });
    })));
    list.querySelectorAll("[data-toggle-event]").forEach(button => button.addEventListener("click", async () => {
      const event = adminEvents.find(item => item.id === button.dataset.toggleEvent);
      if (event.status === "cancelled") {
        let { error: updateError } = await client.from("events").update({ status: "scheduled", cancel_reason: null, updated_at: new Date().toISOString() }).eq("id", event.id);
        if (updateError && /cancel_reason|column .* does not exist/i.test(updateError.message || "")) {
          ({ error: updateError } = await client.from("events").update({ status: "scheduled", notes: notesWithoutCancellation(event.notes), updated_at: new Date().toISOString() }).eq("id", event.id));
        }
        setStatus("#adminEventStatus", updateError ? updateError.message : `${event.name} has been restored.`);
        if (!updateError) await loadEvents();
        return;
      }
      cancellingEvent = event;
      document.querySelector("#adminCancelEventName").textContent = `Cancel ${event.name}?`;
      document.querySelector("#adminCancelReason").value = "";
      document.querySelector("#adminCancelDetail").value = "";
      setStatus("#adminCancelEventStatus", "");
      document.querySelector("#adminCancelEventDialog")?.showModal();
    }));
    [list, pastList].forEach(container => container.querySelectorAll("[data-delete-event]").forEach(button => button.addEventListener("click", async () => {
      const event = adminEvents.find(item => item.id === button.dataset.deleteEvent);
      if (!confirm(`Permanently delete ${event.name} and its related RSVPs and tee times?`)) return;
      const { error: deleteError } = await client.from("events").delete().eq("id", event.id);
      setStatus("#adminEventStatus", deleteError ? deleteError.message : `${event.name} was deleted.`);
      if (!deleteError) await loadEvents();
    })));
  };

  const closeCancelDialog = () => document.querySelector("#adminCancelEventDialog")?.close();
  document.querySelector("#adminCancelEventClose")?.addEventListener("click", closeCancelDialog);
  document.querySelector("#adminCancelEventBack")?.addEventListener("click", closeCancelDialog);
  document.querySelector("#adminCancelEventForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!cancellingEvent) return;
    const reason = document.querySelector("#adminCancelReason").value;
    const detail = document.querySelector("#adminCancelDetail").value.trim();
    const cancelReason = detail ? `${reason} — ${detail}` : reason;
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "Cancelling…";
    let result = await client.from("events").update({ status: "cancelled", cancel_reason: cancelReason, updated_at: new Date().toISOString() }).eq("id", cancellingEvent.id);
    if (result.error && /cancel_reason|column .* does not exist/i.test(result.error.message || "")) {
      const baseNotes = notesWithoutCancellation(cancellingEvent.notes) || "";
      result = await client.from("events").update({ status: "cancelled", notes: `${baseNotes}${baseNotes ? "\n" : ""}${cancelMarker}${cancelReason}`, updated_at: new Date().toISOString() }).eq("id", cancellingEvent.id);
    }
    button.disabled = false;
    button.textContent = "Cancel event";
    if (result.error) {
      setStatus("#adminCancelEventStatus", result.error.message);
      return;
    }
    setStatus("#adminEventStatus", `${cancellingEvent.name} has been cancelled. Members will see a red CANCELLED banner.`);
    cancellingEvent = null;
    closeCancelDialog();
    await loadEvents();
  });

  const courseMatches = document.querySelector("#adminCourseMatches");
  const renderCourseMatches = matches => {
    if (!courseMatches) return;
    courseMatches.innerHTML = matches.map((course, index) => `<button type="button" role="option" data-course-index="${index}"><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.address || "United Kingdom")}</small></button>`).join("");
    courseMatches.classList.toggle("hidden", !matches.length);
    courseMatches.querySelectorAll("[data-course-index]").forEach(button => button.addEventListener("click", async () => {
      const match = matches[Number(button.dataset.courseIndex)];
      setStatus("#adminCourseSearchStatus", "Loading course details and finding a course video…");
      courseMatches.classList.add("hidden");
      const detailsResult = match.place_id ? await client.functions.invoke("course-lookup", { body: { place_id: match.place_id } }) : { data: null, error: null };
      const course = detailsResult.data?.course || match;
      selectedCourse = course;
      document.querySelector("#adminCourseSearch").value = course.name || match.name || "";
      document.querySelector("#adminEventVenue").value = course.name || match.name || "";
      document.querySelector("#adminEventName").value = course.name || match.name || "";
      document.querySelector("#adminEventAddress").value = course.address || match.address || "";
      document.querySelector("#adminEventNotes").value = course.description || `${course.name || match.name} golf course${course.address ? ` in ${course.address}` : ""}.`;
      document.querySelector("#adminEventVideo").value = course.video_url || "";
      setStatus("#adminCourseSearchStatus", "Course selected. Check the details below, then add the date, price and slots.");
    }));
  };
  document.querySelector("#adminCourseSearch")?.addEventListener("input", event => {
    clearTimeout(courseSearchTimer);
    selectedCourse = null;
    const query = event.target.value.trim();
    if (query.length < 3) {
      courseMatches?.classList.add("hidden");
      setStatus("#adminCourseSearchStatus", "Type at least 3 letters to search Google.");
      return;
    }
    setStatus("#adminCourseSearchStatus", "Searching golf courses…");
    courseSearchTimer = setTimeout(async () => {
      const { data, error } = await client.functions.invoke("course-lookup", { body: { query } });
      if (error) {
        courseMatches?.classList.add("hidden");
        let backendMessage = "";
        try {
          if (error.context?.clone) backendMessage = (await error.context.clone().json())?.error || "";
        } catch {}
        setStatus("#adminCourseSearchStatus", backendMessage || "Course search could not connect. Please refresh and try again.");
        return;
      }
      const matches = Array.isArray(data?.courses) ? data.courses : [];
      renderCourseMatches(matches);
      setStatus("#adminCourseSearchStatus", matches.length ? "Select the correct course below." : "No matching golf course found. Keep typing or enter the details manually.");
    }, 350);
  });

  document.querySelector("#adminEventForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const id = document.querySelector("#adminEventId").value;
    const automaticRoundNumber = id ? null : nextRoundNumber();
    const payload = {
      name: document.querySelector("#adminEventName").value.trim(),
      venue: document.querySelector("#adminEventVenue").value.trim(),
      address: document.querySelector("#adminEventAddress").value.trim() || null,
      event_date: document.querySelector("#adminEventDate").value,
      first_tee_time: document.querySelector("#adminEventFirstTee").value || null,
      price: document.querySelector("#adminEventPrice").value || null,
      guest_price: document.querySelector("#adminEventGuestPrice").value || null,
      course_member_price: document.querySelector("#adminEventCourseMemberPrice").value || null,
      capacity: document.querySelector("#adminEventCapacity").value || null,
      course_video_url: document.querySelector("#adminEventVideo").value.trim() || null,
      notes: document.querySelector("#adminEventNotes").value.trim() || null,
      latitude: selectedCourse?.latitude ?? null,
      longitude: selectedCourse?.longitude ?? null,
      status: id ? undefined : "scheduled",
      updated_at: new Date().toISOString()
    };
    if (id) delete payload.status;
    if (!id) payload.round_number = automaticRoundNumber;
    let eventResult = id
      ? await client.from("events").update(payload).eq("id", id).select("id").single()
      : await client.from("events").insert(payload).select("id").single();
    if (!id && eventResult.error && /round_number.*column|column.*round_number/i.test(eventResult.error.message || "")) {
      delete payload.round_number;
      eventResult = await client.from("events").insert(payload).select("id").single();
    }
    const saveError = eventResult.error;
    setStatus("#adminEventStatus", saveError ? saveError.message : id ? "Event updated." : "Event created.");
    if (!saveError) {
      resetEventForm();
      await Promise.all([loadEvents(), loadRounds()]);
    }
  });
  document.querySelector("#adminEventReset")?.addEventListener("click", resetEventForm);

  const loadRsvps = async eventId => {
    currentRsvpEventId = eventId;
    const playing = document.querySelector("#adminPlayingList");
    const reserve = document.querySelector("#adminReserveList");
    if (!eventId) {
      playing.innerHTML = reserve.innerHTML = "<p>Select an event.</p>";
      return;
    }
    const [{ data, error }, { data: teeTimesPublished }] = await Promise.all([
      client.from("rsvps")
        .select("id,member_id,status,payment_status,is_course_member,buggy_requested,preferred_tee_time,guest_name,profiles(full_name,phone)")
        .eq("event_id", eventId).order("created_at"),
      client.rpc("get_event_rsvp_lock_status", { target_event_id: eventId })
    ]);
    if (error) { setStatus("#adminRsvpStatus", error.message); return; }
    const preferenceLabel = value => ({ dont_mind: "Don’t mind", first: "Early", middle: "Middle", end: "Last" })[value] || "Don’t mind";
    const row = item => { const paid=item.payment_status==="paid"; return `<article><div><strong>${escapeHtml(item.profiles?.full_name || item.guest_name || "Guest")}</strong><small>${escapeHtml(item.profiles?.phone || "No phone")} · ${item.member_id?(item.is_course_member?"Course member price":"Barford member price"):"Guest price"} · ${item.buggy_requested ? "Buggy requested" : "Walking"} · prefers ${preferenceLabel(item.preferred_tee_time)}</small><span class="payment-status ${paid?"paid":"due"}">${paid?"Paid":"Payment due"}</span></div><div class="admin-row-actions"><button type="button" data-payment-rsvp="${item.id}" data-payment-next="${paid?"payment_due":"paid"}">${paid?"Mark payment due":"Mark as paid"}</button><button type="button" data-edit-rsvp="${item.id}">Change</button>${teeTimesPublished ? "" : `<button class="danger-link" type="button" data-remove-rsvp="${item.id}">Remove</button>`}</div></article>`; };
    const active = (data || []).filter(item => item.status === "playing");
    const reserves = (data || []).filter(item => item.status === "reserve");
    playing.innerHTML = active.length ? active.map(row).join("") : "<p>No confirmed players.</p>";
    reserve.innerHTML = reserves.length ? reserves.map(row).join("") : "<p>No reserves.</p>";
    setStatus("#adminRsvpStatus", teeTimesPublished ? "Tee times are published. Use Manage late dropout below to remove a player with minimum disruption." : "Members can still change their own RSVP.");
    document.querySelectorAll("[data-edit-rsvp]").forEach(button => button.addEventListener("click", () => {
      editingRsvp = (data || []).find(item => item.id === button.dataset.editRsvp);
      if (!editingRsvp) return;
      document.querySelector("#adminRsvpEditMember").textContent = editingRsvp.profiles?.full_name || editingRsvp.guest_name || "Guest";
      document.querySelector("#adminRsvpEditTravel").value = editingRsvp.buggy_requested ? "buggy" : "walking";
      document.querySelector("#adminRsvpEditPreference").value = ["dont_mind", "first", "middle", "end"].includes(editingRsvp.preferred_tee_time)
        ? editingRsvp.preferred_tee_time : "dont_mind";
      setStatus("#adminRsvpEditStatus", "");
      document.querySelector("#adminRsvpEditDialog")?.showModal();
    }));
    document.querySelectorAll("[data-payment-rsvp]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      const nextStatus = button.dataset.paymentNext;
      const { error: paymentError } = await client.from("rsvps").update({ payment_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", button.dataset.paymentRsvp);
      setStatus("#adminRsvpStatus", paymentError ? paymentError.message : nextStatus === "paid" ? "Payment confirmed. The member will now see ‘You have paid’." : "Payment changed back to due.");
      if (paymentError) button.disabled = false;
      else loadRsvps(eventId);
    }));
    document.querySelectorAll("[data-remove-rsvp]").forEach(button => button.addEventListener("click", async () => {
      const { error: removeError } = await client.from("rsvps").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", button.dataset.removeRsvp);
      setStatus("#adminRsvpStatus", removeError ? removeError.message : "Player removed. Regenerate tee times when ready.");
      if (!removeError) loadRsvps(eventId);
    }));
  };
  document.querySelector("#adminRsvpEvent")?.addEventListener("change", event => loadRsvps(event.target.value));

  const closeRsvpEdit = () => document.querySelector("#adminRsvpEditDialog")?.close();
  document.querySelector("#adminRsvpEditClose")?.addEventListener("click", closeRsvpEdit);
  document.querySelector("#adminRsvpEditCancel")?.addEventListener("click", closeRsvpEdit);
  document.querySelector("#adminRsvpEditForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!editingRsvp) return;
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "Saving…";
    const changes = {
      buggy_requested: document.querySelector("#adminRsvpEditTravel").value === "buggy",
      preferred_tee_time: document.querySelector("#adminRsvpEditPreference").value,
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from("rsvps").update(changes).eq("id", editingRsvp.id);
    button.disabled = false;
    button.textContent = "Save change";
    setStatus("#adminRsvpEditStatus", error ? error.message : "RSVP choices updated. Amend the saved tee-time group if needed.");
    if (!error) {
      await loadRsvps(currentRsvpEventId);
      setTimeout(closeRsvpEdit, 700);
    }
  });

  const minutesToTime = total => `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  const teeWindowRank = value => ({ first: 0, dont_mind: 1, middle: 1, end: 2 })[value] ?? 1;
  const teeWindowName = value => ({ dont_mind: "Don’t mind", first: "Early", middle: "Middle", end: "Last" })[value] || "Don’t mind";
  const pairingKey = (first, second) => [first, second].sort().join("|");

  const buildPairingHistory = rows => {
    const savedGroups = new Map();
    (rows || []).forEach(row => {
      if (!row.member_id) return;
      const key = `${row.event_id}|${row.tee_time}`;
      if (!savedGroups.has(key)) savedGroups.set(key, []);
      savedGroups.get(key).push(row.member_id);
    });
    const pairings = new Map();
    savedGroups.forEach(members => {
      for (let first = 0; first < members.length; first += 1) {
        for (let second = first + 1; second < members.length; second += 1) {
          const key = pairingKey(members[first], members[second]);
          pairings.set(key, (pairings.get(key) || 0) + 1);
        }
      }
    });
    return pairings;
  };

  const groupSizes = count => {
    if (count <= 4) return count ? [count] : [];
    const numberOfGroups = Math.ceil(count / 4);
    if (count < numberOfGroups * 3) return [3, count - 3];
    const threeballs = numberOfGroups * 4 - count;
    return [
      ...Array(threeballs).fill(3),
      ...Array(numberOfGroups - threeballs).fill(4)
    ];
  };

  const mixCohort = (players, pairings) => {
    const remaining = [...players].sort((first, second) =>
      teeWindowRank(first.preferred_tee_time) - teeWindowRank(second.preferred_tee_time) ||
      String(first.profiles?.full_name || first.guest_name || "").localeCompare(String(second.profiles?.full_name || second.guest_name || ""))
    );
    return groupSizes(remaining.length).map(size => {
      const group = [remaining.shift()];
      while (group.length < size && remaining.length) {
        let bestIndex = 0;
        let bestScore = Infinity;
        remaining.forEach((candidate, index) => {
          const preferredDistance = group.reduce((total, member) => {
            if (candidate.preferred_tee_time === "dont_mind" || member.preferred_tee_time === "dont_mind") return total;
            return total + Math.abs(teeWindowRank(candidate.preferred_tee_time) - teeWindowRank(member.preferred_tee_time));
          }, 0);
          const repeatPairings = group.reduce((total, member) => {
            if (!candidate.member_id || !member.member_id) return total;
            return total + (pairings.get(pairingKey(candidate.member_id, member.member_id)) || 0);
          }, 0);
          const score = preferredDistance * 1000 + repeatPairings * 10 + index / 1000;
          if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
          }
        });
        group.push(remaining.splice(bestIndex, 1)[0]);
      }
      return group.filter(Boolean);
    });
  };

  const groupPlayers = (players, pairings) => {
    const buggy = players.filter(item => item.buggy_requested);
    const walkers = players.filter(item => !item.buggy_requested);
    return [...mixCohort(buggy, pairings), ...mixCohort(walkers, pairings)];
  };
  let draggedTeePlayer = null;
  const renderTeePreview = () => {
    const preview = document.querySelector("#adminTeePreview");
    if (!preview) return;
    preview.innerHTML = teeGroups.length ? teeGroups.map((group, groupIndex) => `
      <article data-tee-group="${groupIndex}"><strong>${group.time}</strong><span>Group ${groupIndex + 1} · ${group.players.length} player${group.players.length === 1 ? "" : "s"}</span><div>${group.players.map((player, playerIndex) => `
        <div class="tee-player" draggable="true" data-tee-player="${playerIndex}" data-tee-source="${groupIndex}">${escapeHtml(player.profiles?.full_name || player.guest_name || "Guest")}${player.buggy_requested ? " · buggy" : ""}<small>${teeWindowName(player.preferred_tee_time)}</small><select class="tee-move-select" data-move-source="${groupIndex}" data-move-player="${playerIndex}" aria-label="Move ${escapeHtml(player.profiles?.full_name || player.guest_name || "player")} to another group"><option value="">Move to…</option>${teeGroups.map((_, target) => target === groupIndex ? "" : `<option value="${target}">Group ${target + 1}</option>`).join("")}</select></div>`).join("")}</div></article>
    `).join("") : "<p>No confirmed players to organise.</p>";
    preview.querySelectorAll("[data-tee-player]").forEach(player => player.addEventListener("dragstart", event => {
      draggedTeePlayer = { source: Number(player.dataset.teeSource), index: Number(player.dataset.teePlayer) };
      event.dataTransfer.effectAllowed = "move";
    }));
    preview.querySelectorAll("[data-tee-group]").forEach(group => {
      group.addEventListener("dragover", event => { event.preventDefault(); group.classList.add("tee-drop-target"); });
      group.addEventListener("dragleave", () => group.classList.remove("tee-drop-target"));
      group.addEventListener("drop", event => {
        event.preventDefault();
        group.classList.remove("tee-drop-target");
        if (!draggedTeePlayer) return;
        const target = Number(group.dataset.teeGroup);
        const source = draggedTeePlayer.source;
        if (target === source) return;
        if (teeGroups[target].players.length >= 4) {
          setStatus("#adminTeeStatus", `Group ${target + 1} already has four players. Move somebody out of that group first.`);
          return;
        }
        const [moved] = teeGroups[source].players.splice(draggedTeePlayer.index, 1);
        teeGroups[target].players.push(moved);
        teeGroups = teeGroups.filter(item => item.players.length);
        draggedTeePlayer = null;
        renderTeePreview();
        setStatus("#adminTeeStatus", "Manual change ready. Press Save tee times to publish it.");
      });
    });
    preview.querySelectorAll("[data-move-player]").forEach(select => select.addEventListener("change", event => {
      if (event.target.value === "") return;
      const source = Number(event.target.dataset.moveSource);
      const target = Number(event.target.value);
      const playerIndex = Number(event.target.dataset.movePlayer);
      if (teeGroups[target].players.length >= 4) {
        setStatus("#adminTeeStatus", `Group ${target + 1} already has four players.`);
        event.target.value = "";
        return;
      }
      const [moved] = teeGroups[source].players.splice(playerIndex, 1);
      teeGroups[target].players.push(moved);
      teeGroups = teeGroups.filter(item => item.players.length);
      renderTeePreview();
      setStatus("#adminTeeStatus", "Manual change ready. Press Save tee times to publish it.");
    }));
  };
  const playerKey = player => player.member_id ? `member:${player.member_id}` : `guest:${String(player.guest_name || "").trim().toLowerCase()}`;
  const preservePublishedGroups = (players, savedRows, pairings, startMinutes, gap) => {
    if (!savedRows.length) return groupPlayers(players, pairings).map((group, index) => ({
      time: minutesToTime(startMinutes + index * gap), players: group
    }));
    const available = new Map(players.map(player => [playerKey(player), player]));
    const grouped = new Map();
    savedRows.forEach(row => {
      const key = `${row.tee_time}|${row.tee_number || 1}`;
      if (!grouped.has(key)) grouped.set(key, { time: timeValue(row.tee_time), teeNumber: row.tee_number || 1, players: [] });
      const player = available.get(playerKey(row));
      if (player) {
        grouped.get(key).players.push(player);
        available.delete(playerKey(row));
      }
    });
    const groups = [...grouped.values()].filter(group => group.players.length);
    const newcomers = [...available.values()];
    groups.forEach(group => {
      while (group.players.length < 4 && newcomers.length) group.players.push(newcomers.shift());
    });
    while (groups.some(group => group.players.length < 3)) {
      const short = groups.find(group => group.players.length < 3);
      const donor = [...groups].reverse().find(group => group !== short && group.players.length > 3);
      if (!donor) break;
      short.players.push(donor.players.pop());
    }
    if (newcomers.length) {
      const lastMinutes = groups.length ? groups.reduce((max, group) => {
        const [h, m] = group.time.split(":").map(Number);
        return Math.max(max, h * 60 + m);
      }, startMinutes - gap) : startMinutes - gap;
      groupPlayers(newcomers, pairings).forEach((players, index) => groups.push({
        time: minutesToTime(lastMinutes + (index + 1) * gap), teeNumber: 1, players
      }));
    }
    return groups;
  };

  document.querySelector("#adminGenerateTeeTimes")?.addEventListener("click", async () => {
    const eventId = document.querySelector("#adminTeeEvent").value;
    if (!eventId) { setStatus("#adminTeeStatus", "Select an event first."); return; }
    const [{ data, error }, { data: history, error: historyError }, { data: savedRows, error: savedError }] = await Promise.all([
      client.from("rsvps").select("member_id,guest_name,buggy_requested,preferred_tee_time,profiles(full_name,phone)").eq("event_id", eventId).eq("status", "playing"),
      client.from("tee_times").select("event_id,tee_time,member_id,events(event_date)").neq("event_id", eventId),
      client.from("tee_times").select("tee_time,tee_number,position,member_id,guest_name").eq("event_id", eventId).order("tee_time").order("position")
    ]);
    if (error) { setStatus("#adminTeeStatus", error.message); return; }
    const selectedEvent = adminEvents.find(item => item.id === eventId);
    const previousGroups = (history || []).filter(row => row.events?.event_date && selectedEvent?.event_date && row.events.event_date < selectedEvent.event_date);
    const pairings = historyError ? new Map() : buildPairingHistory(previousGroups);
    const [hours, minutes] = document.querySelector("#adminTeeStart").value.split(":").map(Number);
    const gap = Number(document.querySelector("#adminTeeGap").value) || 8;
    teeGroups = preservePublishedGroups([...(data || [])], savedError ? [] : (savedRows || []), pairings, hours * 60 + minutes, gap);
    renderTeePreview();
    document.querySelector("#adminSaveTeeTimes").disabled = !teeGroups.length;
    setStatus("#adminTeeStatus", teeGroups.length ? (savedRows?.length ? "Preview ready. Existing groups and times have been kept wherever possible; only the minimum moves were made." : "Preview ready. Buggy groups are first, tee-window requests are applied, and previous pairings are minimised.") : "");
  });
  document.querySelector("#adminSaveTeeTimes")?.addEventListener("click", async () => {
    const eventId = document.querySelector("#adminTeeEvent").value;
    const rows = teeGroups.flatMap((group, groupIndex) => group.players.map((player, position) => ({
      event_id: eventId, tee_time: group.time, tee_number: group.teeNumber || 1, position: position + 1,
      member_id: player.member_id || null, guest_name: player.member_id ? null : player.guest_name
    })));
    const { error: deleteError } = await client.from("tee_times").delete().eq("event_id", eventId);
    const { error } = deleteError ? { error: deleteError } : await client.from("tee_times").insert(rows);
    if(error){setStatus("#adminTeeStatus",error.message);return;}
    const { error: workflowError } = await client.from("events").update({ tee_times_status: "published", updated_at: new Date().toISOString() }).eq("id", eventId);
    if (workflowError) { setStatus("#adminTeeStatus", workflowError.message); return; }
    const {data:cards,error:cardCheckError}=await client.from('event_scorecards').select('id').eq('event_id',eventId).limit(1);
    if(cardCheckError){setStatus('#adminTeeStatus','Tee times published, but scorecards could not be checked. Use Create group scorecards below.');return;}
    if(!cards?.length){
      const {error:prepareError}=await client.rpc('prepare_event_scorecards',{target_event_id:eventId});
      if(prepareError){setStatus('#adminTeeStatus','Tee times published. Scorecards need attention before members can choose a scorer: '+prepareError.message);return;}
      const {error:publishError}=await client.from('events').update({scorecards_status:'published',results_status:'collecting',updated_at:new Date().toISOString()}).eq('id',eventId);
      if(publishError){setStatus('#adminTeeStatus','Scorecards prepared, but their publication status could not be saved. Use Create group scorecards below to retry.');return;}
    }
    setStatus('#adminTeeStatus','Tee times published. Group scorecards are on members’ dashboards, ready for each group to choose its scorer.');
  });

  let dropoutRsvps = [];
  document.querySelector("#adminDropoutEvent")?.addEventListener("change", async event => {
    const eventId = event.target.value;
    const playerSelect = document.querySelector("#adminDropoutPlayer");
    const confirmDropout = document.querySelector("#adminConfirmDropout");
    dropoutRsvps = [];
    playerSelect.innerHTML = '<option value="">Select player</option>';
    playerSelect.disabled = true;
    confirmDropout.disabled = true;
    if (!eventId) return;
    const [{ data: rsvps, error }, { data: published }] = await Promise.all([
      client.from("rsvps").select("id,member_id,guest_name,profiles(full_name)").eq("event_id", eventId).eq("status", "playing").order("created_at"),
      client.rpc("get_event_rsvp_lock_status", { target_event_id: eventId })
    ]);
    if (error) { setStatus("#adminDropoutStatus", error.message); return; }
    if (!published) {
      setStatus("#adminDropoutStatus", "Tee times have not been published yet. Remove the player from the RSVP overview instead.");
      return;
    }
    dropoutRsvps = rsvps || [];
    playerSelect.innerHTML += dropoutRsvps.map(item => `<option value="${item.id}">${escapeHtml(item.profiles?.full_name || item.guest_name || "Guest")}</option>`).join("");
    playerSelect.disabled = !dropoutRsvps.length;
    setStatus("#adminDropoutStatus", dropoutRsvps.length ? "Select the player who can no longer attend." : "No confirmed players found.");
  });
  document.querySelector("#adminDropoutPlayer")?.addEventListener("change", event => {
    document.querySelector("#adminConfirmDropout").disabled = !event.target.value;
  });
  document.querySelector("#adminConfirmDropout")?.addEventListener("click", async event => {
    const eventId = document.querySelector("#adminDropoutEvent").value;
    const rsvpId = document.querySelector("#adminDropoutPlayer").value;
    const dropout = dropoutRsvps.find(item => item.id === rsvpId);
    if (!eventId || !dropout) return;
    const playerName = dropout.profiles?.full_name || dropout.guest_name || "this player";
    if (!confirm(`Confirm ${playerName} has dropped out? Tee groups will be kept as unchanged as possible.`)) return;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Updating…";
    const { data: originalRows, error: teeError } = await client.from("tee_times")
      .select("tee_time,tee_number,position,member_id,guest_name").eq("event_id", eventId).order("tee_time").order("position");
    if (teeError) {
      setStatus("#adminDropoutStatus", teeError.message);
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = "Confirm dropout";
      return;
    }
    const isDropout = row => dropout.member_id ? row.member_id === dropout.member_id : String(row.guest_name || "") === String(dropout.guest_name || "");
    const groupsByKey = new Map();
    (originalRows || []).filter(row => !isDropout(row)).forEach(row => {
      const key = `${timeValue(row.tee_time)}|${row.tee_number || 1}`;
      if (!groupsByKey.has(key)) groupsByKey.set(key, { time: timeValue(row.tee_time), teeNumber: row.tee_number || 1, players: [] });
      groupsByKey.get(key).players.push(row);
    });
    const groups = [...groupsByKey.values()].filter(group => group.players.length);
    groups.forEach((group, index) => {
      if (group.players.length >= 3 || groups.reduce((sum, item) => sum + item.players.length, 0) <= 4) return;
      const donors = groups.map((item, donorIndex) => ({ item, donorIndex })).filter(candidate => candidate.item !== group && candidate.item.players.length > 3).sort((a, b) => Math.abs(a.donorIndex - index) - Math.abs(b.donorIndex - index));
      if (donors.length) group.players.push(donors[0].item.players.pop());
    });
    const replacementRows = groups.flatMap(group => group.players.map((player, position) => ({
      event_id: eventId,
      tee_time: group.time,
      tee_number: group.teeNumber,
      position: position + 1,
      member_id: player.member_id || null,
      guest_name: player.member_id ? null : player.guest_name
    })));
    const { error: rsvpError } = await client.from("rsvps").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", rsvpId);
    let updateError = rsvpError;
    if (!updateError) {
      const deleted = await client.from("tee_times").delete().eq("event_id", eventId);
      updateError = deleted.error;
      if (!updateError && replacementRows.length) updateError = (await client.from("tee_times").insert(replacementRows)).error;
      if (updateError) {
        await client.from("tee_times").delete().eq("event_id", eventId);
        if (originalRows?.length) await client.from("tee_times").insert(originalRows.map(row => ({ ...row, event_id: eventId })));
        await client.from("rsvps").update({ status: "playing", updated_at: new Date().toISOString() }).eq("id", rsvpId);
      }
    }
    event.currentTarget.textContent = "Confirm dropout";
    if (updateError) {
      event.currentTarget.disabled = false;
      setStatus("#adminDropoutStatus", `Nothing was changed because the update failed: ${updateError.message}`);
      return;
    }
    setStatus("#adminDropoutStatus", `${playerName} has been removed. Tee times were kept the same and only the minimum group adjustment was made.`);
    document.querySelector("#adminDropoutPlayer").value = "";
    await Promise.all([loadRsvps(eventId), document.querySelector("#adminDropoutEvent").dispatchEvent(new Event("change"))]);
  });
  document.querySelector("#adminWhatsAppTeeTimes")?.addEventListener("click", async () => {
    const event = adminEvents.find(item => item.id === document.querySelector("#adminTeeEvent").value);
    const message = [`⛳ ${event?.name || "Barford tee times"}`, ...teeGroups.map(group =>
      `${group.time} — ${group.players.map(player => player.profiles?.full_name || player.guest_name || "Guest").join(", ")}`
    )].join("\n");
    await navigator.clipboard.writeText(message);
    setStatus("#adminTeeStatus", "WhatsApp tee-time message copied.");
  });

  const refreshRoundEventOptions = () => {
    const select = document.querySelector("#adminRoundEvent");
    if (!select) return;
    const linkedEventIds = new Set(adminRounds.map(round => round.event_id).filter(Boolean));
    const availableEvents = adminEvents.filter(event =>
      !linkedEventIds.has(event.id) && event.status !== "cancelled"
    );
    select.innerHTML = `<option value="">Select event</option>${availableEvents.map(event =>
      `<option value="${event.id}">${escapeHtml(event.name)} · ${escapeHtml(event.event_date)}</option>`
    ).join("")}`;
    const nextNumber = Math.max(0, ...adminRounds.map(round => Number(round.round_number) || 0)) + 1;
    document.querySelector("#adminRoundNumber").value = nextNumber;
  };

  const loadRounds = async () => {
    const { data, error } = await client.from("rounds").select("*,events(name,venue,event_date)").eq("season", 2027).order("round_number");
    if (error) { setStatus("#adminRoundStatus", error.message); return; }
    const rounds = data || [];
    adminRounds = rounds;
    refreshRoundEventOptions();
    document.querySelector("#adminScoreRound").innerHTML = `<option value="">Select round</option>${rounds.map(round =>
      `<option value="${round.id}">Round ${round.round_number} · ${escapeHtml(round.events?.name || round.name)}</option>`).join("")}`;
    const list = document.querySelector("#adminRoundList");
    list.innerHTML = rounds.length ? rounds.map(round => `<article><div><strong>Round ${round.round_number} · ${escapeHtml(round.events?.name || round.name)}</strong><small>${escapeHtml(round.events?.event_date || round.played_on || "Date not set")} · ${escapeHtml(round.events?.venue || "")} · ${round.locked ? "Locked" : "Open"}</small></div><button type="button" data-lock-round="${round.id}" data-locked="${round.locked}">${round.locked ? "Unlock" : "Lock round"}</button></article>`).join("") : "<p>No rounds created. Choose a published event above to make Round 1.</p>";
    list.querySelectorAll("[data-lock-round]").forEach(button => button.addEventListener("click", async () => {
      const locked = button.dataset.locked !== "true";
      const { error: lockError } = await client.from("rounds").update({ locked }).eq("id", button.dataset.lockRound);
      setStatus("#adminRoundStatus", lockError ? lockError.message : locked ? "Round locked." : "Round unlocked.");
      if (!lockError) loadRounds();
    }));
  };
  const roundAverage = scores => {
    const sorted = [...scores].sort((a, b) => a - b);
    const included = sorted.length > 4 ? sorted.slice(1, -1) : sorted;
    return Math.round(included.reduce((sum, score) => sum + score, 0) / included.length);
  };
  const baseHandicapAdjustment = (points, average) => {
    const difference = points - average;
    if (difference >= 10) return -4;
    if (difference >= 8) return -3;
    if (difference >= 6) return -2;
    if (difference >= 4) return -1;
    if (difference >= 2) return -0.5;
    if (difference >= -1) return 0;
    if (difference >= -3) return 0.5;
    if (difference >= -5) return 1;
    if (difference >= -7) return 2;
    if (difference >= -9) return 3;
    return 4;
  };
  const handicapMultiplier = handicap => handicap <= 9 ? 0.5 : handicap <= 18 ? 0.75 : handicap <= 28 ? 1 : 1.25;
  const handicapOutcome = (handicap, points, average) => {
    const raw = baseHandicapAdjustment(points, average) * handicapMultiplier(handicap);
    const adjustment = Math.max(-3, Math.min(2, Math.round(raw)));
    return { adjustment, nextHandicap: Math.max(0, handicap + adjustment) };
  };
  const scoreNumber = (row, field) => {
    const value = row.querySelector(`[data-field="${field}"]`)?.value;
    return value === "" || value == null ? null : Number(value);
  };
  const recalculateScoreEditor = ({ preserveSaved = false } = {}) => {
    const rows = [...document.querySelectorAll("[data-score-member]")];
    const playedRows = rows.filter(row => {
      const points = scoreNumber(row, "points");
      return !row.querySelector('[data-field="dnp"]').checked && Number.isFinite(points) && points > 0;
    });
    if (playedRows.length < 4) {
      if (!preserveSaved) rows.forEach(row => {
        const dnp = row.querySelector('[data-field="dnp"]').checked || scoreNumber(row, "points") === 0;
        if (dnp) {
          row.querySelector('[data-field="dnp"]').checked = true;
          row.querySelector('[data-field="adjustment"]').value = "";
          row.querySelector('[data-field="next_handicap"]').value = scoreNumber(row, "handicap_used") ?? "";
        } else {
          row.querySelector('[data-field="adjustment"]').value = "";
          row.querySelector('[data-field="next_handicap"]').value = "";
        }
      });
      setStatus("#adminScoreStatus", "Enter points for at least 4 players to calculate the round handicaps.");
      return null;
    }

    const average = roundAverage(playedRows.map(row => scoreNumber(row, "points")));
    rows.forEach(row => {
      const handicap = scoreNumber(row, "handicap_used");
      const points = scoreNumber(row, "points");
      const dnpInput = row.querySelector('[data-field="dnp"]');
      if (points === 0) dnpInput.checked = true;
      if (dnpInput.checked) {
        row.querySelector('[data-field="adjustment"]').value = "";
        row.querySelector('[data-field="next_handicap"]').value = Number.isFinite(handicap) ? handicap : "";
        return;
      }
      if (!Number.isFinite(handicap) || !Number.isFinite(points)) {
        row.querySelector('[data-field="adjustment"]').value = "";
        row.querySelector('[data-field="next_handicap"]').value = "";
        return;
      }
      const result = handicapOutcome(handicap, points, average);
      row.querySelector('[data-field="adjustment"]').value = result.adjustment;
      row.querySelector('[data-field="next_handicap"]').value = result.nextHandicap;
    });

    const topScore = Math.max(...playedRows.map(row => scoreNumber(row, "points")));
    const leaders = playedRows.filter(row => scoreNumber(row, "points") === topScore);
    rows.forEach(row => {
      const winner = row.querySelector('[data-field="winner"]');
      if (leaders.length === 1) winner.checked = row === leaders[0];
      else if (!leaders.includes(row)) winner.checked = false;
    });
    setStatus(
      "#adminScoreStatus",
      leaders.length > 1
        ? `Round average: ${average}. The top score is tied — select the winner before saving.`
        : `Round average: ${average}. Adjustments and next handicaps are calculated automatically.`
    );
    return { average, leaders };
  };

  const loadScoreEditor = async roundId => {
    const editor = document.querySelector("#adminScoreEditor");
    if (!roundId) { editor.innerHTML = "<p>Select a round.</p>"; return; }
    const [{ data: round }, { data: players }, { data: scores }, { data: history }] = await Promise.all([
      client.from("rounds").select("round_number,locked").eq("id", roundId).single(),
      client.from("profiles").select("id,full_name,handicap,leaderboard_from_round").eq("leaderboard_active", true).order("full_name"),
      client.from("scores").select("*").eq("round_id", roundId),
      client.from("scores").select("member_id,round_id,next_handicap")
    ]);
    const eligible = (players || []).filter(player => Number(player.leaderboard_from_round || 1) <= Number(round?.round_number || 1));
    const byMember = new Map((scores || []).map(score => [score.member_id, score]));
    const roundNumbers = new Map(adminRounds.map(item => [item.id, Number(item.round_number)]));
    const previousHandicap = new Map();
    (history || [])
      .filter(score => Number(roundNumbers.get(score.round_id)) < Number(round?.round_number) && Number.isFinite(Number(score.next_handicap)))
      .sort((a, b) => Number(roundNumbers.get(a.round_id)) - Number(roundNumbers.get(b.round_id)))
      .forEach(score => previousHandicap.set(score.member_id, Number(score.next_handicap)));

    editor.innerHTML = eligible.length ? eligible.map(player => {
      const score = byMember.get(player.id) || {};
      const startingHandicap = score.handicap_used ?? previousHandicap.get(player.id) ?? player.handicap ?? "";
      return `<article class="admin-score-row" data-score-member="${player.id}">
        <strong>${escapeHtml(player.full_name)}</strong>
        <label>Starting HCP<input data-field="handicap_used" type="number" min="0" step=".1" value="${startingHandicap}"></label>
        <label>Points<input data-field="points" type="number" min="0" value="${score.points ?? ""}"></label>
        <label>Adjustment<input data-field="adjustment" class="calculated-score-field" type="number" step=".5" value="${score.adjustment ?? ""}" readonly aria-readonly="true"></label>
        <label>Next HCP<input data-field="next_handicap" class="calculated-score-field" type="number" step=".1" value="${score.next_handicap ?? ""}" readonly aria-readonly="true"></label>
        <label class="score-check"><input data-field="dnp" type="checkbox" ${score.dnp ? "checked" : ""}> DNP</label>
        <label class="score-check"><input data-field="winner" type="checkbox" ${score.winner ? "checked" : ""}> Winner</label>
      </article>`;
    }).join("") : "<p>No eligible leaderboard players for this round.</p>";
    document.querySelector("#adminSaveScores").disabled = Boolean(round?.locked) || !eligible.length;
    if (round?.locked) {
      setStatus("#adminScoreStatus", "Unlock this round before changing scores.");
    } else {
      recalculateScoreEditor({ preserveSaved: true });
    }
  };
  document.querySelector("#adminScoreEditor")?.addEventListener("input", event => {
    if (event.target.matches('[data-field="handicap_used"], [data-field="points"]')) recalculateScoreEditor();
  });
  document.querySelector("#adminScoreEditor")?.addEventListener("change", event => {
    if (event.target.matches('[data-field="dnp"]')) {
      const row = event.target.closest("[data-score-member]");
      if (event.target.checked && row.querySelector('[data-field="points"]').value === "") {
        row.querySelector('[data-field="points"]').value = "0";
      }
      recalculateScoreEditor();
    }
  });
  document.querySelector("#adminScoreRound")?.addEventListener("change", event => loadScoreEditor(event.target.value));
  document.querySelector("#adminSaveScores")?.addEventListener("click", async () => {
    const roundId = document.querySelector("#adminScoreRound").value;
    const calculation = recalculateScoreEditor();
    if (!calculation) return;
    if (calculation.leaders.length > 1) {
      const selectedWinners = calculation.leaders.filter(row => row.querySelector('[data-field="winner"]').checked);
      if (selectedWinners.length !== 1) {
        setStatus("#adminScoreStatus", "The top score is tied. Select exactly one winner before saving.");
        return;
      }
    }
    const rows = [...document.querySelectorAll("[data-score-member]")].map(row => {
      const dnp = row.querySelector('[data-field="dnp"]').checked;
      return {
        round_id: roundId,
        member_id: row.dataset.scoreMember,
        handicap_used: scoreNumber(row, "handicap_used"),
        points: dnp ? null : scoreNumber(row, "points"),
        adjustment: dnp ? null : scoreNumber(row, "adjustment"),
        next_handicap: scoreNumber(row, "next_handicap"),
        dnp,
        winner: row.querySelector('[data-field="winner"]').checked,
        updated_at: new Date().toISOString()
      };
    });
    const { error } = await client.from("scores").upsert(rows, { onConflict: "round_id,member_id" });
    if (error) {
      setStatus("#adminScoreStatus", error.message);
      return;
    }
    setStatus("#adminScoreStatus", "All scores, adjustments and next handicaps have been saved.");
    await loadScoreEditor(roundId);
  });
  document.querySelector("#adminExportLeaderboard")?.addEventListener("click", async () => {
    const { data } = await client.rpc("get_2027_leaderboard_snapshot");
    const rows = [["Player", "Round", "Points", "Handicap", "Next Handicap"]];
    (data?.rounds || []).forEach(round => (round.results || []).forEach(result => {
      const player = (data.players || []).find(item => item.id === result.playerId);
      rows.push([player?.name || "", round.name, result.points ?? "DNP", result.handicapUsed ?? "", result.nextHandicap ?? ""]);
    }));
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "barford-2027-leaderboard.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  });
  document.querySelector("#adminClearScores")?.addEventListener("click", async () => {
    if (!confirm("Clear every 2027 score? Member accounts, events and rounds will remain. This cannot be undone.")) return;
    if (!confirm("Final confirmation: permanently delete all 2027 score entries?")) return;
    const { data: rounds } = await client.from("rounds").select("id").eq("season", 2027);
    const roundIds = (rounds || []).map(round => round.id);
    if (!roundIds.length) { setStatus("#adminRoundStatus", "There are no 2027 rounds to clear."); return; }
    const { error } = await client.from("scores").delete().in("round_id", roundIds);
    setStatus("#adminRoundStatus", error ? error.message : "All 2027 scores were cleared. Rounds and members remain.");
  });

  const loadGallery = async () => {
    const { data, error } = await client.from("gallery_photos").select("id,storage_path,caption,approved,created_at").order("created_at", { ascending: false });
    if (error) { setStatus("#adminGalleryStatus", error.message); return; }
    const awaiting = (data || []).filter(item => !item.approved).length;
    document.querySelector("#adminGalleryCount").textContent = `${(data || []).length} uploaded${awaiting ? ` · ${awaiting} awaiting approval` : ""}`;
    const list = document.querySelector("#adminGalleryList");
    list.classList.add("admin-gallery-grid");
    const photos = (data || []).map(photo => ({ ...photo, url: client.storage.from("gallery-images").getPublicUrl(photo.storage_path).data.publicUrl }));
    list.innerHTML = photos.length ? photos.map(photo => `<article><div class="admin-photo">${photo.url ? `<img loading="lazy" src="${photo.url}" alt="${escapeHtml(photo.caption || "Society photo")}">` : ""}</div><strong>${escapeHtml(photo.caption || "Society photo")}</strong><small>${photo.approved ? "Visible in gallery" : "Waiting for approval"}${photo.created_at ? ` · ${new Intl.DateTimeFormat("en-GB", { day:"numeric", month:"short", year:"numeric" }).format(new Date(photo.created_at))}` : ""}</small><div class="admin-row-actions">${photo.approved ? "" : `<button type="button" data-approve-photo="${photo.id}">Approve</button>`}<button class="admin-delete-photo" type="button" data-delete-photo="${photo.id}" data-photo-path="${escapeHtml(photo.storage_path)}">Delete photo</button></div></article>`).join("") : "<p>No uploaded photographs to manage.</p>";
    list.querySelectorAll("[data-approve-photo]").forEach(button => button.addEventListener("click", async () => {
      const { error: approveError } = await client.from("gallery_photos").update({ approved: true }).eq("id", button.dataset.approvePhoto);
      setStatus("#adminGalleryStatus", approveError ? approveError.message : "Photo approved.");
      if (!approveError) loadGallery();
    }));
    list.querySelectorAll("[data-delete-photo]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("Permanently delete this photo from the society gallery? This cannot be undone.")) return;
      button.disabled = true;
      button.textContent = "Deleting…";
      setStatus("#adminGalleryStatus", "Deleting photo…");
      const storageResult = await client.storage.from("gallery-images").remove([button.dataset.photoPath]);
      const { error: rowError } = storageResult.error ? { error: storageResult.error } : await client.from("gallery_photos").delete().eq("id", button.dataset.deletePhoto);
      setStatus("#adminGalleryStatus", rowError ? rowError.message : "Photo deleted.");
      if (!rowError) loadGallery();
      else { button.disabled = false; button.textContent = "Delete photo"; }
    }));
  };

  const loadContent = async () => {
    const [{ data: products, error: productError }, { data: trips, error: tripError }] = await Promise.all([
      client.from("products").select("*").order("created_at"),
      client.from("world_events").select("*,world_event_votes(vote)").order("created_at", { ascending: false })
    ]);
    const productList = document.querySelector("#adminProductList");
    productList.innerHTML = productError ? `<p>${escapeHtml(productError.message)}</p>` : (products || []).map(product => `<article><div><strong>${escapeHtml(product.name)}</strong><small>£${Number(product.price).toFixed(2)} · ${product.stock} in stock</small></div><button class="danger-link" type="button" data-remove-product="${product.id}">Remove</button></article>`).join("") || "<p>No products.</p>";
    const tripList = document.querySelector("#adminTripList");
    tripList.innerHTML = tripError ? `<p>${escapeHtml(tripError.message)}</p>` : (trips || []).map(trip => {
      const votes = trip.world_event_votes || [];
      return `<article><div><strong>${escapeHtml(trip.name)}</strong><small>${votes.filter(v => v.vote === "yes").length} yes · ${votes.filter(v => v.vote === "maybe").length} maybe · ${votes.filter(v => v.vote === "no").length} no</small></div><button class="danger-link" type="button" data-remove-trip="${trip.id}">Delete</button></article>`;
    }).join("") || "<p>No trip events.</p>";
    document.querySelectorAll("[data-remove-product]").forEach(button => button.addEventListener("click", async () => {
      await client.from("products").update({ active: false }).eq("id", button.dataset.removeProduct); loadContent();
    }));
    document.querySelectorAll("[data-remove-trip]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("Delete this trip and its votes?")) return;
      await client.from("world_events").delete().eq("id", button.dataset.removeTrip); loadContent();
    }));
  };
  document.querySelector("#adminProductForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const { error } = await client.from("products").insert({
      name: document.querySelector("#adminProductName").value.trim(),
      price: Number(document.querySelector("#adminProductPrice").value),
      stock: Number(document.querySelector("#adminProductStock").value),
      description: document.querySelector("#adminProductDescription").value.trim() || null
    });
    setStatus("#adminContentStatus", error ? error.message : "Product added.");
    if (!error) { event.currentTarget.reset(); loadContent(); }
  });
  document.querySelector("#adminTripForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const { error } = await client.from("world_events").insert({
      name: document.querySelector("#adminTripName").value.trim(),
      video_url: document.querySelector("#adminTripVideo").value.trim() || null
    });
    setStatus("#adminContentStatus", error ? error.message : "Trip event created.");
    if (!error) { event.currentTarget.reset(); loadContent(); }
  });

  const loadAccounts = async () => {
    const list = document.querySelector("#adminAccountList");
    const accountCount = document.querySelector("#adminAccountCount");
    accountCount.textContent = "Loading…";

    const coreColumns = "id,full_name,email,phone,photo_url,is_admin,leaderboard_active,leaderboard_from_round,created_at";
    let contactedAvailable = true;
    let result = await client.from("profiles")
      .select(`${coreColumns},committee_contacted`)
      .order("full_name");

    if (result.error && /committee_contacted|column .* does not exist/i.test(result.error.message || "")) {
      contactedAvailable = false;
      result = await client.from("profiles").select(coreColumns).order("full_name");
    }

    if (result.error) {
      accountCount.textContent = "Could not load";
      list.innerHTML = '<p class="form-status error">Member accounts could not be loaded. Please refresh the page.</p>';
      setStatus("#adminAccountStatus", result.error.message);
      return;
    }

    const accounts = result.data || [];
    accountCount.textContent = `${accounts.length} account${accounts.length === 1 ? "" : "s"}`;
    list.innerHTML = accounts.map(account => `
      <article class="admin-account-row">
        <span class="admin-avatar">${escapeHtml(initials(account.full_name))}</span>
        <div class="admin-account-name"><strong>${escapeHtml(account.full_name)}</strong><small>${escapeHtml(account.email)} · ${escapeHtml(account.phone || "No phone")}</small></div>
        <span class="status ${account.is_admin ? "active" : "member"}">${account.is_admin ? "Administrator" : "Member"}</span>
        ${contactedAvailable ? `<label class="admin-access-toggle">
          <input type="checkbox" data-contacted-id="${escapeHtml(account.id)}" ${account.committee_contacted ? "checked" : ""}>
          <span>${account.committee_contacted ? "Contacted" : "Mark contacted"}</span>
        </label>` : ""}
        <label class="admin-access-toggle leaderboard-toggle">
          <input type="checkbox" data-leaderboard-id="${escapeHtml(account.id)}" data-leaderboard-name="${escapeHtml(account.full_name)}" ${account.leaderboard_active !== false ? "checked" : ""}>
          <span>${account.leaderboard_active !== false ? `Leaderboard · from round ${account.leaderboard_from_round || 1}` : "Add to leaderboard"}</span>
        </label>
        <label class="admin-access-toggle">
          <input type="checkbox" data-admin-id="${escapeHtml(account.id)}" data-admin-name="${escapeHtml(account.full_name)}" ${account.is_admin ? "checked" : ""} ${account.id === signedInProfile.id ? "disabled" : ""}>
          <span>${account.is_admin ? "Admin access on" : "Give admin access"}</span>
        </label>
      </article>`).join("");
    if (!contactedAvailable) {
      setStatus("#adminAccountStatus", "Admin and leaderboard controls are ready. Run admin-controls-add-on.sql to also enable the contacted marker.");
    } else {
      setStatus("#adminAccountStatus", "");
    }

    list.querySelectorAll("[data-admin-id]").forEach(input => input.addEventListener("change", event => {
      const control = event.currentTarget;
      pendingChange = {
        id: control.dataset.adminId,
        name: control.dataset.adminName,
        grant: control.checked,
        control
      };
      control.checked = !control.checked;
      document.querySelector("#adminAccessTitle").textContent = pendingChange.grant
        ? `Give ${pendingChange.name} admin access?`
        : `Remove ${pendingChange.name}’s admin access?`;
      document.querySelector("#adminAccessMessage").textContent = pendingChange.grant
        ? `${pendingChange.name} will be able to view and edit all member, event, score, RSVP and payment information.`
        : `${pendingChange.name} will immediately lose access to the Admin page and all protected controls.`;
      document.querySelector("#adminAccessConfirmLabel").textContent = `I confirm I selected ${pendingChange.name}`;
      confirmCheck.checked = false;
      confirmButton.disabled = true;
      document.querySelector("#adminAccessDialogStatus").textContent = "";
      dialog.showModal();
    }));
    list.querySelectorAll("[data-leaderboard-id]").forEach(input => input.addEventListener("change", async event => {
      const control = event.currentTarget;
      const makeActive = control.checked;
      control.disabled = true;
      const { error: membershipError } = await client.rpc("set_member_leaderboard_access", {
        target_user_id: control.dataset.leaderboardId,
        make_active: makeActive
      });
      if (membershipError) {
        control.checked = !makeActive;
        control.disabled = false;
        document.querySelector("#adminAccountStatus").textContent = membershipError.message;
        return;
      }
      document.querySelector("#adminAccountStatus").textContent = makeActive
        ? `${control.dataset.leaderboardName} has joined from the next eligible round.`
        : `${control.dataset.leaderboardName} has been removed from future leaderboard participation. Historical scores are preserved.`;
      await loadAccounts();
    }));
    list.querySelectorAll("[data-contacted-id]").forEach(input => input.addEventListener("change", async event => {
      const control = event.currentTarget;
      const { error: contactedError } = await client.from("profiles")
        .update({ committee_contacted: control.checked, updated_at: new Date().toISOString() })
        .eq("id", control.dataset.contactedId);
      if (contactedError) {
        control.checked = !control.checked;
        setStatus("#adminAccountStatus", contactedError.message);
        return;
      }
      setStatus("#adminAccountStatus", control.checked ? "Member marked as contacted." : "Contacted marker removed.");
      await loadAccounts();
    }));
  };

  confirmCheck?.addEventListener("change", () => {
    confirmButton.disabled = !confirmCheck.checked;
  });

  confirmButton?.addEventListener("click", async () => {
    if (!pendingChange || !confirmCheck.checked) return;
    confirmButton.disabled = true;
    confirmButton.textContent = "Saving…";
    const { error } = await client.rpc("set_member_admin_access", {
      target_user_id: pendingChange.id,
      grant_access: pendingChange.grant,
      confirmation_name: pendingChange.name
    });
    if (error) {
      document.querySelector("#adminAccessDialogStatus").textContent = error.message;
      confirmButton.disabled = false;
      confirmButton.textContent = "Confirm change";
      return;
    }
    dialog.close();
    document.querySelector("#adminAccountStatus").textContent = pendingChange.grant
      ? `${pendingChange.name} now has administrator access.`
      : `${pendingChange.name}’s administrator access has been removed.`;
    confirmButton.textContent = "Confirm change";
    pendingChange = null;
    await loadAccounts();
  });

  const display = async () => {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      login.classList.remove("hidden");
      dashboard.classList.add("hidden");
      denied.classList.add("hidden");
      return;
    }
    const { data: profile } = await client.from("profiles").select("id,full_name,is_admin").eq("id", session.user.id).single();
    signedInProfile = profile;
    login.classList.add("hidden");
    dashboard.classList.toggle("hidden", !profile?.is_admin);
    denied.classList.toggle("hidden", Boolean(profile?.is_admin));
    if (profile?.is_admin) {
      await Promise.allSettled([
        loadEvents(),
        loadRounds(),
        loadGallery(),
        loadContent(),
        loadAccounts()
      ]);
    }
  };

  document.querySelector("#adminLoginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    status.textContent = "Signing in…";
    const { error } = await client.auth.signInWithPassword({
      email: document.querySelector("#adminEmail").value.trim().toLowerCase(),
      password: document.querySelector("#adminPassword").value
    });
    if (error) {
      status.textContent = "Email or password not recognised.";
      return;
    }
    status.textContent = "";
    await display();
  });

  document.querySelector("#adminSignOut")?.addEventListener("click", async () => {
    await client.auth.signOut();
    display();
  });
  display();
})();
