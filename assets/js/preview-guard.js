/* 2027 is live. Keep this compatibility file for previously cached preview pages.
   Member authentication and admin authorization remain enforced by Supabase. */
(function () {
  document.documentElement.style.visibility = "";
  try { sessionStorage.removeItem("barford-2027-preview-session"); } catch {}
})();
