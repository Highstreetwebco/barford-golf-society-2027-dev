import { mountPayments } from "./operations.js?v=2027-colour-1";
import {
  photoPickerHTML,
  wirePhotoPicker,
  savePhoto,
  mountPhotoEditor,
} from "./member-photos.js?v=2027-colour-1";
const b = await window.barfordReady;
const { raw, state, escape: e, submit } = b;
const isSignup = location.pathname.endsWith("signup.html");
const redirect = b.nextPath();
if (isSignup) {
  document.getElementById("signInLink").href =
    "account.html?next=" + encodeURIComponent(redirect);
  const selector = document.getElementById("memberName");
  let roster = [];
  try {
    const result = await b.client.rpc("member_roster");
    if (result.error) throw result.error;
    roster = result.data;
    selector.innerHTML =
      '<option value="">Select your name</option>' +
      roster
        .map(
          (m) =>
            `<option value="${e(m.id)}" ${m.claimed ? "disabled" : ""}>${e(m.name)}${m.claimed ? " — account already created" : ""}</option>`,
        )
        .join("");
  } catch {
    selector.innerHTML =
      '<option value="">Names could not load. Please refresh.</option>';
  }
  selector.onchange = () =>
    (document.getElementById("fullName").value =
      roster.find((m) => m.id === selector.value)?.name || "");
  const invited = new URLSearchParams(location.search).get("member");
  if (invited && roster.some((m) => m.id === invited && !m.claimed)) {
    selector.value = invited;
    selector.onchange();
  }
  const help = document.createElement("p");
  help.innerHTML =
    '<a href="about.html#join">My name isn’t listed / I’m new to the society</a>';
  selector.after(help);
  const photoArea = document.createElement("div");
  photoArea.className = "form-stack";
  photoArea.innerHTML = photoPickerHTML();
  document.querySelector("#signupForm button[type=submit]").before(photoArea);
  const selectedPhoto = wirePhotoPicker(photoArea);
  document.getElementById("signupForm").onsubmit = (ev) => {
    ev.preventDefault();
    submit(ev.target, async () => {
      const f = new FormData(ev.target),
        member = roster.find((m) => m.id === f.get("roster_id"));
      if (!member || member.claimed)
        throw new Error(
          "Choose your own available name. If it is already claimed, sign in or contact an organiser.",
        );
      const portrait = await selectedPhoto();
      if (!(await confirmName(member.name))) return;
      const { data, error } = await raw.auth.signUp({
        email: "member-" + crypto.randomUUID() + "@members.barford2027.invalid",
        password: String(f.get("password")),
        options: {
          data: {
            roster_id: member.id,
            full_name: member.name,
            phone: String(f.get("phone")).trim(),
            name_confirmation: true,
          },
        },
      });
      if (error)
        throw new Error(
          error.message.includes("Database")
            ? "This name may already have an account, or the mobile number is invalid. Refresh the list and check your details."
            : error.message,
        );
      if (!data.session)
        throw new Error(
          "Your account needs organiser help to finish signing in. Please do not create another account.",
        );
      if (portrait) {
        try {
          await savePhoto(portrait, data.user.id);
        } catch (error) {
          ev.target.innerHTML = `<h2>Your account is ready.</h2><p>Your photo could not be saved: ${e(error.message)}</p><p>You can add it later in My account.</p><a class="button" href="${e(redirect)}">Continue to the homepage</a><a href="account.html">Add my photo</a>`;
          return;
        }
      }
      location.href = redirect;
    });
  };
  if (state.user) {
    document.getElementById("signupForm").innerHTML =
      `<h2>You’re already signed in.</h2><p>Continue with your existing account.</p><a class="button" href="${e(redirect)}">Continue</a><a href="account.html">My account</a>`;
  }
} else {
  const area = document.getElementById("accountContent");
  async function render() {
    if (state.recovery && state.user) {
      passwordForm(true);
      return;
    }
    if (!state.user) {
      renderSignIn();
      return;
    }
    document.querySelector(".page-heading h1").textContent = "Your account.";
    const p = state.profile || {};
    const membership = await raw
      .from("baseline_member_accounts")
      .select("member_id,disabled")
      .eq("user_id", state.user.id)
      .maybeSingle();
    const linked = !!membership.data?.member_id;
    if (membership.data?.disabled) {
      area.innerHTML =
        '<section class="panel"><h2>Account needs organiser help</h2><p>This account’s name has been released. Contact an organiser before using it again.</p><button id="blockedSignOut">Sign out</button></section>';
      document.getElementById("blockedSignOut").onclick = async () => {
        await raw.auth.signOut();
        location.reload();
      };
      return;
    }

    area.innerHTML = `<section class="panel"><form id="profileForm" class="form-stack"><h2>Your details</h2><label for="profileName">Username (your name)</label><input id="profileName" name="full_name" autocomplete="name" maxlength="150" value="${e(p.full_name || "")}" ${linked ? "readonly" : ""} required>${state.user.email?.endsWith("@members.barford2027.invalid") ? "" : `<label for="profileEmail">Existing account email</label><input id="profileEmail" type="email" value="${e(state.user.email || "")}" readonly>`}<label for="profilePhone">Mobile number</label><input id="profilePhone" name="phone" type="tel" autocomplete="tel" maxlength="25" required value="${e(p.phone || "")}" aria-describedby="phoneHelp"><small id="phoneHelp">Visible to organisers and your assigned buggy partner.</small><button>Save details</button><p class="form-status" role="status"></p></form><div class="actions"><button id="changePassword" class="secondary">Change password</button><button id="signOut" class="secondary">Sign out</button></div></section><aside><section class="panel"><p class="eyebrow">YOUR GOLF</p><h2>Your RSVPs</h2><div id="myRsvps" class="member-summary">Loading…</div><a class="button secondary" href="events.html" style="margin-top:22px">All events</a></section>${state.admin ? '<a class="button section" href="admin.html">Organiser tools</a>' : ""}</aside>`;
    const payments = document.createElement("section");
    payments.id = "payments";
    payments.className = "panel section full";
    area.append(payments);
    await mountPayments(payments);
    if (location.hash === "#payments") payments.scrollIntoView();
    const photoEditor = document.createElement("section");
    photoEditor.className = "panel section";
    area.querySelector("section").after(photoEditor);
    await mountPhotoEditor(photoEditor);
    if (!linked) {
      const claim = document.createElement("section");
      claim.className = "panel section";
      claim.innerHTML =
        '<h2>Link your scoreboard name</h2><p>Keep your existing account and select your 2026 name. This becomes your username.</p><form id="claimForm" class="form-stack"><label for="claimName">Your name</label><select id="claimName" required></select><button>Link my name</button><p role="status"></p></form>';
      area.prepend(claim);
      const rr = await b.client.rpc("member_roster");
      const available = (rr.data || []).filter((m) => !m.claimed);
      claim.querySelector("select").innerHTML =
        '<option value="">Select your name</option>' +
        available
          .map((m) => `<option value="${e(m.id)}">${e(m.name)}</option>`)
          .join("");
      claim.querySelector("form").onsubmit = (ev) => {
        ev.preventDefault();
        submit(ev.target, async () => {
          const m = available.find(
            (m) => m.id === claim.querySelector("select").value,
          );
          if (!m || !(await confirmName(m.name))) return;
          const result = await b.client.rpc("claim_member", {
            who: m.id,
            mobile: document.getElementById("profilePhone").value,
            confirmed: true,
          });
          if (result.error) throw result.error;
          await b.refresh();
          await render();
        });
      };
    }
    document.getElementById("profileForm").onsubmit = (ev) => {
      ev.preventDefault();
      submit(ev.target, async () => {
        const f = new FormData(ev.target),
          name = String(f.get("full_name")).trim(),
          phone = String(f.get("phone")).trim();
        if (!name) throw new Error("Enter your full name.");
        if (phone.replace(/[^0-9]/g, "").length < 10)
          throw new Error("Enter a valid mobile number.");
        const { error } = await raw
          .from("profiles")
          .update({ full_name: name, phone: phone || null })
          .eq("id", state.user.id);
        if (error) throw error;
        await b.refresh();
        const status = ev.target.querySelector('[role="status"]');
        status.textContent = "Your details are saved.";
        status.classList.add("success");
      });
    };
    document.getElementById("signOut").onclick = async () => {
      const { error } = await raw.auth.signOut();
      if (error) {
        b.toast(error.message);
        return;
      }
      location.href = "account.html";
    };
    document.getElementById("changePassword").onclick = () =>
      passwordForm(false);
    const { data, error } = await b.client
      .from("rsvps")
      .select(
        "event_id,attending,reserve,buggy,preferred_time,baseline_events(name,date,cancelled)",
      )
      .eq("user_id", state.user.id);
    const list = (data || [])
      .filter(
        (r) =>
          r.baseline_events &&
          r.baseline_events.date >= new Date().toLocaleDateString("en-CA"),
      )
      .sort((a, c) =>
        a.baseline_events.date.localeCompare(c.baseline_events.date),
      );
    document.getElementById("myRsvps").innerHTML = error
      ? "<p>Unable to load your RSVPs. Please try again.</p>"
      : list.length
        ? list
            .map(
              (r) =>
                `<a href="event.html?id=${r.event_id}"><strong>${e(r.baseline_events.name)}</strong><span>${e(b.date(r.baseline_events.date))}</span><br><span>${r.baseline_events.cancelled ? "Event cancelled" : r.reserve ? "On the waiting list" : r.attending ? "Playing" : "Not playing"}</span></a>`,
            )
            .join("")
        : '<p class="muted">No upcoming responses yet. Find a golf day and save your RSVP.</p>';
  }
  function renderSignIn() {
    const reset = new URLSearchParams(location.search).get("mode") === "reset";
    area.innerHTML = `${reset ? '<p class="notice">For a name-only account, contact an organiser to reset your password. Email reset is only for existing email accounts.</p>' : ""}<section class="panel"><form id="loginForm" class="form-stack"><h2>${reset ? "Reset your password" : "Sign in"}</h2><label for="email">${reset ? "Existing account email" : "Username (your name), or existing email"}</label><input id="email" name="email" type="${reset ? "email" : "text"}" autocomplete="username" required>${reset ? "" : '<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>'}<button>${reset ? "Send reset link" : "Sign in"}</button><p class="form-status" role="status"></p><div class="dialog-links"><a href="signup.html?next=${encodeURIComponent(redirect)}">Create an account</a><a href="account.html${reset ? "" : "?mode=reset"}">${reset ? "Back to sign in" : "Forgot password?"}</a></div></form></section><aside class="account-aside"><p class="eyebrow">YOUR NEXT ROUND STARTS HERE</p><h2>A few taps.<br>Then you’re in.</h2><p>Use the same account for every event. Your saved RSVP can be updated whenever your plans change.</p><p>Your device remembers your login. Already have a 2027 account? Your existing email login still works.</p></aside>`;
    document.getElementById("loginForm").onsubmit = (ev) => {
      ev.preventDefault();
      submit(ev.target, async () => {
        const f = new FormData(ev.target),
          email = String(f.get("email")).trim();
        if (reset) {
          const { error } = await raw.auth.resetPasswordForEmail(email, {
            redirectTo: new URL("account.html?mode=recovery", location.href)
              .href,
          });
          if (error) throw error;
          const status = ev.target.querySelector('[role="status"]');
          status.textContent =
            "If an account exists for this email, you’ll receive a reset link.";
          status.classList.add("success");
        } else {
          await b.login(email, String(f.get("password")));
          location.href = redirect;
        }
      });
    };
  }
  function passwordForm(recovery) {
    document.querySelector(".page-heading h1").textContent =
      "Choose a new password.";
    area.innerHTML = `<section class="panel"><form id="passwordForm" class="form-stack"><h2>${recovery ? "Reset password" : "Change password"}</h2>${recovery ? "" : '<label for="currentPassword">Current password</label><input id="currentPassword" type="password" name="current" autocomplete="current-password" required>'}<label for="newPassword">New password</label><input id="newPassword" name="password" type="password" minlength="8" autocomplete="new-password" required><small>Use at least 8 characters.</small><label for="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirm" type="password" minlength="8" autocomplete="new-password" required><button>Save password</button><p class="form-status" role="status"></p><a href="account.html">Back to my account</a></form></section>`;
    area.querySelector('a[href="account.html"]').onclick = async (event) => {
      event.preventDefault();
      state.recovery = false;
      sessionStorage.removeItem("barford-password-recovery");
      history.replaceState(null, "", "account.html");
      await render();
    };
    document.getElementById("passwordForm").onsubmit = (ev) => {
      ev.preventDefault();
      submit(ev.target, async () => {
        const f = new FormData(ev.target),
          password = String(f.get("password"));
        if (password !== f.get("confirm"))
          throw new Error("Your passwords do not match.");
        const args = { password };
        if (!recovery) args.currentPassword = String(f.get("current"));
        const { error } = await raw.auth.updateUser(args);
        if (error) throw error;
        state.recovery = false;
        sessionStorage.removeItem("barford-password-recovery");
        history.replaceState(null, "", "account.html");
        await b.refresh();
        await render();
        b.toast("Your password has been updated.");
      });
    };
  }
  window.addEventListener("barford-recovery", () => passwordForm(true));
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("error_description")) b.toast(params.get("error_description"));
  await render();
}

async function confirmName(name) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", "confirmNameTitle");
  dialog.innerHTML = `<h2 id="confirmNameTitle">Are you ${e(name)}?</h2><p>You are creating an account under <strong>${e(name)}</strong>. This will be your username.</p><p class="notice">Only continue if this is you. Creating an account for someone else could ruin the setup for the season, so please don’t try to be funny.</p><div class="actions"><button data-confirm>Yes, I am ${e(name)}</button><button class="secondary" data-cancel>Go back</button></div>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    const finish = (x) => {
      dialog.close();
      dialog.remove();
      resolve(x);
    };
    dialog.querySelector("[data-confirm]").onclick = () => finish(true);
    dialog.querySelector("[data-cancel]").onclick = () => finish(false);
    dialog.oncancel = (ev) => {
      ev.preventDefault();
      finish(false);
    };
    dialog.showModal();
    dialog.querySelector("[data-cancel]").focus();
  });
}
