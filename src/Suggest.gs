/**
 * Email Sorter — label suggestions.
 *
 * Reads who emailed you over the last 60 days (sender, subject, whether it
 * came from a mailing list, which labels you used; never the body), asks
 * Claude for a label set with inbox actions, and writes it to a
 * Suggestions sheet. Nothing changes in Gmail until you tick rows and
 * choose "Apply checked suggestions".
 */

var SUGGEST_DAYS = 60;
var SUGGEST_MAX_THREADS = 400;
var SUGGEST_TIME_MS = 150 * 1000;
var SUGGEST_LABEL_HEADER = ['Apply', 'Label', 'What belongs here', 'Inbox action', 'Archive after (days)', 'Already exists'];
var SUGGEST_SENDER_HEADER = ['Apply', 'Sender', 'Label'];

function suggestLabels() {
  var ui = SpreadsheetApp.getUi();
  if (!getApiKey()) {
    ui.alert('Claude API key needed', 'Set one first: Email Sorter > Settings > Set Claude API key.', ui.ButtonSet.OK);
    return;
  }
  var ok = ui.alert('Suggest labels',
    'This reads the sender and subject (not the body) of up to ' + SUGGEST_MAX_THREADS +
    ' conversations from the last ' + SUGGEST_DAYS + ' days, sends that summary to Claude, and writes ' +
    'suggested labels and sender assignments to a Suggestions sheet.\n\n' +
    'Nothing in Gmail changes until you tick suggestions and choose Apply checked suggestions.\n\n' +
    'Takes 1 to 3 minutes.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  var summary = collectMailSummary_();
  if (summary.senders.length === 0) {
    ui.alert('Nothing to go on', 'No mail from the last ' + SUGGEST_DAYS + ' days was found.', ui.ButtonSet.OK);
    return;
  }
  var labels = readLabels();
  var existing = Object.keys(labels.map).map(function(k) { return labels.map[k]; })
    .filter(function(l) { return isUserLabelName(l.name); });

  var answer;
  try {
    answer = callClaudeJson(SUGGEST_SYSTEM_PROMPT, buildSuggestMessage(summary, existing),
      buildSuggestSchema(), { effort: 'low', maxTokens: 8000 });
  } catch (e) {
    ui.alert('Claude could not make suggestions', e.message, ui.ButtonSet.OK);
    return;
  }
  writeSuggestions_(answer.result, existing);
  ui.alert('Suggestions ready',
    'Looked at ' + summary.threads + ' conversations from ' + summary.senders.length + ' senders.\n\n' +
    'Review the Suggestions sheet, untick anything you don\'t want, adjust names or inbox actions, ' +
    'then choose Email Sorter > Apply checked suggestions.', ui.ButtonSet.OK);
}

var SUGGEST_SYSTEM_PROMPT = [
  'You help one person organize their Gmail. You get a summary of who emailed them in the last ' + SUGGEST_DAYS +
  ' days and the labels they already have. Propose a small set of labels (5 to 15) so that their inbox holds ' +
  'only mail that needs them, and everything else is filed where they can find it.',
  '',
  'Reuse existing labels where they fit: set already_exists to true and keep the exact name. Suggest new ' +
  'labels only for real gaps. Leave out existing labels that look unused or redundant.',
  '',
  'Use sub-labels, written Parent/Child, to group related labels. Where the person already has a parent ' +
  'label, put new labels for the same area under it (for example Work/Clients next to an existing Work/Tech). ' +
  'Go at most two levels deep, and do not create a parent that would hold only one child.',
  '',
  'Give every label a one-sentence description of what belongs in it, written so that another assistant can ' +
  'sort new email by it.',
  '',
  'inbox_action is what happens to new mail with that label:',
  '- "Keep in inbox" for mail from people and anything the person must act on.',
  '- "Keep in inbox + mark read" for things worth seeing in the inbox that never need to show as unread.',
  '- "Archive + mark read" for noise nobody reads.',
  '- "Archive" for mail worth keeping but not worth seeing.',
  '- "Archive after days" for mail that matters for a few days, like shipping updates or notifications; ' +
  'set archive_after_days (usually 2 to 7). Use 0 for every other action.',
  'Mail from individual people the person writes to always stays in the inbox, so never make a label whose ' +
  'purpose is to archive people.',
  '',
  'senders: assign up to 60 of the most frequent automated or list senders to one of your labels. Leave out ' +
  'individual people.',
  '',
  'notes: two or three plain sentences on what you noticed, such as the biggest sources of clutter.'
].join('\n');

function buildSuggestSchema() {
  return {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            inbox_action: { type: 'string', enum: ACTION_LIST.slice() },
            archive_after_days: { type: 'integer' },
            already_exists: { type: 'boolean' }
          },
          required: ['name', 'description', 'inbox_action', 'archive_after_days', 'already_exists'],
          additionalProperties: false
        }
      },
      senders: {
        type: 'array',
        items: {
          type: 'object',
          properties: { sender: { type: 'string' }, label: { type: 'string' } },
          required: ['sender', 'label'],
          additionalProperties: false
        }
      },
      notes: { type: 'string' }
    },
    required: ['labels', 'senders', 'notes'],
    additionalProperties: false
  };
}

/** Sender-level summary of recent mail. */
function collectMailSummary_() {
  var started = Date.now();
  var mine = {};
  getMyAddresses().forEach(function(a) { mine[a] = true; });
  var bySender = {};
  var threads = 0;
  var query = 'newer_than:' + SUGGEST_DAYS + 'd -in:sent -in:chats -in:spam -in:trash';

  for (var start = 0; start < SUGGEST_MAX_THREADS && Date.now() - started < SUGGEST_TIME_MS; start += 100) {
    var page = GmailApp.search(query, start, 100);
    if (page.length === 0) break;
    for (var i = 0; i < page.length && Date.now() - started < SUGGEST_TIME_MS; i++) {
      addThreadToSummary_(page[i], mine, bySender);
      threads++;
    }
  }
  var senders = Object.keys(bySender).map(function(k) { return bySender[k]; })
    .sort(function(a, b) { return b.count - a.count || (a.email < b.email ? -1 : 1); });
  return { threads: threads, senders: senders };
}

function addThreadToSummary_(thread, mine, bySender) {
  var messages = thread.getMessages();
  var latest = null;
  var youWrote = false;
  for (var i = messages.length - 1; i >= 0; i--) {
    var email = parseAddress(messages[i].getFrom()).email;
    if (mine[email]) youWrote = true;
    else if (!latest) latest = messages[i];
  }
  if (!latest) return;
  var from = parseAddress(latest.getFrom());
  if (!from.email) return;
  var s = bySender[from.email];
  if (!s) {
    s = bySender[from.email] = { email: from.email, name: from.name, count: 0, subjects: [], list: false,
      repliedTo: false, inbox: 0, labels: {} };
  }
  s.count++;
  var subject = String(latest.getSubject() || '').substring(0, 80);
  if (subject && s.subjects.length < 3 && s.subjects.indexOf(subject) < 0) s.subjects.push(subject);
  if (!s.list) {
    try { s.list = !!latest.getHeader('List-Unsubscribe'); } catch (e) { /* ignore */ }
  }
  if (youWrote) s.repliedTo = true;
  if (thread.isInInbox()) s.inbox++;
  thread.getLabels().forEach(function(l) {
    var n = l.getName();
    if (isUserLabelName(n)) s.labels[n] = (s.labels[n] || 0) + 1;
  });
}

/** The summary as compact text: one line per sender. */
function buildSuggestMessage(summary, existingLabels) {
  var lines = ['Existing labels:'];
  if (existingLabels.length === 0) lines.push('(none)');
  existingLabels.forEach(function(l) {
    lines.push('- ' + l.name + (l.description ? ': ' + l.description : ''));
  });
  lines.push('', 'Senders in the last ' + SUGGEST_DAYS + ' days (' + summary.threads + ' conversations), most frequent first:');

  var top = summary.senders.slice(0, 200);
  top.forEach(function(s) {
    var facts = [s.count + ' conversation' + (s.count === 1 ? '' : 's')];
    if (s.list) facts.push('mailing list');
    if (s.repliedTo) facts.push('you replied');
    facts.push(s.inbox + ' still in inbox');
    var used = Object.keys(s.labels);
    if (used.length) facts.push('labels: ' + used.join(', '));
    lines.push('- ' + s.email + (s.name ? ' (' + s.name + ')' : '') + ': ' + facts.join('; ') +
      (s.subjects.length ? ' | e.g. ' + s.subjects.map(function(x) { return '"' + x + '"'; }).join(', ') : ''));
  });
  var rest = summary.senders.length - top.length;
  if (rest > 0) lines.push('(' + rest + ' more senders with fewer emails not shown)');
  return lines.join('\n');
}

function writeSuggestions_(result, existingLabels) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Suggestions') || ss.insertSheet('Suggestions');
  sheet.clear();
  sheet.getDataRange().clearDataValidations();

  var existing = {};
  existingLabels.forEach(function(l) { existing[l.name.toLowerCase()] = true; });
  var labels = (result.labels || []).filter(function(l) { return l && l.name; });
  var senders = (result.senders || []).filter(function(s) { return s && s.sender && s.label; });

  sheet.getRange(1, 1).setValue('Suggestions from Claude. Untick what you don\'t want, edit anything, then choose ' +
    'Email Sorter > Apply checked suggestions. Nothing changes in Gmail until then.').setFontWeight('bold');
  sheet.getRange(2, 1).setValue(safeCell(result.notes || ''));

  var r = 4;
  sheet.getRange(r, 1, 1, SUGGEST_LABEL_HEADER.length).setValues([SUGGEST_LABEL_HEADER]);
  headerStyle_(sheet.getRange(r, 1, 1, SUGGEST_LABEL_HEADER.length), '#1a73e8');
  if (labels.length) {
    sheet.getRange(r + 1, 1, labels.length, SUGGEST_LABEL_HEADER.length).setValues(labels.map(function(l) {
      var action = normalizeAction(l.inbox_action) || ACTIONS.KEEP;
      return [true, safeCell(l.name), safeCell(l.description), action,
        action === ACTIONS.ARCHIVE_LATER ? (l.archive_after_days || DEFAULT_ARCHIVE_DAYS) : '',
        existing[String(l.name).toLowerCase()] ? 'yes' : 'no'];
    }));
    sheet.getRange(r + 1, 1, labels.length, 1).setDataValidation(checkboxValidation_());
    sheet.getRange(r + 1, 4, labels.length, 1).setDataValidation(actionValidation_());
  }

  r = r + labels.length + 2;
  sheet.getRange(r, 1, 1, SUGGEST_SENDER_HEADER.length).setValues([SUGGEST_SENDER_HEADER]);
  headerStyle_(sheet.getRange(r, 1, 1, SUGGEST_SENDER_HEADER.length), '#9334e6');
  if (senders.length) {
    sheet.getRange(r + 1, 1, senders.length, SUGGEST_SENDER_HEADER.length).setValues(senders.map(function(s) {
      return [true, safeCell(String(s.sender).toLowerCase()), safeCell(s.label)];
    }));
    sheet.getRange(r + 1, 1, senders.length, 1).setDataValidation(checkboxValidation_());
  }
  [60, 280, 520, 170, 140, 110].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange('C:C').setWrap(true);
  ss.setActiveSheet(sheet);
}

/** Splits the Suggestions sheet back into its two tables. */
function parseSuggestionsSheet(values) {
  var labels = [];
  var senders = [];
  var section = '';
  values.forEach(function(row) {
    var a = String(row[0]);
    var b = String(row[1] || '').trim();
    if (a === 'Apply' && b === 'Label') { section = 'labels'; return; }
    if (a === 'Apply' && b === 'Sender') { section = 'senders'; return; }
    if (!b) return;
    if (!isChecked_(row[0])) return;
    if (section === 'labels') {
      var days = parseInt(row[4], 10);
      labels.push({ name: b, description: String(row[2] || '').trim(),
        action: normalizeAction(row[3]) || ACTIONS.KEEP, days: isNaN(days) ? null : days });
    } else if (section === 'senders') {
      senders.push({ sender: b.toLowerCase(), label: String(row[2] || '').trim() });
    }
  });
  return { labels: labels, senders: senders };
}

function applySuggestions() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Suggestions');
  if (!sheet || sheet.getLastRow() < 2) {
    ui.alert('No suggestions', 'Run Email Sorter > Suggest labels from my mail first.', ui.ButtonSet.OK);
    return;
  }
  var parsed = parseSuggestionsSheet(sheet.getRange(1, 1, sheet.getLastRow(), 6).getValues());

  parsed.labels.forEach(function(l) {
    ensureLabel(l.name, null, true); // you ticked it, so its parent may be created too
    upsertLabelRow(l.name, l.description, l.action, l.action === ACTIONS.ARCHIVE_LATER ? l.days : '');
  });
  syncLabelsToSheet();

  var labels = readLabels();
  var store = loadSenders();
  var assigned = 0;
  var skipped = 0;
  parsed.senders.forEach(function(s) {
    var known = labels.map[s.label.toLowerCase()];
    var row = store.byKey[s.sender];
    if (!known || (row && (row.source === 'you' || row.source === 'rescued'))) { skipped++; return; }
    teachSender(store, s.sender, { source: 'suggested', labels: [known.name], action: '',
      note: 'From suggestions on ' + formatDate_(new Date()).substring(0, 10) }, Date.now());
    assigned++;
  });
  saveSenders(store);

  ui.alert('Suggestions applied',
    parsed.labels.length + ' label' + (parsed.labels.length === 1 ? '' : 's') + ' added or updated, ' +
    assigned + ' sender' + (assigned === 1 ? '' : 's') + ' assigned' +
    (skipped ? ' (' + skipped + ' skipped: unknown label, or you already chose for that sender)' : '') + '.\n\n' +
    'Check the Inbox action of each label on the Labels sheet. New mail is sorted with these from now on.',
    ui.ButtonSet.OK);
}
