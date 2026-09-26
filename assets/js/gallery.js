const b = await window.barfordReady;
const { client: c, escape: e, state } = b;
const grid = document.getElementById("galleryGrid"),
  dialog = document.getElementById("lightbox"),
  form = document.getElementById("uploadForm");
let photos = [],
  selected = [],
  active = 0,
  previewUrls = [];
if (state.user) {
  document.getElementById("uploadGate").hidden = true;
  form.hidden = false;
}
async function load() {
  const { data, error } = await c.storage
    .from("gallery-images")
    .list("uploads", {
      limit: 1000,
      sortBy: { column: "created_at", order: "desc" },
    });
  if (error) {
    grid.innerHTML = "<p>Photos could not load. Please try again.</p>";
    return;
  }
  photos = (data || [])
    .filter((o) => o.id && !o.name.startsWith("."))
    .map((o) => ({
      path: "uploads/" + o.name,
      url: c.storage.from("gallery-images").getPublicUrl("uploads/" + o.name)
        .data.publicUrl,
    }));
  grid.innerHTML = photos.length
    ? photos
        .map(
          (p, i) =>
            `<article class="gallery-tile"><button data-photo="${i}" aria-label="View photo ${i + 1}"><img src="${e(p.url)}" alt="Society golf day photo ${i + 1}" loading="lazy"></button>${state.admin ? `<button class="danger" data-delete="${i}" aria-label="Delete photo ${i + 1}">Delete photo</button>` : ""}</article>`,
        )
        .join("")
    : b.empty(
        "Our next memories go here.",
        "No photos yet. Share a few from your next society golf day.",
      );
  grid.querySelectorAll("[data-photo]").forEach(
    (button) =>
      (button.onclick = () => {
        active = Number(button.dataset.photo);
        show();
        dialog.showModal();
      }),
  );
  grid.querySelectorAll("[data-delete]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("Delete this photo?")) return;
        const { error } = await c.storage
          .from("gallery-images")
          .remove([photos[Number(button.dataset.delete)].path]);
        if (error) return b.toast(error.message);
        await load();
        b.toast("Photo deleted.");
      }),
  );
}
function show() {
  document.getElementById("lightboxImage").src = photos[active].url;
  document.getElementById("photoNumber").textContent =
    `${active + 1} / ${photos.length}`;
}
function move(delta) {
  if (!photos.length) return;
  active = (active + delta + photos.length) % photos.length;
  show();
}
document.getElementById("closePhoto").onclick = () => dialog.close();
document.getElementById("previousPhoto").onclick = () => move(-1);
document.getElementById("nextPhoto").onclick = () => move(1);
dialog.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowLeft") move(-1);
  if (ev.key === "ArrowRight") move(1);
});
function previews() {
  previewUrls.forEach(URL.revokeObjectURL);
  previewUrls = [];
  const area = document.getElementById("photoPreviews");
  area.innerHTML = selected
    .map((file, i) => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      return `<div><img src="${url}" alt="${e(file.name)}"><button type="button" data-remove="${i}" aria-label="Remove ${e(file.name)}">×</button></div>`;
    })
    .join("");
  area.querySelectorAll("[data-remove]").forEach(
    (button) =>
      (button.onclick = () => {
        selected.splice(Number(button.dataset.remove), 1);
        previews();
      }),
  );
  document.getElementById("uploadSubmit").hidden = !selected.length;
}
document.getElementById("photos").onchange = (ev) => {
  selected = Array.from(ev.target.files);
  previews();
};
form.onsubmit = (ev) => {
  ev.preventDefault();
  b.submit(form, async () => {
    if (!(await b.requireMember())) return;
    if (!selected.length) throw new Error("Choose a photo first.");
    for (const file of selected) {
      if (file.size > 15 * 1024 * 1024)
        throw new Error(file.name + " is larger than 15 MB.");
      if (
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/heic",
          "image/heif",
        ].includes(file.type) &&
        !/^.*\.(heic|heif)$/i.test(file.name)
      )
        throw new Error("Choose JPEG, PNG, WebP or HEIC photos.");
    }
    while (selected.length) {
      const file = selected[0],
        path =
          "uploads/" +
          Date.now() +
          "_" +
          crypto.randomUUID() +
          "_" +
          file.name.replace(/[^\w.-]/g, "_");
      const { error } = await c.storage
        .from("gallery-images")
        .upload(path, file);
      if (error) {
        previews();
        await load();
        throw error;
      }
      selected.shift();
    }
    form.reset();
    previews();
    await load();
    b.toast("Your photos have been uploaded.");
  });
};
await load();
