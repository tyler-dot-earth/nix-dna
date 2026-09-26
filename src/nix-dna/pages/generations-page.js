/** System generations, the boot menu, and what changed between two of them. */

import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";

import { SectionPage } from "../section-page.js";
import { group, preferencesPage, row } from "../ui.js";
import {
  formatBytes,
  formatCount,
  formatRelativeSeconds,
  shortStoreHash,
  storePathName,
} from "../format.js";
import {
  diffGenerationBins,
  readBootEntries,
  readBootspec,
  readClosureSize,
  readHomeManagerGenerations,
  readSystemGenerations,
  runCommandAsync,
  nixBinary,
} from "../nix-facts.js";

/** Builds the generations section. The list fills in on idle. */
export function createGenerationsPage(host) {
  const section = new SectionPage({
    title: "Generations",
    description: "Every system profile NixOS kept. Switching still happens from the boot menu.",
  });
  const page = section.preferences;

  const summary = group("Profiles", "A profile is the symlink Nix flips when a rebuild succeeds. Older flips stay until garbage collection.");
  const listGroup = group("System generations", "Newest first. Current is the profile symlink. Booted is the one this boot started.");
  const homeGroup = group("Home Manager", "The same idea as a system generation, for your user configuration.");
  const bootGroup = group("Boot loader");
  page.add(summary);
  page.add(listGroup);
  page.add(homeGroup);
  page.add(bootGroup);

  section.showLoading("Reading system profiles.");

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    try {
      fillGenerations({ summary, listGroup, homeGroup, bootGroup, host });
      section.showPreferences();
    } catch (error) {
      section.showError("Could not read generations", String(error?.message ?? error));
    }
    return GLib.SOURCE_REMOVE;
  });

  return section;
}

function fillGenerations({ summary, listGroup, homeGroup, bootGroup, host }) {
  const generations = readSystemGenerations();
  const home = readHomeManagerGenerations();
  const boots = readBootEntries();

  const current = generations.find((gen) => gen.current);
  const booted = generations.find((gen) => gen.booted);
  summary.add(row("System generations", formatCount(generations.length)));
  if (current && booted) {
    const same = current.number === booted.number;
    summary.add(row(
      same ? "Current and booted" : "Current is ahead of booted",
      same
        ? `Generation ${current.number} is what you are running.`
        : `Generation ${current.number} is current. This boot is still generation ${booted.number}.`,
    ));
  }
  if (generations.length >= 2) {
    const oldest = generations[generations.length - 1];
    const newest = generations[0];
    summary.add(row(
      "Span",
      `Generation ${oldest.number} (${formatRelativeSeconds(oldest.mtime)}) through ${newest.number} (${formatRelativeSeconds(newest.mtime)}).`,
    ));
  }

  const visible = generations.slice(0, 12);
  for (const gen of visible) {
    listGroup.add(generationRow(gen, generations, host));
  }
  if (generations.length > visible.length) {
    const older = new Adw.ActionRow({
      title: `${formatCount(generations.length - visible.length)} older generations`,
      subtitle: "Same profile series, back to the first one still on disk.",
    });
    const button = new Gtk.Button({ label: "Show all", valign: Gtk.Align.CENTER });
    button.connect("clicked", () => showAllGenerations(generations, host));
    older.add_suffix(button);
    older.activatable_widget = button;
    listGroup.add(older);
  }

  if (home.length === 0) {
    homeGroup.add(row("No Home Manager profile", "Looked in ~/.local/state/nix/profiles."));
  } else {
    for (const gen of home) {
      homeGroup.add(row(
        `Generation ${gen.number}${gen.current ? " · current" : ""}`,
        `${storePathName(gen.storePath)} · home-manager ${gen.hmVersion || "?"}`,
        formatRelativeSeconds(gen.mtime),
      ));
    }
  }

  if (boots.length === 0) {
    bootGroup.add(row("No entries readable", "/boot/loader/entries is missing or not mounted."));
  } else {
    bootGroup.add(row("Entries", `${formatCount(boots.length)} nixos-generation-*.conf files`));
    const sample = boots[0];
    bootGroup.add(row(`Newest entry · ${sample.number}`, sample.version || sample.file));
  }
}

function generationRow(gen, generations, host) {
  const flags = [
    gen.current ? "current" : "",
    gen.booted ? "booted" : "",
  ].filter(Boolean).join(", ");
  const kernelName = storePathName(gen.kernel).replace(/\/bzImage$/, "");
  const expander = new Adw.ExpanderRow({
    title: `Generation ${gen.number}${flags ? ` · ${flags}` : ""}`,
    subtitle: `${gen.version || "unknown version"} · ${formatRelativeSeconds(gen.mtime)}`,
  });

  let filled = false;
  expander.connect("notify::expanded", () => {
    if (!expander.get_expanded() || filled) return;
    filled = true;
    const closure = readClosureSize(gen.storePath);
    expander.add_row(row("Store path", gen.storePath, shortStoreHash(gen.storePath)));
    expander.add_row(row("Closure", `${formatCount(closure.paths)} paths`, formatBytes(closure.narBytes)));
    expander.add_row(row("Kernel", kernelName || "unknown"));
    const spec = readBootspec(gen.storePath);
    const label = spec?.["org.nixos.bootspec.v1"]?.label;
    if (label) expander.add_row(row("Boot label", label));
    const specialisations = spec?.["org.nixos.specialisation.v1"] ?? {};
    const names = Object.keys(specialisations);
    expander.add_row(row(
      "Specialisations",
      names.length ? names.join(", ") : "None in this generation.",
    ));

    const previous = generations.find((other) => other.number < gen.number);
    if (previous) {
      const programRow = row(
        `Programs since generation ${previous.number}`,
        "Comparing executable names…",
      );
      expander.add_row(programRow);
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
          const bins = diffGenerationBins(previous.storePath, gen.storePath);
          const added = bins.added.slice(0, 8);
          const removed = bins.removed.slice(0, 8);
          programRow.set_subtitle(
            added.length || removed.length
              ? `${bins.added.length} added, ${bins.removed.length} removed in /sw/bin`
              : "No executable package names changed.",
          );
          if (added.length) {
            expander.add_row(row("Added", added.join(", ") + (bins.added.length > added.length ? "…" : "")));
          }
          if (removed.length) {
            expander.add_row(row("Removed", removed.join(", ") + (bins.removed.length > removed.length ? "…" : "")));
          }
        } catch (error) {
          programRow.set_subtitle(String(error?.message ?? error));
        }
        return GLib.SOURCE_REMOVE;
      });
      const buttonRow = new Adw.ActionRow({
        title: "Full closure diff",
        subtitle: `nix store diff-closures ${previous.number} → ${gen.number}`,
      });
      const button = new Gtk.Button({ label: "Run", valign: Gtk.Align.CENTER });
      button.connect("clicked", () => showClosureDiff(previous, gen, host));
      buttonRow.add_suffix(button);
      buttonRow.activatable_widget = button;
      expander.add_row(buttonRow);
    }
  });
  return expander;
}

/** Scrollable list of every generation, without the per-row closure work. */
function showAllGenerations(generations, host) {
  const dialog = new Adw.Dialog({
    title: "All system generations",
    content_width: 640,
    content_height: 520,
  });
  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(new Adw.HeaderBar());
  const groupBox = new Adw.PreferencesGroup({
    description: "Open a generation from the main list to see its closure. This list is the index.",
  });
  for (const gen of generations) {
    const flags = [gen.current ? "current" : "", gen.booted ? "booted" : ""].filter(Boolean).join(", ");
    groupBox.add(row(
      `Generation ${gen.number}${flags ? ` · ${flags}` : ""}`,
      gen.version || storePathName(gen.storePath),
      formatRelativeSeconds(gen.mtime),
    ));
  }
  const page = new Adw.PreferencesPage();
  page.add(groupBox);
  toolbar.set_content(page);
  dialog.set_child(toolbar);
  dialog.present(host);
}

/** Runs `nix store diff-closures` off the main loop and shows the text. */
function showClosureDiff(before, after, host) {
  const dialog = new Adw.Dialog({
    title: `Generation ${before.number} to ${after.number}`,
    content_width: 680,
    content_height: 480,
  });
  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(new Adw.HeaderBar());
  const text = new Gtk.TextView({
    editable: false,
    monospace: true,
    wrap_mode: Gtk.WrapMode.WORD_CHAR,
    left_margin: 12,
    right_margin: 12,
    top_margin: 12,
    bottom_margin: 12,
  });
  text.get_buffer().set_text("Walking both closures.", -1);
  toolbar.set_content(new Gtk.ScrolledWindow({ child: text, hexpand: true, vexpand: true }));
  dialog.set_child(toolbar);
  dialog.present(host);

  runCommandAsync([nixBinary(), "store", "diff-closures", before.link, after.link])
    .then((diff) => text.get_buffer().set_text(diff.trim() || "No differences.", -1))
    .catch((error) => text.get_buffer().set_text(String(error?.message ?? error), -1));
}
