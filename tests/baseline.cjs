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
      ".svg": "image/svg+xml",
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
  function completeGuest(payload) {
    model.guestCategory = "guest";
    if (payload.full_name) model.profile.full_name = payload.full_name;
    if (payload.phone) model.profile.phone = payload.phone;
    model.guestBookings = [
      {
        event_id: 999,
        host_name: "Gary Host",
        status: "pending",
        guest_price: 45,
        attending: true,
        reserve: false,
      },
    ];
    model.responses = [
      {
        id: 123,
        event_id: 999,
        user_id: uid,
        name: model.profile.full_name + " (guest)",
        attending: true,
        reserve: false,
        buggy: payload.buggy,
        guest_host_id: "host",
        preferred_time: payload.preferred_time,
      },
    ];
    model.ops = {
      settings: {
        bank_instructions:
          "Pay Barford Treasurer · sort code 00-00-00 · account 00000000",
        guest_policy: "Committee approves handicaps",
      },
      category: "guest",
      charges: [
        {
          id: 1,
          event_id: 999,
          user_id: uid,
          label: fixture.name,
          amount: 45,
          received: 0,
          category: "guest",
        },
      ],
      guests: [],
      pairs: [],
      players: [],
      changes: [],
    };
  }
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
    if (p.endsWith("/rpc/baseline_guest_invitations")) {
      const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      model.guestLinks ||= [];
      model.guestBookings ||= [];
      if (body.action === "mine")
        return reply({
          category: model.guestCategory || "member",
          links: model.guestLinks,
          bookings: model.guestBookings,
        });
      if (body.action === "create") {
        model.guestCreates = (model.guestCreates || 0) + 1;
        model.guestLinks.push({ token, event_id: 999, claimed: false });
        return reply({ token, event_id: 999, host_name: "Test Member" });
      }
      if (body.action === "view")
        return reply(
          model.guestView || {
            status: "open",
            event_id: 999,
            event_name: fixture.name,
            date: fixture.date,
            first_time: "10:00",
            event_type: "league",
            host_name: "Gary Host",
            guest_price: 45,
            cancellation_terms: "Cancel by the agreed deadline",
            waiting: false,
          },
        );
      if (body.action === "join") {
        model.guestJoin = body.payload;
        completeGuest(body.payload);
        return reply({ event_id: 999, attending: true, reserve: false });
      }
      if (body.action === "revoke") {
        model.guestLinks.find((l) => l.token === body.payload.token).revoked =
          true;
        return reply({});
      }
      if (body.action === "review") {
        model.guestReview = body.payload;
        return reply({});
      }
    }
    if (p.endsWith("/rpc/baseline_reservation_notices")) return reply([]);
    if (p.endsWith("/rpc/baseline_manual_handicap")) {
      model.manual = body;
      const person = model.league.players.find((p) => p.id === body.who);
      person.adjustments = body.remove
        ? []
        : [
            {
              round_number: body.from_round,
              handicap: body.new_handicap,
              reason: body.reason,
            },
          ];
      model.league.revision++;
      return reply(model.league);
    }
    if (p.endsWith("/rpc/baseline_course_layout") && body.action === "list")
      return reply({ layouts: [], legacy: [] });
    if (p.endsWith("/rpc/baseline_finance")) {
      model.expenses ||= [];
      const q = body.payload || {};
      if (body.action === "summary")
        return reply({ pending: model.expenses.filter((x) => !x.done).length });
      if (body.action === "list")
        return reply({
          items: model.expenses,
          charges: model.ops?.charges || [],
        });
      if (body.action === "add") {
        const x = {
          ...q,
          id: model.expenses.length + 1,
          revision: 0,
          done: false,
          created_at: "2027-06-25T10:00:00Z",
          created_by_name: "Test Member",
        };
        model.expenses.push(x);
        return reply(x);
      }
      if (body.action === "paid") {
        const x = model.expenses.find((x) => x.id === q.id);
        Object.assign(x, {
          done: true,
          revision: x.revision + 1,
          paid_at: "2027-06-25T12:00:00Z",
          paid_by_name: "Test Member",
        });
        return reply(x);
      }
    }
    if (p.startsWith("/storage/v1/object/sign/baseline-expense-receipts/"))
      return reply({ signedURL: "/storage/v1/object/receipt-test.png" });
    if (p.startsWith("/storage/v1/object/baseline-expense-receipts/")) {
      model.receiptUploads = (model.receiptUploads || 0) + 1;
      return reply({ Key: p.replace("/storage/v1/object/", "") });
    }
    if (p === "/storage/v1/object/receipt-test.png")
      return route.fulfill({
        contentType: "image/png",
        body: fs.readFileSync(path.join(root, "icon-logo.png")),
      });
    if (p.endsWith("/rpc/baseline_operations")) {
      model.operationCalls ||= [];
      model.operationCalls.push(body);
      if (body.action === "admin" && model.teePairingGate) await model.teePairingGate;
      if (body.action === "admin" && model.teePairingFailure) {
        model.teePairingFailure = false;
        return reply({ message: "Pairing data temporarily unavailable." }, 503);
      }
      model.ops ||= {
        settings: {
          bank_instructions: "Transfer to the society account",
          membership_fee: null,
          guest_policy: "Organisers approve guest handicaps.",
        },
        charges: [],
        guests: [],
        changes: [],
        pairs: [],
        players: [],
        accounts: [{ id: uid, name: "Test Member", category: "member" }],
        items: [],
        tasks: [],
        buggies: [],
        handicap_history: [],
      };
      const q = body.payload || {};
      if (body.action === "report_payment")
        model.ops.charges.find((c) => c.id === q.id).reported = true;
      if (body.action === "save_charge")
        Object.assign(
          model.ops.charges.find((c) => c.id === q.id),
          q,
          { revision: q.revision + 1 },
        );
      if (body.action === "confirm_buggy")
        model.buggy.confirmed_at = q.confirmed ? "2027-06-20T10:00:00Z" : null;
      if (body.action === "invite_guest")
        model.ops.guests.push({ ...q, id: "guest-test", status: "pending" });
      if (body.action === "settings") Object.assign(model.ops.settings, q);
      if (body.action === "task") model.ops.tasks.push(q);
      if (body.action === "pair")
        model.ops.pairs = [
          {
            id: 1,
            first_user: uid,
            second_user: q.partner_id,
            status: q.partner_id ? "requested" : "looking",
          },
        ];
      if (body.action === "seen_changes") model.ops.changes = [];
      return reply(
        body.action === "member" || body.action === "admin"
          ? model.ops
          : { saved: true },
      );
    }
    if (p.endsWith("/rpc/baseline_event_tee_groups"))
      return reply(
        model.teeView || {
          status: model.groups.length ? "published" : "unpublished",
          round_number: 1,
          provisional: false,
          groups: model.groups.map((g) => ({
            ...g,
            players: g.players.map((p) => ({
              ...p,
              handicap: 18,
              handicap_secret: false,
              avatar_path: null,
            })),
          })),
        },
      );
    if (p === "/storage/v1/object/sign/baseline-profile-images")
      return reply(
        (body.paths || []).map((path) => ({
          path,
          signedURL:
            "/object/sign/baseline-profile-images/" + path + "?token=mock",
        })),
      );
    if (p.startsWith("/storage/v1/object/sign/baseline-profile-images/"))
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: fs.readFileSync(path.join(root, "icon-logo.png")),
      });
    if (p.startsWith("/storage/v1/object/baseline-profile-images")) {
      if (method === "POST") {
        model.photoUploads = (model.photoUploads || 0) + 1;
        return reply({ Id: uid, Key: p.replace("/storage/v1/object/", "") });
      }
      if (method === "DELETE") {
        model.photoRemovals = (model.photoRemovals || 0) + 1;
        return reply([]);
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
      if (model.roundFail) {
        model.roundFail = false;
        return reply(
          { message: "Connection interrupted. Retry your confirmation." },
          503,
        );
      }
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
      if (body.data?.guest_token) completeGuest(body.data);
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
      return reply(
        req.headers()["accept"]?.includes("vnd.pgrst.object")
          ? result[0]
          : result,
      );
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
          ? model.responses.find((r) => r.user_id === uid && (!u.searchParams.get("event_id") || "eq." + r.event_id === u.searchParams.get("event_id"))) || null
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
      model.rsvpAttempts = (model.rsvpAttempts || 0) + 1;
      if (model.rsvpFailure) {
        model.rsvpFailure = false;
        return reply({ message: "Unable to save right now. Please try again." }, 503);
      }
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
          .getByRole("heading", { name: "The season ahead." })
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
      await page.goto(base + "index.html");
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
      assert.equal(
        await form
          .locator("input:not([type=radio]):not([type=checkbox])")
          .count(),
        0,
      );
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
      model.rsvpFailure = true;
      await form.getByRole("button", { name: "Save RSVP", exact: true }).click();
      await form.getByText("Unable to save right now. Please try again.", { exact: true }).waitFor();
      assert.equal(model.responses.length, 0, "Failed save must not appear as a confirmed booking");
      assert.equal(await form.getByRole("radio", { name: "First", exact: true }).isChecked(), true, "Retry retains the chosen tee preference");
      assert.equal(await form.getByRole("button", { name: "Save RSVP", exact: true }).isEnabled(), true);
      await form.getByRole("button", { name: "Save RSVP", exact: true }).click();
      await page.getByRole("button", { name: "Change RSVP", exact: true }).waitFor();
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      assert.equal(model.payloads.length, 1);
      assert(!("name" in model.payloads[0]));
      assert(!("user_id" in model.payloads[0]));
      assert.equal(model.responses.length, 1);
      await page
        .getByRole("button", { name: "Change RSVP", exact: true })
        .click();
      await form
        .getByRole("radio", { name: "Yes, please", exact: true })
        .check();
      await form.getByRole("radio", { name: "End", exact: true }).check();
      await form
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.locator("#homeOperations").getByText("Buggy requested · Tee preference: End", { exact: true }).waitFor();
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      assert.equal(model.responses.length, 1);
      assert.equal(model.payloads[1].preferred_time, "End");
      await page
        .getByRole("button", { name: "Change RSVP", exact: true })
        .click();
      await form
        .getByRole("radio", { name: "Not this time", exact: true })
        .check();
      assert.equal(await form.locator("[data-playing]").isVisible(), false);
      await form
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "You’re not booked", exact: true })
        .waitFor();
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      assert.equal(model.payloads[2].attending, false);
      model.wait = true;
      await page
        .getByRole("button", { name: "Change RSVP", exact: true })
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
        .getByRole("heading", { name: "You’re on the waiting list", exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).pathname, "/index.html", "RSVP and all edits stay on the homepage");
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      assert.equal(await page.locator(".rsvp-dialog[open]").count(), 0, "Successful RSVP closes its dialog");
      assert.equal(model.payloads[3].preferred_time, "Middle");
      assert.equal(model.responses[0].reserve, true);
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
      await page.locator('[data-detail-section="buggy"] > summary').click();
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
      await page.locator('[data-detail-section="weather"] > summary').click();
      await page.locator("[data-weather] .weather-summary").waitFor();
      assert.match(await page.locator("[data-weather]").innerText(), /40%/);
      assert.match(await page.locator("[data-weather]").innerText(), /09:32/);
      await page.locator('[data-detail-section="travel"] > summary').click();
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
      await page
        .getByLabel("Season starting handicap", { exact: true })
        .fill("18.2");
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
        starting_handicap: null,
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
      for (let n = 2; n <= 6; n++)
        await page
          .getByLabel(`Starting handicap for Player ${n}`, { exact: true })
          .fill("20");
      await page
        .getByRole("button", { name: "Save all starting handicaps" })
        .click();
      await page
        .getByText("Starting handicaps saved. Published rounds recalculated.", {
          exact: true,
        })
        .waitFor();
      assert.equal(model.handicaps.entries[0].handicap, 18.5);
      assert.equal(
        await page.locator('[data-tab="handicaps"]').isVisible(),
        false,
      );
      await page.reload();
      await page.evaluate(() => window.barfordReady);
      await page
        .getByRole("heading", { name: "Society administration." })
        .waitFor();
      assert.equal(
        await page.locator('[data-tab="handicaps"]').isVisible(),
        false,
      );
      await page
        .getByRole("button", { name: "Enter scores", exact: true })
        .click();
      await page.getByLabel("Choose an event").selectOption("999");
      await page
        .getByText("Edit full score sheet or paste scores", { exact: true })
        .click();
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
      const dnpBox = await page
        .getByLabel("DNP for Player 1", { exact: true })
        .boundingBox();
      assert(
        dnpBox.x + dnpBox.width <= 390,
        "DNP should fit without horizontal scrolling",
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
          results: people.slice(0, 2).map((p, i) => ({
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
      await mp.locator(".standing-card").first().waitFor();
      assert.equal(await mp.locator(".secret-score").count(), 2);
      assert.equal(
        await mp
          .locator(".standing-card")
          .first()
          .locator("[data-total]")
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
      await mp.getByLabel("Choose round", { exact: true }).selectOption("7");
      assert.equal(
        await mp
          .locator(".standing-card")
          .first()
          .locator("[data-total]")
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
    // Guided entry: failed confirmation stays put, resume saved progress, final review.
    {
      const context = await browser.newContext({
          viewport: { width: 390, height: 960 },
          serviceWorkers: "block",
        }),
        model = await mocks(context, { signedIn: true, admin: true }),
        page = await context.newPage();
      const people = Array.from({ length: 6 }, (_, i) => ({
        id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, "0")}`,
        name: `Golfer ${i + 1}`,
        starting_handicap: 20,
      }));
      model.league = { revision: 1, players: people, rounds: [] };
      model.events = [{ ...fixture, round_number: 1 }];
      model.responses = people.slice(0, 5).map((p, i) => ({
        id: i + 1,
        event_id: 999,
        user_id: p.id,
        name: p.name,
        attending: true,
        reserve: false,
      }));
      await page.goto(base + "admin.html");
      await page
        .getByRole("button", { name: "Enter scores", exact: true })
        .click();
      await page.getByLabel("Choose an event").selectOption("999");
      await page
        .getByRole("button", { name: "Input scores for round 1", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("heading", { name: "Golfer 1", exact: true })
        .waitFor();
      await dialog.getByLabel("Stableford points", { exact: true }).fill("40");
      await dialog
        .getByText(
          "Round handicap: 20. Adjustment available after at least four played scores. The final adjustment needs every score.",
          { exact: true },
        )
        .waitFor();
      model.roundFail = true;
      await dialog
        .getByRole("button", { name: "Confirm & next", exact: true })
        .click();
      await dialog
        .getByText("Connection interrupted. Retry your confirmation.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await dialog
          .getByRole("heading", { name: "Golfer 1", exact: true })
          .count(),
        1,
      );
      await dialog
        .getByRole("button", { name: "Confirm & next", exact: true })
        .click();
      await dialog
        .getByRole("heading", { name: "Golfer 2", exact: true })
        .waitFor();
      assert.equal(model.roundSave.publish, false);
      await dialog.getByLabel("Stableford points", { exact: true }).fill("36");
      await dialog
        .getByRole("button", { name: "Save & close", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Input scores for round 1", exact: true })
        .click();
      await dialog
        .getByRole("heading", { name: "Golfer 3", exact: true })
        .waitFor();
      await dialog.getByLabel("Stableford points", { exact: true }).fill("31");
      await dialog
        .getByRole("button", { name: "Confirm & next", exact: true })
        .click();
      await dialog
        .getByRole("heading", { name: "Golfer 4", exact: true })
        .waitFor();
      await dialog.getByLabel("Stableford points", { exact: true }).fill("24");
      await page.screenshot({
        path: path.join(out, "score-wizard-preview-390.png"),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Confirm & next", exact: true })
        .click();
      await dialog
        .getByRole("heading", { name: "Golfer 5", exact: true })
        .waitFor();
      await dialog.getByLabel("Did not play (DNP)", { exact: true }).check();
      await dialog
        .getByRole("button", { name: "Confirm & next", exact: true })
        .click();
      await dialog
        .getByRole("heading", { name: "Complete round 1", exact: true })
        .waitFor();
      await dialog
        .getByText("1 non-participant automatically marked DNP", {
          exact: true,
        })
        .click();
      await dialog.getByText("Golfer 6", { exact: true }).waitFor();
      assert.equal(model.roundSave.publish, false);
      await page.screenshot({
        path: path.join(out, "score-wizard-complete-390.png"),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Complete round", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(model.roundSave.publish, true);
      assert.equal(model.roundSave.entries.length, 5);
      assert.equal(model.roundSave.entries[4].status, "dnp");
      await context.close();
      report.push({
        page: "guided-round-entry-resume-retry-preview-completion",
        width: 390,
        status: "passed",
      });
    }
    // Profile upload at signup and afterwards; homepage groups and enlarged portraits.
    {
      const context = await browser.newContext({
          viewport: { width: 390, height: 960 },
          serviceWorkers: "block",
        }),
        model = await mocks(context),
        page = await context.newPage();
      await page.goto(base + "signup.html");
      await page.getByLabel("Who are you?", { exact: true }).selectOption(uid);
      await page
        .getByLabel("Mobile number", { exact: true })
        .fill("07000000003");
      await page.getByLabel("Password", { exact: true }).fill("test-password");
      await page
        .getByLabel("Profile photo (optional)", { exact: true })
        .setInputFiles(path.join(root, "icon-logo.png"));
      await page.locator("#profilePhotoPreview").waitFor({ state: "visible" });
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await page
        .getByRole("button", { name: "Yes, I am New Member", exact: true })
        .click();
      await page.waitForURL("**/index.html");
      assert.equal(model.photoUploads, 1);
      assert(model.profile.baseline_avatar_path.startsWith(uid + "/"));
      model.teeView = {
        status: "published",
        round_number: 2,
        provisional: false,
        groups: [
          {
            group_number: 2,
            tee_time: "10:16",
            players: [
              {
                user_id: uid,
                name: "Test Member",
                handicap: 18.5,
                type: "buggy",
                avatar_path: model.profile.baseline_avatar_path,
              },
              {
                user_id: "other",
                name: "Gary Example",
                handicap: 21,
                type: "walker",
                avatar_path: null,
              },
            ],
          },
          {
            group_number: 3,
            tee_time: "10:24",
            players: [
              {
                user_id: "third",
                name: "Simon Example",
                handicap: 14,
                type: "walker",
                avatar_path: null,
              },
            ],
          },
        ],
      };
      await page.reload();
      await page
        .getByRole("heading", { name: "Your tee group", exact: true })
        .waitFor();
      await page
        .getByText("Round 2 HCP: 18.5 · Buggy", { exact: true })
        .first()
        .waitFor();
      await page
        .getByRole("button", {
          name: "Enlarge photo of Test Member",
          exact: true,
        })
        .first()
        .click();
      await page
        .getByRole("dialog", { name: "Test Member profile photo", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Close photo", exact: true })
        .click();
      await page.getByText("View all tee groups", { exact: true }).click();
      await page.getByText("Simon Example", { exact: true }).waitFor();
      await page.screenshot({
        path: path.join(out, "home-tee-groups-390.png"),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      await page.goto(base + "account.html");
      await page
        .getByRole("heading", { name: "Your profile photo", exact: true })
        .waitFor();
      await page
        .getByLabel("Profile photo (optional)", { exact: true })
        .setInputFiles(path.join(root, "icon-logo.png"));
      await page
        .getByRole("button", { name: "Save photo", exact: true })
        .click();
      await page.getByText("Profile photo saved.", { exact: true }).waitFor();
      assert.equal(model.photoUploads, 2);
      await page
        .getByRole("button", { name: "Remove photo", exact: true })
        .click();
      await page.getByText("Profile photo removed.", { exact: true }).waitFor();
      assert.equal(model.profile.baseline_avatar_path, null);
      model.teeView = { status: "reviewing", groups: [] };
      await page.goto(base + "index.html");
      await page
        .getByText(
          "The player list has changed. Organisers are reviewing the tee times.",
          { exact: true },
        )
        .waitFor();
      assert.equal(await page.locator(".member-tee-card").count(), 0);
      await context.close();
      report.push({
        page: "signup-account-private-photos-home-group-all-groups-enlarge",
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
    let releasePairing;
    model.teePairingGate = new Promise(resolve => { releasePairing = resolve; });
    model.teePairingFailure = true;
    const pairingRequested = page.waitForRequest(request => request.url().endsWith("/rpc/baseline_operations") && request.postDataJSON().action === "admin");
    await page
      .getByRole("button", { name: "Generate groups", exact: true })
      .click();
    await pairingRequested;
    for (const id of ["generateTees", "loadTees", "saveTees", "adminEvent", "teeStart", "teeGap"]) assert.equal(await page.locator("#" + id).isDisabled(), true, id + " must wait for tee generation");
    assert.equal(await page.locator("#teeEditor .tee-group").count(), 0);
    releasePairing();
    model.teePairingGate = null;
    await page.getByText("Pairing data temporarily unavailable.", { exact: true }).waitFor();
    for (const id of ["generateTees", "loadTees", "saveTees", "adminEvent", "teeStart", "teeGap"]) assert.equal(await page.locator("#" + id).isDisabled(), false, id + " must recover after a failed request");
    await page.getByRole("button", { name: "Generate groups", exact: true }).click();
    await page.getByText("Draft groups generated. Review buggy pairs and preferences before publishing.", { exact: true }).waitFor();
    const memberGroup = page.locator("#teeEditor").getByRole("combobox", { name: "Group for Test Member", exact: true });
    await memberGroup.waitFor();
    assert.equal(await memberGroup.count(), 1, "The confirmed member must appear in exactly one generated group");
    assert.equal(await memberGroup.inputValue(), "0", "The confirmed member must be assigned to Group 1");
    assert.equal(await page.locator("#teeEditor .tee-player").count(), 1);
    await page
      .getByRole("button", { name: "Publish tee times", exact: true })
      .click();
    await page
      .locator("dialog")
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
    const eventRound = page.locator('#eventForm [name="round_number"]');
    assert.equal(await eventRound.isVisible(), true, "League events must show their round selection");
    assert.equal(await eventRound.isEnabled(), true, "League round selection must be enabled");
    await eventRound.selectOption("1");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.getByText("Event saved.", { exact: true }).waitFor();
    assert(model.events.some((ev) => ev.name === "Another Golf Day" && ev.round_number === 1));
    report.push({
      page: "organiser-events-and-tee-times",
      width: 390,
      status: "passed",
    });
    await context.close();
    // Operations: member transfers and social forms; admin override and record management.
    for (const width of [390, 1365]) {
      const context = await browser.newContext({
          viewport: { width, height: 960 },
          serviceWorkers: "block",
        }),
        model = await mocks(context, { signedIn: true, admin: true }),
        page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      model.events = [
        {
          ...fixture,
          event_type: "social",
          name: "Presentation evening",
          arrival_time: "19:00",
          refreshment_time: "19:30",
          included: "Dinner and presentation",
          cancellation_terms: "Contact the organiser before cancelling.",
          member_price: 12,
          guest_price: 12,
        },
      ];
      model.league = {
        revision: 1,
        players: [
          {
            id: uid,
            name: "Test Member",
            starting_handicap: 30,
            adjustments: [],
          },
        ],
        rounds: [],
      };
      model.ops = {
        settings: {
          bank_instructions: "Society transfer details",
          membership_fee: 20,
          guest_policy: "Organiser approval required",
        },
        charges: [
          {
            id: 1,
            user_id: uid,
            event_id: 999,
            scope: "event:999",
            name: "Test Member",
            label: "Presentation evening",
            category: "member",
            amount: 12,
            received: 0,
            reported: false,
            revision: 0,
          },
        ],
        guests: [],
        changes: [],
        pairs: [],
        players: [],
        accounts: [{ id: uid, name: "Test Member", category: "member" }],
        items: [],
        tasks: [],
        buggies: [],
        handicap_history: [],
      };
      await page.goto(base + "index.html");
      await page.locator("[data-home-rsvp]").click();
      await page
        .getByRole("radio", { name: "Yes, I’m attending", exact: true })
        .check();
      assert.equal(await page.locator("[data-playing]").isVisible(), false);
      assert.equal(await page.locator("[data-weather]").count(), 0);
      await page.locator(".rsvp-form").getByRole("button", { name: "Save RSVP", exact: true }).click();
      assert.equal(model.payloads.length, 0, "Cancellation terms require explicit consent before RSVP saves");
      await page.getByLabel("I accept the cancellation terms").check();
      await page
        .locator(".rsvp-form")
        .getByRole("button", { name: "Save RSVP", exact: true })
        .click();
      await page.getByRole("button", { name: "Change RSVP", exact: true }).waitFor();
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      assert.equal(model.payloads.at(-1).buggy, false);
      assert.equal(model.payloads.at(-1).accept_terms, true);
      await page.goto(base + "event.html?id=999");
      await page.locator('[data-detail-section="booking"] > summary').click();
      await page
        .getByRole("button", { name: "I’ve sent the transfer", exact: true })
        .click();
      await page
        .getByText("Transfer reported — awaiting organiser confirmation.", {
          exact: true,
        })
        .waitFor();
      assert.equal(model.ops.charges[0].received, 0);
      await page.screenshot({
        path: path.join(out, `operations-social-payment-${width}.png`),
        fullPage: true,
      });
      await page.goto(base + "index.html");
      await page.locator("[data-home-rsvp]").click();
      await page.getByRole("radio", { name: "Not this time", exact: true }).check();
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page
        .getByRole("heading", { name: "You’re not booked", exact: true })
        .waitFor();
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      await page.goto(base + "admin.html");
      await page
        .getByRole("button", {
          name: "Manual handicap adjustments",
          exact: true,
        })
        .click();
      await page.locator("#adminOp-adjustments [name=new_handicap]").fill("24");
      await page
        .locator("#adminOp-adjustments [name=reason]")
        .fill("Committee agreed exceptional cut after review");
      await page
        .getByRole("button", { name: "Save adjustment", exact: true })
        .click();
      await page
        .getByText("Future-round handicap updated.", { exact: true })
        .waitFor();
      assert.equal(model.manual.from_round, 2);
      assert.equal(model.manual.new_handicap, 24);
      assert.equal(model.league.players[0].starting_handicap, 30);
      await page.screenshot({
        path: path.join(out, `operations-handicap-${width}.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Payments", exact: true }).click();
      await page.locator('[data-charge="1"] [name=received]').fill("12");
      await page
        .getByRole("button", { name: "Save payment record", exact: true })
        .click();
      await page
        .getByText("Payment settings saved.", { exact: true })
        .waitFor();
      assert.equal(Number(model.ops.charges[0].received), 12);
      await page.screenshot({
        path: path.join(out, `operations-admin-payments-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Event details", exact: true })
        .click();
      await page.getByLabel("Choose an event").selectOption("999");
      await page
        .getByRole("button", { name: "Event checklist", exact: true })
        .click();
      await page
        .locator('[data-task="Course confirmed"] [name=owner]')
        .fill("Tim");
      await page.locator('[data-task="Course confirmed"] [name=done]').check();
      await page.locator('[data-task="Course confirmed"] button').click();
      await page
        .locator('[data-task="Course confirmed"] [role=status]')
        .getByText("Saved.", { exact: true })
        .waitFor();
      assert.equal(model.ops.tasks[0].owner, "Tim");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      report.push({
        page: "operations-social-payments-future-handicap-checklist",
        width,
        status: "passed",
      });
      await context.close();
    }
    // Real UI, mocked sharing/auth: no invitations are sent and no accounts are created.
    for (const width of [390, 1365]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 960 },
        serviceWorkers: "block",
      });
      const m = await mocks(ctx, { signedIn: true }),
        p = await ctx.newPage();
      m.events = [{ ...fixture, guest_price: 45 }];
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await ctx.addInitScript(() =>
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data) => {
            window.__shared = data;
          },
        }),
      );
      await p.goto(base + "index.html");
      await p.locator("#nextEvent [data-home-invite]").waitFor();
      assert.equal(m.guestCreates || 0, 0, "Opening the homepage must not generate guest invitations");
      assert.equal(await p.locator("#nextEvent [data-home-rsvp]").count(), 1, "RSVP and invitation sit beside the same event");
      await p.locator("#nextEvent [data-home-invite]").click();
      assert.equal(new URL(p.url()).pathname, "/index.html", "Guest invitation starts directly on the homepage");
      await p.getByRole("dialog", { name: "Share guest invitation" }).waitFor();
      assert.equal(m.guestCreates, 1, "Only the explicit invitation click creates a link");
      assert.match(
        await p.getByLabel("Invitation message").inputValue(),
        /£45.00/,
      );
      assert.match(
        await p.getByLabel("Invitation message").inputValue(),
        /guest.html#aaaaaaaa/,
      );
      await p.getByRole("button", { name: "Send invite", exact: true }).click();
      assert.match(
        (await p.evaluate(() => window.__shared)).text,
        /The Warwickshire Golf Day/,
      );
      await p.evaluate(() =>
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: undefined,
        }),
      );
      await p.getByRole("button", { name: "Send invite", exact: true }).click();
      await p
        .getByRole("link", { name: "Open WhatsApp", exact: true })
        .waitFor();
      await p.screenshot({
        path: path.join(out, `guest-share-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      report.push({
        page: "homepage-guest-invite-native-share-and-fallback",
        width,
        status: "passed",
      });
      await ctx.close();
      const guestCtx = await browser.newContext({
          viewport: { width, height: 960 },
          serviceWorkers: "block",
        }),
        gm = await mocks(guestCtx),
        gp = await guestCtx.newPage();
      gm.events = [{ ...fixture, guest_price: 45 }];
      const guestErrors = [];
      gp.on("pageerror", (e) => guestErrors.push(e.message));
      await gp.goto(base + "guest.html#aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      await gp.getByLabel("Full name", { exact: true }).fill("New Guest");
      await gp
        .getByLabel("Contact number", { exact: true })
        .fill("07000000999");
      await gp
        .getByLabel("Create a password", { exact: true })
        .fill("guest-test-password");
      await gp.getByLabel("Your current handicap", { exact: true }).fill("29");
      await gp.getByLabel("I need a buggy", { exact: true }).check();
      await gp
        .getByLabel("Preferred tee time", { exact: true })
        .selectOption("Middle");
      await gp
        .getByLabel("I accept the cancellation terms", { exact: true })
        .check();
      await gp
        .getByLabel("Profile photo (optional)", { exact: true })
        .setInputFiles(path.join(root, "icon-logo.png"));
      await gp.screenshot({
        path: path.join(out, `guest-signup-${width}.png`),
        fullPage: true,
      });
      await gp
        .getByRole("button", {
          name: "Create account & join round",
          exact: true,
        })
        .click();
      await gp
        .getByRole("heading", { name: "You’re booked as a guest", exact: true })
        .waitFor();
      assert.equal(gm.signup.length, 1);
      assert.equal(gm.signup[0].data.guest_handicap, "29");
      assert.equal(
        gm.signup[0].data.guest_token,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      );
      assert.equal(gm.photoUploads, 1);
      await gp
        .getByRole("link", {
          name: "View round & payment details",
          exact: true,
        })
        .click();
      await gp.locator('[data-detail-section="booking"] > summary').click();
      await gp
        .getByText(
          "Pay Barford Treasurer · sort code 00-00-00 · account 00000000",
          { exact: true },
        )
        .waitFor();
      await gp.getByText("£45.00 to pay", { exact: true }).waitFor();
      await gp.goto(base + "index.html");
      await gp.getByText("£45.00 to pay", { exact: true }).waitFor();
      await gp
        .getByText(
          "Your handicap is awaiting committee approval. Your booking is saved.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await gp
          .getByRole("button", { name: "Invite a guest", exact: true })
          .count(),
        0,
      );
      await gp.screenshot({
        path: path.join(out, `guest-home-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await gp.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      assert.deepEqual(guestErrors, []);
      report.push({
        page: "guest-signup-photo-auto-rsvp-home-price-bank-details",
        width,
        status: "passed",
      });
      await guestCtx.close();
    }
    // The redesigned browse/detail hierarchy stays compact while retaining every event tool.
    // The cover is the official Earls course photograph (visual fixture only, not a site asset).
    const visualCover = "https://tcc-one-production-storage.s3.eu-west-2.amazonaws.com/sections/01KCVEZ11KQ91GCSK4TF18KA6V.webp";
    for (const width of [320, 390, 1365]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: "block" });
      const model = await mocks(context, { signedIn: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const ev = {
        ...fixture,
        event_type: "league",
        round_number: 3,
        course_name: "The Warwickshire · Earls Course",
        location: "The Warwickshire · Earls Course",
        cover_url: visualCover,
        cover_credit: "The Club Company — official Earls course photograph",
        member_price: 45,
        guest_price: 55,
        address: "Leek Wootton, Warwick, CV35 7QT",
        course_link: "https://www.theclubcompany.com/the-warwickshire/golf/golf-courses",
        course_phone: "01926 409409",
        refreshment_time: "09:00",
        included: "Coffee, bacon roll and 18 holes",
        practice: "Driving range and practice putting green",
        cancellation_terms: "Contact the organiser at least seven days before the round.",
        payment_due: "2027-06-18",
        rsvp_deadline: "2027-06-11",
        event_notice: "Please be ready on the first tee ten minutes before your time.",
        video_link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      };
      model.events = [ev, { ...ev, id: 998, name: "August summer golf", date: "2027-08-20", first_time: "11:00" }];
      model.responses = [{ id: 111, event_id: 999, user_id: uid, name: "Test Member", attending: true, reserve: false, buggy: true, preferred_time: "Middle" }];
      model.groups = [{ event_id: 999, group_number: 1, tee_time: "10:08", players: [{ user_id: uid, name: "Test Member", type: "buggy" }, { user_id: "partner", name: "Partner Member", type: "buggy" }] }];
      model.buggy = { status: "paired", partner_name: "Partner Member", partner_phone: "07000000002", booking_name: "Partner Member", booking_me: false };
      model.course = {
        description: "A woodland course with tree-lined fairways and water in play on several holes.",
        rating: 4.5,
        review_count: 123,
        reviews: [{ text: "Well-kept greens and a friendly welcome", author: "Course reviewer", rating: 5, url: "https://maps.google.com/" }],
        maps_url: "https://maps.google.com/",
      };
      model.ops = { settings: { bank_instructions: "Society transfer details", guest_policy: "Organisers approve guest handicaps." }, charges: [{ id: 1, event_id: 999, user_id: uid, label: fixture.name, amount: 45, received: 0 }], guests: [], changes: [], pairs: [], players: [] };
      await page.goto(base + "index.html");
      await page.locator("#homeOperations").getByRole("heading", { name: "You’re booked", exact: true }).waitFor();
      if (width === 320) {
        const redirects = await page.evaluate(() => {
          const original = location.href;
          const values = ["index.html?event=998#rsvp", "https://example.invalid/", "//example.invalid/"];
          const resolved = values.map(value => {
            history.replaceState(null, "", "index.html?next=" + encodeURIComponent(value));
            return window.barford.nextPath();
          });
          history.replaceState(null, "", original);
          return resolved;
        });
        assert.deepEqual(redirects, ["index.html?event=998#rsvp", "events.html", "events.html"], "Sign-in/signup preserve the chosen local event and reject external redirects");
      }
      assert.equal(await page.locator("#nextEvent [data-home-rsvp]").count(), 1);
      assert.equal(await page.locator("#nextEvent [data-home-invite]").count(), 1);
      assert.equal(await page.locator("#nextEvent [data-weather], #nextEvent [data-course-live]").count(), 0);
      await page.screenshot({ path: path.join(out, `simple-home-populated-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "Home quick actions fit narrow screens");
      await page.goto(base + "events.html");
      const poster = page.locator('a.event-poster-card[href="event.html?id=999"]');
      await poster.waitFor();
      assert.equal(await poster.locator(".event-poster-image").getAttribute("src"), visualCover, "Events uses the uploaded cover as the card background");
      assert.match(await poster.innerText(), /The Warwickshire Golf Day/);
      assert.match(await poster.innerText(), /10:00/);
      assert.match(await poster.innerText(), /45/);
      assert.match(await poster.innerText(), /23.*24/);
      assert.equal(await poster.locator("button, form, details").count(), 0, "Summary card has one navigation action");
      assert.equal(await page.locator(".event-poster-card").count(), 2);
      await page.waitForFunction(() => Array.from(document.querySelectorAll(".event-poster-image")).every(img => img.complete));
      const loadedPhoto = await poster.locator(".event-poster-image").evaluate(img => img.naturalWidth > 0);
      await page.screenshot({ path: path.join(out, `simple-events-populated-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "Photo summary cards fit narrow screens");
      // Click the edge of the cover, away from its title: the entire card must navigate.
      await poster.click({ position: { x: 18, y: 18 } });
      await page.waitForURL("**/event.html?id=999");
      await page.locator(".event-detail-hero h1").waitFor();
      await page.locator("#eventOperations .payment-card").waitFor({ state: "attached" });
      assert.equal(await page.locator("h1").count(), 1, "The event title appears once");
      assert.equal(await page.locator(".rsvp-form, [data-home-invite], [data-rsvp], #quickRsvp").count(), 0, "Event details have no duplicate RSVP or invite interface");
      assert.equal(await page.getByRole("button", { name: "Invite a guest", exact: true }).count(), 0);
      assert.equal(await page.locator(".event-info-section[open]").count(), 0, "Detailed sections start collapsed");
      assert.equal(await page.locator(".event-info-section").count(), 6, "Travel, course, weather, players, booking and requested buggy details are retained");
      const facts = await page.locator(".event-essentials").innerText();
      assert.match(facts, /45/);
      assert.match(facts, /55/);
      assert.match(facts, /10:00/);
      assert.match(facts, /23.*24/);
      await page.screenshot({ path: path.join(out, `simple-event-collapsed-${width}.png`), fullPage: true });
      for (const name of ["travel", "course", "weather", "players", "booking", "buggy"])
        await page.locator(`[data-detail-section="${name}"] > summary`).click();
      await page.locator('[data-detail-section="course"]').getByText(model.course.description, { exact: true }).waitFor();
      await page.locator('[data-detail-section="players"]').getByText("10:08", { exact: false }).first().waitFor();
      assert.equal(await page.getByRole("link", { name: "Google Maps ↗", exact: true }).count(), 1);
      assert.equal(await page.getByRole("link", { name: "Apple Maps ↗", exact: true }).count(), 1);
      assert.equal(await page.getByRole("link", { name: "Waze ↗", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Add to phone calendar", exact: true }).count(), 1);
      assert.equal(await page.locator("[data-play-video]").count(), 1);
      assert.match(await page.locator('[data-detail-section="course"]').innerText(), /Course reviewer/);
      assert.match(await page.locator('[data-detail-section="booking"]').innerText(), /Society transfer details/);
      assert.match(await page.locator('[data-detail-section="booking"]').innerText(), /seven days/);
      assert.match(await page.locator('[data-detail-section="buggy"]').innerText(), /Partner Member is booking the buggy/);
      assert.equal(await page.locator('a[href="tel:07000000002"]').count(), 1);
      assert.equal(await page.locator('a[href="tel:01926409409"]').count() >= 1, true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "Expanded event details fit narrow screens");
      await page.screenshot({ path: path.join(out, `simple-event-expanded-${width}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      report.push({ page: "simple-home-photo-events-collapsible-complete-details", width, status: "passed", loadedPhoto });
      await context.close();
    }
    // An event-details link must RSVP to that event, even when it is not the next event.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 960 }, serviceWorkers: "block" });
      const model = await mocks(context, { signedIn: true });
      model.events = [fixture, { ...fixture, id: 996, name: "Later summer round", date: "2027-08-20", guest_price: null }];
      const page = await context.newPage();
      await page.goto(base + "index.html?event=996#rsvp");
      const form = page.locator("#form-996 form");
      await form.waitFor();
      assert.match(await form.innerText(), /Later summer round/);
      await form.getByRole("radio", { name: "Yes, I’m playing", exact: true }).check();
      await form.getByRole("button", { name: "Save RSVP", exact: true }).click();
      await page.getByRole("button", { name: "Change RSVP", exact: true }).waitFor();
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      assert.equal(model.payloads[0].event_id, 996, "The selected event survives the homepage handoff");
      assert.equal(model.responses.some(row => row.event_id === 999), false, "The next event was not booked accidentally");
      const invite = page.locator("#nextEvent [data-home-invite]");
      assert.equal(await invite.isDisabled(), true, "Guest invitations cannot begin before a guest price is set");
      assert.equal(model.guestCreates || 0, 0);
      report.push({ page: "selected-event-home-rsvp-and-unpriced-guest-guard", width: 390, status: "passed" });
      await context.close();
    }
    // Guest bookings remain invitation-scoped when RSVP moves onto Home.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 960 }, serviceWorkers: "block" });
      const model = await mocks(context, { signedIn: true });
      const page = await context.newPage();
      model.guestCategory = "guest";
      model.guestBookings = [];
      model.events = [fixture, { ...fixture, id: 996, name: "A round without an invitation", date: "2027-08-20" }];
      await page.goto(base + "index.html");
      await page.getByRole("heading", { name: "Your next invitation starts here.", exact: true }).waitFor();
      assert.equal(await page.locator("[data-home-rsvp], [data-home-invite]").count(), 0, "Guests with no invitation cannot book the next member event");
      assert.equal((await page.locator("#nextEvent").innerText()).includes(fixture.name), false);
      await page.goto(base + "event.html?id=996#rsvp");
      await page.getByText("A member needs to invite you to this event. Open their invitation link to book your guest place.", { exact: true }).waitFor();
      assert.equal(await page.locator(".rsvp-form").count(), 0, "Legacy event links cannot bypass the guest invitation requirement");
      assert.equal(model.payloads.length, 0);
      model.guestBookings = [{ event_id: 999, host_name: "Gary Host", status: "approved", attending: false, reserve: false, guest_price: 45 }];
      model.responses = [{ id: 111, event_id: 999, user_id: uid, name: "Test Member (guest)", attending: false, reserve: false, buggy: false, guest_host_id: "host" }];
      await page.goto(base + "index.html?event=999#rsvp");
      const form = page.locator("#form-999 form");
      await form.waitFor();
      await form.getByRole("radio", { name: "Yes, I’m playing", exact: true }).check();
      await form.getByRole("button", { name: "Save changes", exact: true }).click();
      await page.locator("#homeOperations").getByRole("heading", { name: "You’re booked", exact: true }).waitFor();
      await page.locator(".rsvp-dialog").waitFor({ state: "detached" });
      assert.equal(model.payloads[0].event_id, 999, "A withdrawn invited guest can rejoin their own event");
      assert.equal(await page.locator("[data-home-invite]").count(), 0, "Guests cannot invite more guests");
      report.push({ page: "homepage-guest-invitation-scope-and-rejoin", width: 390, status: "passed" });
      await context.close();
    }
    // New visual layout: narrow phone, tablet, desktop and dark mode.
    for (const width of [320, 768, 1365]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      await mocks(context, { signedIn: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "index.html");
      await page
        .locator(".next-event-facts [data-live-slots]")
        .filter({ hasText: /available|spaces|places|slots/i })
        .waitFor();
      assert.equal(
        await page.locator("[data-weather]").count(),
        0,
        "Detailed forecast belongs on the event page",
      );
      assert.equal(await page.locator(".home-guide").count(), 0, "The homepage no longer duplicates the course guide");
      assert.equal(await page.locator("[data-home-rsvp]").count(), 1, "One direct RSVP action beside the next event");
      await page
        .getByRole("button", { name: "Dark mode", exact: true })
        .click();
      assert(
        await page
          .locator("body")
          .evaluate((e) => e.classList.contains("dark-mode")),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
        "New layout overflow",
      );
      await page.screenshot({
        path: path.join(out, `redesign-dark-home-${width}.png`),
        fullPage: true,
      });
      if (width === 320) {
        await page
          .getByRole("link", { name: "Events tab", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "The season ahead." })
          .waitFor();
        assert.equal(
          await page
            .getByRole("link", { name: "Events tab", exact: true })
            .getAttribute("aria-current"),
          "page",
        );
      }
      assert.deepEqual(errors, []);
      report.push({
        page: "redesign-responsive-dark-mode-simple-home",
        width,
        status: "passed",
      });
      await context.close();
    }
    for (const width of [320, 1365]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 960 },
        serviceWorkers: "block",
        acceptDownloads: true,
      });
      const model = await mocks(ctx, { signedIn: true, admin: true }),
        page = await ctx.newPage(),
        errors = [];
      page.on("pageerror", (err) => errors.push(err.message));
      model.league = {
        revision: 1,
        players: [{ id: uid, name: "Test Member", starting_handicap: 20 }],
        rounds: [],
      };
      await page.goto(base + "admin.html");
      await page.locator('[data-tab="committee"]').click();
      await page.getByText("Add an expense", { exact: true }).click();
      await page
        .getByLabel("Your name / claimant", { exact: true })
        .fill("Test Member");
      await page
        .getByLabel("What is it for?", { exact: true })
        .fill("=Prize purchases");
      await page.getByLabel("Amount due (£)", { exact: true }).fill("27.50");
      await page
        .locator("input[name=receipt]")
        .setInputFiles(path.join(root, "icon-logo.png"));
      await page
        .getByRole("button", { name: "Add expense", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "=Prize purchases", exact: true })
        .waitFor();
      assert.equal(model.receiptUploads, 1);
      assert.equal(
        await page
          .locator('[data-tab="committee"] .notification-count')
          .innerText(),
        "1",
      );
      await page
        .getByRole("button", { name: "View receipt", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Expense receipt", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Close receipt", exact: true })
        .click();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export expenses CSV", exact: true })
        .click();
      const file = await download;
      await file.saveAs(path.join(out, `expenses-${width}.csv`));
      const csv = fs.readFileSync(
        path.join(out, `expenses-${width}.csv`),
        "utf8",
      );
      assert.match(csv, /27.5/);
      assert.match(csv, /'=Prize purchases/);
      assert.match(csv, /Unpaid/);
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Mark paid", exact: true })
        .click();
      await page.getByText("Expense marked paid.", { exact: true }).waitFor();
      assert.equal(
        await page
          .locator('[data-tab="committee"] .notification-count')
          .count(),
        0,
      );
      assert.equal(model.expenses[0].paid_by_name, "Test Member");
      for (const name of ["Export income CSV", "Export finance summary"]) {
        const pending = page.waitForEvent("download");
        await page.getByRole("button", { name, exact: true }).click();
        assert((await pending).suggestedFilename().endsWith(".csv"));
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(out, `expense-paid-${width}.png`),
        fullPage: true,
      });
      model.league.players.push({
        id: "pending",
        name: "New Player",
        starting_handicap: null,
      });
      await page.reload();
      await page
        .locator('[data-tab="handicaps"]')
        .waitFor({ state: "visible" });
      assert.deepEqual(errors, []);
      await ctx.close();
      report.push({
        page: "receipt-upload-paid-badge-finance-exports-and-new-player-setup",
        width,
        status: "passed",
      });
      const mc = await browser.newContext({
        viewport: { width, height: 960 },
        serviceWorkers: "block",
      });
      const mm = await mocks(mc, { signedIn: true }),
        mp = await mc.newPage();
      mm.board = {
        visible_rounds: 5,
        players: [
          { id: uid, name: "Test Member", starting_handicap: 20 },
          { id: "other", name: "Another Player", starting_handicap: 15 },
        ],
        rounds: [
          {
            round: 1,
            average: 30,
            results: [
              {
                user_id: uid,
                points: 38,
                handicap: 20,
                adjustment: -2,
                next_handicap: 18,
                winner: true,
              },
              {
                user_id: "other",
                points: 25,
                handicap: 15,
                adjustment: 2,
                next_handicap: 17,
                winner: false,
              },
            ],
          },
          {
            round: 6,
            average: 99,
            results: [
              {
                user_id: uid,
                points: 99,
                handicap: 18,
                adjustment: -9,
                next_handicap: 9,
                winner: true,
              },
            ],
          },
        ],
      };
      await mp.goto(base + "index.html");
      await mp
        .locator("#personalResults")
        .getByText("Round winner. Well played.", { exact: true })
        .waitFor();
      const text = await mp.locator("#personalResults").innerText();
      assert.match(text, /38/);
      assert.match(text, /-2/);
      assert.match(text, /18/);
      assert(!text.includes("99"));
      await mp.screenshot({
        path: path.join(out, `personal-results-${width}.png`),
        fullPage: true,
      });
      await mp.goto(base + "scores.html");
      await mp.locator(".standing-card").first().waitFor();
      assert.equal(
        await mp.locator(".standing-card [data-total]").first().innerText(),
        "38",
      );
      assert.match(
        await mp.locator(".standing-card").nth(1).innerText(),
        /\+2/,
      );
      assert.equal(
        await mp
          .locator("#roundResults")
          .evaluate((x) => x.scrollWidth > x.clientWidth + 2),
        false,
      );
      assert.equal(
        await mp.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      await mp.screenshot({
        path: path.join(out, `round-cards-${width}.png`),
        fullPage: true,
      });
      await mc.close();
      report.push({
        page: "compact-round-results-personal-summary-and-secret-protection",
        width,
        status: "passed",
      });
    }
    const { packPlayers } = await import(
      "data:text/javascript;base64," +
        Buffer.from(
          fs.readFileSync(path.join(root, "assets/js/tee-groups.js"), "utf8"),
        ).toString("base64")
    );
    const teePeople = [
      { user_id: "host", name: "Host", buggy: true },
      {
        user_id: "guest",
        name: "Guest (guest)",
        guest_host_id: "host",
        buggy: false,
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        user_id: "p" + i,
        name: "Player " + i,
        buggy: i < 3,
      })),
    ];
    const packed = packPlayers(teePeople, [
      { first_user: "p0", second_user: "p1" },
    ]);
    assert(
      packed.some(
        (g) =>
          g.some((p) => p.user_id === "host") &&
          g.some((p) => p.user_id === "guest"),
      ),
    );
    assert(
      packed.some(
        (g) =>
          g.some((p) => p.user_id === "p0") &&
          g.some((p) => p.user_id === "p1"),
      ),
    );
    assert(packed.every((g) => g.length <= 4));
    assert.equal(new Set(packed.flat().map((p) => p.user_id)).size, 10);
    report.push({
      page: "host-guest-grouping-preserves-confirmed-pairs-and-capacity",
      status: "passed",
    });
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
