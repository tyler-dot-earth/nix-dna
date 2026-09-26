/**
 * A flake lock drawn as boxes and lines.
 *
 * The flake is the first box. Each input hangs below the input that pulls
 * it in. A dashed line means the input follows another pin instead of
 * choosing its own. The layout is the lock file, not an evaluation.
 */

import Gtk from "gi://Gtk?version=4.0";

const BOX_W = 168;
const BOX_H = 44;
const GAP_X = 28;
const GAP_Y = 36;
const PAD = 16;

/**
 * `nodes` is a list of { depth, name, detail, follows }, in tree order.
 * Returns a drawing area sized to the tree.
 */
export function flakeDiagram(nodes) {
  const layout = layoutTree(nodes);
  const area = new Gtk.DrawingArea({
    content_width: layout.width,
    content_height: layout.height,
    css_classes: ["accent"],
    hexpand: true,
  });
  area.set_draw_func((widget, cr, width, height) => {
    drawDiagram(widget, cr, width, height, layout);
  });
  return area;
}

/**
 * Places each node under its parent.
 * A parent's children start at the parent's column, so a connector drops
 * straight down instead of crossing the connector next to it.
 */
function layoutTree(nodes) {
  const boxes = nodes.map((node, index) => ({
    ...node,
    index,
    column: 0,
    x: 0,
    y: PAD + node.depth * (BOX_H + GAP_Y),
  }));
  const edges = [];
  boxes.forEach((box, index) => {
    const parent = parentBox(boxes, index);
    const siblings = parent
      ? boxes.filter((candidate) => parentBox(boxes, candidate.index) === parent)
      : boxes.filter((candidate) => candidate.depth === 0);
    const position = siblings.indexOf(box);
    box.column = (parent?.column ?? 0) + position;
    box.x = PAD + box.column * (BOX_W + GAP_X);
    if (parent) edges.push({ from: parent, to: box, follows: Boolean(box.follows) });
  });
  const columns = Math.max(1, ...boxes.map((box) => box.column + 1));
  const rows = Math.max(1, ...boxes.map((box) => box.depth + 1));
  return {
    boxes,
    edges,
    width: PAD * 2 + columns * BOX_W + (columns - 1) * GAP_X,
    height: PAD * 2 + rows * BOX_H + (rows - 1) * GAP_Y,
  };
}

/** Lines first, then the boxes, so a line never crosses a label. */
function drawDiagram(widget, cr, width, height, layout) {
  const color = widget.get_color();
  const offsetX = Math.max(0, (width - layout.width) / 2);
  cr.translate(offsetX, 0);
  cr.setLineWidth(1.5);
  for (const edge of layout.edges) {
    cr.setSourceRGBA(color.red, color.green, color.blue, edge.follows ? 0.45 : 0.8);
    if (edge.follows) cr.setDash([4, 3], 0);
    else cr.setDash([], 0);
    link(cr, edge.from, edge.to);
  }
  cr.setDash([], 0);
  for (const box of layout.boxes) drawBox(cr, color, box);
}

/** The nearest earlier box one level up. Tree order makes that the parent. */
function parentBox(boxes, index) {
  const depth = boxes[index].depth;
  if (depth === 0) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (boxes[cursor].depth === depth - 1) return boxes[cursor];
  }
  return null;
}

/** A right-angle connector from the bottom of one box to the top of the next. */
function link(cr, from, to) {
  const x1 = from.x + BOX_W / 2;
  const y1 = from.y + BOX_H;
  const x2 = to.x + BOX_W / 2;
  const y2 = to.y;
  const mid = (y1 + y2) / 2;
  cr.newPath();
  cr.moveTo(x1, y1);
  cr.lineTo(x1, mid);
  cr.lineTo(x2, mid);
  cr.lineTo(x2, y2);
  cr.stroke();
}

/** One node: a rounded rectangle, the input name, and the pin or follows note. */
function drawBox(cr, color, box) {
  cr.setSourceRGBA(color.red, color.green, color.blue, 0.16);
  roundedRect(cr, box.x, box.y, BOX_W, BOX_H, 8);
  cr.fill();
  cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
  roundedRect(cr, box.x, box.y, BOX_W, BOX_H, 8);
  cr.stroke();
  cr.selectFontFace("sans-serif", 0, 0);
  cr.setFontSize(13);
  cr.moveTo(box.x + 10, box.y + 18);
  cr.showText(fitText(cr, box.name, BOX_W - 20));
  cr.setFontSize(11);
  cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha * 0.75);
  const detail = box.follows ? `follows ${box.follows}` : box.detail;
  cr.moveTo(box.x + 10, box.y + 34);
  cr.showText(fitText(cr, detail, BOX_W - 20));
}

/** Shortens text with an ellipsis once it passes `maxWidth`. */
function fitText(cr, text, maxWidth) {
  const value = String(text ?? "");
  if (cr.textExtents(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && cr.textExtents(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Rounded rectangle path. */
function roundedRect(cr, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  cr.newPath();
  cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  cr.arc(x + width - r, y + r, r, Math.PI * 1.5, 0);
  cr.arc(x + width - r, y + height - r, r, 0, Math.PI * 0.5);
  cr.arc(x + r, y + height - r, r, Math.PI * 0.5, Math.PI);
  cr.closePath();
}
