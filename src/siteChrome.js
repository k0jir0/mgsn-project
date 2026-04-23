const PLATFORM_PAGES = Object.freeze([
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "trench", label: "Trench", href: "/trench.html" },
  { key: "strategy", label: "Strategy", href: "/strategy.html" },
  { key: "build", label: "Build", href: "/build.html" },
  { key: "subscribe", label: "Subscribe", href: "/subscribe.html" },
  { key: "ops", label: "Ops", href: "/ops.html" },
  { key: "buyback", label: "Buyback", href: "/buyback.html" },
  { key: "staking", label: "Staking", href: "/staking.html" },
  { key: "keepBurn", label: "Keep/Burn", href: "/keep-burn.html" },
  { key: "burn", label: "Burn", href: "/burn.html" },
]);

function buildNavLinks(activePage, linkClassName) {
  return PLATFORM_PAGES.map((page) => {
    const active = page.key === activePage;
    return `
      <a class="${linkClassName}${active ? " active" : ""}" href="${page.href}"${active ? ' aria-current="page"' : ""}>
        ${page.label}
      </a>`;
  }).join("");
}

export function buildMobilePlatformNavHTML(activePage) {
  return `
    <nav class="mobile-platform-nav" aria-label="Mobile primary">
      ${buildNavLinks(activePage, "mobile-platform-link")}
    </nav>`;
}

export function buildPlatformHeaderHTML({
  activePage = "dashboard",
  badgeText = "",
  priceLabel = "",
  priceValue = "—",
  priceId = "",
  priceClass = "",
  mobileActions = [],
} = {}) {
  const priceIdAttr = priceId ? ` id="${priceId}"` : "";
  const badgeHtml = badgeText
    ? `
      <div class="top-header-badge">
        <div class="live-dot"></div>
        <span class="badge-text">${badgeText}</span>
      </div>`
    : "";
  const priceHtml = priceLabel
    ? `
      <div class="top-header-icp">
        <span class="header-price-label">${priceLabel}</span>
        <span class="header-price-val${priceClass ? ` ${priceClass}` : ""}"${priceIdAttr}>${priceValue}</span>
      </div>`
    : "";
  const mobileActionsHtml = mobileActions.length
    ? `
      <div class="top-header-mobile-actions">
        ${mobileActions.map((action) => `
          <button
            class="header-mobile-btn"
            id="${action.id}"
            type="button"${action.ariaExpanded != null ? ` aria-expanded="${String(action.ariaExpanded)}"` : ""}>
            ${action.label}
          </button>`).join("")}
      </div>`
    : "";

  return `
    <header class="top-header">
      <div class="top-header-logo">
        <div class="logo-icon">M</div>
        <div class="top-header-brand-copy">
          <div class="logo-title">MGSN Strategy Tracker</div>
          <div class="logo-subtitle">on Internet Computer</div>
        </div>
      </div>
      <nav class="platform-nav" aria-label="Primary">
        ${buildNavLinks(activePage, "platform-nav-link")}
      </nav>
      <div class="top-header-spacer"></div>
      ${badgeHtml}
      ${priceHtml}
      ${mobileActionsHtml}
    </header>
    ${buildMobilePlatformNavHTML(activePage)}`;
}
