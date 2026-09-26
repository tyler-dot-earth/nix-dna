/** Overview: what this machine is, and the numbers that define its Nix install. */

import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";

import { SectionPage } from "../section-page.js";
import { barChart } from "../bar-chart.js";
import { group, row } from "../ui.js";
import {
  formatBytes,
  formatCount,
  formatPercent,
  formatRelativeSeconds,
  parseNixOsVersion,
  shortStoreHash,
  storePathName,
} from "../format.js";
import {
  countAutoGcRoots,
  readDiskUsage,
  readInodeUsage,
  readMachineIdentity,
  readStoreInfo,
  readStoreTotals,
  readSystemGenerations,
} from "../nix-facts.js";

/** Builds the overview section. The first idle tick fills the groups. */
export function createOverviewPage(host) {
  const section = new SectionPage({
    title: "Overview",
    description: "This machine, the running generation, and the store behind it.",
  });
  const identityGroup = group("This machine");
  const installGroup = group("Install");
  const storeGroup = group("Store", "NAR bytes are the size Nix recorded for a path. Sharing on disk makes the real usage smaller.");
  const diskGroup = group("Disk");
  section.addGroup(identityGroup);
  section.addGroup(installGroup);
  section.addGroup(storeGroup);
  section.addGroup(diskGroup);
  section.showLoading("Reading the local Nix database.");

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    try {
      fillOverview({ section, identityGroup, installGroup, storeGroup, diskGroup, host });
      section.showPreferences();
    } catch (error) {
      section.showError("Could not read Nix", String(error?.message ?? error));
    }
    return GLib.SOURCE_REMOVE;
  });

  return section;
}

/** Names the busiest day, so the chart has a sentence and not only bars. */
function rebuildCaption(bars) {
  const peak = bars.reduce((best, bar) => (bar.value > best.value ? bar : best), bars[0]);
  const span = bars.length === 1 ? bars[0].label : `${bars[0].label} to ${bars[bars.length - 1].label}`;
  return `${peak.value} generations on ${peak.label}, the most in one day. One bar per day, ${span}.`;
}

/** One bar per day that has at least one generation, oldest day first. */
function generationDayCounts(generations) {
  const counts = new Map();
  for (const gen of generations) {
    if (!gen.mtime) continue;
    const date = new Date(gen.mtime * 1000);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value }));
}

function fillOverview({ section, identityGroup, installGroup, storeGroup, diskGroup, host }) {
  const id = readMachineIdentity();
  const parsed = parseNixOsVersion(id.nixosVersion);
  const generations = readSystemGenerations();
  const current = generations.find((gen) => gen.current);
  const booted = generations.find((gen) => gen.booted);
  const totals = readStoreTotals();
  let disk = null;
  let inodes = null;
  try {
    disk = readDiskUsage("/nix/store");
    inodes = readInodeUsage("/nix/store");
  } catch (error) {
    diskGroup.add(row("Could not read the filesystem", String(error?.message ?? error)));
  }
  let storeInfo = { url: "daemon", version: "", trusted: 0 };
  try {
    storeInfo = readStoreInfo();
  } catch {
    storeInfo = { url: "daemon", version: "", trusted: 0 };
  }
  const roots = countAutoGcRoots();

  identityGroup.add(row("Hostname", id.hostname));
  identityGroup.add(row("User", id.username));
  identityGroup.add(row("Desktop", id.desktop || "not set"));
  identityGroup.add(row("Architecture", id.arch));
  identityGroup.add(row("Kernel", id.kernel));

  installGroup.add(row("Operating system", id.prettyName, parsed.release));
  if (id.codename) installGroup.add(row("Release codename", id.codename));
  installGroup.add(row(
    "nixpkgs revision",
    parsed.revision ? `${parsed.revision} from ${parsed.date}` : id.nixosVersion,
  ));
  installGroup.add(row("Nix", id.nixVersion.replace(/^nix \(Nix\) /, "Nix ")));
  installGroup.add(row(
    "Store daemon",
    storeInfo.trusted ? "trusted user" : "untrusted user",
    String(storeInfo.url ?? "daemon"),
  ));
  if (current) {
    installGroup.add(row(
      `Current generation ${current.number}`,
      `${storePathName(current.storePath)} · ${shortStoreHash(current.storePath)}`,
      formatRelativeSeconds(current.mtime),
    ));
  }
  if (booted && current && booted.number !== current.number) {
    installGroup.add(row(
      `Booted generation ${booted.number}`,
      "A newer generation is current, but this boot is still the older one.",
      formatRelativeSeconds(booted.mtime),
    ));
    section.setBanner(
      `This boot is generation ${booted.number}. Generation ${current.number} applies on the next boot.`,
    );
  } else if (booted) {
    installGroup.add(row("Booted generation", `Generation ${booted.number} is the one this boot started from.`));
  }
  installGroup.add(row("Generations kept", `${formatCount(generations.length)} system generations`));
  const rebuilds = generationDayCounts(generations);
  if (rebuilds.length > 1) {
    const chartGroup = group("Rebuilds", rebuildCaption(rebuilds));
    const chart = barChart(rebuilds, { unit: "generations" });
    chart.add_css_class("nix-dna-chart");
    chartGroup.add(chart);
    section.addGroup(chartGroup);
  }

  storeGroup.add(row("Valid paths", formatCount(totals.paths)));
  storeGroup.add(row("Outputs", formatCount(totals.outputs), formatBytes(totals.outputBytes)));
  storeGroup.add(row("Derivations", formatCount(totals.derivations), formatBytes(totals.derivationBytes)));
  storeGroup.add(row("NAR bytes", "Added up from the database. Hard links mean the disk holds less than this.", formatBytes(totals.narBytes)));
  storeGroup.add(row("Unreferenced paths", "Nothing in the database points at these.", formatCount(totals.roots)));
  storeGroup.add(row("GC roots", `${formatCount(roots)} links under /nix/var/nix/gcroots/auto`));
  storeGroup.add(row(
    "First path registered",
    formatRelativeSeconds(totals.oldest),
  ));

  if (!disk) return;
  const usedFraction = disk.bytes > 0 ? disk.used / disk.bytes : 0;
  diskGroup.add(row(
    "Filesystem",
    disk.mount,
    `${formatPercent(disk.used, disk.bytes)} used`,
  ));
  diskGroup.add(row("Used", formatBytes(disk.used)));
  diskGroup.add(row("Free", formatBytes(disk.available)));
  if (inodes) diskGroup.add(row("Inodes", `${formatCount(inodes.used)} used of ${formatCount(inodes.total)}`));
  const barRow = new Adw.ActionRow({ title: "Capacity" });
  const bar = new Gtk.LevelBar({
    min_value: 0,
    max_value: 1,
    value: usedFraction,
    hexpand: true,
    valign: Gtk.Align.CENTER,
  });
  barRow.add_suffix(bar);
  diskGroup.add(barRow);

  diskGroup.set_description(
    "This is the whole filesystem that holds the store, not the store alone. The store shares the disk with everything else.",
  );
}
