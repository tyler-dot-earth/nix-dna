/** One row in a Gtk.ListView: title, subtitle, an optional trailing value. */

import GObject from "gi://GObject";

/**
 * GObject fields a list item factory can bind.
 * `payload` is the plain object the click handler wants back.
 */
export const FactRow = GObject.registerClass({
  GTypeName: "NixDnaFactRow",
  Properties: {
    title: GObject.ParamSpec.string(
      "title", "Title", "Primary line",
      GObject.ParamFlags.READWRITE, "",
    ),
    subtitle: GObject.ParamSpec.string(
      "subtitle", "Subtitle", "Secondary line",
      GObject.ParamFlags.READWRITE, "",
    ),
    value: GObject.ParamSpec.string(
      "value", "Value", "Trailing label",
      GObject.ParamFlags.READWRITE, "",
    ),
  },
}, class FactRow extends GObject.Object {
  constructor(params = {}) {
    super();
    this.title = params.title ?? "";
    this.subtitle = params.subtitle ?? "";
    this.value = params.value ?? "";
    this.payload = params.payload ?? null;
  }
});
