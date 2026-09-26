const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const target = path.resolve(
    root,
    "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
  );
  if (
    !target.startsWith(root + path.sep) ||
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
  ) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader(
    "Content-Type",
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
    }[path.extname(target)] || "application/octet-stream",
  );
  fs.createReadStream(target).pipe(res);
});
const base = "http://127.0.0.1:8765/",
  backend = "https://xspzmthygrajzktydvvj.supabase.co";
const uid = "11111111-1111-4111-8111-111111111111",
  user = {
    id: uid,
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.invalid",
    user_metadata: { full_name: "Test Member" },
    app_metadata: { provider: "email" },
    created_at: "2026-01-01T00:00:00Z",
  };
const jwt =
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ) +
  "." +
  Buffer.from(
    JSON.stringify({ sub: uid, exp: 4102444800, role: "authenticated" }),
  ).toString("base64url") +
  ".test";
const session = {
  access_token: jwt,
  refresh_token: "mock-refresh-token",
  expires_in: 3600,
  expires_at: 4102444800,
  token_type: "bearer",
  user,
};
const fixture = {
  id: 999,
  name: "The Warwickshire Golf Day",
  date: "2027-06-25",
  location: "The Warwickshire · Kings Course",
  price: "£45 per person",
  description:
    "Join us for coffee and bacon rolls before 18 holes.\nMeet at the clubhouse 45 minutes before your tee time.",
  max_players: 24,
  first_time: "10:00",
  cancelled: false,
  tee_times_dirty: false,
};
async function mocks(context, { signedIn = false, admin = false } = {}) {
  const model = {
    responses: [],
    payloads: [],
    wait: false,
    signup: [],
    events: [
      fixture,
      { ...fixture, id: 998, name: "Cancelled golf day", cancelled: true },
      { ...fixture, id: 997, name: "Past golf day", date: "2025-06-25" },
    ],
    profile: {
      id: uid,
      full_name: "Test Member",
      email: user.email,
      phone: "07000000000",
    },
    groups: [],
    orders: [],
    products: [
      {
        id: 1,
        name: "Society golf balls",
        description: "A dozen balls for your next round.",
        price: 18,
        packs_left: 4,
        image: "",
        active: true,
      },
    ],
  };
  if (signedIn)
    await context.addInitScript(
      ({ session }) =>
        localStorage.setItem(
          "sb-xspzmthygrajzktydvvj-auth-token",
          JSON.stringify(session),
        ),
      { session },
    );
  await context.route(backend + "/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname,
      method = req.method();
    const body = req.postData()
      ? (() => {
          try {
            return req.postDataJSON();
          } catch {
            return {};
          }
        })()
      : {};
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (p === "/functions/v1/baseline-services") {
      if (body.action === "login")
        return body.password === "wrong-password"
          ? reply({ error: "Check your username and password." }, 400)
          : reply({ session });
      if (body.action === "course") return reply(model.course || {});
      if (body.action === "weather")
        return reply(model.weather || { status: "too_early" });
      if (body.action === "search_course") return reply({ places: [] });
      if (body.action === "admin_reset_password") {
        model.passwordReset = body;
        return reply({ updated: true });
      }
    }
    if (p.endsWith("/rpc/baseline_league_admin"))
      return reply(model.league || { revision: 0, players: [], rounds: [] });
    if (p.endsWith("/rpc/baseline_league_board"))
      return reply(
        model.board || {
          players: [],
          rounds: [],
          visible_rounds: admin ? 7 : 5,
        },
      );
    if (p.endsWith("/rpc/baseline_league_save_handicaps")) {
      model.handicaps = body;
      for (const x of body.entries)
        model.league.players.find((p) => p.id === x.user_id).starting_handicap =
          x.handicap;
      model.league.revision++;
      return reply(model.league);
    }
    if (p.endsWith("/rpc/baseline_league_save_round")) {
      model.roundSave = body;
      model.league.revision++;
      model.league.rounds = [
        {
          event_id: body.event,
          round_number: 1,
          draft: body.entries,
          draft_winner: body.chosen_winner,
          published_entries: body.publish ? body.entries : null,
          results: body.publish
            ? body.entries.map((x) => ({
                ...x,
                handicap: 20,
                next_handicap: 18,
                adjustment: -2,
                winner: x.user_id === body.chosen_winner,
              }))
            : null,
        },
      ];
      return reply(model.league);
    }
    if (p.endsWith("/rpc/baseline_admin_accounts"))
      return admin
        ? reply(
            model.accounts || [
              {
                id: uid,
                username: "Test Member",
                mobile: "07000000000",
                handicap: null,
                is_admin: true,
                disabled: false,
                member_id: uid,
                created_at: "2026-09-26T09:00:00Z",
              },
            ],
          )
        : reply({ message: "Organiser access required" }, 403);
    if (p.endsWith("/rpc/baseline_admin_save_account")) {
      model.accountEdits = body;
      const person = model.accounts.find((p) => p.id === body.target);
      Object.assign(person, {
        username: body.username,
        mobile: body.mobile,
        handicap: body.society_handicap,
        is_admin: body.admin_access,
      });
      return reply(null);
    }
    if (p.endsWith("/baseline_member_accounts"))
      return reply({ member_id: uid, disabled: false });
    if (p.endsWith("/rpc/baseline_member_roster"))
      return reply([{ id: uid, name: "New Member", claimed: false }]);
    if (p.endsWith("/rpc/baseline_buggy_details")) {
      if (body.claim)
        model.buggy = {
          ...model.buggy,
          booking_me: true,
          booking_name: "Test Member",
        };
      if (body.release)
        model.buggy = { ...model.buggy, booking_me: false, booking_name: null };
      return reply(model.buggy || { status: "unpaired" });
    }
    if (p === "/auth/v1/token")
      return body.password === "wrong-password"
        ? reply(
            {
              error: "invalid_grant",
              error_description: "Invalid login credentials",
            },
            400,
          )
        : reply(session);
    if (p === "/auth/v1/user") return reply(user);
    if (p === "/auth/v1/logout" || p === "/auth/v1/recover") return reply({});
    if (p === "/auth/v1/signup") {
      model.signup.push(body);
      return reply({ ...session });
    }
    if (p === "/rest/v1/profiles") {
      if (method === "PATCH") Object.assign(model.profile, body);
      return reply(model.profile);
    }
    if (p.endsWith("/rpc/is_admin")) return reply(admin);
    if (p.endsWith("/baseline_events")) {
      if (method === "POST") {
        const obj = { ...fixture, ...body, id: 1001 };
        model.events.push(obj);
        return reply(obj);
      }
      if (method === "PATCH") {
        Object.assign(
          model.events.find((ev) => "eq." + ev.id === u.searchParams.get("id")),
          body,
        );
        return reply(
          model.events.find((ev) => "eq." + ev.id === u.searchParams.get("id")),
        );
      }
      const result = model.events.filter(
        (ev) =>
          !u.searchParams.get("id") ||
          "eq." + ev.id === u.searchParams.get("id"),
      );
      return reply(result);
    }
    if (p.endsWith("/rpc/baseline_event_counts"))
      return reply(
        model.events.map((ev) => ({
          event_id: ev.id,
          playing: model.responses.filter(
            (r) => r.event_id === ev.id && r.attending,
          ).length,
          waiting: model.responses.filter(
            (r) => r.event_id === ev.id && r.reserve,
          ).length,
        })),
      );
    if (p.endsWith("/baseline_rsvps")) {
      return reply(
        u.searchParams.get("user_id") &&
          !u.searchParams.get("select")?.includes("baseline_events")
          ? model.responses.find((r) => r.user_id === uid) || null
          : model.responses.map((r) =>
              u.searchParams.get("select")?.includes("baseline_events")
                ? {
                    ...r,
                    baseline_events: model.events.find(
                      (ev) => ev.id === r.event_id,
                    ),
                  }
                : r,
            ),
      );
    }
    if (p.endsWith("/baseline_tee_times")) return reply(model.groups);
    if (p.endsWith("/rpc/baseline_submit_rsvp")) {
      model.payloads.push(body.payload);
      let r = model.responses.find((r) => r.event_id === body.payload.event_id);
      if (!r) {
        r = {
          id: 111,
          user_id: uid,
          name: "Test Member",
          created_at: "2026-09-26",
          requested_at: "2026-09-26",
        };
        model.responses.push(r);
      }
      Object.assign(r, body.payload, {
        attending: body.payload.attending && !model.wait,
        reserve: body.payload.attending && model.wait,
      });
      if (!body.payload.attending) {
        r.buggy = false;
        r.preferred_time = null;
      }
      return reply(r);
    }
    if (p.endsWith("/rpc/baseline_save_tee_times")) {
      model.groups = body.groups.map((g, i) => ({
        event_id: 999,
        group_number: i + 1,
        tee_time: g.time,
        players: g.players.map((id) => ({
          user_id: id,
          name: "Test Member",
          type: "walker",
        })),
      }));
      return reply(null);
    }
    if (p.endsWith("/baseline_products")) return reply(model.products);
    if (p.endsWith("/baseline_shop_orders")) return reply(model.orders);
    if (p.endsWith("/rpc/baseline_reserve_basket")) {
      model.orders.push({
        id: 1,
        product_id: 1,
        product_name: "Society golf balls",
        quantity: body.items[0].qty,
        price: 18,
        customer_name: body.customer,
        payment_method: body.payment,
        user_id: uid,
        delivered: false,
      });
      return reply(null);
    }
    if (
      p.endsWith("/baseline_players") ||
      p.endsWith("/baseline_scores") ||
      p.endsWith("/baseline_trip_events") ||
      p.endsWith("/baseline_trip_votes") ||
      p.endsWith("/baseline_signups")
    )
      return reply([]);
    if (p.includes("/storage/")) return reply([]);
    throw new Error("Unexpected mocked request: " + method + " " + u.pathname);
  });
  return model;
}
(async () => {
  await new Promise((r) => server.listen(8765, "127.0.0.1", r));
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const width of [390, 1365]) {
      const context = await browser.newContext({
          viewport: { width, height: 960 },
          serviceWorkers: "block",
        }),
        page = await context.newPage();
      let errors = [];
      const connections = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (r.url().includes(".supabase.co")) connections.push(r.url());
      });
      for (const name of [
        "index",
        "events",
        "worldevents",
        "scores",
        "shop",
        "gallery",
        "about",
        "signup",
        "account",
        "admin",
      ]) {
        errors = [];
        try {
          await page.goto(base + name + ".html");
          await page.waitForFunction(() => Boolean(window.barford));
          await page.evaluate(() => window.barfordReady);
          await page.waitForLoadState("networkidle");
          assert.equal(await page.locator("h1").count(), 1, name + " heading");
          assert.equal(
            await page.locator(".site-nav a").count(),
            9,
            name + " navigation",
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 2,
            ),
            false,
            name + " horizontal overflow",
          );
          assert.deepEqual(errors, [], name + " browser errors");
          await page.screenshot({
            path: path.join(out, `${name}-${width}.png`),
            fullPage: true,
          });
          report.push({ page: name, width, status: "passed" });
        } catch (error) {
          report.push({
            page: name,
            width,
            status: "failed",
            error: error.message,
          });
          await page.screenshot({
            path: path.join(out, `${name}-${width}-failed.png`),
            fullPage: true,
          });
        }
      }
      assert(
        connections.every(
          (u) => new URL(u).hostname === "xspzmthygrajzktydvvj.supabase.co",
        ),
        "Unexpected backend connection",
      );
      if (width === 390) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await page.getByRole("link", { name: "Events", exact: true }).click();
        await page
          .getByRole("heading", { name: "Your next golf day." })
          .waitFor();
      }
      await context.close();
    }
    // Member journey uses mocked HTTP responses; no emails or real accounts are created.
    for (const width of [390, 1365]) {
      const context = await browser.newContext({
          viewport: { width, height: 960 },
          serviceWorkers: "block",
        }),
        model = await mocks(context),
        page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "event.html?id=999");
      await page
        .getByRole("button", { name: "Sign in to RSVP", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await page
        .getByLabel("Username (your name)", { exact: true })
        .fill("New Member");
      await page.getByLabel("Password", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByText("Check your username and password.", { exact: true })
        .waitFor();
      await page.getByLabel("Password", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const form = page.locator("#form-999 form");
      await form.waitFor();
      assert.equal(await form.locator("fieldset").count(), 3);
      assert.equal(await form.locator("input:not([type=radio])").count(), 0);
      await form
        .getByRole("radio", { name: "Yes, I’m playing", exact: true })
        .check();
      await form
        .getByRole("radio", { name: "No, I’ll walk", exact: true })
        .check();
      await form.getByRole("radio", { name: "First", exact: true }).check();
      await page.screenshot({
        path: path.join(out, `rsvp-form-${width}.png`),
        fullPage: true,
      });
      await form
        .getByRole("button", { name: "Save RSVP", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit RSVP", exact: true })
        .waitFor();
      assert.equal(model.payloads.length, 1);
      assert(!("name" in model.payloads[0]));
      assert(!("user_id" in model.payloads[0]));
      assert.equal(model.responses.length, 1);
      await page
        .getByRole("button", { name: "Edit RSVP", exact: true })
        .click();
      await form
        .getByRole("radio", { name: "Yes, please", exact: true })
        .check();
      await form.getByRole("radio", { name: "End", exact: true }).check();
      await form
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByText("Buggy requested · End tee time preference", { exact: true })
        .waitFor();
      assert.equal(model.responses.length, 1);
      assert.equal(model.payloads[1].preferred_time, "End");
      await page
        .getByRole("button", { name: "Edit RSVP", exact: true })
        .click();
      await form
        .getByRole("radio", { name: "Not this time", exact: true })
        .check();
      assert.equal(await form.locator("[data-playing]").isVisible(), false);
      await form
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Not playing", exact: true })
        .waitFor();
      assert.equal(model.payloads[2].attending, false);
      model.wait = true;
      await page
        .getByRole("button", { name: "Edit RSVP", exact: true })
        .click();
      await form
        .getByRole("radio", { name: "Yes, I’m playing", exact: true })
        .check();
      await form
        .getByRole("radio", { name: "No, I’ll walk", exact: true })
        .check();
      await form.getByRole("radio", { name: "Middle", exact: true }).check();
      await form
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "On the waiting list", exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#event-998 button[data-rsvp]").count(),
        0,
      );
      await page.locator("#event-999 summary").click();
      await page.screenshot({
        path: path.join(out, `event-saved-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
        "Populated event overflows",
      );
      await page.goto(base + "account.html");
      await page.getByLabel("Username (your name)", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByLabel("Username (your name)", { exact: true })
          .getAttribute("readonly"),
        "",
      );
      await page
        .getByLabel("Mobile number", { exact: true })
        .fill("07000000009");
      await page
        .getByRole("button", { name: "Save details", exact: true })
        .click();
      await page
        .getByText("Your details are saved.", { exact: true })
        .waitFor();
      assert.equal(model.profile.full_name, "Test Member");
      assert.equal(model.profile.phone, "07000000009");
      await page.screenshot({
        path: path.join(out, `account-member-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await page
        .getByLabel("Current password", { exact: true })
        .fill("test-password");
      await page
        .getByLabel("New password", { exact: true })
        .fill("updated-password");
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill("different-password");
      await page
        .getByRole("button", { name: "Save password", exact: true })
        .click();
      await page
        .getByText("Your passwords do not match.", { exact: true })
        .waitFor();
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill("updated-password");
      await page
        .getByRole("button", { name: "Save password", exact: true })
        .click();
      await page.getByLabel("Username (your name)", { exact: true }).waitFor();
      await page.evaluate(() =>
        sessionStorage.setItem("barford-password-recovery", "true"),
      );
      await page.reload();
      await page
        .getByRole("heading", { name: "Reset password", exact: true })
        .waitFor();
      await page
        .getByRole("link", { name: "Back to my account", exact: true })
        .click();
      await page.getByLabel("Username (your name)", { exact: true }).waitFor();
      await page.goto(base + "shop.html");
      await page
        .getByRole("button", { name: "Add to basket", exact: true })
        .click();
      await page.getByRole("button", { name: "Basket 1", exact: true }).click();
      await page
        .getByLabel("How would you like to pay?")
        .selectOption("Cash at Event");
      await page
        .getByRole("button", { name: "Reserve items", exact: true })
        .click();
      await page
        .getByText(
          "Reservation confirmed. Payment is still due by your chosen method.",
          { exact: true },
        )
        .waitFor();
      assert.equal(model.orders.length, 1);
      assert.equal(model.orders[0].customer_name, "Test Member");
      await page.goto(base + "account.html");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page
        .getByRole("heading", { name: "Sign in", exact: true })
        .waitFor();
      await page.goto(base + "signup.html?next=events.html");
      await page.getByLabel("Who are you?", { exact: true }).selectOption(uid);
      assert.equal(
        await page.getByLabel("Your username", { exact: true }).inputValue(),
        "New Member",
      );
      await page
        .getByLabel("Mobile number", { exact: true })
        .fill("07000000003");
      await page.getByLabel("Password", { exact: true }).fill("new-password");
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      assert.equal(
        model.signup.length,
        0,
        "No account before name confirmation",
      );
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      assert.equal(model.signup.length, 0);
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Yes, I am New Member", exact: true })
        .click();
      await page.waitForURL("**/events.html");
      assert.equal(model.signup.length, 1);
      assert.equal(model.signup[0].data.full_name, "New Member");
      assert.equal(model.signup[0].data.roster_id, uid);
      assert.equal(model.signup[0].data.name_confirmation, true);
      assert.equal(model.signup[0].data.phone, "07000000003");
      assert.deepEqual(errors, []);
      report.push({
        page: "member-account-rsvp-shop-flow",
        width,
        status: "passed",
      });
      await context.close();
    }
    // Exercise the populated event details, individual forecast, private buggy state and calendar file.
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 960 },
        serviceWorkers: "block",
      });
      const model = await mocks(context, { signedIn: true });
      const page = await context.newPage();
      model.responses = [
        {
          id: 111,
          event_id: 999,
          user_id: uid,
          name: "Test Member",
          attending: true,
          reserve: false,
          buggy: true,
          preferred_time: null,
        },
      ];
      model.groups = [
        {
          event_id: 999,
          group_number: 1,
          tee_time: "09:32",
          players: [{ user_id: uid, name: "Test Member", type: "buggy" }],
        },
      ];
      model.buggy = {
        status: "paired",
        partner_name: "Partner Member",
        partner_phone: "07000000002",
        booking_me: false,
        booking_name: null,
      };
      model.weather = {
        status: "ready",
        updated_at: "2027-06-24T06:00:00Z",
        hours: Array.from({ length: 7 }, (_, i) => ({
          time: "2027-06-25T" + String(i + 9).padStart(2, "0") + ":00",
          temperature: 20,
          rain: i === 3 ? 40 : 10,
          code: 0,
          wind: 12,
        })),
      };
      await page.goto(base + "event.html?id=999");
      await page.getByText("Your partner is", { exact: false }).waitFor();
      await page
        .getByRole("button", { name: "I’ll book the buggy", exact: true })
        .click();
      await page
        .getByText("You’re booking the buggy. Your partner can see this.", {
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator('a[href="tel:07000000002"]').count(), 1);
      assert.match(await page.locator("[data-weather]").innerText(), /40%/);
      assert.match(await page.locator("[data-weather]").innerText(), /09:32/);
      const downloadPromise = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Add to phone calendar", exact: true })
        .click();
      const download = await downloadPromise;
      const calendarPath = path.join(out, "member-calendar.ics");
      await download.saveAs(calendarPath);
      const ics = fs.readFileSync(calendarPath, "utf8");
      assert.match(ics, /DTSTART:20270625T083200Z/);
      assert.match(ics, /DTEND:20270625T133200Z/);
      assert.match(
        await page
          .getByRole("link", { name: "Google Maps ↗", exact: true })
          .getAttribute("href"),
        /destination=/,
      );
      await page.screenshot({
        path: path.join(out, "buggy-weather-390.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name: "Release booking responsibility",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "I’ll book the buggy", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      report.push({
        page: "private-buggy-hourly-weather-calendar",
        width: 390,
        status: "passed",
      });
      await context.close();
    }
    {
      const context = await browser.newContext({
          viewport: { width: 390, height: 960 },
          serviceWorkers: "block",
        }),
        model = await mocks(context, { signedIn: true, admin: true }),
        page = await context.newPage();
      const second = "22222222-2222-4222-8222-222222222222";
      model.accounts = [
        {
          id: uid,
          username: "Test Member",
          mobile: "07000000000",
          is_admin: true,
          member_id: uid,
          created_at: "2026-09-26T09:00:00Z",
        },
        {
          id: second,
          username: "Another Member",
          mobile: "07000000002",
          is_admin: false,
          member_id: second,
          created_at: "2026-09-26T09:00:00Z",
        },
      ];
      await page.goto(base + "admin.html");
      await page
        .getByRole("heading", { name: "All accounts", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Event details", exact: true })
        .click();
      await page.getByRole("button", { name: "Accounts", exact: true }).click();
      await page.getByLabel("Find a member", { exact: true }).fill("Another");
      await page
        .getByRole("button", { name: "Edit account", exact: true })
        .click();
      await page.getByLabel("Username", { exact: true }).fill("Renamed Member");
      await page.getByLabel("Season starting handicap", { exact: true }).fill("18.2");
      await page.getByLabel("Administrator access", { exact: true }).check();
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(model.accountEdits.admin_access, true);
      assert.equal(model.accountEdits.society_handicap, 18.2);
      await page.getByLabel("Find a member", { exact: true }).fill("Renamed");
      await page
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      await page
        .getByLabel("New password", { exact: true })
        .fill("temporary-test-password");
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill("temporary-test-password");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(model.passwordReset.target, second);
      await page
        .getByLabel("Find a member", { exact: true })
        .fill("Test Member");
      await page
        .getByRole("button", { name: "Edit account", exact: true })
        .click();
      assert.equal(
        await page
          .getByLabel("Administrator access", { exact: true })
          .isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByLabel("Find a member", { exact: true }).fill("");
      await page.screenshot({
        path: path.join(out, "admin-accounts-390.png"),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      report.push({
        page: "account-review-edit-admin-role-password-reset",
        width: 390,
        status: "passed",
      });
      await context.close();
    }
    // Fast league entry, drafts, explicit ties, scorecard filtering, and member secrecy.
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 960 },
        serviceWorkers: "block",
        acceptDownloads: true,
      });
      const model = await mocks(context, { signedIn: true, admin: true }),
        page = await context.newPage();
      const people = Array.from({ length: 6 }, (_, i) => ({
        id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
        name: `Player ${i + 1}`,
        starting_handicap: 20,
      }));
      model.league = { revision: 1, players: people, rounds: [] };
      model.events = [
        { ...fixture, round_number: 1 },
        {
          ...fixture,
          id: 1000,
          name: "Next round",
          round_number: 2,
          date: "2027-07-25",
        },
      ];
      model.responses = people.map((p, i) => ({
        id: i + 1,
        user_id: p.id,
        name: p.name,
        event_id: 999,
        attending: i !== 5,
        reserve: i === 4,
        buggy: i < 2,
      }));
      await page.goto(base + "admin.html");
      await page
        .getByRole("button", { name: "Starting handicaps", exact: true })
        .click();
      await page
        .getByLabel("Starting handicap for Player 1", { exact: true })
        .fill("18.5");
      await page
        .getByLabel("Starting handicap for Player 1", { exact: true })
        .press("Enter");
      assert.equal(
        await page
          .getByLabel("Starting handicap for Player 2", { exact: true })
          .evaluate((x) => x === document.activeElement),
        true,
      );
      await page
        .getByRole("button", { name: "Save all starting handicaps" })
        .click();
      await page
        .getByText("Starting handicaps saved. Published rounds recalculated.", {
          exact: true,
        })
        .waitFor();
      assert.equal(model.handicaps.entries[0].handicap, 18.5);
      await page
        .getByRole("button", { name: "Enter scores", exact: true })
        .click();
      await page.getByLabel("Choose an event").selectOption("999");
      await page.getByLabel("Points for Player 1", { exact: true }).fill("40");
      await page
        .getByLabel("Points for Player 1", { exact: true })
        .press("Enter");
      assert.equal(
        await page
          .getByLabel("Points for Player 2", { exact: true })
          .evaluate((x) => x === document.activeElement),
        true,
      );
      await page
        .getByText("Paste scores from a spreadsheet", { exact: true })
        .click();
      await page
        .locator("#pasteScores")
        .fill("Player 1\t40\nPlayer 2\t40\nPlayer 3\t30\nPlayer 4\t25");
      await page.getByRole("button", { name: "Apply to score sheet" }).click();
      await page
        .getByText("4 rows added. Review before publishing.", { exact: true })
        .waitFor();
      await page.locator("#pasteScores").fill("Unknown Person\t99");
      await page.getByRole("button", { name: "Apply to score sheet" }).click();
      await page
        .getByText(
          "No registered player matches “Unknown Person”. No rows changed.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page
          .getByLabel("Points for Player 1", { exact: true })
          .inputValue(),
        "40",
      );
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await page
        .getByText("Draft saved. Members cannot see it.", { exact: true })
        .waitFor();
      assert.equal(model.roundSave.publish, false);
      assert.equal(model.roundSave.entries.length, 4);
      await page
        .getByLabel("Round winner — tied on 40 points")
        .selectOption(people[1].id);
      await page
        .getByRole("button", { name: "Publish round & update handicaps" })
        .click();
      await page
        .getByText("Round published. Leaderboard and handicaps updated.", {
          exact: true,
        })
        .waitFor();
      assert.equal(model.roundSave.chosen_winner, people[1].id);
      assert.equal(model.roundSave.publish, true);
      await page.screenshot({
        path: path.join(out, "admin-scoring-390.png"),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      // Round 2 card preparation must use round 1's resulting handicap.
      model.responses = model.responses.map((x) => ({ ...x, event_id: 1000 }));
      await page.getByLabel("Choose an event").selectOption("1000");
      await page
        .getByRole("button", {
          name: "Setup next round score cards",
          exact: true,
        })
        .click();
      await page.locator(".scorecard-table tbody tr").first().waitFor();
      assert.equal(await page.locator(".scorecard-table tbody tr").count(), 4);
      assert.equal(await page.locator(".card-hcp").first().textContent(), "18");
      assert(
        !(await page
          .locator("#adminScorecards")
          .textContent()
          .then((x) => x.includes("Player 5") || x.includes("Player 6"))),
      );
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download CSV", exact: true })
        .click();
      assert.equal(
        (await download).suggestedFilename(),
        "barford-round-2-scorecards.csv",
      );
      await page.screenshot({
        path: path.join(out, "admin-scorecards-390.png"),
        fullPage: true,
      });
      await page.emulateMedia({ media: "print" });
      await page.evaluate(() =>
        document.body.classList.add("printing-scorecards"),
      );
      await page.screenshot({
        path: path.join(out, "scorecards-print.png"),
        fullPage: true,
      });
      await page.emulateMedia({ media: "screen" });
      await context.close();
      report.push({
        page: "league-bulk-handicaps-fast-entry-drafts-winner-scorecards",
        width: 390,
        status: "passed",
      });
      const member = await browser.newContext({
        viewport: { width: 390, height: 960 },
        serviceWorkers: "block",
      });
      const memberModel = await mocks(member, { signedIn: true });
      memberModel.board = {
        players: people.slice(0, 2),
        visible_rounds: 5,
        rounds: [1, 2, 3, 4, 5].map((n) => ({
          round: n,
          average: 30,
          results: people
            .slice(0, 2)
            .map((p, i) => ({
              user_id: p.id,
              points: i ? 25 : 30,
              handicap: 20,
              adjustment: 0,
              next_handicap: 20,
              winner: i === 0,
            })),
        })),
      };
      const mp = await member.newPage();
      await mp.goto(base + "scores.html");
      await mp.locator(".league-table tbody tr").first().waitFor();
      assert.equal(await mp.locator(".secret-score").count(), 4);
      assert.equal(
        await mp
          .locator(".league-table tbody tr")
          .first()
          .locator("td")
          .nth(8)
          .textContent(),
        "150",
      );
      await mp.getByLabel("Choose round", { exact: true }).selectOption("6");
      await mp
        .getByText("🔒 Round 6 is secret. Only admins can see these results.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await mp.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      await mp.screenshot({
        path: path.join(out, "leaderboard-member-390.png"),
        fullPage: true,
      });
      // Admin best-five calculation: drop two lowest from seven, including secret rounds.
      memberModel.board.visible_rounds = 7;
      memberModel.board.rounds.push(
        ...[6, 7].map((n) => ({
          round: n,
          average: 40,
          results: [
            {
              user_id: people[0].id,
              points: 40,
              handicap: 20,
              adjustment: -1,
              next_handicap: 19,
              winner: true,
            },
          ],
        })),
      );
      await mp.getByRole("button", { name: "Refresh leaderboard" }).click();
      await mp
        .getByText("Admin view · All seven rounds visible.", { exact: true })
        .waitFor();
      assert.equal(await mp.locator(".secret-score").count(), 0);
      assert.equal(
        await mp
          .locator(".league-table tbody tr")
          .first()
          .locator("td")
          .nth(8)
          .textContent(),
        "170",
      );
      await member.close();
      report.push({
        page: "league-member-secret-rounds-and-best-five-ranking",
        width: 390,
        status: "passed",
      });
    }
    // Organiser can create events and publish every confirmed member once.
    const context = await browser.newContext({
        viewport: { width: 390, height: 960 },
        serviceWorkers: "block",
      }),
      model = await mocks(context, { signedIn: true, admin: true }),
      page = await context.newPage();
    model.responses = [
      {
        id: 111,
        event_id: 999,
        user_id: uid,
        name: "Test Member",
        attending: true,
        reserve: false,
        buggy: false,
        preferred_time: "First",
        created_at: "2026-09-26",
        requested_at: "2026-09-26",
      },
    ];
    await page.goto(base + "admin.html");
    await page
      .getByRole("button", { name: "Event details", exact: true })
      .click();
    await page.getByLabel("Choose an event").selectOption("999");
    await page.getByRole("button", { name: "RSVPs", exact: true }).click();
    await page.getByText("Test Member", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(out, "admin-rsvps-390.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    await page.getByRole("button", { name: "Tee groups", exact: true }).click();
    await page
      .getByRole("button", { name: "Generate groups", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Publish tee times", exact: true })
      .click();
    await page
      .getByText("Tee times published. Members can view them on the event.", {
        exact: true,
      })
      .waitFor();
    assert.equal(model.groups.length, 1);
    await page.screenshot({
      path: path.join(out, "admin-tees-390.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Event details", exact: true })
      .click();
    await page.getByLabel("Choose an event").selectOption("");
    await page
      .getByLabel("Event name", { exact: true })
      .fill("Another Golf Day");
    await page.getByLabel("Date", { exact: true }).fill("2027-07-30");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.getByText("Event saved.", { exact: true }).waitFor();
    assert(model.events.some((ev) => ev.name === "Another Golf Day"));
    report.push({
      page: "organiser-events-and-tee-times",
      width: 390,
      status: "passed",
    });
    await context.close();
    fs.writeFileSync(
      path.join(out, "checks.json"),
      JSON.stringify(report, null, 2),
    );
    assert(
      !report.some((r) => r.status === "failed"),
      JSON.stringify(report.filter((r) => r.status === "failed")),
    );
    console.log(
      `${report.length} checks passed: mobile/desktop pages, account signup/sign-in/out, RSVP editing/waiting list, reservations and organiser tee publication.`,
    );
  } finally {
    fs.writeFileSync(
      path.join(out, "checks.json"),
      JSON.stringify(report, null, 2),
    );
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
