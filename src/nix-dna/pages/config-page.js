/** Nix configuration: nix.conf, nix config show, and the ideas Nix is built on. */

import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";

import { SectionPage } from "../section-page.js";
import { group, row } from "../ui.js";
import { readChannels, readExtraGcRoots, readNixConf, readNixConfigShow } from "../nix-facts.js";
import { formatBytes, storePathName } from "../format.js";

const INTERESTING_KEYS = [
  "system",
  "experimental-features",
  "sandbox",
  "substituters",
  "trusted-public-keys",
  "trusted-substituters",
  "trusted-users",
  "allowed-users",
  "require-sigs",
  "auto-optimise-store",
  "max-jobs",
  "cores",
  "system-features",
  "extra-platforms",
  "min-free",
  "max-free",
  "keep-outputs",
  "keep-derivations",
  "flake-registry",
  "warn-dirty",
  "accept-flake-config",
  "allow-import-from-derivation",
  "eval-cache",
  "http-connections",
  "fallback",
  "builders",
  "sandbox-paths",
];

const IDEAS = [
  ["The store", "Everything Nix builds lands in /nix/store under a hash of its inputs. Same inputs, same path. Two machines with the same path have the same bytes."],
  ["Derivations", "A .drv file is the build recipe: inputs, builder, arguments, environment. The output path is fixed before the build runs."],
  ["Closures", "A path plus every path it references, recursively. Generations, profiles, and nix-copy-closure all move closures, not single files."],
  ["Profiles and generations", "A profile is a symlink Nix updates atomically. Old generations stay until garbage collection, which is why a bad rebuild is a reboot away from the previous one."],
  ["Garbage collection", "A path stays if a GC root reaches it: a generation, a result symlink, a direnv profile, the running system. Everything else can be deleted."],
  ["Flakes", "A flake is a directory with flake.nix and, once locked, flake.lock. Inputs are pinned. Outputs are evaluated from that pin, not from whatever channel happens to be installed."],
  ["Substituters", "Binary caches. If cache.nixos.org already has the NAR for an output path, Nix downloads it instead of building."],
  ["Purity", "Builds run in a sandbox with no network and a fixed PATH. That is the deal that makes the hash meaningful."],
];

/** Builds the configuration section. */
export function createConfigPage() {
  const section = new SectionPage({
    title: "Configuration",
    description: "What this Nix is willing to do, and a short tour of the model those settings sit on.",
  });
  const fileGroup = group("nix.conf", "/etc/nix/nix.conf, generated from the NixOS nix.* options.");
  const liveGroup = group("Effective config", "nix config show. Defaults fill in whatever nix.conf left out.");
  const channelsGroup = group("Channels", "The pre-flake pin, still installed for root if nix-channel was used.");
  const rootsGroup = group("GC roots that are not generations", "result links, direnv profiles, and anything else holding store paths open.");
  const ideas = group("The model");
  section.addGroup(fileGroup);
  section.addGroup(liveGroup);
  section.addGroup(channelsGroup);
  section.addGroup(rootsGroup);
  section.addGroup(ideas);

  for (const [title, subtitle] of IDEAS) ideas.add(row(title, subtitle));
  section.showLoading("Reading nix config.");

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    try {
      const conf = readNixConf();
      const keys = Object.keys(conf);
      if (keys.length === 0) fileGroup.add(row("Unreadable", "Could not read /etc/nix/nix.conf."));
      for (const key of keys) fileGroup.add(row(key, conf[key] || "empty"));

      const live = readNixConfigShow();
      for (const key of INTERESTING_KEYS) {
        if (!(key in live)) continue;
        const value = live[key] === "" ? "empty" : presentConfigValue(key, live[key]);
        const overridden = key in conf ? "set in nix.conf" : "default";
        liveGroup.add(row(key, value, overridden));
      }

      const channels = readChannels();
      if (channels.length === 0) {
        channelsGroup.add(row("No channel profiles", "This install is flakes-only, or the per-user profile dir is empty."));
      }
      for (const channel of channels) {
        channelsGroup.add(row(
          `${channel.user}${channel.current ? " · current" : ""}`,
          storePathName(channel.storePath),
        ));
      }

      const roots = readExtraGcRoots(40);
      if (roots.length === 0) {
        rootsGroup.add(row("None", "Every auto GC root points at a system generation."));
      }
      for (const root of roots) {
        rootsGroup.add(row(shortenHome(root.target), root.name));
      }
      section.showPreferences();
    } catch (error) {
      section.showError("Could not read configuration", String(error?.message ?? error));
    }
    return GLib.SOURCE_REMOVE;
  });

  return section;
}

const BYTE_KEYS = new Set(["min-free", "max-free", "download-buffer-size"]);

/** Byte-sized nix settings render as GiB. Everything else stays a string. */
function presentConfigValue(key, value) {
  if (!BYTE_KEYS.has(key)) return value;
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  if (bytes > 10 * 1024 ** 4) return "unlimited";
  return formatBytes(bytes);
}

function shortenHome(path) {
  const home = GLib.get_home_dir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
