/** The main Nix DNA window: a split view, one section visible at a time. */

import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";

import { createOverviewPage } from "./pages/overview-page.js";
import { createGenerationsPage } from "./pages/generations-page.js";
import { createPackagesPage } from "./pages/packages-page.js";
import { createStorePage } from "./pages/store-page.js";
import { createFlakesPage } from "./pages/flakes-page.js";
import { createConfigPage } from "./pages/config-page.js";

const SECTIONS = [
  { id: "overview", title: "Overview", icon: "computer-symbolic" },
  { id: "generations", title: "Generations", icon: "view-list-symbolic" },
  { id: "packages", title: "Packages", icon: "system-software-install-symbolic" },
  { id: "store", title: "Store", icon: "drive-harddisk-symbolic" },
  { id: "flakes", title: "Flakes", icon: "folder-symbolic" },
  { id: "config", title: "Configuration", icon: "emblem-system-symbolic" },
];

/** Application window. Each section fills itself after it is first shown. */
export class NixDnaWindow extends Adw.ApplicationWindow {
  static {
    GObject.registerClass({ GTypeName: "NixDnaWindow" }, this);
  }

  constructor(application) {
    super({
      application,
      title: "Nix DNA",
      default_width: 980,
      default_height: 640,
    });

    this.toastOverlay = new Adw.ToastOverlay();
    this.set_content(this.toastOverlay);

    this.split = new Adw.NavigationSplitView({
      max_sidebar_width: 240,
      min_sidebar_width: 200,
      show_content: true,
    });
    this.toastOverlay.set_child(this.split);

    this.stack = new Gtk.Stack({
      transition_type: Gtk.StackTransitionType.NONE,
      vhomogeneous: false,
      hhomogeneous: false,
      vexpand: true,
      hexpand: true,
    });
    const pages = {
      overview: createOverviewPage(this),
      generations: createGenerationsPage(this),
      packages: createPackagesPage(),
      store: createStorePage(this),
      flakes: createFlakesPage(this),
      config: createConfigPage(),
    };
    for (const section of SECTIONS) {
      this.stack.add_named(pages[section.id].widget(), section.id);
    }

    const contentPage = new Adw.NavigationPage({ title: "Overview", child: this.stack });
    const sidebar = new Adw.ToolbarView();
    const sidebarHeader = new Adw.HeaderBar();
    sidebarHeader.set_title_widget(new Adw.WindowTitle({
      title: "Nix DNA",
      subtitle: "this machine",
    }));
    const aboutButton = new Gtk.Button({
      icon_name: "help-about-symbolic",
      tooltip_text: "About this app",
    });
    aboutButton.connect("clicked", () => this.presentAbout());
    sidebarHeader.pack_end(aboutButton);
    sidebar.add_top_bar(sidebarHeader);

    this.sidebarList = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.SINGLE,
      css_classes: ["navigation-sidebar"],
    });
    for (const section of SECTIONS) {
      const row = new Adw.ActionRow({ title: section.title, activatable: false });
      row.add_prefix(new Gtk.Image({ icon_name: section.icon }));
      row.sectionId = section.id;
      this.sidebarList.append(row);
    }
    this.sidebarList.connect("row-selected", (_list, row) => {
      if (!row) return;
      this.stack.set_visible_child_name(row.sectionId);
      const section = SECTIONS.find((item) => item.id === row.sectionId);
      contentPage.set_title(section?.title ?? "Nix DNA");
    });
    sidebar.set_content(new Gtk.ScrolledWindow({ child: this.sidebarList, vexpand: true }));

    const sidebarPage = new Adw.NavigationPage({ title: "Nix DNA", child: sidebar });

    this.split.set_sidebar(sidebarPage);
    this.split.set_content(contentPage);
    this.sidebarList.select_row(this.sidebarList.get_row_at_index(0));
  }

  /** Selects a sidebar section by id. The row handler swaps the stack. */
  showSection(id) {
    let row = this.sidebarList.get_row_at_index(0);
    while (row) {
      if (row.sectionId === id) {
        this.sidebarList.select_row(row);
        return;
      }
      row = row.get_next_sibling();
    }
  }

  /** Toast in the window overlay. Sections call this instead of keeping their own. */
  showToast(title) {
    this.toastOverlay.add_toast(new Adw.Toast({ title, timeout: 2 }));
  }

  /** Presents the standard Adwaita about dialog. */
  presentAbout() {
    const dialog = new Adw.AboutDialog({
      application_name: "Nix DNA",
      application_icon: "nix-snowflake",
      developer_name: "Nix DNA",
      version: "0.2.0",
      comments: "A local look at the Nix store, generations, flakes, and configuration on this machine.",
      website: "https://nixos.org/",
      license_type: Gtk.License.MIT_X11,
    });
    dialog.present(this);
  }
}
