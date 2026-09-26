/** Flakes on disk under the home directory, plus the flake registry. */

import Adw from "gi://Adw?version=1";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import Gtk from "gi://Gtk?version=4.0";
import { SectionPage } from "../section-page.js";
import { flakeDiagram } from "../flake-graph.js";
import { copyRow, group, row } from "../ui.js";
import { flakePinLabel, formatRelativeSeconds, shortStoreHash } from "../format.js";
import {
  findFlakeFiles,
  readFlakeRegistry,
  readFlakeSummary,
  readSystemRegistryPins,
} from "../nix-facts.js";

/** Builds the flakes section. Discovery is a filesystem walk, not `nix flake show`. */
export function createFlakesPage(host) {
  const section = new SectionPage({
    title: "Flakes",
    description: "flake.nix under your home directory, two levels down, and the registries Nix consults.",
  });
  const found = group("On disk", "Locked inputs come from flake.lock. Nothing is evaluated.");
  const pins = group("System registry", "/etc/nix/registry.json, written by the NixOS module.");
  const registry = group("Registry", "nix registry list. system beats global beats user.");

  const diagramPage = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  const listPage = new Adw.PreferencesPage();
  listPage.add(found);
  listPage.add(pins);
  listPage.add(registry);
  const flakesStack = new Adw.ViewStack();
  flakesStack.add_titled_with_icon(diagramPage, "diagram", "Diagram", "view-grid-symbolic");
  flakesStack.add_titled_with_icon(listPage, "list", "List", "view-list-symbolic");
  const switcher = new Adw.ViewSwitcher({ stack: flakesStack, policy: Adw.ViewSwitcherPolicy.WIDE });
  section.header.set_title_widget(switcher);
  section.showWidget("flakes", flakesStack);
  section.showLoading("Looking for flake.nix files.");

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    try {
      fillFlakes({ found, pins, registry, host, diagramPage, flakesStack });
      section.showWidget("flakes", flakesStack);
    } catch (error) {
      section.showError("Could not read flakes", String(error?.message ?? error));
    }
    return GLib.SOURCE_REMOVE;
  });

  return section;
}

function fillFlakes({ found, pins, registry, host, diagramPage, flakesStack }) {
  const home = GLib.get_home_dir();
  const roots = [home, `${home}/src`, `${home}/code`, `${home}/dev`, `${home}/projects`];
  const files = findFlakeFiles(roots.filter((root, index) => index === 0 || Gio.File.new_for_path(root).query_exists(null)), 2);
  if (files.length === 0) {
    found.add(row("None found", `No flake.nix within three directories of ${home}.`));
  }
  const summaries = files.map((file) => readFlakeSummary(file));
  for (const summary of summaries) found.add(flakeRow(summary, host));
  fillDiagram(diagramPage, summaries);
  flakesStack.set_visible_child_name("diagram");

  const systemPins = readSystemRegistryPins();
  if (systemPins.length === 0) {
    pins.add(row("Empty", "No pins in /etc/nix/registry.json."));
  }
  for (const pin of systemPins) {
    pins.add(row(pin.from || "nixpkgs", pin.to, shortStoreHash(pin.to)));
  }

  const entries = readFlakeRegistry();
  const interesting = entries.filter((entry) => entry.kind !== "global").concat(
    entries.filter((entry) => entry.kind === "global").slice(0, 12),
  );
  for (const entry of interesting) {
    registry.add(row(`${entry.kind} · ${entry.from}`, entry.to));
  }
  const hidden = entries.length - interesting.length;
  if (hidden > 0) {
    registry.add(row("Global registry", `${hidden} more global pins from the channel registry were not listed.`));
  }
}

function flakeRow(summary, host) {
  const title = summary.dir.replace(GLib.get_home_dir(), "~");
  const expander = new Adw.ExpanderRow({
    title,
    subtitle: summary.description || (summary.hasLock ? "locked" : "no flake.lock"),
  });
  expander.add_row(copyRow("Directory", summary.dir, summary.dir, host));
  expander.add_row(row(
    "flake.nix",
    formatRelativeSeconds(summary.mtime),
  ));
  expander.add_row(row(
    "Lock",
    summary.hasLock ? `${summary.nodes.length} locked nodes` : "No flake.lock next to flake.nix.",
  ));
  if (summary.lockError) expander.add_row(row("Lock parse error", summary.lockError));
  return expander;
}

/** One card per flake: its name, then the lock drawn as boxes and lines. */
function fillDiagram(page, summaries) {
  const scroll = new Gtk.ScrolledWindow({ hexpand: true, vexpand: true });
  const flow = new Gtk.FlowBox({
    selection_mode: Gtk.SelectionMode.NONE,
    column_spacing: 12,
    row_spacing: 12,
    margin_top: 12,
    margin_bottom: 12,
    margin_start: 12,
    margin_end: 12,
    homogeneous: true,
  });
  for (const summary of summaries) {
    const nodes = lockTreeRows(summary);
    if (nodes.length === 0) continue;
    const card = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      css_classes: ["card"],
      margin_top: 6,
      margin_bottom: 6,
      margin_start: 6,
      margin_end: 6,
    });
    card.append(new Gtk.Label({
      label: summary.dir.replace(GLib.get_home_dir(), "~"),
      xalign: 0,
      margin_top: 10,
      margin_start: 12,
      margin_end: 12,
      css_classes: ["heading"],
    }));
    card.append(new Gtk.Label({
      label: "Solid lines are pins. Dashed lines follow another input.",
      xalign: 0,
      margin_start: 12,
      margin_bottom: 6,
      css_classes: ["dim-label"],
    }));
    card.append(flakeDiagram(nodes));
    flow.append(card);
  }
  scroll.set_child(flow);
  page.append(scroll);
}

/**
 * Direct inputs, then each input's own inputs.
 * An array edge is a follows: the node uses another input's pin.
 */
function lockTreeRows(summary) {
  const byName = new Map(summary.nodes.map((node) => [node.name, node]));
  const rows = [];
  const visit = (name, depth, seen) => {
    if (depth > 4 || seen.has(name)) return;
    const node = byName.get(name);
    if (!node) return;
    const nextSeen = new Set(seen);
    nextSeen.add(name);
    rows.push({
      depth,
      name,
      detail: flakePinLabel(node),
      follows: "",
    });
    for (const [inputName, target] of Object.entries(node.inputs ?? {})) {
      if (Array.isArray(target)) {
        rows.push({ depth: depth + 1, name: inputName, detail: "", follows: target.join(".") });
        continue;
      }
      visit(target, depth + 1, nextSeen);
    }
  };
  for (const name of summary.rootInputs) visit(name, 0, new Set());
  return rows;
}
