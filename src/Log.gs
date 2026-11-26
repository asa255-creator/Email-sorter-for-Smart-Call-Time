/**
 * Email Sorter — the Log sheet. Newest entries at the top; each subject
 * links to the conversation in Gmail.
 */

var LOG_HEADER = ['Time', 'From', 'Subject', 'Sorted by', 'Label', 'Inbox', 'Why'];
var LOG_MAX_ROWS = 3000;

/** Stops text that starts with = + - @ from being read as a spreadsheet formula. */
function safeCell(value) {
  var s = value === null || value === undefined ? '' : String(value);
  if (s.length > 500) s = s.substring(0, 497) + '...';
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function describeInbox(decision) {
  switch (decision.action) {
    case ACTIONS.ARCHIVE: return 'Archived';
    case ACTIONS.ARCHIVE_READ: return 'Archived + read';
    case ACTIONS.KEEP_READ: return 'Kept + read';
    case ACTIONS.ARCHIVE_LATER: return 'Archive in ' + decision.days + ' day' + (decision.days === 1 ? '' : 's');
    default: return 'Kept';
  }
}

var SORTED_BY_NAMES = { you: 'You', rule: 'Rule', memory: 'Memory', claude: 'Claude' };

function logDecision(run, f, decision) {
  var label = (decision.labels || []).join(', ');
  if (decision.review) label += (label ? ', ' : '') + run.reviewLabel;
  run.logs.push({
    values: [new Date(), f.fromHeader, f.subject, SORTED_BY_NAMES[decision.by] || decision.by,
      label, describeInbox(decision), decision.reason],
    threadId: f.threadId
  });
}

function logEvent(run, kind, message, threadId, subject) {
  run.logs.push({
    values: [new Date(), '', subject || '', kind, '', '', message],
    threadId: threadId || ''
  });
}

/** Writes buffered entries in one go and trims old ones. */
function flushLog(run) {
  if (!run.logs.length) return;
  var sheet = SpreadsheetApp.getActive().getSheetByName('Log');
  if (!sheet) return;
  var entries = run.logs.slice().reverse(); // newest first
  run.logs = [];

  sheet.insertRowsAfter(1, entries.length);
  var range = sheet.getRange(2, 1, entries.length, LOG_HEADER.length);
  range.setValues(entries.map(function(e) { return e.values.map(function(v, i) { return i === 0 ? v : safeCell(v); }); }));

  var links = entries.map(function(e) {
    var text = String(e.values[2] || '');
    var builder = SpreadsheetApp.newRichTextValue().setText(text);
    if (e.threadId && text) builder.setLinkUrl('https://mail.google.com/mail/u/0/#all/' + e.threadId);
    return [builder.build()];
  });
  sheet.getRange(2, 3, entries.length, 1).setRichTextValues(links);

  var extra = sheet.getLastRow() - 1 - LOG_MAX_ROWS;
  if (extra > 0) sheet.deleteRows(LOG_MAX_ROWS + 2, extra);
}
