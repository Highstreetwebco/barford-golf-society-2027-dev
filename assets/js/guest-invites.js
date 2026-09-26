const b = await window.barfordReady,
  e = b.escape;
export async function guestAction(action, payload = {}) {
  const { data, error } = await b.client.rpc("guest_invitations", {
    action,
    payload,
  });
  if (error) throw error;
  return data;
}
export function inviteURL(token) {
  const url = new URL("guest.html", location.href);
  url.hash = token;
  return url.href;
}
export function shareInvite(ev, token, host) {
  const url = inviteURL(token);
  const message = `${host} has invited you to join Barford Golf Society for ${ev.name} on ${b.date(ev.date)}${ev.first_time ? `, first tee ${ev.first_time}` : ""}.\n\nGuest price: ${b.money(ev.guest_price)}. Create your account and join this round using the link below. We’ll try to place you in the same tee group as your host. Places are subject to availability.\n\n${url}`;
  const dialog = document.createElement("dialog");
  dialog.className = "invite-dialog";
  dialog.setAttribute("aria-label", "Share guest invitation");
  dialog.innerHTML = `<h2>Your guest invitation</h2><p>Send this invitation to one person. Create another invite for another guest.</p><label>Invitation message<textarea rows="10" readonly>${e(message)}</textarea></label><div class="actions section"><button data-share>Send invite</button><button class="secondary" data-copy>Copy invitation</button><button class="secondary" data-close>Close</button></div><div data-fallback hidden><p>Choose WhatsApp, or copy the invitation and paste it into Messenger or another app.</p><a class="button secondary" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(message)}">Open WhatsApp</a></div><p role="status"></p>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  const status = dialog.querySelector("[role=status]");
  const fallback = () => {
    dialog.querySelector("[data-fallback]").hidden = false;
  };
  dialog.querySelector("[data-share]").onclick = async () => {
    if (!navigator.share) {
      fallback();
      return;
    }
    try {
      await navigator.share({
        title: "Barford guest invitation",
        text: message,
      });
      status.textContent =
        "Share menu opened. Complete sending in your chosen app.";
    } catch (err) {
      if (err.name !== "AbortError") {
        fallback();
        status.textContent =
          "Your browser could not open sharing. Use the options below.";
      }
    }
  };
  dialog.querySelector("[data-copy]").onclick = async () => {
    try {
      await navigator.clipboard.writeText(message);
      status.textContent = "Invitation copied. Paste it into your message.";
    } catch {
      dialog.querySelector("textarea").select();
      status.textContent = "Select and copy the invitation above.";
    }
  };
}
export async function mountGuestInvites(area, ev, category = "member") {
  let data;
  try {
    data = await guestAction("mine", { event_id: ev.id });
  } catch {
    data = { links: [], bookings: [] };
  }
  const booking = (data.bookings || []).find((x) => x.event_id === ev.id);
  if (booking) {
    area.innerHTML = `<h3>Your guest place</h3><p>Invited by ${e(booking.host_name)} · Guest price ${b.money(booking.guest_price)}</p><p>${booking.reserve ? "Waiting list — no payment is due until your place is confirmed." : booking.attending ? "We’ll try to place you in your host’s tee group." : "You have withdrawn from this round."}</p>${booking.status === "pending" ? '<p class="notice">Your handicap is awaiting committee approval. Your booking is saved.</p>' : ""}`;
    return;
  }
  if ((data.category || category) === "guest" || ev.cancelled) {
    area.hidden = true;
    return;
  }
  area.innerHTML = `<h3>Bring a guest</h3><p>${ev.guest_price == null ? "The organiser needs to confirm the guest price before invitations can be sent." : `Guest price: <strong>${b.money(ev.guest_price)}</strong>. Your guest fills in their own details. We’ll try to group you together.`}</p><button data-create-invite ${ev.guest_price == null ? "disabled" : ""}>Invite a guest</button><div data-invites>${(
    data.links || []
  )
    .filter((l) => !l.revoked)
    .map(
      (l, i) =>
        `<div class="response-row section"><span>${l.claimed ? `${e(l.guest_name)} (guest) has joined` : `Unused invitation ${i + 1}`}</span>${!l.claimed ? `<button class="secondary" data-reshare="${e(l.token)}">Share invite again</button><button class="text-button" data-revoke="${e(l.token)}">Cancel invite</button>` : ""}</div>`,
    )
    .join("")}</div><p role="status"></p>`;
  area.querySelector("[data-create-invite]").onclick = async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const link = await guestAction("create", { event_id: ev.id });
      shareInvite(ev, link.token, link.host_name);
      await mountGuestInvites(area, ev, category);
    } catch (err) {
      area.querySelector("[role=status]").textContent = err.message;
      btn.disabled = false;
    }
  };
  for (const btn of area.querySelectorAll("[data-reshare]"))
    btn.onclick = () =>
      shareInvite(
        ev,
        btn.dataset.reshare,
        b.state.profile?.full_name || "A Barford member",
      );
  for (const btn of area.querySelectorAll("[data-revoke]"))
    btn.onclick = async () => {
      if (
        !confirm("Cancel this unused invitation? Its link will stop working.")
      )
        return;
      btn.disabled = true;
      try {
        await guestAction("revoke", { token: btn.dataset.revoke });
        await mountGuestInvites(area, ev, category);
      } catch (err) {
        area.querySelector("[role=status]").textContent = err.message;
        btn.disabled = false;
      }
    };
}
