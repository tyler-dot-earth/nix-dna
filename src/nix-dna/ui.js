/** Small Adwaita helpers shared by every Nix DNA page. */

import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";

/** Scrollable preferences page. Groups stack vertically inside it. */
export function preferencesPage(title, description) {
  const page = new Adw.PreferencesPage({ title, description });
  return page;
}

/** A preferences group with an optional description. */
export function group(title, description = "") {
  return new Adw.PreferencesGroup({ title, description });
}

/** Read-only action row: title, subtitle, optional trailing label. */
export function row(title, subtitle = "", value = "") {
  const action = new Adw.ActionRow({
    title: String(title ?? ""),
    subtitle: String(subtitle ?? ""),
  });
  if (value) {
    const label = new Gtk.Label({
      label: String(value),
      css_classes: ["dim-label"],
      valign: Gtk.Align.CENTER,
    });
    action.add_suffix(label);
  }
  return action;
}

/**
 * Action row that copies `copyText` when activated.
 * `host` is the window. It must implement showToast.
 */
export function copyRow(title, subtitle, copyText, host) {
  const action = row(title, subtitle);
  action.activatable = true;
  action.set_tooltip_text("Copy");
  const icon = new Gtk.Image({ icon_name: "edit-copy-symbolic" });
  action.add_suffix(icon);
  action.connect("activated", () => {
    const display = action.get_display();
    display.get_clipboard().set(String(copyText ?? subtitle ?? title));
    host?.showToast?.("Copied");
  });
  return action;
}
