/**
 * A virtual list of FactRow items with a substring filter.
 *
 * Gtk.ListView builds only the rows on screen. The filter runs in the model,
 * so a search of a few hundred packages does not rebuild the widget tree.
 */

import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";
import { FactRow } from "./fact-row.js";

/** A filtered FactRow list plus the Gtk.ListView that shows it. */
export class RecordList {
  /**
   * `onActivate` receives the FactRow payload when a row is clicked.
   * Omit it for a list that only displays.
   */
  constructor({ onActivate = null } = {}) {
    this.store = Gio.ListStore.new(FactRow);
    this.filter = new Gtk.CustomFilter();
    this.filter.set_filter_func((item) => this.matches(item));
    this.filtered = new Gtk.FilterListModel({
      model: this.store,
      filter: this.filter,
      incremental: true,
    });
    this.selection = new Gtk.SingleSelection({ model: this.filtered, autoselect: false });
    this.query = "";
    const list = new Gtk.ListView({
      model: this.selection,
      factory: recordFactory(),
      css_classes: ["navigation-sidebar", "rich-list"],
      single_click_activate: Boolean(onActivate),
    });
    this.view = new Gtk.ScrolledWindow({
      child: list,
      hexpand: true,
      vexpand: true,
      propagate_natural_height: false,
    });
    if (onActivate) {
      list.connect("activate", (_view, position) => {
        const item = this.filtered.get_item(position);
        if (item) onActivate(item.payload, item);
      });
    }
  }

  /** Replaces every row. Each record is { title, subtitle, value, payload }. */
  setRecords(records) {
    this.store.remove_all();
    for (const record of records) this.store.append(new FactRow(record));
  }

  /** Case-insensitive match against title and subtitle. */
  setQuery(query) {
    this.query = String(query ?? "").trim().toLowerCase();
    this.filter.changed(Gtk.FilterChange.DIFFERENT);
  }

  /** How many rows the current query leaves visible. */
  visibleCount() {
    return this.filtered.get_n_items();
  }

  matches(item) {
    if (!this.query) return true;
    const title = String(item.title ?? "").toLowerCase();
    const subtitle = String(item.subtitle ?? "").toLowerCase();
    return title.includes(this.query) || subtitle.includes(this.query);
  }
}

/** Builds an Adw.ActionRow for each FactRow and keeps its labels in sync. */
function recordFactory() {
  const factory = new Gtk.SignalListItemFactory();
  factory.connect("setup", (_factory, listItem) => {
    const row = new AdwActionRow();
    listItem.set_child(row);
  });
  factory.connect("bind", (_factory, listItem) => {
    const row = listItem.get_child();
    const item = listItem.get_item();
    row.set_title(item.title ?? "");
    row.set_subtitle(item.subtitle ?? "");
    const value = item.value ?? "";
    let label = row._valueLabel;
    if (!label) {
      label = new GtkLabel(value);
      row._valueLabel = label;
      row.add_suffix(label);
    }
    label.set_label(value);
    label.set_visible(Boolean(value));
  });
  return factory;
}

function AdwActionRow() {
  const Adw = imports.gi.Adw;
  return new Adw.ActionRow({ activatable: false });
}

function GtkLabel(text) {
  return new Gtk.Label({
    label: text,
    css_classes: ["dim-label"],
    valign: Gtk.Align.CENTER,
  });
}
