/**
 * Email Sorter — creating, upgrading and reading the sheets.
 *
 * Config     settings
 * Labels     your labels: what belongs in each and what happens to it
 * Rules      exact matches that run before Claude (GitHub defaults)
 * Senders    sender memory (see Senders.gs)
 * Log        what happened to each email and why
 * Start Here how it works
 */

var LABELS_HEADER = ['Label', 'What belongs here (Claude reads this)', 'Inbox action',
  'Archive after (days)', 'Claude can choose it', 'Notes'];
var V1_SHEETS = ['Queue', 'Instructions'];
// While upgrading, the v1 Labels sheet is kept under this name until the new one is filled in,
// so an interrupted upgrade never loses your label descriptions.
var LABELS_BACKUP = 'Labels (old)';

function headerStyle_(range, color) {
  range.setFontWeight('bold').setBackground(color).setFontColor('white');
}

function actionValidation_() {
  return SpreadsheetApp.newDataValidation().requireValueInList(ACTION_LIST, true).setAllowInvalid(false).build();
}

/** Checkbox display that keeps existing TRUE/FALSE values (insertCheckboxes() would reset them). */
function checkboxValidation_() {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

// ============================================================================
// CONFIG
// ============================================================================

/**
 * Creates or upgrades the Config sheet. Keeps your values, drops v1-only
 * settings, moves the API key into private storage and moves v1 models to
 * Sonnet 5.5. Returns notes about what changed.
 */
function ensureConfigSheet(ss) {
  var notes = [];
  var sheet = ss.getSheetByName('Config') || ss.insertSheet('Config');
  var existing = {};
  var extraRows = [];
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(function(r) {
      var key = String(r[0] || '').trim();
      if (!key) return;
      existing[key] = r[1];
      var known = DEFAULT_CONFIG.some(function(d) { return d[0] === key; });
      if (!known && RETIRED_CONFIG_KEYS.indexOf(key) < 0) extraRows.push([key, r[1], r[2]]);
    });
  }

  var oldKey = String(existing.claude_api_key || '').trim();
  if (oldKey.indexOf('sk-ant-') === 0) {
    if (!getApiKey()) setApiKey(oldKey);
    notes.push('Moved your Claude API key out of the Config sheet into private script storage.');
  }

  var model = String(existing.claude_model || '').trim();
  if (OLD_MODELS.indexOf(model) >= 0) {
    existing.claude_model = defaultConfigValue_('claude_model');
    notes.push('Switched the model from ' + model + ' to Claude Haiku 5.5 ($0.10/$0.50 per million tokens). ' +
      'Settings > Choose model changes it.');
  }

  if (existing.none_label && !existing.review_label) existing.review_label = existing.none_label;
  if (existing.chat_webhook_url) notes.push('Removed the old Google Chat webhook URL from the Config sheet.');

  var rows = DEFAULT_CONFIG.map(function(d) {
    var value = d[0] === 'version' ? SORTER_VERSION
      : (existing[d[0]] !== undefined && String(existing[d[0]]).trim() !== '' ? existing[d[0]] : d[1]);
    return [d[0], value, d[2]];
  }).concat(extraRows);

  // Overwrite in place, then clear what's left below, so an interruption never leaves an empty sheet.
  var all = [['Setting', 'Value', 'What it does']].concat(rows);
  var last = sheet.getLastRow();
  sheet.getRange(1, 1, all.length, 3).setValues(all);
  if (last > all.length) sheet.getRange(all.length + 1, 1, last - all.length, 3).clearContent();
  headerStyle_(sheet.getRange(1, 1, 1, 3), '#5f6368');
  sheet.getRange(2, 1, rows.length, 1).setFontWeight('bold');
  sheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 560);
  sheet.getRange('C:C').setWrap(true);
  sheet.setFrozenRows(1);
  if (sheet.isSheetHidden()) sheet.showSheet();
  _configCache = null;
  return notes;
}

// ============================================================================
// LABELS
// ============================================================================

/**
 * Creates the Labels sheet, or upgrades a v1 one. The v1 sheet is renamed
 * to LABELS_BACKUP rather than cleared, and its descriptions are returned
 * (lower-case name -> text) for syncLabelsToSheet. Running this again after
 * an interruption picks the descriptions up from the backup.
 */
function ensureLabelsSheet(ss, notes) {
  var sheet = ss.getSheetByName('Labels');
  if (sheet && sheet.getLastRow() >= 1 &&
      String(sheet.getRange(1, 2).getValue() || '').trim() !== LABELS_HEADER[1]) {
    var stale = ss.getSheetByName(LABELS_BACKUP);
    if (stale) ss.deleteSheet(stale);
    sheet.setName(LABELS_BACKUP);
    sheet = null;
    if (notes) notes.push('Rebuilt the Labels sheet with an Inbox action column. Your label descriptions were kept.');
  }
  if (!sheet) sheet = ss.getSheetByName('Labels') || ss.insertSheet('Labels');
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LABELS_HEADER.length).setValues([LABELS_HEADER]);
  }
  headerStyle_(sheet.getRange(1, 1, 1, LABELS_HEADER.length), '#1a73e8');
  sheet.setFrozenRows(1);
  return readV1Descriptions_(ss.getSheetByName(LABELS_BACKUP));
}

/** Label descriptions from a v1 Labels sheet (A = name, E = description). */
function readV1Descriptions_(sheet) {
  var out = {};
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 5) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues().forEach(function(r) {
    if (r[0] && r[4]) out[String(r[0]).toLowerCase()] = String(r[4]);
  });
  return out;
}

/** Deletes the v1 Labels backup once the new Labels sheet has been filled in. */
function removeLabelsBackup(ss) {
  var backup = ss.getSheetByName(LABELS_BACKUP);
  if (backup) ss.deleteSheet(backup);
}

function readLabelRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, LABELS_HEADER.length).getValues()
    .filter(function(r) { return String(r[0] || '').trim() !== ''; });
}

function isChecked_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/**
 * Reads the Labels sheet.
 * @returns {{ map: Object, aiList: Object[] }} map: lower-case name -> settings;
 *   aiList: labels Claude may choose, sorted by name.
 */
function readLabels() {
  var rows = readLabelRows_(SpreadsheetApp.getActive().getSheetByName('Labels'));
  var system = [getConfig('outreach_label').toLowerCase(), getConfig('review_label').toLowerCase()];
  var map = {};
  var aiList = [];
  rows.forEach(function(r) {
    var name = String(r[0]).trim();
    var days = parseInt(r[3], 10);
    var info = {
      name: name,
      description: String(r[1] || '').trim(),
      action: normalizeAction(r[2]) || ACTIONS.KEEP,
      days: isNaN(days) ? null : days,
      ai: isChecked_(r[4]) && system.indexOf(name.toLowerCase()) < 0 && isUserLabelName(name)
    };
    map[name.toLowerCase()] = info;
    if (info.ai) aiList.push({ name: name, description: info.description });
  });
  aiList.sort(function(a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  return { map: map, aiList: aiList };
}

/**
 * Brings the Labels sheet in line with Gmail. Keeps everything you typed,
 * adds new Gmail labels (staying in the inbox until you choose otherwise)
 * and keeps the sorter's two labels at the bottom.
 */
function syncLabelsToSheet(oldDescriptions) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Labels');
  if (!sheet) return 0;
  oldDescriptions = oldDescriptions || {};

  var existing = {};
  var order = [];
  readLabelRows_(sheet).forEach(function(r) {
    var key = String(r[0]).trim().toLowerCase();
    if (!existing[key]) order.push(key);
    existing[key] = r;
  });

  _labelCache = null;
  var gmail = {};
  GmailApp.getUserLabels().forEach(function(l) {
    var name = l.getName();
    if (isUserLabelName(name)) gmail[name.toLowerCase()] = name;
  });

  var outreach = getConfig('outreach_label');
  var review = getConfig('review_label');
  var systemKeys = [outreach.toLowerCase(), review.toLowerCase()];
  var rows = [];

  Object.keys(gmail).sort().forEach(function(key) {
    if (systemKeys.indexOf(key) >= 0) return;
    var prev = existing[key];
    rows.push(prev
      ? [gmail[key], prev[1] || oldDescriptions[key] || '', prev[2] || ACTIONS.KEEP, prev[3],
        prev[4] === '' ? true : isChecked_(prev[4]), '']
      : [gmail[key], oldDescriptions[key] || '', ACTIONS.KEEP, '', true, '']);
  });
  // Labels you typed into the sheet that Gmail doesn't have yet.
  order.forEach(function(key) {
    if (gmail[key] || systemKeys.indexOf(key) >= 0) return;
    var prev = existing[key];
    rows.push([prev[0], prev[1], prev[2] || ACTIONS.KEEP, prev[3], prev[4] === '' ? true : isChecked_(prev[4]),
      'Not in Gmail yet: created the first time it is used']);
  });

  var prevOutreach = existing[outreach.toLowerCase()];
  rows.push([outreach,
    'Sales and marketing emails dressed up as personal. The sorter applies this itself; Claude does not choose it.',
    prevOutreach && prevOutreach[2] ? prevOutreach[2] : ACTIONS.ARCHIVE_READ,
    prevOutreach ? prevOutreach[3] : '', false, 'Managed by the sorter']);
  rows.push([review, 'Claude was not sure about these. They always stay in the inbox.',
    ACTIONS.KEEP, '', false, 'Managed by the sorter']);

  var last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, LABELS_HEADER.length).clearContent().clearDataValidations();
  }
  sheet.getRange(2, 1, rows.length, LABELS_HEADER.length).setValues(rows.map(function(r) {
    return [safeCell(r[0]), safeCell(r[1]), r[2], r[3], r[4], r[5]];
  }));
  sheet.getRange(2, 3, rows.length, 1).setDataValidation(actionValidation_());
  sheet.getRange(2, 5, rows.length, 1).setDataValidation(checkboxValidation_());
  refreshActionDropdowns(ss);
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 460);
  sheet.setColumnWidth(3, 170);
  sheet.setColumnWidth(4, 130);
  sheet.setColumnWidth(5, 140);
  sheet.setColumnWidth(6, 260);
  sheet.getRange('B:B').setWrap(true);
  return rows.length;
}

/** Re-applies the Inbox action dropdowns on the Rules and Senders sheets, so new options show up. */
function refreshActionDropdowns(ss) {
  var rules = ss.getSheetByName('Rules');
  if (rules) rules.getRange(2, 5, Math.max(rules.getLastRow(), 101) - 1, 1).setDataValidation(actionValidation_());
  var senders = ss.getSheetByName('Senders');
  if (senders) senders.getRange('C2:C').setDataValidation(actionValidation_());
}

/** Adds or updates one label's row (used for suggestions and labels the sorter creates). */
function upsertLabelRow(name, description, action, days, note) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Labels');
  var rows = readLabelRows_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === name.toLowerCase()) {
      sheet.getRange(i + 2, 2, 1, 4).setValues([[safeCell(description || rows[i][1]), action || rows[i][2],
        days === null || days === undefined ? rows[i][3] : days, true]]);
      return;
    }
  }
  sheet.appendRow([safeCell(name), safeCell(description || ''), action || ACTIONS.KEEP,
    days === null || days === undefined ? '' : days, true, note || '']);
}

// ============================================================================
// RULES, SENDERS, LOG, START HERE
// ============================================================================

function ensureRulesSheet(ss) {
  var sheet = ss.getSheetByName('Rules');
  if (sheet) return false;
  sheet = ss.insertSheet('Rules');
  sheet.getRange(1, 1, 1, RULES_HEADER.length).setValues([RULES_HEADER]);
  headerStyle_(sheet.getRange(1, 1, 1, RULES_HEADER.length), '#188038');
  var existing = GmailApp.getUserLabels().map(function(l) { return l.getName(); });
  var rules = defaultRulesFor(existing);
  sheet.getRange(2, 1, rules.length, RULES_HEADER.length).setValues(rules);
  sheet.getRange(2, 1, 100, 1).setDataValidation(checkboxValidation_());
  sheet.getRange(2, 5, 100, 1).setDataValidation(actionValidation_());
  sheet.setFrozenRows(1);
  [50, 150, 420, 120, 170, 130, 420].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange(1, 2).setNote('From, To, Cc, Subject, Body, or the name of any email header ' +
    '(for example X-GitHub-Reason or List-Id).');
  sheet.getRange(1, 3).setNote('Case does not matter. Separate alternatives with |.');
  sheet.getRange(1, 5).setNote('Leave blank to use the label\'s Inbox action from the Labels sheet.');
  return true;
}

function ensureSendersSheet(ss) {
  var sheet = ss.getSheetByName('Senders');
  if (sheet) return false;
  sheet = ss.insertSheet('Senders');
  sheet.getRange(1, 1, 1, SENDERS_HEADER.length).setValues([SENDERS_HEADER]);
  headerStyle_(sheet.getRange(1, 1, 1, SENDERS_HEADER.length), '#9334e6');
  sheet.setFrozenRows(1);
  sheet.getRange('C2:C').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ACTION_LIST, true).setAllowInvalid(false).build());
  sheet.getRange('D2:D').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SENDER_TYPES, true).setAllowInvalid(true).build());
  sheet.getRange('G2:G').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SENDER_SOURCES, true).setAllowInvalid(true).build());
  [260, 160, 160, 110, 90, 100, 90, 120, 110, 110, 360].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange(1, 1).setNote('An address, or @domain.com for everyone at a domain.');
  sheet.getRange(1, 7).setNote('you = your choice, always followed. Editing Label, Inbox action or Type ' +
    'sets this to "you" automatically.');
  return true;
}

function isCurrentLog_(sheet) {
  return !!sheet && String(sheet.getRange(1, 4).getValue()) === LOG_HEADER[3];
}

function ensureLogSheet(ss) {
  var sheet = ss.getSheetByName('Log');
  if (isCurrentLog_(sheet)) return;
  if (sheet) ss.deleteSheet(sheet);   // an old-format log: nothing in it is needed
  sheet = ss.insertSheet('Log');
  sheet.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]);
  headerStyle_(sheet.getRange(1, 1, 1, LOG_HEADER.length), '#d93025');
  sheet.setFrozenRows(1);
  [140, 240, 340, 90, 150, 120, 480].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange('A:A').setNumberFormat('MMM d, h:mm am/pm');
}

function ensureStartHereSheet(ss) {
  var sheet = ss.getSheetByName('Start Here') || ss.insertSheet('Start Here', 0);
  sheet.clear();
  var lines = [
    ['Email Sorter ' + SORTER_VERSION],
    [''],
    ['Every few minutes (run_every_minutes on Config) it sorts new inbox mail in this order. The first step with an answer wins:'],
    ['  1. Your own choices (Senders sheet, Source = you)'],
    ['  2. Rules (Rules sheet). GitHub notifications are handled here, no AI involved.'],
    ['  3. Senders it has learned (Senders sheet)'],
    ['  4. Claude, which also decides whether a "personal" email is really a sales sequence'],
    [''],
    ['Mail from people you have emailed, or conversations you wrote in, is never archived.'],
    [''],
    ['What happens to each label is set on the Labels sheet, in the Inbox action column:'],
    ['  Keep in inbox | Archive | Archive + mark read | Archive after days'],
    ['New labels start as "Keep in inbox", so nothing leaves your inbox until you choose.'],
    [''],
    ['Teach it from Gmail, including on your phone:'],
    ['  Apply "Sorter/Always keep" to an email: that sender is never archived again.'],
    ['  Apply "Sorter/Always archive" to an email: that sender is always archived (good for HubSpot-style sales mail).'],
    ['  Move something the sorter archived back to the inbox: that sender\'s mail stays in the inbox from now on.'],
    ['  (Search label:sorter-archived to see everything it archived. Its labels are hidden from your sidebar.)'],
    ['An email can get several labels. It only leaves the inbox if every one of its labels says to archive it.'],
    [''],
    ['  Change or add a label on something it sorted: it is noted on the Corrections sheet and Claude learns from it.'],
    ['    For automated senders (receipts, alerts, newsletters) their future mail follows your new label.'],
    [''],
    ['New labels: when Claude keeps wanting a label you don\'t have (often a sub-label like Finance/Receipts),'],
    ['the sorter creates it and files those emails there. New labels keep mail in the inbox until you choose.'],
    [''],
    ['Every decision and its reason is on the Log sheet. Click a subject to open the email.'],
    ['Not sure which labels you need? Email Sorter > Suggest labels from my mail.']
  ];
  sheet.getRange(1, 1, lines.length, 1).setValues(lines);
  sheet.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  sheet.setColumnWidth(1, 900);
  return sheet;
}

/**
 * Deletes the v1 sheets the sorter no longer uses: Queue (it kept copies of
 * email bodies), Instructions, and the old-format Log (v1 never trimmed it).
 * Done first during an upgrade, because a large old file is what makes
 * Google Sheets time out. Returns their names.
 */
function removeV1Sheets(ss) {
  var removed = [];
  V1_SHEETS.concat(['Log']).forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || ss.getSheets().length <= 1) return;
    if (name === 'Log' && isCurrentLog_(sheet)) return;
    ss.deleteSheet(sheet);
    SpreadsheetApp.flush();
    removed.push(name === 'Log' ? 'old Log' : name);
  });
  return removed;
}

function readRules() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Rules');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return parseRules(sheet.getRange(2, 1, sheet.getLastRow() - 1, RULES_HEADER.length).getValues());
}
