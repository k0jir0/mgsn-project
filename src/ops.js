import "./styles.css";

import { Principal } from "@dfinity/principal";

import { getAuthState, login, logout, subscribeAuth } from "./auth";
import {
  createAnalyticsActor,
  createSubscriptionsActor,
  createTreasuryActor,
  getPublicCanisterId,
} from "./mgsnCanisters";
import {
  formatTimestampNs,
  formatTokenAmount,
  isAnonymousPrincipal,
  optionalValue,
  parseTokenAmount,
  principalText,
  shorten,
  toOptionalPrincipal,
  unwrapResult,
} from "./platformUtils";
import { buildPlatformHeaderHTML } from "./siteChrome";

const app = document.querySelector("#app");

const state = {
  auth: null,
  treasuryOverview: null,
  analyticsDashboard: null,
  subscriptionsConfig: null,
  subscriptionsPortal: null,
  notice: null,
  busyAction: "",
};

function setNotice(type, text) {
  state.notice = { type, text };
}

function clearNotice() {
  state.notice = null;
}

async function safeOptionalCall(factory) {
  try {
    return await factory();
  } catch {
    return null;
  }
}

async function loadOpsState() {
  const [treasuryActor, analyticsActor, subscriptionsActor] = await Promise.all([
    createTreasuryActor(state.auth?.identity),
    createAnalyticsActor(state.auth?.identity),
    createSubscriptionsActor(state.auth?.identity),
  ]);

  const [treasuryOverview, analyticsDashboard, subscriptionsConfig, subscriptionsPortal] = await Promise.all([
    treasuryActor ? treasuryActor.getOverview() : null,
    analyticsActor ? safeOptionalCall(() => analyticsActor.getDashboard()) : null,
    subscriptionsActor ? subscriptionsActor.getConfig() : null,
    subscriptionsActor ? subscriptionsActor.getPortalState([]) : null,
  ]);

  state.treasuryOverview = treasuryOverview;
  state.analyticsDashboard = analyticsDashboard;
  state.subscriptionsConfig = subscriptionsConfig;
  state.subscriptionsPortal = subscriptionsPortal;
  render();
}

function requireAuthenticatedIdentity() {
  if (!state.auth?.identity || isAnonymousPrincipal(state.auth.principal)) {
    throw new Error("Authenticate with Internet Identity before running admin treasury actions.");
  }

  return state.auth.identity;
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="ops-alert ${state.notice.type}">
      ${state.notice.text}
    </div>`;
}

function renderMetricCards() {
  const analytics = state.analyticsDashboard;

  if (!analytics) {
    return '<div class="ops-empty">Analytics canister is not available in this environment.</div>';
  }

  return `
    <article class="ops-card compact-card">
      <div class="ops-card-kicker">Revenue</div>
      <h3>${formatTokenAmount(analytics.totalRevenueE8s)}</h3>
      <p class="ops-copy small">Lifetime net revenue recorded into the analytics canister.</p>
    </article>
    <article class="ops-card compact-card">
      <div class="ops-card-kicker">Trailing 30 days</div>
      <h3>${formatTokenAmount(analytics.trailing30dRevenueE8s)}</h3>
      <p class="ops-copy small">Recent realized revenue from treasury events.</p>
    </article>
    <article class="ops-card compact-card">
      <div class="ops-card-kicker">MRR</div>
      <h3>${formatTokenAmount(analytics.monthlyRecurringRevenueE8s)}</h3>
      <p class="ops-copy small">Current run rate derived from active subscription events.</p>
    </article>
    <article class="ops-card compact-card">
      <div class="ops-card-kicker">Active subscriptions</div>
      <h3>${analytics.activeSubscriptions.toString()}</h3>
      <p class="ops-copy small">Paying subscribers: ${analytics.payingSubscribers.toString()}</p>
    </article>`;
}

function renderTreasuryEvents() {
  const revenue = state.treasuryOverview?.recentRevenue || [];
  const disbursements = state.treasuryOverview?.recentDisbursements || [];

  return `
    <div class="ops-grid two-column-grid">
      <article class="ops-card">
        <div class="ops-section-header compact">
          <div>
            <div class="ops-card-kicker">Treasury</div>
            <h2>Recent revenue</h2>
          </div>
        </div>
        ${
          revenue.length
            ? `<div class="ops-list">${revenue
                .slice()
                .reverse()
                .map(
                  (event) => `
                    <div class="ops-list-row">
                      <div>
                        <strong>${formatTokenAmount(event.amountE8s, 8, event.tokenSymbol)}</strong>
                        <div class="ops-copy small">${event.source} · ${formatTimestampNs(event.recordedAt)}</div>
                      </div>
                      <div class="ops-copy small">${event.memo || "—"}</div>
                    </div>`
                )
                .join("")}</div>`
            : '<div class="ops-empty">No treasury revenue has been recorded yet.</div>'
        }
      </article>
      <article class="ops-card">
        <div class="ops-section-header compact">
          <div>
            <div class="ops-card-kicker">Treasury</div>
            <h2>Recent disbursements</h2>
          </div>
        </div>
        ${
          disbursements.length
            ? `<div class="ops-list">${disbursements
                .slice()
                .reverse()
                .map(
                  (entry) => `
                    <div class="ops-list-row">
                      <div>
                        <strong>${formatTokenAmount(entry.amountE8s, 8, entry.tokenSymbol)}</strong>
                        <div class="ops-copy small">${entry.reason} · ${formatTimestampNs(entry.executedAt)}</div>
                      </div>
                      <div class="ops-copy small">${shorten(principalText(entry.to.owner), 8, 6)}</div>
                    </div>`
                )
                .join("")}</div>`
            : '<div class="ops-empty">No treasury disbursements have been executed yet.</div>'
        }
      </article>
    </div>`;
}

function renderAdminPanel() {
  const treasuryCanisterId = getPublicCanisterId("treasury");
  const subscriptionsCanisterId = getPublicCanisterId("subscriptions");
  const analyticsCanisterId = getPublicCanisterId("analytics");
  const treasuryGovernance = state.treasuryOverview?.admin?.governance;
  const trackedToken = state.treasuryOverview?.trackedTokens?.[0];
  const subscriptionConfig = state.subscriptionsConfig;

  return `
    <div class="ops-grid two-column-grid">
      <article class="ops-card">
        <div class="ops-section-header compact">
          <div>
            <div class="ops-card-kicker">Bootstrap</div>
            <h2>DAO wiring</h2>
          </div>
        </div>
        <div class="ops-copy small">Use the current authenticated principal to claim ownership and wire treasury, subscriptions, and analytics together.</div>
        <div class="ops-meta-grid">
          <div>
            <span class="ops-label">Treasury canister</span>
            <code>${treasuryCanisterId || "—"}</code>
          </div>
          <div>
            <span class="ops-label">Subscriptions canister</span>
            <code>${subscriptionsCanisterId || "—"}</code>
          </div>
          <div>
            <span class="ops-label">Analytics canister</span>
            <code>${analyticsCanisterId || "—"}</code>
          </div>
          <div>
            <span class="ops-label">Billing token</span>
            <code>${subscriptionConfig ? `${subscriptionConfig.tokenSymbol} / fee ${formatTokenAmount(subscriptionConfig.tokenFee)}` : "—"}</code>
          </div>
        </div>
        <div class="ops-button-row top-gap">
          <button class="ops-btn primary" data-action="bootstrap" ${state.busyAction === "bootstrap" ? "disabled" : ""}>
            ${state.busyAction === "bootstrap" ? "Bootstrapping..." : "Bootstrap integrations"}
          </button>
          <button class="ops-btn secondary" data-action="snapshot" ${state.busyAction === "snapshot" ? "disabled" : ""}>
            ${state.busyAction === "snapshot" ? "Snapshotting..." : `Snapshot ${trackedToken?.symbol || "ICP"} balance`}
          </button>
        </div>
      </article>
      <article class="ops-card">
        <div class="ops-section-header compact">
          <div>
            <div class="ops-card-kicker">Governance</div>
            <h2>Treasury SNS hooks</h2>
          </div>
        </div>
        <form class="ops-form" data-form="governance">
          <label>
            <span class="ops-label">DAO owner principal</span>
            <input class="ops-input" type="text" name="owner" value="${principalText(treasuryGovernance?.owner) === "—" ? "" : principalText(treasuryGovernance?.owner)}" placeholder="Optional owner principal" />
          </label>
          <label>
            <span class="ops-label">SNS root principal</span>
            <input class="ops-input" type="text" name="snsRoot" value="${principalText(treasuryGovernance?.snsRoot) === "—" ? "" : principalText(treasuryGovernance?.snsRoot)}" placeholder="Optional SNS root principal" />
          </label>
          <label>
            <span class="ops-label">SNS governance principal</span>
            <input class="ops-input" type="text" name="snsGovernance" value="${principalText(treasuryGovernance?.snsGovernance) === "—" ? "" : principalText(treasuryGovernance?.snsGovernance)}" placeholder="Optional SNS governance principal" />
          </label>
          <button class="ops-btn secondary" type="submit" ${state.busyAction === "governance" ? "disabled" : ""}>
            ${state.busyAction === "governance" ? "Saving..." : "Save governance wiring"}
          </button>
        </form>
      </article>
    </div>
    <article class="ops-card top-gap">
      <div class="ops-section-header compact">
        <div>
          <div class="ops-card-kicker">Treasury ops</div>
          <h2>Execute disbursement</h2>
        </div>
      </div>
      <form class="ops-form three-column" data-form="disburse">
        <label>
          <span class="ops-label">Recipient principal</span>
          <input class="ops-input" type="text" name="recipient" placeholder="aaaaa-aa..." required />
        </label>
        <label>
          <span class="ops-label">Amount (${trackedToken?.symbol || "ICP"})</span>
          <input class="ops-input" type="text" name="amount" placeholder="0.50" required />
        </label>
        <label>
          <span class="ops-label">Reason</span>
          <input class="ops-input" type="text" name="reason" placeholder="Audit payment" required />
        </label>
        <button class="ops-btn primary" type="submit" ${state.busyAction === "disburse" ? "disabled" : ""}>
          ${state.busyAction === "disburse" ? "Sending..." : "Send treasury disbursement"}
        </button>
      </form>
    </article>`;
}

function render() {
  const principal = state.auth?.principal || "—";
  const headerValue = state.analyticsDashboard
    ? formatTokenAmount(state.analyticsDashboard.monthlyRecurringRevenueE8s)
    : "—";

  app.innerHTML = `
    ${buildPlatformHeaderHTML({
      activePage: "ops",
      badgeText: "Treasury and analytics",
      priceLabel: "MRR",
      priceValue: headerValue,
      priceClass: "live",
    })}
    <main class="ops-shell">
      <section class="ops-hero">
        <div>
          <div class="ops-card-kicker">Operations</div>
          <h1>Run the treasury, subscription, and analytics canisters as one product system.</h1>
          <p class="ops-copy">
            This page is the operational surface for the multi-canister stack: bootstrap integrations, snapshot balances, wire SNS governance principals, and execute real treasury disbursements.
          </p>
        </div>
        <div class="ops-hero-panel">
          <div>
            <span class="ops-label">Current principal</span>
            <strong>${shorten(principal, 10, 8)}</strong>
          </div>
          <div>
            <span class="ops-label">Treasury account</span>
            <strong>${shorten(principalText(state.treasuryOverview?.account?.owner), 10, 8)}</strong>
          </div>
          <div>
            <span class="ops-label">Auth mode</span>
            <strong>${state.auth?.authenticated ? "Internet Identity" : "Anonymous"}</strong>
          </div>
          <div class="ops-button-row">
            <button class="ops-btn secondary" data-action="login">${state.auth?.authenticated ? "Refresh session" : "Login with Internet Identity"}</button>
            <button class="ops-btn ghost" data-action="logout">Use anonymous mode</button>
          </div>
          <p class="ops-copy small">
            Admin actions require a non-anonymous principal so ownership and SNS hooks are attached to a reusable identity.
          </p>
        </div>
      </section>
      ${renderNotice()}
      <section class="ops-section">
        <div class="ops-section-header">
          <div>
            <div class="ops-card-kicker">KPIs</div>
            <h2>Revenue analytics</h2>
          </div>
        </div>
        <div class="ops-grid four-column-grid">
          ${renderMetricCards()}
        </div>
      </section>
      <section class="ops-section">
        <div class="ops-section-header">
          <div>
            <div class="ops-card-kicker">Activity</div>
            <h2>Treasury journal</h2>
          </div>
        </div>
        ${renderTreasuryEvents()}
      </section>
      <section class="ops-section">
        <div class="ops-section-header">
          <div>
            <div class="ops-card-kicker">Administration</div>
            <h2>Bootstrap and governance controls</h2>
          </div>
        </div>
        ${renderAdminPanel()}
      </section>
    </main>`;
}

async function withBusyAction(actionKey, callback) {
  state.busyAction = actionKey;
  render();

  try {
    clearNotice();
    await callback();
  } catch (error) {
    setNotice("error", error.message || String(error));
  } finally {
    state.busyAction = "";
    render();
  }
}

async function bootstrapIntegrations() {
  const identity = requireAuthenticatedIdentity();
  const [treasuryActor, subscriptionsActor, analyticsActor] = await Promise.all([
    createTreasuryActor(identity),
    createSubscriptionsActor(identity),
    createAnalyticsActor(identity),
  ]);

  if (!treasuryActor || !subscriptionsActor || !analyticsActor) {
    throw new Error("One or more ops canisters are not configured in this environment.");
  }

  const treasuryPrincipal = Principal.fromText(getPublicCanisterId("treasury"));
  const subscriptionsPrincipal = Principal.fromText(getPublicCanisterId("subscriptions"));
  const analyticsPrincipal = Principal.fromText(getPublicCanisterId("analytics"));

  await Promise.allSettled([
    treasuryActor.claimOwner(),
    subscriptionsActor.claimOwner(),
    analyticsActor.claimOwner(),
  ]);

  unwrapResult(await treasuryActor.setAnalyticsCanister([analyticsPrincipal]));

  const config = await subscriptionsActor.getConfig();
  unwrapResult(
    await subscriptionsActor.configure({
      ...config,
      treasuryCanister: [treasuryPrincipal],
      analyticsCanister: [analyticsPrincipal],
    })
  );

  unwrapResult(await treasuryActor.authorizeRevenueReporter(subscriptionsPrincipal, true));
  unwrapResult(await analyticsActor.authorizeReporter(treasuryPrincipal, true));
  unwrapResult(await analyticsActor.authorizeReporter(subscriptionsPrincipal, true));
}

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const { action } = target.dataset;

  if (action === "login") {
    await withBusyAction("login", async () => {
      state.auth = await login();
      setNotice("success", "Authenticated with Internet Identity.");
      await loadOpsState();
    });
    return;
  }

  if (action === "logout") {
    await withBusyAction("logout", async () => {
      state.auth = await logout();
      setNotice("info", "Switched to anonymous read-only mode.");
      await loadOpsState();
    });
    return;
  }

  if (action === "bootstrap") {
    await withBusyAction("bootstrap", async () => {
      await bootstrapIntegrations();
      setNotice("success", "Treasury, subscriptions, and analytics canisters have been wired together.");
      await loadOpsState();
    });
    return;
  }

  if (action === "snapshot") {
    await withBusyAction("snapshot", async () => {
      const identity = requireAuthenticatedIdentity();
      const treasuryActor = await createTreasuryActor(identity);
      const token = state.treasuryOverview?.trackedTokens?.[0];
      if (!treasuryActor || !token) {
        throw new Error("Treasury token configuration is unavailable.");
      }

      const snapshot = unwrapResult(await treasuryActor.snapshotBalance(token.ledgerId));
      setNotice("success", `Captured ${formatTokenAmount(snapshot.balanceE8s, 8, snapshot.tokenSymbol)} treasury balance snapshot.`);
      await loadOpsState();
    });
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) {
    return;
  }

  event.preventDefault();
  const formName = form.dataset.form;

  if (formName === "governance") {
    await withBusyAction("governance", async () => {
      const identity = requireAuthenticatedIdentity();
      const treasuryActor = await createTreasuryActor(identity);
      const values = new FormData(form);

      unwrapResult(
        await treasuryActor.configureGovernance({
          owner: toOptionalPrincipal(String(values.get("owner") || "")),
          snsRoot: toOptionalPrincipal(String(values.get("snsRoot") || "")),
          snsGovernance: toOptionalPrincipal(String(values.get("snsGovernance") || "")),
        })
      );

      setNotice("success", "Treasury governance wiring updated.");
      await loadOpsState();
    });
    return;
  }

  if (formName === "disburse") {
    await withBusyAction("disburse", async () => {
      const identity = requireAuthenticatedIdentity();
      const treasuryActor = await createTreasuryActor(identity);
      const values = new FormData(form);
      const token = state.treasuryOverview?.trackedTokens?.[0];
      if (!treasuryActor || !token) {
        throw new Error("Treasury is not ready for disbursements.");
      }

      const recipient = Principal.fromText(String(values.get("recipient") || "").trim());
      const amountE8s = parseTokenAmount(String(values.get("amount") || "0"), Number(token.decimals));
      const reason = String(values.get("reason") || "").trim();

      const disbursement = unwrapResult(
        await treasuryActor.disburse({
          ledgerId: token.ledgerId,
          tokenSymbol: token.symbol,
          to: {
            owner: recipient,
            subaccount: [],
          },
          amountE8s,
          feeE8s: [],
          reason,
          memo: [],
          memoText: reason,
        })
      );

      setNotice(
        "success",
        `Executed treasury disbursement of ${formatTokenAmount(disbursement.amountE8s, Number(token.decimals), token.symbol)}.`
      );
      form.reset();
      await loadOpsState();
    });
  }
});

async function init() {
  state.auth = await getAuthState();
  subscribeAuth(async (nextAuth) => {
    state.auth = nextAuth;
    await loadOpsState();
  });
  await loadOpsState();
}

void init();