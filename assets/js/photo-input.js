export async function preparePhoto(file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Choose a JPEG, PNG or WebP photo. Export HEIC photos as JPEG first.",
    );
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 10 MB.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This photo could not be opened. Try another JPEG or PNG.");
  }
  try {
    if (bitmap.width * bitmap.height > 50000000)
      throw new Error("This photo is too large. Choose a smaller image.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 640;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 640, 640);
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      640,
      640,
    );
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not prepare this photo.")),
        "image/jpeg",
        0.85,
      ),
    );
  } finally {
    bitmap.close();
  }
}
export function photoPickerHTML() {
  return `<label for="profilePhoto">Profile photo (optional)</label><input id="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp"><small>Choose a clear photo of yourself. A square preview is shown below. Visible to signed-in society members.</small><img id="profilePhotoPreview" class="photo-preview" alt="Your selected profile photo" hidden><p id="photoPickerStatus" role="status"></p>`;
}
export function wirePhotoPicker(area) {
  let blob = null,
    pending = null,
    url = null,
    error = null,
    version = 0;
  area.querySelector("#profilePhoto").onchange = () => {
    const n = ++version;
    error = null;
    blob = null;
    const file = area.querySelector("#profilePhoto").files[0],
      preview = area.querySelector("#profilePhotoPreview"),
      status = area.querySelector("#photoPickerStatus");
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
    preview.hidden = true;
    status.textContent = file ? "Preparing your photo…" : "";
    pending = preparePhoto(file)
      .then((value) => {
        if (n !== version) return;
        blob = value;
        if (blob) {
          url = URL.createObjectURL(blob);
          preview.src = url;
          preview.hidden = false;
        }
        status.textContent = "";
      })
      .catch((err) => {
        if (n !== version) return;
        error = err;
        status.textContent = err.message;
      });
  };
  return async () => {
    if (pending) await pending;
    if (error) throw error;
    return blob;
  };
}
