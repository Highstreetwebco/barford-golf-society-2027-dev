const b = await window.barfordReady;
const { raw, state, escape: e, submit } = b;
const isSignup = location.pathname.endsWith("signup.html");
const redirect = b.nextPath();
if (isSignup) {
  document.getElementById("signInLink").href =
    "account.html?next=" + encodeURIComponent(redirect);
  document.getElementById("signupForm").onsubmit = (ev) => {
    ev.preventDefault();
    submit(ev.target, async () => {
      const f = new FormData(ev.target),
        name = String(f.get("full_name")).trim();
      if (!name) throw new Error("Enter your full name.");
      const { data, error } = await raw.auth.signUp({
        email: String(f.get("email")).trim(),
        password: String(f.get("password")),
        options: {
          data: { full_name: name },
          emailRedirectTo: new URL("account.html", location.href).href,
        },
      });
      if (error) throw error;
      if (data.session) {
        location.href = redirect;
        return;
      }
      const status = ev.target.querySelector('[role="status"]');
      status.classList.add("success");
      status.textContent =
        "Check your email for a confirmation link, then sign in. If you already have an account, use Sign in or reset your password.";
    });
  };
  if (state.user) {
    document.getElementById("signupForm").innerHTML =
      `<h2>You’re already signed in.</h2><p>Continue with your existing account.</p><a class="button" href="${e(redirect)}">Continue</a><a href="account.html">My account</a>`;
  }
} else {
  const area = document.getElementById("accountContent");
  async function render() {
    if (state.recovery) {
      passwordForm(true);
      return;
    }
    if (!state.user) {
      renderSignIn();
      return;
    }
    document.querySelector(".page-heading h1").textContent = "Your account.";
    const p = state.profile || {};
    area.innerHTML = `<section class="panel"><form id="profileForm" class="form-stack"><h2>Your details</h2><label for="profileName">Full name</label><input id="profileName" name="full_name" autocomplete="name" maxlength="150" value="${e(p.full_name || "")}" required><label for="profileEmail">Email address</label><input id="profileEmail" type="email" value="${e(state.user.email || "")}" readonly><label for="profilePhone">Phone number <span class="muted">(optional)</span></label><input id="profilePhone" name="phone" type="tel" autocomplete="tel" maxlength="40" value="${e(p.phone || "")}" aria-describedby="phoneHelp"><small id="phoneHelp">Only visible to the organisers.</small><button>Save details</button><p class="form-status" role="status"></p></form><div class="actions"><button id="changePassword" class="secondary">Change password</button><button id="signOut" class="secondary">Sign out</button></div></section><aside><section class="panel"><p class="eyebrow">YOUR GOLF</p><h2>Your RSVPs</h2><div id="myRsvps" class="member-summary">Loading…</div><a class="button secondary" href="events.html" style="margin-top:22px">All events</a></section>${state.admin ? '<a class="button section" href="admin.html">Organiser tools</a>' : ""}</aside>`;
    document.getElementById("profileForm").onsubmit = (ev) => {
      ev.preventDefault();
      submit(ev.target, async () => {
        const f = new FormData(ev.target),
          name = String(f.get("full_name")).trim(),
          phone = String(f.get("phone")).trim();
        if (!name) throw new Error("Enter your full name.");
        if (phone && phone.length < 5)
          throw new Error("Enter a valid phone number or leave it blank.");
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
                `<a href="events.html#event-${r.event_id}"><strong>${e(r.baseline_events.name)}</strong><span>${e(b.date(r.baseline_events.date))}</span><br><span>${r.baseline_events.cancelled ? "Event cancelled" : r.reserve ? "On the waiting list" : r.attending ? "Playing" : "Not playing"}</span></a>`,
            )
            .join("")
        : '<p class="muted">No upcoming responses yet. Find a golf day and save your RSVP.</p>';
  }
  function renderSignIn() {
    const reset = new URLSearchParams(location.search).get("mode") === "reset";
    area.innerHTML = `<section class="panel"><form id="loginForm" class="form-stack"><h2>${reset ? "Reset your password" : "Sign in"}</h2><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required>${reset ? "" : '<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>'}<button>${reset ? "Send reset link" : "Sign in"}</button><p class="form-status" role="status"></p><div class="dialog-links"><a href="signup.html?next=${encodeURIComponent(redirect)}">Create an account</a><a href="account.html${reset ? "" : "?mode=reset"}">${reset ? "Back to sign in" : "Forgot password?"}</a></div></form></section><aside class="account-aside"><p class="eyebrow">YOUR NEXT ROUND STARTS HERE</p><h2>A few taps.<br>Then you’re in.</h2><p>Use the same account for every event. Your saved RSVP can be updated whenever your plans change.</p><p>Already have a 2027 account? Your existing login still works.</p></aside>`;
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
          const { error } = await raw.auth.signInWithPassword({
            email,
            password: String(f.get("password")),
          });
          if (error) throw error;
          location.href = redirect;
        }
      });
    };
  }
  function passwordForm(recovery) {
    document.querySelector(".page-heading h1").textContent =
      "Choose a new password.";
    area.innerHTML = `<section class="panel"><form id="passwordForm" class="form-stack"><h2>${recovery ? "Reset password" : "Change password"}</h2>${recovery ? "" : '<label for="currentPassword">Current password</label><input id="currentPassword" type="password" name="current" autocomplete="current-password" required>'}<label for="newPassword">New password</label><input id="newPassword" name="password" type="password" minlength="8" autocomplete="new-password" required><small>Use at least 8 characters.</small><label for="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirm" type="password" minlength="8" autocomplete="new-password" required><button>Save password</button><p class="form-status" role="status"></p><a href="account.html">Back to my account</a></form></section>`;
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
