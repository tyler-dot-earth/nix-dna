/**
 * A row of bars drawn with the theme accent color.
 *
 * Used where a list of numbers is easier to read as a shape: how many
 * paths landed each day, how many generations were built each day.
 */

import Gtk from "gi://Gtk?version=4.0";

/**
 * `bars` is a list of { label, value }. `value` is the bar height.
 * The widget does not scroll and does not ask for more than its fixed height.
 */
export function barChart(bars, { height = 112, unit = "" } = {}) {
  const area = new Gtk.DrawingArea({
    hexpand: true,
    height_request: height,
    css_classes: ["accent"],
  });
  area.set_draw_func((widget, cr, width, widgetHeight) => {
    drawBars(widget, cr, width, widgetHeight, bars, unit);
  });
  return area;
}

/**
 * Draws one bar per entry.
 * The first and last labels sit under the ends. The peak value sits on its bar.
 */
function drawBars(widget, cr, width, height, bars, unit) {
  const color = widget.get_color();
  const count = Math.max(bars.length, 1);
  const gap = 3;
  const labelHeight = 16;
  const topPad = 16;
  const barWidth = Math.max(2, (width - gap * (count + 1)) / count);
  const max = bars.reduce((peak, bar) => Math.max(peak, Number(bar.value) || 0), 0);
  const baseline = height - labelHeight - 2;
  const usable = baseline - topPad;
  let peakIndex = 0;
  bars.forEach((bar, index) => {
    if ((Number(bar.value) || 0) > (Number(bars[peakIndex].value) || 0)) peakIndex = index;
  });

  cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
  bars.forEach((bar, index) => {
    const value = Number(bar.value) || 0;
    const barHeight = max > 0 && value > 0 ? Math.max(2, (value / max) * usable) : 0;
    if (barHeight === 0) return;
    const x = gap + index * (barWidth + gap);
    roundedBar(cr, x, baseline - barHeight, barWidth, barHeight, 2);
    cr.fill();
  });

  cr.selectFontFace("sans-serif", 0, 0);
  cr.setFontSize(11);
  const peak = bars[peakIndex];
  if (peak && max > 0) {
    const text = `${formatChartValue(peak.value)} ${unit}`.trim();
    const peakX = gap + peakIndex * (barWidth + gap);
    const peakHeight = Math.max(2, (max / max) * usable);
    drawText(cr, text, Math.min(Math.max(4, peakX), width - 80), baseline - peakHeight - 3);
  }
  const first = bars[0]?.label ?? "";
  const last = bars[bars.length - 1]?.label ?? "";
  if (first) drawText(cr, first, 4, height - 3);
  if (last && last !== first) {
    const extents = cr.textExtents(last);
    drawText(cr, last, Math.max(4, width - extents.width - 4), height - 3);
  }
}

/** Integers get thousands separators. Anything else is left as text. */
function formatChartValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return Math.round(number).toLocaleString("en-US");
}

/** Left-aligned text whose baseline is `y`. */
function drawText(cr, text, x, y) {
  cr.moveTo(x, y);
  cr.showText(String(text));
}

/** A rectangle with rounded top corners. Cairo arcs use radians. */
function roundedBar(cr, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  cr.newPath();
  cr.moveTo(x, y + height);
  cr.lineTo(x, y + r);
  cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  cr.lineTo(x + width - r, y);
  cr.arc(x + width - r, y + r, r, Math.PI * 1.5, 0);
  cr.lineTo(x + width, y + height);
  cr.closePath();
}
