#!/usr/bin/env gjs
/**
 * Nix DNA
 *
 * Adwaita browser for the local Nix install: the running system, its
 * generations, the packages on the system path, the store database,
 * flakes under $HOME, and the daemon configuration.
 *
 * Run from a source checkout with `bin/nix-dna`, or `nix run` once
 * the package is built.
 */

imports.gi.versions.Gtk = "4.0";
imports.gi.versions.Adw = "1";

import System from "system";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import { NixDnaWindow } from "./window.js";

GLib.set_prgname("nix-dna");
GLib.set_application_name("Nix DNA");

const application = new Adw.Application({
  application_id: "org.nixos.NixDna",
  flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});

application.connect("startup", () => {
  const quit = new Gio.SimpleAction({ name: "quit" });
  quit.connect("activate", () => application.quit());
  application.add_action(quit);
  application.set_accels_for_action("app.quit", ["<primary>q"]);

  const css = new Gtk.CssProvider();
  css.load_from_string(`
    .navigation-sidebar row { padding: 2px 4px; }
    .nix-dna-mono { font-family: monospace; }
    .nix-dna-chart { margin: 6px 12px 0; }
  `);
  const display = Gdk.Display.get_default();
  if (display) {
    Gtk.StyleContext.add_provider_for_display(
      display,
      css,
      Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
  }
});

application.connect("activate", () => {
  let window = application.get_active_window();
  if (!window) window = new NixDnaWindow(application);
  window.present();
});

const status = application.run([System.programInvocationName]);
GLib.exit(status ?? 0);
