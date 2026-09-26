import { guestAction } from "./guest-invites.js?v=2027-colour-1";
import {
  photoPickerHTML,
  wirePhotoPicker,
  savePhoto,
} from "./member-photos.js?v=2027-colour-1";
const b = await window.barfordReady,
  e = b.escape,
  area = document.getElementById("guestJoin");
const token = location.hash.slice(1);
async function render() {
  if (!/^[a-f0-9-]{36}$/i.test(token)) {
    area.innerHTML =
      "<h2>Invitation not found</h2><p>Open the complete link sent by your host.</p>";
    return;
  }
  const invite = await guestAction("view", { token });
  if (!["open", "joined"].includes(invite.status)) {
    area.innerHTML = `<h2>${invite.status === "used" ? "This invitation has been used" : invite.status === "closed" ? "Bookings are closed" : "Invitation unavailable"}</h2><p>Ask your host for help or sign in if you already joined.</p><a class="button" href="account.html">Sign in</a>`;
    return;
  }
  document.querySelector("h1").textContent =
    `You’re invited to ${invite.event_name}.`;
  const eventURL = `event.html?id=${invite.event_id}`;
  if (invite.status === "joined") {
    area.innerHTML = `<h2>You’ve joined this round</h2><p>Your RSVP is saved. You can view your booking, payment details and tee group on the event page.</p><a class="button" href="${eventURL}">View your round</a><a class="button secondary" href="index.html">Go to homepage</a>`;
    return;
  }
  const golf = invite.event_type !== "social";
  area.innerHTML = `<p class="eyebrow">INVITED BY ${e(invite.host_name)}</p><h2>${e(b.date(invite.date))}</h2><p>${e(invite.location || "")}${invite.first_time ? ` · ${golf ? "First tee" : "Starts"} ${e(invite.first_time)}` : ""}</p><p class="notice"><strong>Guest price: ${invite.guest_price == null ? "To be confirmed" : b.money(invite.guest_price)}</strong>${invite.payment_due ? ` · Pay by ${e(b.date(invite.payment_due))}` : ""}</p><p>${invite.waiting ? "This round is currently full. Join the waiting list; you will not be charged until a place is confirmed." : "Joining adds you to this round, subject to places still being available."} We’ll try to place you with ${e(invite.host_name)}.</p>${invite.guest_price == null ? "<p>The organiser must set the guest price before you can join.</p>" : `<form class="form-stack" id="guestForm"><h3>${b.state.user ? "Join with your account" : "Create your guest account"}</h3>${b.state.user ? `<p>Signed in as <strong>${e(b.state.profile?.full_name)}</strong>. <a href="account.html">Use a different account</a></p>` : `<label>Full name<input name="full_name" autocomplete="name" required minlength="2" maxlength="150"></label><small>Your full name will be your username. Use it with your password next time.</small><label>Contact number<input name="phone" type="tel" autocomplete="tel" required minlength="10" maxlength="25"></label><small>Visible to organisers and your assigned buggy partner.</small><label>Create a password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>`}${golf ? `<label>Your current handicap<input name="guest_handicap" type="number" inputmode="decimal" min="0" max="54" step="0.1" required value="${e(b.state.profile?.handicap ?? "")}"></label><small>The committee approves new society handicaps before play. Existing society handicaps continue to apply.</small><label class="check"><input type="checkbox" name="buggy"> I need a buggy</label><label for="guestPreferred">Preferred tee time</label><select id="guestPreferred" name="preferred_time"><option value="">No preference</option><option>First</option><option>Middle</option><option>End</option></select>` : ""}<div data-photo>${photoPickerHTML()}</div>${invite.cancellation_terms ? `<div class="notice preserve-lines">${e(invite.cancellation_terms)}</div><label class="check"><input name="accept_terms" type="checkbox" required> I accept the cancellation terms</label>` : ""}<button type="submit">${b.state.user ? "Join this round" : invite.waiting ? "Create account & join waiting list" : "Create account & join round"}</button><p class="form-status" role="status"></p>${!b.state.user ? '<p>Already have an account? <button type="button" class="text-button" data-sign-in>Sign in to join</button></p>' : ""}</form>`}`;
  const form = area.querySelector("form");
  if (!form) return;
  const portrait = wirePhotoPicker(form.querySelector("[data-photo]"));
  form.querySelector("[data-sign-in]")?.addEventListener("click", async () => {
    if (await b.signIn()) await render();
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    b.submit(form, async () => {
      const f = new FormData(form),
        photo = await portrait();
      const payload = {
        token,
        guest_token: token,
        guest_price: invite.guest_price,
        guest_handicap: f.get("guest_handicap") || null,
        buggy: f.has("buggy"),
        preferred_time: f.get("preferred_time") || null,
        accept_terms: f.has("accept_terms"),
        terms_snapshot: invite.cancellation_terms,
      };
      let user = b.state.user;
      if (!user) {
        const { data, error } = await b.raw.auth.signUp({
          email: `member-${crypto.randomUUID()}@members.barford2027.invalid`,
          password: String(f.get("password")),
          options: {
            data: {
              ...payload,
              full_name: String(f.get("full_name")).trim(),
              phone: String(f.get("phone")).trim(),
              name_confirmation: true,
            },
          },
        });
        if (error)
          throw new Error(
            error.message.includes("Database")
              ? "We could not create this account. If your name or mobile is already registered, sign in instead. Otherwise refresh the invite to check the price and availability."
              : error.message,
          );
        if (!data.session)
          throw new Error(
            "Your account was created but needs organiser help to sign in. Do not create another account.",
          );
        user = data.user;
      } else await guestAction("join", payload);
      let photoMessage = "";
      if (photo) {
        try {
          await savePhoto(
            photo,
            user.id,
            b.state.profile?.baseline_avatar_path,
          );
        } catch {
          photoMessage =
            " Your booking is saved, but your photo could not upload. Add it later in My account.";
        }
      }
      await b.refresh();
      const mine = await guestAction("mine"),
        booking = (mine.bookings || []).find(
          (x) => x.event_id === invite.event_id,
        );
      area.innerHTML = `<h2>${booking?.reserve ? "You’re on the waiting list" : "You’re booked as a guest"}</h2><p>${booking?.reserve ? "No payment is due until your place is confirmed." : "Your account and RSVP are saved. View the bank details and payment reference on your round page."}${e(photoMessage)}</p><p>Your username is <strong>${e(b.state.profile?.full_name)}</strong>. This device remembers your sign-in.</p><a class="button" href="${eventURL}#rsvp">View round & payment details</a><a class="button secondary" href="index.html">Go to homepage</a>`;
    });
  };
}
render().catch((err) => {
  area.innerHTML = `<h2>Invitation could not load</h2><p>${e(err.message)}</p><button onclick="location.reload()">Try again</button>`;
});
