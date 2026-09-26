/** Packages on the current system profile, in a virtual list. */

import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";

import { SectionPage } from "../section-page.js";
import { RecordList } from "../record-list.js";
import { readSystemPackages } from "../nix-facts.js";

/**
 * Builds the packages section.
 * The list is /run/current-system/sw/bin, not every path in the store.
 */
export function createPackagesPage() {
  const section = new SectionPage({
    title: "Packages",
    description: "Programs on the current system. One row is one store path behind /run/current-system/sw/bin. Libraries and Home Manager programs are not here.",
  });
  const records = new RecordList();
  section.showWidget("list", records.view);
  section.enableSearch("Package or executable", (text) => {
    records.setQuery(text);
  });

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    section.showLoading("Reading /run/current-system/sw/bin.");
    try {
      const packages = readSystemPackages();
      records.setRecords(packages.map((pkg) => ({
        title: pkg.name,
        subtitle: previewExecutables(pkg.executables),
        value: String(pkg.executables.length),
        payload: pkg,
      })));
      section.showWidget("list", records.view);
    } catch (error) {
      section.showError("Could not read the system path", String(error?.message ?? error));
    }
    return GLib.SOURCE_REMOVE;
  });

  return section;
}

/** First few executable names, with a count of the rest. */
function previewExecutables(executables) {
  const preview = executables.slice(0, 6).join(", ");
  const extra = executables.length > 6 ? `, +${executables.length - 6}` : "";
  return `${preview}${extra}`;
}

void Adw;
