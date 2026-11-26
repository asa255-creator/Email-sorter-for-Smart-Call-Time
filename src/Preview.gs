/**
 * Email Sorter — Preview and Re-sort.
 *
 * Preview runs the same decisions the sorter makes on the newest inbox
 * conversations (sorted or not) and writes them to a Preview sheet. It
 * changes nothing in Gmail and learns nothing.
 *
 * Re-sort sorts the conversations already in your inbox again, with your
 * current labels, descriptions and rules. It adds labels and applies inbox
 * actions; it never removes a label.
 */

var PREVIEW_MAX = 50;
var PREVIEW_HEADER = ['From', 'Subject', 'Labels now', 'Would label', 'Would do', 'Decided by', 'Why'];
var RESORT_MAX = 1000;

function previewSort() {
  var ui = SpreadsheetApp.getUi();
  var days = getConfigNumber('backfill_days');
  var ok = ui.alert('Preview sorting',
    'Shows what the sorter would do with the ' + PREVIEW_MAX + ' newest conversations in your inbox from the last ' +
    days + ' days, including ones it has already sorted.\n\n' +
    'Nothing in Gmail changes and nothing is learned. Emails that rules and memory can\'t decide are sent to ' +
    'Claude (with Haiku, roughly 2 cents for 50). Takes 1 to 3 minutes.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  var preview = buildPreview(PREVIEW_MAX, days);
  writePreview_(preview.rows);
  var archived = preview.rows.filter(function(r) { return /^Archive/.test(r.would); }).length;
  var changed = preview.rows.filter(function(r) { return r.changed; }).length;
  ui.alert('Preview ready',
    'Looked at ' + preview.rows.length + ' conversations. ' + archived + ' would leave the inbox (now or later) and ' +
    changed + ' would get different labels from the ones they have now (highlighted).\n\n' +
    'If it looks right, Email Sorter > Re-sort inbox applies it. Otherwise fix the descriptions or rules and ' +
    'preview again.', ui.ButtonSet.OK);
}

/** Decides every conversation without touching Gmail or the sheets. */
function buildPreview(max, days) {
  var run = startRun_(loadState(), Date.now());
  var rows = [];
  GmailApp.search('in:inbox newer_than:' + days + 'd', 0, max).forEach(function(thread) {
    if (!timeLeft_(run)) return;
    var f = buildThreadFeatures(thread, run.mineList, run.outreachSignals);
    var current = leafLabels(userLabelsOf(thread, []));
    var row = { from: f.fromHeader, subject: f.subject, threadId: f.threadId, now: current.join(', ') };
    try {
      var d = decideThread_(run, f, false).decision;
      var labels = (d.labels || []).concat(d.review ? [run.reviewLabel] : []);
      row.labels = labels;
      row.would = d.action + (d.action === ACTIONS.ARCHIVE_LATER ? ' (' + d.days + ')' : '');
      row.by = SORTED_BY_NAMES[d.by] || d.by;
      row.why = d.reason;
      row.changed = !sameLabels(leafLabels(labels), current);
    } catch (e) {
      if (e.kind === 'fatal' || e.kind === 'busy') run.claudeBlocked = e.message;
      row.labels = [];
      row.would = 'Not decided';
      row.by = 'Error';
      row.why = e.message;
      row.changed = false;
    }
    rows.push(row);
  });
  return { rows: rows, stats: run.stats };
}

function writePreview_(rows) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Preview') || ss.insertSheet('Preview');
  sheet.clear();
  sheet.getRange(1, 1, 1, PREVIEW_HEADER.length).setValues([PREVIEW_HEADER]);
  headerStyle_(sheet.getRange(1, 1, 1, PREVIEW_HEADER.length), '#5f6368');
  sheet.setFrozenRows(1);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, PREVIEW_HEADER.length).setValues(rows.map(function(r) {
      return [safeCell(r.from), safeCell(r.subject), safeCell(r.now), safeCell(r.labels.join(', ')), r.would,
        r.by, safeCell(r.why)];
    }));
    sheet.getRange(2, 2, rows.length, 1).setRichTextValues(rows.map(function(r) {
      return [SpreadsheetApp.newRichTextValue().setText(String(r.subject || ''))
        .setLinkUrl('https://mail.google.com/mail/u/0/#all/' + r.threadId).build()];
    }));
    sheet.getRange(2, 4, rows.length, 1).setBackgrounds(rows.map(function(r) {
      return [r.changed ? '#fef7e0' : null];
    }));
  }
  [220, 320, 200, 220, 170, 90, 420].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  ss.setActiveSheet(sheet);
}

function resortInbox() {
  var ui = SpreadsheetApp.getUi();
  var days = getConfigNumber('backfill_days');
  var ok = ui.alert('Re-sort inbox',
    'Sorts the conversations in your inbox from the last ' + days + ' days again, using your current labels, ' +
    'descriptions and rules, and applies their Inbox actions, so some may be archived or marked read.\n\n' +
    'It adds labels but never removes any. Tip: run Preview sorting first.\n\n' +
    'It works through them ' + getConfigNumber('max_threads_per_run') + ' at a time, every few minutes. ' +
    'Watch the Log sheet.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  var queued = markInboxUnsorted(days);
  var stats = runSorter_({});
  ui.alert('Re-sorting',
    queued + ' conversation' + (queued === 1 ? '' : 's') + ' queued; ' + (stats.sorted || 0) +
    ' sorted so far. The rest follow automatically every ' + runInterval_() + ' minute' +
    (runInterval_() === 1 ? '' : 's') + '. Details are on the Log sheet.', ui.ButtonSet.OK);
}

/** Takes the "sorted" marker off inbox conversations so the next runs sort them again. */
function markInboxUnsorted(days) {
  var label = findLabel(SORTER_LABELS.SORTED);
  if (!label) return 0;
  var state = loadState();
  var total = 0;
  var query = 'in:inbox ' + labelSearchTerm(SORTER_LABELS.SORTED) + ' newer_than:' + days + 'd';
  while (total < RESORT_MAX) {
    var threads = GmailApp.search(query, 0, 100);
    if (!threads.length) break;
    label.removeFromThreads(threads);
    threads.forEach(function(t) {
      stateDelete(state, STATE_PREFIX.SEEN, t.getId());
      stateDelete(state, STATE_PREFIX.DUE, t.getId());
    });
    total += threads.length;
  }
  saveState(state);
  return total;
}
