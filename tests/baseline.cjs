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
            8,
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
