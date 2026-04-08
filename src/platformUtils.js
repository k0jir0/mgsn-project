import { Principal } from "@dfinity/principal";

export function toBigInt(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string") {
    return BigInt(value);
  }

  return 0n;
}

export function optionalValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function principalText(value) {
  const unwrapped = optionalValue(value);

  if (!unwrapped) {
    return "—";
  }

  if (typeof unwrapped === "string") {
    return unwrapped;
  }

  if (typeof unwrapped.toText === "function") {
    return unwrapped.toText();
  }

  return String(unwrapped);
}

export function shorten(text, head = 6, tail = 5) {
  if (!text || text.length <= head + tail + 3) {
    return text || "—";
  }

  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

export function formatTokenAmount(value, decimals = 8, symbol = "ICP") {
  const bigintValue = toBigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = bigintValue / base;
  const fraction = (bigintValue % base).toString().padStart(decimals, "0");
  const trimmedFraction = fraction.slice(0, 4).replace(/0+$/, "");

  return trimmedFraction
    ? `${whole.toString()}.${trimmedFraction} ${symbol}`
    : `${whole.toString()} ${symbol}`;
}

export function parseTokenAmount(value, decimals = 8) {
  const trimmed = value.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid positive token amount");
  }

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  if (fractionPart.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }

  const paddedFraction = `${fractionPart}${"0".repeat(decimals)}`.slice(0, decimals);
  return BigInt(wholePart) * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");
}

export function formatTimestampNs(value) {
  const unwrapped = optionalValue(value);

  if (unwrapped == null) {
    return "—";
  }

  const milliseconds = Number(toBigInt(unwrapped) / 1_000_000n);
  if (!Number.isFinite(milliseconds)) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(milliseconds));
}

export function blobToHex(value) {
  if (!value) {
    return "";
  }

  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function variantLabel(variant) {
  if (!variant || typeof variant !== "object") {
    return "unknown";
  }

  return Object.keys(variant)[0] || "unknown";
}

export function unwrapResult(result) {
  if (result && typeof result === "object" && "ok" in result) {
    return result.ok;
  }

  throw new Error(result?.err || "Canister returned an unknown error");
}

export function toOptionalPrincipal(text) {
  const trimmed = text.trim();
  return trimmed ? [Principal.fromText(trimmed)] : [];
}

export function isAnonymousPrincipal(principal) {
  return principal === "2vxsx-fae";
}