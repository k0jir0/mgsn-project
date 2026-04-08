import "./styles.css";

import { Principal } from "@dfinity/principal";

import { getAuthState, login, logout, subscribeAuth } from "./auth";
import { createSubscriptionsActor } from "./mgsnCanisters";
import {
  blobToHex,
  formatTimestampNs,
  formatTokenAmount,
  isAnonymousPrincipal,
  optionalValue,
  principalText,
  shorten,
  unwrapResult,
  variantLabel,
} from "./platformUtils";
import { buildPlatformHeaderHTML } from "./siteChrome";

const app = document.querySelector("#app");

const state = {
  auth: null,
  portal: null,
  notice: null,
  busyAction: "",
};

function setNotice(type, text) {
  state.notice = { type, text };
}

function clearNotice() {
  state.notice = null;
}

function currentPrincipalOption() {
  if (!state.auth?.principal) {
    return [];
  }

  return [Principal.fromText(state.auth.principal)];
}

async function getSubscriptionsActor() {
  return createSubscriptionsActor(state.auth?.identity);
}

async function loadPortalState() {
  const actor = await getSubscriptionsActor();
  if (!actor) {
    state.portal = null;
    setNotice("error", "Subscriptions canister is not configured in this environment.");
    render();
    return;
  }

  state.portal = await actor.getPortalState(currentPrincipalOption());
  render();
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

function renderPlanCards() {
  const plans = state.portal?.plans || [];
  const tokenSymbol = state.portal?.config?.tokenSymbol || "ICP";
  const decimals = Number(state.portal?.config?.tokenDecimals ?? 8n);

  if (!plans.length) {
    return '<div class="ops-empty">No subscription plans are configured yet.</div>';
  }

  return plans
    .map((plan) => {
      const planId = String(plan.id);
      const createKey = `create-${planId}`;

      return `
        <article class="ops-card plan-card">
          <div class="ops-card-kicker">Plan ${planId}</div>
          <h3>${plan.name}</h3>
          <p class="ops-copy">${plan.description}</p>
          <div class="ops-metric-stack">
            <div>
              <span class="ops-label">Price</span>
              <strong>${formatTokenAmount(plan.priceE8s, decimals, tokenSymbol)}</strong>
            </div>
            <div>
              <span class="ops-label">Interval</span>
              <strong>${plan.intervalDays.toString()} days</strong>
            </div>
            <div>
              <span class="ops-label">Status</span>
              <strong>${plan.active ? "active" : "paused"}</strong>
            </div>
          </div>
          <ul class="ops-feature-list">
            ${plan.features.map((feature) => `<li>${feature}</li>`).join("")}
          </ul>
          <button class="ops-btn primary" data-action="create-invoice" data-plan-id="${planId}" ${
            state.busyAction === createKey ? "disabled" : ""
          }>
            ${state.busyAction === createKey ? "Creating invoice..." : "Create invoice"}
          </button>
        </article>`;
    })
    .join("");
}

function renderInvoices() {
  const invoices = [...(state.portal?.invoices || [])].reverse();
  const tokenSymbol = state.portal?.config?.tokenSymbol || "ICP";
  const decimals = Number(state.portal?.config?.tokenDecimals ?? 8n);

  if (!invoices.length) {
    return '<div class="ops-empty">No invoices yet. Create one from a plan card to generate a real deposit subaccount.</div>';
  }

  return invoices
    .map((invoice) => {
      const invoiceId = String(invoice.id);
      const statusKey = variantLabel(invoice.status);
      const status = statusKey.replaceAll("_", " ");
      const subaccountHex = blobToHex(invoice.subaccount);
      const refreshKey = `refresh-${invoiceId}`;
      const settleKey = `settle-${invoiceId}`;

      return `
        <article class="ops-card invoice-card">
          <div class="ops-card-topline">
            <div>
              <div class="ops-card-kicker">Invoice ${invoiceId}</div>
              <h3>Deposit into canister subaccount</h3>
            </div>
            <span class="ops-status ${statusKey}">${status}</span>
          </div>
          <div class="ops-detail-grid">
            <div>
              <span class="ops-label">Quoted total</span>
              <strong>${formatTokenAmount(invoice.quotedAmountE8s, decimals, tokenSymbol)}</strong>
            </div>
            <div>
              <span class="ops-label">Net revenue</span>
              <strong>${formatTokenAmount(invoice.revenueE8s, decimals, tokenSymbol)}</strong>
            </div>
            <div>
              <span class="ops-label">Observed balance</span>
              <strong>${formatTokenAmount(invoice.balanceE8s, decimals, tokenSymbol)}</strong>
            </div>
            <div>
              <span class="ops-label">Expires</span>
              <strong>${formatTimestampNs(invoice.expiresAt)}</strong>
            </div>
          </div>
          <div class="ops-address-block">
            <div>
              <span class="ops-label">Deposit owner</span>
              <code>${principalText(invoice.account.owner)}</code>
            </div>
            <div>
              <span class="ops-label">Subaccount</span>
              <code title="${subaccountHex}">${shorten(subaccountHex, 14, 10) || "—"}</code>
            </div>
          </div>
          <div class="ops-copy small">
            Send the exact quoted amount to the canister principal with this invoice subaccount, then refresh and settle the invoice to sweep funds into treasury.
          </div>
          <div class="ops-button-row">
            <button class="ops-btn secondary" data-action="refresh-invoice" data-invoice-id="${invoiceId}" ${
              state.busyAction === refreshKey ? "disabled" : ""
            }>
              ${state.busyAction === refreshKey ? "Refreshing..." : "Refresh payment"}
            </button>
            <button class="ops-btn primary" data-action="settle-invoice" data-invoice-id="${invoiceId}" ${
              state.busyAction === settleKey ? "disabled" : ""
            }>
              ${state.busyAction === settleKey ? "Settling..." : "Settle to treasury"}
            </button>
          </div>
        </article>`;
    })
    .join("");
}

function renderSubscriptions() {
  const subscriptions = [...(state.portal?.subscriptions || [])].reverse();
  const tokenSymbol = state.portal?.config?.tokenSymbol || "ICP";
  const decimals = Number(state.portal?.config?.tokenDecimals ?? 8n);

  if (!subscriptions.length) {
    return '<div class="ops-empty">No subscription entitlements exist for this principal yet.</div>';
  }

  return subscriptions
    .map((subscription) => {
      const statusKey = variantLabel(subscription.status);
      const status = statusKey.replaceAll("_", " ");
      return `
        <article class="ops-card compact-card">
          <div class="ops-card-topline">
            <div>
              <div class="ops-card-kicker">Plan ${subscription.planId.toString()}</div>
              <h3>Subscription ${subscription.id.toString()}</h3>
            </div>
            <span class="ops-status ${statusKey}">${status}</span>
          </div>
          <div class="ops-detail-grid">
            <div>
              <span class="ops-label">Paid to date</span>
              <strong>${formatTokenAmount(subscription.totalPaidE8s, decimals, tokenSymbol)}</strong>
            </div>
            <div>
              <span class="ops-label">Renews from</span>
              <strong>${formatTimestampNs(subscription.renewedAt)}</strong>
            </div>
            <div>
              <span class="ops-label">Expires</span>
              <strong>${formatTimestampNs(subscription.expiresAt)}</strong>
            </div>
            <div>
              <span class="ops-label">Last invoice</span>
              <strong>${subscription.lastInvoiceId.toString()}</strong>
            </div>
          </div>
        </article>`;
    })
    .join("");
}

function render() {
  const principal = state.auth?.principal || "—";
  const config = state.portal?.config;
  const authMode = state.auth?.authenticated ? "Internet Identity" : "Anonymous identity";
  const authWarning = isAnonymousPrincipal(principal)
    ? "Anonymous mode is useful for testing, but production subscriptions should be created while authenticated so entitlements follow your real principal."
    : "Authenticated principals can create invoices and settle revenue into treasury without sharing custody with the frontend.";

  app.innerHTML = `
    ${buildPlatformHeaderHTML({
      activePage: "subscribe",
      badgeText: state.auth?.authenticated ? "Authenticated billing" : "Live anonymous billing",
      priceLabel: "Principal",
      priceValue: shorten(principal, 8, 6),
      priceClass: state.auth?.authenticated ? "live" : "",
    })}
    <main class="ops-shell">
      <section class="ops-hero">
        <div>
          <div class="ops-card-kicker">Revenue app</div>
          <h1>Issue real on-chain invoices and settle subscriptions into treasury.</h1>
          <p class="ops-copy">
            This page creates unique ICRC-1 invoice subaccounts on the subscriptions canister, verifies incoming balances on-chain, and sweeps settled revenue into the treasury canister.
          </p>
        </div>
        <div class="ops-hero-panel">
          <div>
            <span class="ops-label">Auth mode</span>
            <strong>${authMode}</strong>
          </div>
          <div>
            <span class="ops-label">Current principal</span>
            <strong>${shorten(principal, 10, 8)}</strong>
          </div>
          <div>
            <span class="ops-label">Billing token</span>
            <strong>${config ? `${config.tokenSymbol} / ${config.invoiceTtlDays.toString()} day invoice TTL` : "—"}</strong>
          </div>
          <div class="ops-button-row">
            <button class="ops-btn secondary" data-action="login">${state.auth?.authenticated ? "Refresh session" : "Login with Internet Identity"}</button>
            <button class="ops-btn ghost" data-action="logout">Use anonymous mode</button>
          </div>
          <p class="ops-copy small">${authWarning}</p>
        </div>
      </section>
      ${renderNotice()}
      <section class="ops-section">
        <div class="ops-section-header">
          <div>
            <div class="ops-card-kicker">Plans</div>
            <h2>Available subscriptions</h2>
          </div>
          <div class="ops-copy small">Each invoice includes the transfer fee so treasury receives the net plan price after settlement.</div>
        </div>
        <div class="plan-grid">
          ${renderPlanCards()}
        </div>
      </section>
      <section class="ops-section">
        <div class="ops-section-header">
          <div>
            <div class="ops-card-kicker">Invoices</div>
            <h2>Your pending and settled invoices</h2>
          </div>
        </div>
        <div class="ops-grid wide-grid">
          ${renderInvoices()}
        </div>
      </section>
      <section class="ops-section">
        <div class="ops-section-header">
          <div>
            <div class="ops-card-kicker">Entitlements</div>
            <h2>Your subscription state</h2>
          </div>
        </div>
        <div class="ops-grid">
          ${renderSubscriptions()}
        </div>
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
      await loadPortalState();
    });
    return;
  }

  if (action === "logout") {
    await withBusyAction("logout", async () => {
      state.auth = await logout();
      setNotice("info", "Switched back to anonymous mode.");
      await loadPortalState();
    });
    return;
  }

  if (action === "create-invoice") {
    const planId = BigInt(target.dataset.planId);
    await withBusyAction(`create-${target.dataset.planId}`, async () => {
      const actor = await getSubscriptionsActor();
      const invoice = unwrapResult(await actor.createInvoice(planId, "MGSN subscription invoice"));
      setNotice("success", `Created invoice ${invoice.id.toString()}. Fund the displayed subaccount, then refresh and settle it.`);
      await loadPortalState();
    });
    return;
  }

  if (action === "refresh-invoice") {
    const invoiceId = BigInt(target.dataset.invoiceId);
    await withBusyAction(`refresh-${target.dataset.invoiceId}`, async () => {
      const actor = await getSubscriptionsActor();
      const invoice = unwrapResult(await actor.refreshInvoice(invoiceId));
      const status = variantLabel(invoice.status).replaceAll("_", " ");
      setNotice("success", `Invoice ${invoice.id.toString()} refreshed. Status is now ${status}.`);
      await loadPortalState();
    });
    return;
  }

  if (action === "settle-invoice") {
    const invoiceId = BigInt(target.dataset.invoiceId);
    await withBusyAction(`settle-${target.dataset.invoiceId}`, async () => {
      const actor = await getSubscriptionsActor();
      const settlement = unwrapResult(await actor.settleInvoice(invoiceId));
      setNotice(
        "success",
        `Invoice ${settlement.invoice.id.toString()} settled into treasury at block ${settlement.treasuryTransferTxIndex.toString()}.`
      );
      await loadPortalState();
    });
  }
});

async function init() {
  state.auth = await getAuthState();
  subscribeAuth(async (nextAuth) => {
    state.auth = nextAuth;
    await loadPortalState();
  });
  await loadPortalState();
}

void init();