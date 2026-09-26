/**
 * A treemap of store paths, sized by NAR bytes.
 *
 * Rectangles are laid out largest first, the way Disk Usage Analyzer lays out
 * directories. Area is the size. The label is the path name, when it fits.
 */

import Gtk from "gi://Gtk?version=4.0";

// GNOME palette, step 3 of each hue. The guidelines give these for icons
// and illustrations, which is what a treemap is.
const PALETTE = [
  "#3584e4", // blue
  "#33d17a", // green
  "#f6d32d", // yellow
  "#ff7800", // orange
  "#e01b24", // red
  "#9141ac", // purple
  "#986a44", // brown
];
const LIGHT_LABEL = "#f6f5f4"; // Light 2
const DARK_LABEL = "#241f31"; // Dark 4

/**
 * `entries` is a list of { label, bytes }, largest first.
 * The widget fills the width it is given and stays a fixed height.
 */
export function treemap(entries, { height = 220 } = {}) {
  const area = new Gtk.DrawingArea({
    hexpand: true,
    height_request: height,
    vexpand: false,
  });
  area.set_draw_func((_widget, cr, width, widgetHeight) => {
    drawTreemap(cr, width, widgetHeight, entries);
  });
  return area;
}

/** Slice-and-dice layout: rows alternate direction so the shape stays compact. */
function drawTreemap(cr, width, height, entries) {
  const total = entries.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
  if (total <= 0 || width < 4 || height < 4) return;
  const rects = [];
  layout(entries, 1, 1, width - 2, height - 2, total, rects);
  rects.forEach((rect, index) => {
    fillColor(cr, PALETTE[index % PALETTE.length]);
    cr.rectangle(rect.x, rect.y, rect.width, rect.height);
    cr.fill();
    if (rect.width < 48 || rect.height < 28) return;
    fillColor(cr, labelColor(PALETTE[index % PALETTE.length]));
    cr.selectFontFace("sans-serif", 0, 0);
    cr.setFontSize(12);
    const name = fit(cr, rect.label, rect.width - 10);
    const size = fit(cr, formatBytes(rect.bytes), rect.width - 10);
    if (name === rect.label) {
      cr.moveTo(rect.x + 5, rect.y + 16);
      cr.showText(name);
    }
    cr.setFontSize(11);
    if (size === formatBytes(rect.bytes)) {
      cr.moveTo(rect.x + 5, rect.y + (name === rect.label ? 30 : 16));
      cr.showText(size);
    }
  });
}

/** Gives each entry a rectangle proportional to its bytes. */
function layout(entries, x, y, width, height, total, out) {
  if (entries.length === 0 || width < 1 || height < 1) return;
  if (entries.length === 1) {
    out.push({ x, y, width, height, label: entries[0].label, bytes: entries[0].bytes });
    return;
  }
  const horizontal = width >= height;
  let used = 0;
  let index = 0;
  const half = total / 2;
  while (index < entries.length - 1 && used < half) {
    used += Number(entries[index].bytes || 0);
    index += 1;
  }
  const first = entries.slice(0, Math.max(1, index));
  const second = entries.slice(first.length);
  const firstBytes = first.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
  const share = total > 0 ? firstBytes / total : 0.5;
  if (horizontal) {
    const split = Math.max(1, width * share);
    layout(first, x, y, split, height, firstBytes, out);
    layout(second, x + split, y, width - split, height, total - firstBytes, out);
  } else {
    const split = Math.max(1, height * share);
    layout(first, x, y, width, split, firstBytes, out);
    layout(second, x, y + split, width, height - split, total - firstBytes, out);
  }
}

/** Shortens a label so it stays inside its rectangle. */
function fit(cr, text, maxWidth) {
  const value = String(text ?? "");
  if (cr.textExtents(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && cr.textExtents(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Light 2 on a dark hue, Dark 4 on a light one. Yellow and green fail the other way. */
function labelColor(hex) {
  return luminance(hex) > 0.3 ? DARK_LABEL : LIGHT_LABEL;
}

/** Relative luminance of a #rrggbb color, 0 to 1. */
function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift) => {
    const srgb = ((value >> shift) & 255) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** Sets the cairo source from a #rrggbb string. */
function fillColor(cr, hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  cr.setSourceRGB(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** Bytes as a short unit, matching the rest of the app's sizes. */
function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
