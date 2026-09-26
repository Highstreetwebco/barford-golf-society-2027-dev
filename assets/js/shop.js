const b = await window.barfordReady;
const { client: c, escape: e, state } = b;
let products = [],
  basket = [];
try {
  basket = JSON.parse(sessionStorage.getItem("barford-basket") || "[]");
  if (!Array.isArray(basket)) basket = [];
} catch {
  basket = [];
}
const dialog = document.getElementById("basketDialog"),
  grid = document.getElementById("productGrid");
async function load() {
  const { data, error } = await c
    .from("products")
    .select("*")
    .eq("active", true)
    .order("id");
  if (error) {
    grid.textContent = "Products could not load. Please try again.";
    return;
  }
  products = data || [];
  basket = basket.filter(
    (item) =>
      products.some((p) => p.id === item.id) &&
      Number.isInteger(item.qty) &&
      item.qty > 0,
  );
  updateBasket();
  grid.innerHTML = products.length
    ? products
        .map(
          (p) =>
            `<article class="panel product-card"><div class="product-image ${b.safeUrl(p.image) ? "" : "placeholder-image"}"><img src="${b.safeUrl(p.image) || "icon-logo.png"}" alt="${e(p.name)}" loading="lazy"></div><div class="product-content"><h2>${e(p.name)}</h2><p>${e(p.description)}</p><div class="product-price">${b.money(p.price)}</div><p>${p.packs_left > 0 ? p.packs_left + " available" : "Out of stock"}</p><button data-add="${p.id}" ${p.packs_left <= 0 ? "disabled" : ""}>${p.packs_left > 0 ? "Add to basket" : "Out of stock"}</button></div></article>`,
        )
        .join("")
    : b.empty(
        "The shelves are being stocked.",
        "Society products will appear here when they’re available.",
      );
  grid.querySelectorAll("[data-add]").forEach(
    (button) =>
      (button.onclick = () => {
        const p = products.find((p) => p.id === Number(button.dataset.add)),
          item = basket.find((item) => item.id === p.id);
        if ((item?.qty || 0) >= p.packs_left)
          return b.toast("You’ve added all the available stock.");
        if (item) item.qty++;
        else basket.push({ id: p.id, qty: 1 });
        updateBasket();
        b.toast(p.name + " added to your basket.");
      }),
  );
  if (state.user) await orders();
  if (state.admin) adminProducts();
}
function updateBasket() {
  sessionStorage.setItem("barford-basket", JSON.stringify(basket));
  document.getElementById("basketCount").textContent = basket.reduce(
    (n, item) => n + item.qty,
    0,
  );
  let total = 0;
  document.getElementById("basketItems").innerHTML = basket.length
    ? basket
        .map((item) => {
          const p = products.find((p) => p.id === item.id);
          if (!p) return "";
          total += Number(p.price) * item.qty;
          return `<div class="basket-row"><div><strong>${e(p.name)}</strong><p>${b.money(p.price)} each</p><button type="button" class="text-button" data-remove="${p.id}">Remove</button></div><label>Quantity<input data-qty="${p.id}" aria-label="Quantity for ${e(p.name)}" type="number" min="1" max="${Math.max(p.packs_left, 1)}" value="${item.qty}"></label></div>`;
        })
        .join("")
    : '<p class="muted">Your basket is empty.</p>';
  document.getElementById("basketTotal").textContent = b.money(total);
  document.getElementById("checkoutForm").hidden = !basket.length;
  document.querySelectorAll("[data-remove]").forEach(
    (button) =>
      (button.onclick = () => {
        basket = basket.filter(
          (item) => item.id !== Number(button.dataset.remove),
        );
        updateBasket();
      }),
  );
  document.querySelectorAll("[data-qty]").forEach(
    (input) =>
      (input.onchange = () => {
        const p = products.find((p) => p.id === Number(input.dataset.qty));
        const n = Number(input.value);
        if (!Number.isInteger(n) || n < 1 || n > p.packs_left) {
          b.toast("Choose a quantity within the available stock.");
          updateBasket();
          return;
        }
        basket.find((item) => item.id === p.id).qty = n;
        updateBasket();
      }),
  );
}
document.getElementById("basketButton").onclick = () => {
  updateBasket();
  dialog.showModal();
};
document.getElementById("closeBasket").onclick = () => dialog.close();
document.getElementById("checkoutForm").onsubmit = (ev) => {
  ev.preventDefault();
  b.submit(ev.target, async () => {
    if (!basket.length) throw new Error("Your basket is empty.");
    if (!(await b.requireMember())) return;
    const name = state.profile?.full_name;
    if (!name) throw new Error("Save your name in My account first.");
    const { error } = await c.rpc("reserve_basket", {
      items: basket,
      customer: name,
      payment: document.getElementById("paymentMethod").value,
    });
    if (error) throw error;
    basket = [];
    updateBasket();
    dialog.close();
    await load();
    document.getElementById("shopStatus").innerHTML =
      '<p class="notice">Reservation confirmed. Payment is still due by your chosen method.</p>';
    b.toast("Your items are reserved.");
  });
};
async function orders() {
  const { data, error } = await c
    .from("shop_orders")
    .select("*")
    .order("id", { ascending: false });
  if (error) {
    b.toast("Reservations could not load.");
    return;
  }
  document.getElementById("myOrders").hidden = false;
  const mine = data.filter((o) => o.user_id === state.user.id);
  document.getElementById("myOrderList").innerHTML = mine.length
    ? '<div class="table-scroll panel"><table><thead><tr><th>Item</th><th>Quantity</th><th>Total</th><th>Payment method</th><th>Delivery</th></tr></thead><tbody>' +
      mine
        .map(
          (o) =>
            `<tr><td>${e(o.product_name)}</td><td>${o.quantity}</td><td>${b.money(o.price * o.quantity)}</td><td>${e(o.payment_method)}</td><td>${o.delivered ? "Delivered" : "Awaiting collection"}</td></tr>`,
        )
        .join("") +
      "</tbody></table></div>"
    : '<p class="muted">You haven’t reserved any items yet.</p>';
  if (!state.admin) return;
  document.getElementById("adminOrders").innerHTML = data.length
    ? "<table><thead><tr><th>Member</th><th>Item</th><th>Qty</th><th>Payment</th><th>Delivery</th><th>Actions</th></tr></thead><tbody>" +
      data
        .map(
          (o) =>
            `<tr><td>${e(o.customer_name)}</td><td>${e(o.product_name)}</td><td>${o.quantity}</td><td>${e(o.payment_method)}</td><td>${o.delivered ? "Delivered" : "Pending"}</td><td>${o.delivered ? "" : `<button data-deliver="${o.id}">Mark delivered</button> `}<button class="danger" data-cancel-order="${o.id}">Cancel</button></td></tr>`,
        )
        .join("") +
      "</tbody></table>"
    : '<p class="muted">No orders yet.</p>';
  document.querySelectorAll("[data-deliver]").forEach(
    (button) =>
      (button.onclick = async () => {
        button.disabled = true;
        const { error } = await c
          .from("shop_orders")
          .update({ delivered: true })
          .eq("id", Number(button.dataset.deliver));
        if (error) {
          button.disabled = false;
          return b.toast(error.message);
        }
        await orders();
      }),
  );
  document.querySelectorAll("[data-cancel-order]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (
          !confirm(
            "Cancel this reservation? Undelivered items will be returned to stock.",
          )
        )
          return;
        button.disabled = true;
        const { error } = await c.rpc("cancel_order", {
          order_id: Number(button.dataset.cancelOrder),
        });
        if (error) {
          button.disabled = false;
          return b.toast(error.message);
        }
        await load();
      }),
  );
}
function adminProducts() {
  const area = document.getElementById("adminProducts");
  area.innerHTML = products
    .map(
      (p) =>
        `<form class="admin-product" data-product="${p.id}"><div class="form-grid"><label>Name<input name="name" value="${e(p.name)}" required></label><label>Price (£)<input name="price" type="number" min="0" step="0.01" value="${p.price}" required></label><label>Stock<input name="packs_left" type="number" min="0" step="1" value="${p.packs_left}" required></label><label>Image URL<input name="image" type="url" value="${e(p.image)}"></label><label class="full">Description<textarea name="description">${e(p.description)}</textarea></label><div class="actions"><button>Save product</button><button type="button" class="danger" data-archive="${p.id}">Remove from shop</button></div><p class="form-status" role="status"></p></div></form>`,
    )
    .join("");
  area.querySelectorAll("form").forEach(
    (form) =>
      (form.onsubmit = (ev) => {
        ev.preventDefault();
        b.submit(form, async () => {
          const payload = productPayload(new FormData(form));
          const { error } = await c
            .from("products")
            .update(payload)
            .eq("id", Number(form.dataset.product));
          if (error) throw error;
          await load();
          b.toast("Product saved.");
        });
      }),
  );
  area.querySelectorAll("[data-archive]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (
          !confirm(
            "Remove this product from the shop? Existing reservations are kept.",
          )
        )
          return;
        const { error } = await c
          .from("products")
          .update({ active: false })
          .eq("id", Number(button.dataset.archive));
        if (error) return b.toast(error.message);
        await load();
      }),
  );
}
function productPayload(f) {
  const name = String(f.get("name")).trim(),
    price = Number(f.get("price")),
    stock = Number(f.get("packs_left"));
  if (
    !name ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(stock) ||
    stock < 0
  )
    throw new Error("Check the product name, price and stock.");
  return {
    name,
    price,
    packs_left: stock,
    image: f.get("image") || "",
    description: f.get("description") || "",
  };
}
document.getElementById("productForm").onsubmit = (ev) => {
  ev.preventDefault();
  b.submit(ev.target, async () => {
    const { error } = await c
      .from("products")
      .insert({ ...productPayload(new FormData(ev.target)), active: true });
    if (error) throw error;
    ev.target.reset();
    await load();
    b.toast("Product added.");
  });
};
await load();
