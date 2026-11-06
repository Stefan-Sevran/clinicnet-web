// Route bookmarks from the former single-page website.
if (location.pathname === "/" || location.pathname === "/index.html") {
  const legacyRoutes = new Map([
    ["#ai-receptionist", "/ai-receptionist/"],
    ["#calculator", "/calculator/"],
    ["#lost-call-rescue", "/missed-call-booking/"],
    ["#forms", "/ai-booking-form/"],
    ["#about", "/about/"],
    ["#eden-research-institute", "/research/"],
    ["#hospitals", "/for-hospitals/"],
    ["#privacy", "/privacy/"],
    ["#terms", "/terms/"],
    ["#audit", "/audit/"],
    ["#clinic-audit-chat-2026", "/audit/"],
    ["#eve-ai-reception-chat-2026", "/ai-receptionist/"],
  ]);
  const target = legacyRoutes.get(location.hash);
  if (target) {
    const anchor = location.hash === "#clinic-audit-chat-2026" || location.hash === "#eve-ai-reception-chat-2026"
      ? location.hash
      : "";
    location.replace(target + location.search + anchor);
  }
}
