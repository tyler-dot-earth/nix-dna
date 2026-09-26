/** Formats bytes, dates, and store paths for the Nix DNA pages. */

/** Byte count as a short IEC string, "1.2 GiB". */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "-";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = abs;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${sign}${value.toFixed(digits)} ${units[unit]}`;
}

/** Signed byte delta, "+12.4 MiB" or "0 B". */
export function formatByteDelta(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n === 0) return "0 B";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${formatBytes(Math.abs(n))}`;
}

/** Unix seconds as a local "2026-09-25 08:02" string. */
export function formatUnixSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const date = new Date(n * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Milliseconds since epoch, same shape as formatUnixSeconds. */
export function formatEpochMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return formatUnixSeconds(n / 1000);
}

/** "3 hours ago" from a unix timestamp in seconds. */
export function formatRelativeSeconds(seconds, nowSeconds = Date.now() / 1000) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const delta = Math.round(nowSeconds - n);
  const abs = Math.abs(delta);
  const future = delta < 0;
  const phrase = (count, unit) => {
    const word = count === 1 ? unit : `${unit}s`;
    return future ? `in ${count} ${word}` : `${count} ${word} ago`;
  };
  if (abs < 45) return "just now";
  if (abs < 90) return future ? "in a minute" : "a minute ago";
  if (abs < 3600) return phrase(Math.round(abs / 60), "minute");
  if (abs < 86400) return phrase(Math.round(abs / 3600), "hour");
  if (abs < 86400 * 30) return phrase(Math.round(abs / 86400), "day");
  return formatUnixSeconds(n);
}

/** "/nix/store/<hash>-name" split into { hash, name }, or null. */
export function splitStorePath(storePath) {
  if (!storePath) return null;
  const match = String(storePath).match(/^\/nix\/store\/([a-z0-9]+)-(.+)$/);
  if (!match) return null;
  return { hash: match[1], name: match[2] };
}

/** Store path with the hash dropped, "gtk4-4.20.2". */
export function storePathName(storePath) {
  return splitStorePath(storePath)?.name ?? String(storePath ?? "");
}

/** First 10 characters of the store hash, for a row subtitle. */
export function shortStoreHash(storePath) {
  const hash = splitStorePath(storePath)?.hash;
  return hash ? hash.slice(0, 10) : "";
}

/** nixpkgs version "25.11.20251112.c5ae371" split into readable pieces. */
export function parseNixOsVersion(version) {
  const text = String(version ?? "").trim();
  const match = text.match(/^(\d+\.\d+)(?:\.(\d{8})\.([0-9a-f]+))?/);
  if (!match) return { raw: text, release: text, date: "", revision: "" };
  const stamp = match[2] ?? "";
  const date = stamp
    ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
    : "";
  return {
    raw: text,
    release: match[1],
    date,
    revision: match[3] ?? "",
  };
}

/** Integer with thousands separators. */
export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("en-US");
}

/** Percent of part/whole, "44%". */
export function formatPercent(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return "-";
  return `${Math.round((p / w) * 100)}%`;
}

/** A short pin: "NixOS/nixpkgs @ c5ae371", or the follows target. */
export function flakePinLabel(node) {
  const follows = node.follows;
  if (Array.isArray(follows)) return `follows ${follows.join(".")}`;
  const locked = node.locked ?? {};
  if (locked.type === "github" || locked.type === "gitlab") {
    const rev = String(locked.rev ?? "").slice(0, 7);
    return `${locked.owner ?? ""}/${locked.repo ?? ""}${rev ? ` @ ${rev}` : ""}`;
  }
  return flakeInputLabel(locked);
}

/** True when a name looks like a flake input rather than a local path. */
export function flakeInputLabel(locked) {
  if (!locked || typeof locked !== "object") return "";
  if (locked.type === "github" || locked.type === "gitlab") {
    const owner = locked.owner ?? "";
    const repo = locked.repo ?? "";
    const rev = String(locked.rev ?? "").slice(0, 7);
    return `${locked.type}:${owner}/${repo}${rev ? `@${rev}` : ""}`;
  }
  if (locked.type === "git" || locked.type === "path") {
    return `${locked.type}:${locked.url ?? locked.path ?? ""}`;
  }
  if (locked.type === "indirect") return `flake:${locked.id ?? ""}`;
  return locked.type ? String(locked.type) : "";
}
