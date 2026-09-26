/**
 * Reads Nix facts the UI can show without root.
 *
 * The store database at /nix/var/nix/db/db.sqlite is world-readable on NixOS.
 * Profile symlinks, boot entries, flake.lock files, and `nix` subcommands
 * cover the rest. Nothing here deletes store paths or switches generations.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

const STORE_DB = "/nix/var/nix/db/db.sqlite";
const PROFILES_DIR = "/nix/var/nix/profiles";
const GCROOTS_AUTO = "/nix/var/nix/gcroots/auto";
const NIX_CONF = "/etc/nix/nix.conf";
const OS_RELEASE = "/etc/os-release";
const CURRENT_SYSTEM = "/run/current-system";
const BOOTED_SYSTEM = "/run/booted-system";
const BOOT_ENTRIES = "/boot/loader/entries";

/** Absolute path of sqlite3, from the wrapper or PATH. */
export function sqliteBinary() {
  const fromEnv = GLib.getenv("ABOUT_NIX_SQLITE");
  if (fromEnv && GLib.file_test(fromEnv, GLib.FileTest.IS_EXECUTABLE)) return fromEnv;
  const found = GLib.find_program_in_path("sqlite3");
  if (!found) throw new Error("sqlite3 not found. Set ABOUT_NIX_SQLITE.");
  return found;
}

/** Absolute path of nix, from PATH. */
export function nixBinary() {
  const found = GLib.find_program_in_path("nix");
  if (!found) throw new Error("nix not found on PATH.");
  return found;
}

function decoder() {
  return new TextDecoder();
}

/**
 * Runs argv and returns stdout as a string.
 * Throws with the command and stderr when the exit status is non-zero.
 * The call blocks the GTK main loop. Use runCommandAsync for anything slow.
 */
export function runCommand(argv, cancellable = null) {
  const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
  const proc = Gio.Subprocess.new(argv, flags);
  const [ok, stdout, stderr] = proc.communicate_utf8(null, cancellable);
  if (!ok || !proc.get_successful()) {
    const err = stderr?.trim() || `exit ${proc.get_exit_status()}`;
    throw new Error(`${argv[0]} failed: ${err}`);
  }
  return stdout ?? "";
}

/**
 * Runs argv off the GTK main loop.
 * Resolves to stdout. Rejects with stderr when the process fails.
 */
export function runCommandAsync(argv, cancellable = null) {
  const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
  const proc = Gio.Subprocess.new(argv, flags);
  return new Promise((resolve, reject) => {
    proc.communicate_utf8_async(null, cancellable, (_source, result) => {
      try {
        const [ok, stdout, stderr] = proc.communicate_utf8_finish(result);
        if (!ok || !proc.get_successful()) {
          const err = stderr?.trim() || `exit ${proc.get_exit_status()}`;
          reject(new Error(`${argv[0]} failed: ${err}`));
          return;
        }
        resolve(stdout ?? "");
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** argv for one read-only SQL statement against the Nix database. */
export function sqliteArgv(sql) {
  return [sqliteBinary(), "-json", "-readonly", STORE_DB, sql];
}

/** Parses sqlite3 -json stdout. An empty result is an empty list. */
export function parseSqliteJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Runs sqlite3 against the Nix store database.
 * `sql` is a single statement. Rows come back as JSON objects.
 * Blocks the GTK main loop. Use queryStoreAsync while a window is up.
 */
export function queryStore(sql, cancellable = null) {
  return parseSqliteJson(runCommand(sqliteArgv(sql), cancellable));
}

/** Same rows as queryStore, without blocking the GTK main loop. */
export async function queryStoreAsync(sql, cancellable = null) {
  return parseSqliteJson(await runCommandAsync(sqliteArgv(sql), cancellable));
}

/** Reads a small text file. Returns "" when it is missing. */
export function readText(path) {
  const file = Gio.File.new_for_path(path);
  if (!file.query_exists(null)) return "";
  const [, bytes] = file.load_contents(null);
  return decoder().decode(bytes);
}

/** Parses KEY=VALUE lines from /etc/os-release. */
export function readOsRelease() {
  const out = {};
  for (const line of readText(OS_RELEASE).split("\n")) {
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const key = line.slice(0, idx);
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** Parses nix.conf assignment lines. Comments and blanks are skipped. */
export function readNixConf(path = NIX_CONF) {
  const out = {};
  for (const raw of readText(path).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** POSIX `df -P` fields for a mountpoint, in bytes: { bytes, used, available, mount }. */
export function readDiskUsage(mount = "/nix/store") {
  const stdout = runCommand(["df", "-B1", "-P", mount]);
  const lines = stdout.trim().split("\n").filter((line) => line && !line.startsWith("Filesystem"));
  const fields = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
  return {
    bytes: Number(fields[1] ?? 0),
    used: Number(fields[2] ?? 0),
    available: Number(fields[3] ?? 0),
    mount: fields[5] ?? mount,
  };
}

/** `df -P -i` inode counts for a mountpoint. */
export function readInodeUsage(mount = "/nix/store") {
  const stdout = runCommand(["df", "-P", "-i", mount]);
  const lines = stdout.trim().split("\n").filter((line) => line && !line.startsWith("Filesystem"));
  const fields = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
  return {
    total: Number(fields[1] ?? 0),
    used: Number(fields[2] ?? 0),
    available: Number(fields[3] ?? 0),
    mount: fields[5] ?? mount,
  };
}

/**
 * Resolves a symlink chain with readlink, or "" when the path is missing.
 * Stops after 8 hops so a loop cannot spin.
 */
export function resolveLink(path) {
  let current = path;
  for (let hop = 0; hop < 8; hop += 1) {
    if (!GLib.file_test(current, GLib.FileTest.EXISTS)) return hop === 0 ? "" : current;
    if (!GLib.file_test(current, GLib.FileTest.IS_SYMLINK)) return current;
    let target;
    try {
      target = GLib.file_read_link(current);
    } catch {
      return current;
    }
    if (!target) return current;
    current = target.startsWith("/")
      ? target
      : GLib.build_filenamev([GLib.path_get_dirname(current), target]);
  }
  return current;
}

/** mtime of a path in unix seconds, or 0. */
export function pathMtime(path) {
  const file = Gio.File.new_for_path(path);
  if (!file.query_exists(null)) return 0;
  try {
    const info = file.query_info("time::modified", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    return info.get_modification_date_time()?.to_unix() ?? 0;
  } catch {
    return 0;
  }
}

/**
 * System generations from /nix/var/nix/profiles/system-*-link.
 * Each item: { number, link, storePath, mtime, version, kernel, current, booted }.
 */
export function readSystemGenerations() {
  const dir = Gio.File.new_for_path(PROFILES_DIR);
  const current = resolveLink(`${PROFILES_DIR}/system`);
  const booted = resolveLink(BOOTED_SYSTEM);
  const generations = [];
  const enumerator = dir.enumerate_children("standard::name,standard::symlink-target,time::modified", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  while (true) {
    const info = enumerator.next_file(null);
    if (!info) break;
    const name = info.get_name();
    const match = name.match(/^system-(\d+)-link$/);
    if (!match) continue;
    const link = `${PROFILES_DIR}/${name}`;
    const storePath = resolveLink(link);
    const version = readText(`${storePath}/nixos-version`).trim();
    let kernel = "";
    try {
      kernel = resolveLink(`${storePath}/kernel`);
    } catch {
      kernel = "";
    }
    generations.push({
      number: Number(match[1]),
      link,
      storePath,
      mtime: info.get_modification_date_time()?.to_unix() ?? pathMtime(link),
      version,
      kernel,
      current: storePath === current,
      booted: storePath === booted,
    });
  }
  enumerator.close(null);
  generations.sort((a, b) => b.number - a.number);
  return generations;
}

/** Home Manager generations under the user's Nix state directory. */
export function readHomeManagerGenerations() {
  const home = GLib.get_home_dir();
  const dirPath = `${home}/.local/state/nix/profiles`;
  const dir = Gio.File.new_for_path(dirPath);
  if (!dir.query_exists(null)) return [];
  const generations = [];
  const enumerator = dir.enumerate_children("standard::name,time::modified", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  while (true) {
    const info = enumerator.next_file(null);
    if (!info) break;
    const name = info.get_name();
    const match = name.match(/^home-manager-(\d+)-link$/);
    if (!match) continue;
    const link = `${dirPath}/${name}`;
    const storePath = resolveLink(link);
    generations.push({
      number: Number(match[1]),
      link,
      storePath,
      mtime: info.get_modification_date_time()?.to_unix() ?? 0,
      hmVersion: readText(`${storePath}/hm-version`).trim(),
      current: resolveLink(`${dirPath}/home-manager`) === storePath,
    });
  }
  enumerator.close(null);
  generations.sort((a, b) => b.number - a.number);
  return generations;
}

/**
 * Channel profiles under /nix/var/nix/profiles/per-user.
 * Each item: { user, name, storePath }.
 */
export function readChannels() {
  const root = "/nix/var/nix/profiles/per-user";
  const dir = Gio.File.new_for_path(root);
  if (!dir.query_exists(null)) return [];
  const channels = [];
  const users = dir.enumerate_children("standard::name,standard::type", Gio.FileQueryInfoFlags.NONE, null);
  while (true) {
    const userInfo = users.next_file(null);
    if (!userInfo) break;
    if (userInfo.get_file_type() !== Gio.FileType.DIRECTORY) continue;
    const user = userInfo.get_name();
    const userDir = Gio.File.new_for_path(`${root}/${user}`);
    const entries = userDir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    while (true) {
      const info = entries.next_file(null);
      if (!info) break;
      const name = info.get_name();
      if (!/^channels-\d+-link$/.test(name)) continue;
      const link = `${root}/${user}/${name}`;
      channels.push({
        user,
        name,
        storePath: resolveLink(link),
        current: resolveLink(`${root}/${user}/channels`) === resolveLink(link),
      });
    }
    entries.close(null);
  }
  users.close(null);
  return channels;
}

/** systemd-boot generation entries, when /boot is readable. */
export function readBootEntries() {
  const dir = Gio.File.new_for_path(BOOT_ENTRIES);
  if (!dir.query_exists(null)) return [];
  const entries = [];
  const enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
  while (true) {
    const info = enumerator.next_file(null);
    if (!info) break;
    const name = info.get_name();
    const match = name.match(/^nixos-generation-(\d+)\.conf$/);
    if (!match) continue;
    const text = readText(`${BOOT_ENTRIES}/${name}`);
    const version = text.match(/^version\s+(.+)$/m)?.[1] ?? "";
    const built = version.match(/built on (\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
    entries.push({ number: Number(match[1]), file: name, version, built });
  }
  enumerator.close(null);
  entries.sort((a, b) => b.number - a.number);
  return entries;
}

/** Direct references of a store path, via the Refs table. */
export function readStoreReferences(storePath) {
  const sql = `
    SELECT vp.path AS path, vp.narSize AS narSize
    FROM ValidPaths vp
    JOIN Refs r ON r.reference = vp.id
    JOIN ValidPaths self ON self.id = r.referrer
    WHERE self.path = '${escapeSql(storePath)}'
    ORDER BY vp.narSize DESC
  `;
  return queryStore(sql);
}

/** One ValidPaths row, or null. */
export function readStorePathRow(storePath) {
  const rows = queryStore(`
    SELECT path, hash, registrationTime, deriver, narSize, ca
    FROM ValidPaths
    WHERE path = '${escapeSql(storePath)}'
  `);
  return rows[0] ?? null;
}

/** Recursive closure count and nar bytes for one store path. */
export function readClosureSize(storePath) {
  const rows = queryStore(`
    WITH RECURSIVE closure(id) AS (
      SELECT id FROM ValidPaths WHERE path = '${escapeSql(storePath)}'
      UNION
      SELECT Refs.reference FROM Refs JOIN closure ON Refs.referrer = closure.id
    )
    SELECT COUNT(*) AS paths, COALESCE(SUM(narSize), 0) AS narBytes
    FROM ValidPaths WHERE id IN (SELECT id FROM closure)
  `);
  return {
    paths: Number(rows[0]?.paths ?? 0),
    narBytes: Number(rows[0]?.narBytes ?? 0),
  };
}

/** Whole-store totals from ValidPaths. */
export function readStoreTotals() {
  const rows = queryStore(`
    SELECT
      COUNT(*) AS paths,
      SUM(CASE WHEN path LIKE '%.drv' THEN 1 ELSE 0 END) AS derivations,
      SUM(CASE WHEN path NOT LIKE '%.drv' THEN 1 ELSE 0 END) AS outputs,
      COALESCE(SUM(narSize), 0) AS narBytes,
      COALESCE(SUM(CASE WHEN path LIKE '%.drv' THEN narSize ELSE 0 END), 0) AS derivationBytes,
      COALESCE(SUM(CASE WHEN path NOT LIKE '%.drv' THEN narSize ELSE 0 END), 0) AS outputBytes,
      MIN(registrationTime) AS oldest,
      MAX(registrationTime) AS newest
    FROM ValidPaths
  `);
  const roots = queryStore(`
    SELECT COUNT(*) AS roots
    FROM ValidPaths v
    WHERE NOT EXISTS (SELECT 1 FROM Refs r WHERE r.reference = v.id)
  `);
  const row = rows[0] ?? {};
  return {
    paths: Number(row.paths ?? 0),
    derivations: Number(row.derivations ?? 0),
    outputs: Number(row.outputs ?? 0),
    narBytes: Number(row.narBytes ?? 0),
    derivationBytes: Number(row.derivationBytes ?? 0),
    outputBytes: Number(row.outputBytes ?? 0),
    oldest: Number(row.oldest ?? 0),
    newest: Number(row.newest ?? 0),
    roots: Number(roots[0]?.roots ?? 0),
  };
}

/** Largest store paths by nar size. */
export function readLargestPaths(limit = 25) {
  return queryStore(`
    SELECT path, narSize, registrationTime
    FROM ValidPaths
    WHERE path NOT LIKE '%.drv'
    ORDER BY narSize DESC
    LIMIT ${Number(limit)}
  `).map((row) => ({
    path: row.path,
    narSize: Number(row.narSize ?? 0),
    registrationTime: Number(row.registrationTime ?? 0),
  }));
}

/** Paths registered in the last `days` days, newest first. */
export function readRecentPaths(days = 2, limit = 40) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return queryStore(`
    SELECT path, narSize, registrationTime
    FROM ValidPaths
    WHERE registrationTime >= ${since} AND path NOT LIKE '%.drv'
    ORDER BY registrationTime DESC
    LIMIT ${Number(limit)}
  `).map((row) => ({
    path: row.path,
    narSize: Number(row.narSize ?? 0),
    registrationTime: Number(row.registrationTime ?? 0),
  }));
}

/** Registration histogram, one bucket per day, oldest first. */
export function readRegistrationHistogram(days = 21) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return queryStore(`
    SELECT (registrationTime / 86400) * 86400 AS day, COUNT(*) AS paths, COALESCE(SUM(narSize), 0) AS narBytes
    FROM ValidPaths
    WHERE registrationTime >= ${since}
    GROUP BY day
    ORDER BY day
  `).map((row) => ({
    day: Number(row.day),
    paths: Number(row.paths),
    narBytes: Number(row.narBytes),
  }));
}

/** Top-level name prefixes, "gtk4-4.20.2" counted as "gtk4", by path count. */
export function readNamePrefixes(limit = 15) {
  return queryStore(`
    SELECT
      CASE
        WHEN instr(substr(path, 45), '-') > 0
          THEN substr(substr(path, 45), 1, instr(substr(path, 45), '-') - 1)
        ELSE substr(path, 45)
      END AS prefix,
      COUNT(*) AS paths
    FROM ValidPaths
    WHERE path NOT LIKE '%.drv'
    GROUP BY prefix
    ORDER BY paths DESC
    LIMIT ${Number(limit)}
  `).map((row) => ({ prefix: row.prefix, paths: Number(row.paths) }));
}

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

/** Live system packages: unique store names behind /run/current-system/sw/bin. */
export function readSystemPackages() {
  const bin = `${CURRENT_SYSTEM}/sw/bin`;
  const dir = Gio.File.new_for_path(bin);
  const packages = new Map();
  const enumerator = dir.enumerate_children("standard::name,standard::symlink-target", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  while (true) {
    const info = enumerator.next_file(null);
    if (!info) break;
    const exe = info.get_name();
    const target = info.get_symlink_target();
    if (!target) continue;
    const abs = target.startsWith("/") ? target : GLib.build_filenamev([bin, target]);
    const match = abs.match(/\/nix\/store\/[a-z0-9]+-(.+?)\/bin\//);
    if (!match) continue;
    const name = match[1];
    if (!packages.has(name)) packages.set(name, []);
    packages.get(name).push(exe);
  }
  enumerator.close(null);
  return [...packages.entries()]
    .map(([name, executables]) => ({ name, executables: executables.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** nix config show, as a map of key to raw value string. */
export function readNixConfigShow() {
  const stdout = runCommand([nixBinary(), "config", "show"]);
  const out = {};
  for (const line of stdout.split("\n")) {
    const idx = line.indexOf(" = ");
    if (idx < 1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 3);
  }
  return out;
}

/** `nix store info --json`. */
export function readStoreInfo() {
  const stdout = runCommand([nixBinary(), "store", "info", "--json"]);
  return JSON.parse(stdout);
}

/** `nix registry list` rows: { kind, from, to }. */
export function readFlakeRegistry() {
  const stdout = runCommand([nixBinary(), "registry", "list"]);
  const rows = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(system|global|user)\s+(\S+)\s+(\S.*)$/);
    if (!match) continue;
    rows.push({ kind: match[1], from: match[2], to: match[3].trim() });
  }
  return rows;
}

/** Indirect inputs pinned by the system flake registry file. */
export function readSystemRegistryPins() {
  const text = readText("/etc/nix/registry.json");
  if (!text) return [];
  const json = JSON.parse(text);
  return (json.flakes ?? []).map((entry) => ({
    from: entry.from?.id ?? "",
    to: entry.to?.path ?? entry.to?.url ?? "",
  }));
}

/** Walks a directory for flake.nix files, skipping huge or hidden trees. */
export function findFlakeFiles(roots, maxDepth = 3) {
  const found = [];
  const skip = new Set([
    ".git",
    "node_modules",
    "target",
    "result",
    "dist",
    ".direnv",
    "vendor",
    "worktrees",
    ".herdr",
  ]);
  const visit = (dir, depth) => {
    if (depth > maxDepth) return;
    let enumerator;
    try {
      enumerator = dir.enumerate_children("standard::name,standard::type", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch {
      return;
    }
    const children = [];
    while (true) {
      const info = enumerator.next_file(null);
      if (!info) break;
      const name = info.get_name();
      if (name === "flake.nix" && info.get_file_type() === Gio.FileType.REGULAR) {
        found.push(dir.get_child(name).get_path());
      } else if (info.get_file_type() === Gio.FileType.DIRECTORY && !skip.has(name) && !name.startsWith(".")) {
        children.push(dir.get_child(name));
      }
    }
    enumerator.close(null);
    for (const child of children) visit(child, depth + 1);
  };
  for (const root of roots) {
    const file = Gio.File.new_for_path(root);
    if (file.query_exists(null)) visit(file, 0);
  }
  return found.sort();
}

/** Reads flake.nix description plus flake.lock nodes, without evaluating. */
export function readFlakeSummary(flakeNixPath) {
  const dir = GLib.path_get_dirname(flakeNixPath);
  const nixText = readText(flakeNixPath);
  const description = nixText.match(/description\s*=\s*"([^"]*)"/)?.[1]
    ?? nixText.match(/description\s*=\s*'([^']*)'/)?.[1]
    ?? "";
  const lockPath = `${dir}/flake.lock`;
  let nodes = [];
  let rootInputs = [];
  let lockError = "";
  if (Gio.File.new_for_path(lockPath).query_exists(null)) {
    try {
      const lock = JSON.parse(readText(lockPath));
      rootInputs = Object.keys(lock.nodes?.root?.inputs ?? {});
      nodes = Object.entries(lock.nodes ?? {})
        .filter(([name]) => name !== "root")
        .map(([name, node]) => ({
          name,
          locked: node.locked ?? {},
          original: node.original ?? {},
          inputs: node.inputs ?? {},
        }));
    } catch (error) {
      lockError = String(error);
    }
  }
  return {
    dir,
    flakeNixPath,
    description,
    lockPath,
    hasLock: Gio.File.new_for_path(lockPath).query_exists(null),
    rootInputs,
    nodes,
    lockError,
    mtime: pathMtime(flakeNixPath),
  };
}

/** GC roots that point at something other than a system generation profile. */
export function readExtraGcRoots(limit = 80) {
  const dir = Gio.File.new_for_path(GCROOTS_AUTO);
  if (!dir.query_exists(null)) return [];
  const roots = [];
  const enumerator = dir.enumerate_children("standard::name,standard::symlink-target", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  while (true) {
    const info = enumerator.next_file(null);
    if (!info) break;
    const target = info.get_symlink_target() ?? "";
    if (!target || target.includes("/nix/var/nix/profiles/system-")) continue;
    roots.push({ name: info.get_name(), target });
    if (roots.length >= limit) break;
  }
  enumerator.close(null);
  return roots.sort((a, b) => a.target.localeCompare(b.target));
}

/** Counts auto GC roots, including system profile roots. */
export function countAutoGcRoots() {
  const dir = Gio.File.new_for_path(GCROOTS_AUTO);
  if (!dir.query_exists(null)) return 0;
  let count = 0;
  const enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
  while (enumerator.next_file(null)) count += 1;
  enumerator.close(null);
  return count;
}

/** Runtime identity: hostname, nix version, current system path, os-release. */
export function readMachineIdentity() {
  const os = readOsRelease();
  const version = readText(`${CURRENT_SYSTEM}/nixos-version`).trim() || os.BUILD_ID || "";
  let nixVersion = "";
  try {
    nixVersion = runCommand([nixBinary(), "--version"]).trim();
  } catch (error) {
    nixVersion = String(error);
  }
  return {
    hostname: GLib.get_host_name(),
    username: GLib.get_user_name(),
    arch: GLib.getenv("HOSTTYPE") || runCommand(["uname", "-m"]).trim(),
    kernel: runCommand(["uname", "-r"]).trim(),
    nixVersion,
    nixosVersion: version,
    prettyName: os.PRETTY_NAME || os.NAME || "NixOS",
    codename: os.VERSION_CODENAME || "",
    homeUrl: os.HOME_URL || "https://nixos.org/",
    currentSystem: resolveLink(CURRENT_SYSTEM),
    bootedSystem: resolveLink(BOOTED_SYSTEM),
    desktop: GLib.getenv("XDG_CURRENT_DESKTOP") || "",
  };
}

/** Bootspec JSON of a generation toplevel, or null. */
export function readBootspec(storePath) {
  const text = readText(`${storePath}/boot.json`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Package names added and removed between two system closures' bin dirs. */
export function diffGenerationBins(beforePath, afterPath) {
  const names = (toplevel) => {
    const bin = `${toplevel}/sw/bin`;
    const dir = Gio.File.new_for_path(bin);
    const set = new Set();
    if (!dir.query_exists(null)) return set;
    const enumerator = dir.enumerate_children("standard::name,standard::symlink-target", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    while (true) {
      const info = enumerator.next_file(null);
      if (!info) break;
      const target = info.get_symlink_target();
      if (!target) continue;
      const abs = target.startsWith("/") ? target : GLib.build_filenamev([bin, target]);
      const match = abs.match(/\/nix\/store\/[a-z0-9]+-(.+?)\/bin\//);
      if (match) set.add(match[1]);
    }
    enumerator.close(null);
    return set;
  };
  const before = names(beforePath);
  const after = names(afterPath);
  return {
    added: [...after].filter((name) => !before.has(name)).sort(),
    removed: [...before].filter((name) => !after.has(name)).sort(),
  };
}

/** Search ValidPaths by substring. Empty query returns nothing. */
export function searchStorePaths(query, limit = 80) {
  const text = String(query ?? "").trim();
  if (text.length < 2) return [];
  return queryStore(`
    SELECT path, narSize, registrationTime
    FROM ValidPaths
    WHERE path LIKE '%${escapeSql(text)}%'
    ORDER BY narSize DESC
    LIMIT ${Number(limit)}
  `).map((row) => ({
    path: row.path,
    narSize: Number(row.narSize ?? 0),
    registrationTime: Number(row.registrationTime ?? 0),
  }));
}

/** Referrers of a store path: who points at it. */
export function readStoreReferrers(storePath, limit = 40) {
  return queryStore(`
    SELECT vp.path AS path, vp.narSize AS narSize
    FROM ValidPaths vp
    JOIN Refs r ON r.referrer = vp.id
    JOIN ValidPaths self ON self.id = r.reference
    WHERE self.path = '${escapeSql(storePath)}' AND vp.path != '${escapeSql(storePath)}'
    ORDER BY vp.narSize DESC
    LIMIT ${Number(limit)}
  `);
}

