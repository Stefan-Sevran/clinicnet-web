// Preserve existing links to the former root Audit pilot.
if (location.pathname === "/" || location.pathname === "/index.html") {
  if (location.hash === "#audit" || location.hash === "#clinic-audit-chat-2026") {
    location.replace("/audit/" + location.search + (location.hash === "#audit" ? "" : location.hash));
  }
}

