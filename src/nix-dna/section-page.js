/**
 * One section of the window.
 *
 * ToolbarView on top, an optional banner, then either a preferences page or
 * a virtual list. Search lives in the header bar and filters the list.
 */

import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";

/** Header bar, banner slot, and a content stack a section swaps as it loads. */
export class SectionPage {
  /**
   * `title` is the header and the sidebar label.
   * `description` is the preferences page intro, when the section uses one.
   */
  constructor({ title, description = "" }) {
    this.title = title;
    this.description = description;
    this.toolbar = new Adw.ToolbarView();
    this.header = new Adw.HeaderBar();
    this.header.set_title_widget(new Adw.WindowTitle({ title }));
    this.toolbar.add_top_bar(this.header);

    this.banner = new Adw.Banner({ revealed: false });

    this.body = new Gtk.Stack({
      transition_type: Gtk.StackTransitionType.NONE,
      vhomogeneous: false,
      hhomogeneous: false,
      vexpand: true,
      hexpand: true,
    });
    this.toolbar.set_content(this.body);

    this.status = new Adw.StatusPage({
      title: "Reading",
      description: "Looking at this machine.",
      child: new Adw.Spinner(),
    });
    this.body.add_named(this.status, "status");

    this.preferences = new Adw.PreferencesPage({ title, description });
    this.body.add_named(this.preferences, "preferences");
    this.body.set_visible_child_name("status");
  }

  /** Widget the window puts in its content stack. */
  widget() {
    return this.toolbar;
  }

  /** Shows the spinner. `description` says what is being read. */
  showLoading(description) {
    this.status.set_title("Reading");
    this.status.set_description(description);
    this.status.set_icon_name("");
    this.status.set_child(new Adw.Spinner());
    this.body.set_visible_child_name("status");
  }

  /** Replaces the spinner with an error the reader can select. */
  showError(title, description) {
    this.status.set_title(title);
    this.status.set_description(description);
    this.status.set_icon_name("dialog-warning-symbolic");
    this.status.set_child(null);
    this.body.set_visible_child_name("status");
  }

  /** Shows the preferences page. Groups added before this stay. */
  showPreferences() {
    this.body.set_visible_child_name("preferences");
  }

  /** Adds a preferences group. Safe to call before the page is visible. */
  addGroup(preferencesGroup) {
    this.preferences.add(preferencesGroup);
  }

  /** Puts `child` in the body under `name` and shows it. */
  showWidget(name, child) {
    if (!this.body.get_child_by_name(name)) this.body.add_named(child, name);
    this.body.set_visible_child_name(name);
  }

  /**
   * Adds the banner once the toolbar is in a window.
   * add_top_bar before that point does not parent the widget.
   */
  attachBanner() {
    if (this.banner.get_parent()) return;
    this.toolbar.add_top_bar(this.banner);
  }

  /** One-line notice under the header bar. Pass "" to hide it. */
  setBanner(text, buttonLabel = "", onButton = null) {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.applyBanner(text, buttonLabel, onButton);
      return GLib.SOURCE_REMOVE;
    });
  }

  /** Parents the banner and sets its text. Called after the window exists. */
  applyBanner(text, buttonLabel, onButton) {
    this.attachBanner();
    if (!text) {
      this.banner.set_revealed(false);
      return;
    }
    this.banner.set_title(text);
    this.banner.set_button_label(buttonLabel || "");
    if (this._bannerHandler) {
      this.banner.disconnect(this._bannerHandler);
      this._bannerHandler = 0;
    }
    if (buttonLabel && onButton) {
      this._bannerHandler = this.banner.connect("button-clicked", () => onButton());
    }
    this.banner.set_revealed(true);
  }

  /**
   * Search button in the header bar.
   * `onSearch` gets the entry text after a short pause.
   * The header is created here, so pages without search have no second title.
   */
  enableSearch(placeholder, onSearch) {
    const entry = new Gtk.SearchEntry({
      placeholder_text: placeholder,
      hexpand: true,
    });
    const bar = new Gtk.SearchBar({ child: entry, key_capture_widget: this.toolbar });
    const button = new Gtk.ToggleButton({
      icon_name: "system-search-symbolic",
      tooltip_text: "Search",
    });
    button.bind_property("active", bar, "search-mode-enabled", 1);
    bar.connect("notify::search-mode-enabled", () => {
      button.set_active(bar.get_search_mode());
    });
    this.header.pack_end(button);
    this.toolbar.add_top_bar(bar);

    let source = 0;
    entry.connect("search-changed", () => {
      if (source) GLib.source_remove(source);
      source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
        source = 0;
        onSearch(entry.get_text());
        return GLib.SOURCE_REMOVE;
      });
    });
    this.searchEntry = entry;
    return entry;
  }
}
