(() => {
  "use strict";
  const client = window.BarfordSupabase;
  if (!client) return;
  const fallback = { primary: "#315C4A", accent: "#C7A96B" };
  const valid = value => /^#[0-9a-f]{6}$/i.test(String(value || ""));
  const rgb = value => {
    const hex = value.slice(1);
    return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  };
  const hex = values => `#${values.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  const mix = (colour, target, amount) => hex(rgb(colour).map((value, index) => value + (rgb(target)[index] - value) * amount));
  const readable = colour => {
    const luminance = value => {
      const channels=rgb(value).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
      return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
    };
    const background=luminance(colour),dark=luminance('#17231D');
    const whiteContrast=1.05/(background+.05);
    const darkContrast=(Math.max(background,dark)+.05)/(Math.min(background,dark)+.05);
    if(Math.max(darkContrast,whiteContrast)<4.5)return '#000000';
    return darkContrast>whiteContrast?'#17231D':'#FFFFFF';
  };
  const contrast = colour => {
    const [maximum, minimum] = [Math.max(...rgb(colour)), Math.min(...rgb(colour))];
    const saturation = maximum ? (maximum - minimum) / maximum : 0;
    const brightness = rgb(colour).reduce((total, value, index) => total + value * [.299, .587, .114][index], 0);
    return { saturation, brightness };
  };
  const apply = (primaryValue, accentValue, persistKey = "") => {
    const primary = valid(primaryValue) ? primaryValue.toUpperCase() : fallback.primary;
    const accent = valid(accentValue) ? accentValue.toUpperCase() : fallback.accent;
    const accentQuality = contrast(accent);
    const action = accentQuality.brightness > 225 || accentQuality.saturation < .12 ? primary : accent;
    const root = document.documentElement;
    const properties = {
      "--member-primary": primary,
      "--member-primary-dark": mix(primary, "#000000", .28),
      "--member-primary-soft": mix(primary, "#FFFFFF", .86),
      "--member-primary-text": readable(primary),
      "--member-accent": accent,
      "--member-accent-dark": mix(accent, "#000000", .22),
      "--member-accent-soft": mix(accent, "#FFFFFF", .82),
      "--member-accent-text": readable(accent),
      "--member-action": action,
      "--member-action-dark": mix(action, "#000000", .24),
      "--member-action-text": readable(action),
      "--green-1000": mix(primary, "#000000", .62),
      "--green-950": mix(primary, "#000000", .48),
      "--green-900": mix(primary, "#000000", .36),
      "--green-800": mix(primary, "#000000", .18),
      "--green-700": primary,
      "--green-100": mix(primary, "#FFFFFF", .82),
      "--green-050": mix(primary, "#FFFFFF", .92),
      "--gold-700": mix(accent, "#000000", .3),
      "--gold-600": mix(accent, "#000000", .16),
      "--gold-500": accent,
      "--gold-400": mix(accent, "#FFFFFF", .18),
      "--gold-100": mix(accent, "#FFFFFF", .8),
      "--brass-soft": `linear-gradient(135deg,${mix(accent, "#000000", .2)} 0%,${accent} 48%,${mix(accent, "#FFFFFF", .25)} 100%)`,
      "--metal-bar": `linear-gradient(180deg,${mix(accent, "#000000", .48)} 0%,${accent} 35%,${mix(accent, "#FFFFFF", .4)} 52%,${mix(accent, "#000000", .22)} 100%)`
    };
    Object.entries(properties).forEach(([name, value]) => root.style.setProperty(name, value));
    root.classList.add("member-personal-theme");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", primary);
    if (persistKey) localStorage.setItem(persistKey, JSON.stringify({ primary, accent }));
    window.dispatchEvent(new CustomEvent("barford-theme-applied", { detail: { primary, accent } }));
  };
  window.BarfordPersonalTheme = { apply, valid };

  (async () => {
    const session = (await (window.BarfordInitialSession || client.auth.getSession())).data.session;
    if (!session) return;
    const key = `barford-personal-theme-${session.user.id}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      if (cached) apply(cached.primary, cached.accent);
    } catch {}
    const context = window.BarfordMemberContext ? await window.BarfordMemberContext : null;
    const data = window.BarfordMemberContext ? context?.profile : (await client.from("profiles").select("theme_primary,theme_accent").eq("id", session.user.id).maybeSingle()).data;
    if (data) apply(data.theme_primary, data.theme_accent, key);
  })().catch(() => {});
})();
