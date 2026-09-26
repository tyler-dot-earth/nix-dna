/** The Nix store: a chart, the biggest paths, and a search of the database. */

import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";

import { SectionPage } from "../section-page.js";
import { RecordList } from "../record-list.js";
import { barChart } from "../bar-chart.js";
import { treemap } from "../treemap.js";
import { group, preferencesPage, row } from "../ui.js";
import {
  formatBytes,
  formatCount,
  formatRelativeSeconds,
  formatUnixSeconds,
  shortStoreHash,
  storePathName,
} from "../format.js";
import {
  queryStoreAsync,
  readClosureSize,
  readStorePathRow,
  readStoreReferences,
  readStoreReferrers,
} from "../nix-facts.js";

/**
 * Builds the store section.
 * The heavy queries go through sqlite asynchronously so the window stays live.
 */
export function createStorePage(host) {
  const section = new SectionPage({ title: "Store" });
  const records = new RecordList({
    onActivate: (path) => showPath(path, host),
  });

  const summaryPage = preferencesPage("Store", "");
  const summary = new Adw.PreferencesGroup({
    title: "Paths registered per day",
    description: "A registration is Nix writing a finished path into the store database. The date is when that happened, not when the software was released.",
  });
  const chartHolder = new Gtk.Box({ hexpand: true });
  summary.add(chartHolder);
  const mapHolder = new Gtk.Box({ hexpand: true });
  const summaryRow = new Adw.ActionRow({ title: "Paths added", subtitle: "Reading the last three weeks." });
  const daysButton = new Gtk.Button({ label: "By day", valign: Gtk.Align.CENTER });
  summaryRow.add_suffix(daysButton);
  summary.add(summaryRow);
  summaryPage.add(summary);
  const summaryScroll = new Gtk.ScrolledWindow({
    child: summaryPage,
    propagate_natural_height: true,
    vexpand: false,
  });
  const browse = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  browse.append(summaryScroll);
  browse.append(mapHolder);
  browse.append(records.view);
  section.showWidget("browse", browse);
  let registrationBuckets = [];
  daysButton.connect("clicked", () => showDays(registrationBuckets, host));

  const views = new Adw.ViewStack();
  views.add_titled_with_icon(new Gtk.Box(), "largest", "Largest", "view-sort-descending-symbolic");
  views.add_titled_with_icon(new Gtk.Box(), "recent", "Recent", "document-open-recent-symbolic");
  const switcher = new Adw.ViewSwitcher({ stack: views, policy: Adw.ViewSwitcherPolicy.WIDE });
  section.header.set_title_widget(switcher);
  section.enableSearch("Store path, at least 2 characters", (text) => {
    const query = text.trim();
    if (query.length < 2) {
      if (mode === "search") loadMode(views.visible_child_name, records, section, summaryRow, (buckets) => { registrationBuckets = buckets; }, chartHolder, mapHolder);
      return;
    }
    mode = "search";
    const token = ++searchToken;
    searchPaths(query, token, () => searchToken, records, section);
  });
  let mode = "largest";
  let searchToken = 0;

  views.connect("notify::visible-child-name", () => {
    if (section.searchEntry?.get_text()) section.searchEntry.set_text("");
    mode = views.visible_child_name;
    loadMode(mode, records, section, summaryRow, (buckets) => { registrationBuckets = buckets; }, chartHolder, mapHolder);
  });

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    loadMode("largest", records, section, summaryRow, (buckets) => { registrationBuckets = buckets; }, chartHolder, mapHolder);
    return GLib.SOURCE_REMOVE;
  });

  return section;
}

/** Largest outputs, or paths registered in the last two days. */
function loadMode(mode, records, section, summaryRow, setBuckets, chartHolder, mapHolder) {
  section.showLoading(mode === "recent" ? "Reading recent paths." : "Reading the largest outputs.");
  const sql = mode === "recent" ? recentSql(2, 60) : largestSql(40);
  queryStoreAsync(histogramSql(21))
    .then((histogram) => {
      const buckets = histogramBuckets(histogram);
      setBuckets(buckets);
      summaryRow.set_subtitle(registrationSummary(buckets));
      replaceChart(chartHolder, buckets);
    })
    .catch(() => {});
  queryStoreAsync(sql)
    .then((rows) => {
      records.setRecords(rows.map(pathRecord));
      if (mode === "largest") replaceTreemap(mapHolder, rows);
      section.showWidget("browse", section.body.get_child_by_name("browse"));
    })
    .catch((error) => {
      section.showError("Could not read the store database", String(error?.message ?? error));
    });
}

/** Substring search. Drops the result if the user has typed again. */
function searchPaths(query, token, currentToken, records, section) {
  section.showLoading(`Searching for "${query}".`);
  queryStoreAsync(searchSql(query, 80))
    .then((rows) => {
      if (token !== currentToken()) return;
      records.setRecords(rows.map(pathRecord));
      section.showWidget("browse", section.body.get_child_by_name("browse"));
    })
    .catch((error) => {
      if (token !== currentToken()) return;
      section.showError("Search failed", String(error?.message ?? error));
    });
}

/** Daily registration counts for the last `days` days. */
function histogramSql(days) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return `
    SELECT (registrationTime / 86400) * 86400 AS day,
           COUNT(*) AS paths,
           COALESCE(SUM(narSize), 0) AS narBytes
    FROM ValidPaths
    WHERE registrationTime >= ${since}
    GROUP BY day
    ORDER BY day
  `;
}

/** Biggest output paths, derivations excluded. */
function largestSql(limit) {
  return `
    SELECT path, narSize, registrationTime
    FROM ValidPaths
    WHERE path NOT LIKE '%.drv'
    ORDER BY narSize DESC
    LIMIT ${Number(limit)}
  `;
}

/** Outputs registered in the last `days` days. */
function recentSql(days, limit) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return `
    SELECT path, narSize, registrationTime
    FROM ValidPaths
    WHERE registrationTime >= ${since} AND path NOT LIKE '%.drv'
    ORDER BY registrationTime DESC
    LIMIT ${Number(limit)}
  `;
}

/** Substring match, biggest first. The query is escaped for SQL strings. */
function searchSql(query, limit) {
  const text = String(query).replaceAll("'", "''");
  return `
    SELECT path, narSize, registrationTime
    FROM ValidPaths
    WHERE path LIKE '%${text}%'
    ORDER BY narSize DESC
    LIMIT ${Number(limit)}
  `;
}

/** One database row as a list record. */
function pathRecord(rowItem) {
  return {
    title: storePathName(rowItem.path),
    subtitle: `${shortStoreHash(rowItem.path)} · ${formatRelativeSeconds(Number(rowItem.registrationTime))}`,
    value: formatBytes(Number(rowItem.narSize)),
    payload: rowItem.path,
  };
}

/** The biggest paths as a treemap. Area is NAR bytes. */
function replaceTreemap(holder, rows) {
  const previous = holder.get_first_child();
  if (previous) holder.remove(previous);
  const entries = rows.slice(0, 12).map((rowItem) => ({
    label: storePathName(rowItem.path),
    bytes: Number(rowItem.narSize) || 0,
  }));
  holder.append(treemap(entries));
}

/** Swaps the registration chart for the latest buckets. */
function replaceChart(holder, buckets) {
  const previous = holder.get_first_child();
  if (previous) holder.remove(previous);
  const chart = barChart(buckets.map((bucket) => ({
    label: formatUnixSeconds(bucket.day).slice(5, 10),
    value: bucket.paths,
  })), { unit: "paths" });
  chart.add_css_class("nix-dna-chart");
  holder.append(chart);
}

/** Database rows as { day, paths, narBytes }, oldest day first. */
function histogramBuckets(rows) {
  return rows.map((rowItem) => ({
    day: Number(rowItem.day),
    paths: Number(rowItem.paths),
    narBytes: Number(rowItem.narBytes),
  }));
}

/** The one line shown above the path list. */
function registrationSummary(buckets) {
  if (buckets.length === 0) return "Nothing registered in the last three weeks.";
  const totalPaths = buckets.reduce((sum, bucket) => sum + bucket.paths, 0);
  const totalBytes = buckets.reduce((sum, bucket) => sum + bucket.narBytes, 0);
  return `${formatCount(totalPaths)} paths, ${formatBytes(totalBytes)}, last three weeks.`;
}

/** The per-day breakdown, in its own dialog so the store page has one scroll area. */
function showDays(buckets, host) {
  const dialog = new Adw.Dialog({
    title: "Paths added",
    content_width: 560,
    content_height: 480,
  });
  const page = preferencesPage("Registrations", "Paths added to the database, by day.");
  const activity = group("By day");
  if (buckets.length === 0) {
    activity.add(row("No registrations", "Nothing was registered in this window."));
  }
  for (const bucket of buckets) {
    activity.add(row(
      formatUnixSeconds(bucket.day).slice(0, 10),
      `${formatCount(bucket.paths)} paths \u00b7 ${formatBytes(bucket.narBytes)}`,
    ));
  }
  page.add(activity);
  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(new Adw.HeaderBar());
  toolbar.set_content(page);
  dialog.set_child(toolbar);
  dialog.present(host?.split?.get_content?.() ?? host);
}

/** Dialog of one store path: closure, references, referrers. */
function showPath(storePath, host) {
  const dialog = new Adw.Dialog({
    title: storePathName(storePath),
    content_width: 680,
    content_height: 480,
  });
  const page = preferencesPage(storePathName(storePath), "Closure, references, and referrers.");
  const about = group("Path");
  const refs = group("References", "The paths this one needs in order to work.");
  const referrers = group("Referrers", "The paths that need this one. No referrers means only a GC root keeps it.");
  page.add(about);
  page.add(refs);
  page.add(referrers);
  const status = new Adw.StatusPage({ title: "Reading", description: "Reading references.", child: new Adw.Spinner() });
  const stack = new Gtk.Stack({ vexpand: true });
  stack.add_named(status, "status");
  stack.add_named(page, "page");
  const toolbar = new Adw.ToolbarView();
  const header = new Adw.HeaderBar();
  header.set_title_widget(new Adw.WindowTitle({ title: storePathName(storePath) }));
  toolbar.add_top_bar(header);
  toolbar.set_content(stack);
  dialog.set_child(toolbar);
  const parent = host?.split?.get_content?.() ?? host;
  dialog.present(parent);

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    try {
      const info = readStorePathRow(storePath);
      const closure = readClosureSize(storePath);
      about.add(row("Store path", storePath));
      if (info) {
        about.add(row("NAR size", formatBytes(info.narSize)));
        about.add(row("Registered", `${formatUnixSeconds(info.registrationTime)} · ${formatRelativeSeconds(info.registrationTime)}`));
        about.add(row("Content address", info.ca || "input-addressed"));
        if (info.deriver) about.add(row("Deriver", info.deriver));
      }
      about.add(row("Closure", `${formatCount(closure.paths)} paths`, formatBytes(closure.narBytes)));
      fillRelation(refs, readStoreReferences(storePath).slice(0, 30), "This path has no references.");
      fillRelation(referrers, readStoreReferrers(storePath, 30), "Nothing in the database points here.");
      stack.set_visible_child_name("page");
    } catch (error) {
      status.set_title("Could not read path");
      status.set_description(String(error?.message ?? error));
      status.set_child(null);
    }
    return GLib.SOURCE_REMOVE;
  });
}

/** Reference or referrer rows, or one explanation when the list is empty. */
function fillRelation(preferencesGroup, paths, emptyText) {
  if (paths.length === 0) {
    preferencesGroup.add(row("None", emptyText));
    return;
  }
  for (const ref of paths) {
    preferencesGroup.add(row(storePathName(ref.path), shortStoreHash(ref.path), formatBytes(ref.narSize)));
  }
}
