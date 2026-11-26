/**
 * Email Sorter — sender memory (the Senders sheet).
 *
 * One row per sender. It records how the sorter has handled them, whether
 * you have ever emailed them, and any choice you made yourself. The
 * "learning" is this table: no hidden model, just rows you can read and edit.
 *
 * Source column:
 *   you        you chose (Sorter labels in Gmail, or you edited the row). Always followed.
 *   rescued    you moved their mail back to the inbox. Their mail stays in the inbox.
 *   suggested  you accepted it from Suggestions. Followed.
 *   claude     Claude's decisions. Followed without asking Claude once it agrees
 *              with itself learn_after times in a row (automated/bulk/outreach only).
 *
 * A row for "@example.com" applies to everyone at that domain who has no row of their own.
 */

var SENDERS_HEADER = ['Sender', 'Labels (use | for several)', 'Inbox action', 'Type', 'Times seen', 'Times agreed',
  'Source', 'You emailed them', 'Checked', 'Last seen', 'Note'];
var SENDER_SOURCES = ['you', 'rescued', 'suggested', 'claude'];
var KNOWN_CONTACT_RECHECK_MS = 14 * DAY_MS;

function newSenderRow_(sender) {
  return {
    index: null, sender: sender, labels: [], action: '', type: '', seen: 0, agreed: 0,
    source: '', emailed: '', checked: null, lastSeen: null, note: ''
  };
}

function rowFromValues_(v, index) {
  return {
    index: index,
    sender: String(v[0] || '').trim().toLowerCase(),
    labels: splitLabels(v[1]),
    action: normalizeAction(v[2]),
    type: String(v[3] || '').trim().toLowerCase(),
    seen: parseInt(v[4], 10) || 0,
    agreed: parseInt(v[5], 10) || 0,
    source: String(v[6] || '').trim().toLowerCase(),
    emailed: String(v[7] || '').trim().toLowerCase(),
    checked: v[8] instanceof Date ? v[8] : (v[8] ? new Date(v[8]) : null),
    lastSeen: v[9] instanceof Date ? v[9] : (v[9] ? new Date(v[9]) : null),
    note: String(v[10] || '')
  };
}

function valuesFromRow_(r) {
  return [safeCell(r.sender), safeCell(joinLabels(r.labels)), r.action, r.type, r.seen, r.agreed, r.source,
    r.emailed, r.checked || '', r.lastSeen || '', safeCell(r.note)];
}

/** Builds an in-memory store from sheet values (header excluded). */
function makeSenderStore(values) {
  var store = { rows: [], byKey: {}, dirty: [] };
  (values || []).forEach(function(v, i) {
    var row = rowFromValues_(v, i + 2);
    if (!row.sender) return;
    store.rows.push(row);
    store.byKey[row.sender] = row;
  });
  return store;
}

function loadSenders() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Senders');
  var values = [];
  if (sheet && sheet.getLastRow() > 1) {
    values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SENDERS_HEADER.length).getValues();
  }
  return makeSenderStore(values);
}

/** Exact address first, then a "@domain" row. */
function findSender(store, email) {
  if (!email) return null;
  return store.byKey[email] || store.byKey['@' + domainOf(email)] || null;
}

/** The row for exactly this address, created if missing. */
function upsertSender(store, email) {
  var row = store.byKey[email];
  if (!row) {
    row = newSenderRow_(email);
    store.rows.push(row);
    store.byKey[email] = row;
  }
  markSenderDirty(store, row);
  return row;
}

function markSenderDirty(store, row) {
  if (store.dirty.indexOf(row) < 0) store.dirty.push(row);
}

/** Counts a sighting. */
function touchSender(store, email, now) {
  if (!email) return;
  var row = upsertSender(store, email);
  row.seen += 1;
  row.lastSeen = new Date(now);
}

/**
 * Records what Claude decided so repeat senders can skip Claude.
 * Choices made by you are never overwritten.
 */
function rememberClaudeDecision(store, email, decision) {
  if (!email) return;
  var row = upsertSender(store, email);
  if (row.source && row.source !== 'claude') return;

  var consistent = decision.confidence !== 'low' && !decision.needsAttention;
  var same = row.source === 'claude' && sameLabels(row.labels, decision.labels) && row.type === decision.type;
  row.source = 'claude';
  row.labels = (decision.labels || []).slice();
  row.type = decision.type;
  row.action = '';            // follows the label's Inbox action on the Labels sheet
  row.agreed = consistent ? (same ? row.agreed + 1 : 1) : 0;
}

/** Records a choice you made yourself. */
function teachSender(store, email, fields, now) {
  if (!email) return null;
  var row = upsertSender(store, email);
  Object.keys(fields).forEach(function(k) { row[k] = fields[k]; });
  row.agreed = 0;
  row.lastSeen = new Date(now);
  return row;
}

/** Writes changed and new rows back to the sheet. */
function saveSenders(store) {
  if (!store.dirty.length) return;
  var sheet = SpreadsheetApp.getActive().getSheetByName('Senders');
  if (!sheet) return;

  // Rows may have moved if you sorted the sheet during the run; re-find them.
  var where = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(v, i) {
      where[String(v[0] || '').trim().toLowerCase()] = i + 2;
    });
  }

  var appended = [];
  store.dirty.forEach(function(row) {
    var at = where[row.sender];
    if (at) {
      sheet.getRange(at, 1, 1, SENDERS_HEADER.length).setValues([valuesFromRow_(row)]);
      row.index = at;
    } else {
      appended.push(row);
    }
  });
  if (appended.length) {
    var start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, appended.length, SENDERS_HEADER.length)
      .setValues(appended.map(valuesFromRow_));
    appended.forEach(function(row, i) { row.index = start + i; });
  }
  store.dirty = [];
}

/**
 * Whether you have emailed this sender, using the cached answer when it is
 * recent and searching your Sent mail otherwise.
 */
function isKnownContact(store, email, mine, now, searchFn) {
  if (!email) return false;
  if (mine[email]) return true;
  var row = store.byKey[email];
  if (row && row.emailed === 'yes') return true;
  if (row && row.emailed === 'no' && row.checked && now - row.checked.getTime() < KNOWN_CONTACT_RECHECK_MS) {
    return false;
  }
  var yes = (searchFn || hasEmailedAddress)(email);
  row = upsertSender(store, email);
  row.emailed = yes ? 'yes' : 'no';
  row.checked = new Date(now);
  return yes;
}

/** Your own choices, for Claude's instructions. Sorted so the prompt stays cache-friendly. */
function senderCorrections(store, max) {
  return store.rows
    .filter(function(r) { return r.source === 'you' || r.source === 'rescued'; })
    .sort(function(a, b) { return a.sender < b.sender ? -1 : 1; })
    .slice(0, max || 25)
    .map(function(r) {
      var m = r.note.match(/"([^"]{1,100})"\s*$/);
      var choice = r.action === ACTIONS.KEEP || r.source === 'rescued'
        ? 'keep in the inbox'
        : (r.action ? r.action.toLowerCase() : 'file');
      if (r.labels.length) choice += ', labels ' + r.labels.join(', ');
      return { sender: r.sender, subject: m ? m[1] : '', choice: choice };
    });
}
