/**
 * Email Sorter — learning that goes beyond single senders.
 *
 * 1. New labels. While sorting, Claude may suggest a label (often a
 *    sub-label such as Finance/Receipts) when nothing fits. Once the same
 *    idea comes up for new_label_after different emails, the sorter creates
 *    the label, files those emails under it, and offers it to Claude from
 *    then on.
 *
 * 2. Labels you change. The sorter remembers which label it chose for each
 *    conversation. If you swap it for another label in Gmail, that is
 *    recorded on the Corrections sheet and shown to Claude as an example.
 *    For automated and bulk senders it also files that sender's future mail
 *    under your label.
 */

var IDEAS_STATUS_KEY = 'label_ideas';
var MAX_IDEAS = 20;
var CORRECTIONS_HEADER = ['Time', 'Sender', 'Subject', 'Sorter chose', 'You chose'];
var CORRECTIONS_MAX_ROWS = 300;
var RELABEL_GRACE_MS = 30 * 60 * 1000;   // give you time to finish re-labelling
var RELABEL_CHECKS_PER_SWEEP = 80;

// ============================================================================
// LABEL IDEAS
// ============================================================================

/** Cleans up a suggested label name; returns '' if it can't be used. */
function normalizeLabelName(name) {
  var n = String(name || '')
    .replace(/\s+/g, ' ')
    .split('/').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; })
    .join('/');
  if (!n || n.length > 60 || n.toUpperCase() === 'NONE' || !isUserLabelName(n)) return '';
  return n;
}

function loadIdeas() {
  try { return JSON.parse(getStatus(IDEAS_STATUS_KEY) || '{}'); } catch (e) { return {}; }
}

function saveIdeas(ideas) {
  setStatus(IDEAS_STATUS_KEY, JSON.stringify(ideas));
}

/**
 * Counts one suggestion of a label for one conversation. The same
 * conversation is only counted once. Returns the idea when it has been
 * suggested for at least `threshold` different conversations.
 */
function addLabelIdea(ideas, name, description, threadId, now, threshold) {
  var key = name.toLowerCase();
  var idea = ideas[key];
  if (!idea) {
    idea = ideas[key] = { name: name, description: '', threads: [], count: 0, first: now };
  }
  idea.last = now;
  if (description && !idea.description) idea.description = String(description).substring(0, 200);
  if (threadId && idea.threads.indexOf(threadId) < 0) {
    idea.threads.push(threadId);
    idea.count++;
    if (idea.threads.length > 5) idea.threads.shift();
  }
  pruneIdeas_(ideas, now);
  return ideas[key] && idea.count >= threshold ? idea : null;
}

/** Keeps the idea store small: drops ideas not seen for 30 days, then the weakest. */
function pruneIdeas_(ideas, now) {
  Object.keys(ideas).forEach(function(k) {
    if (now - (ideas[k].last || 0) > 30 * DAY_MS) delete ideas[k];
  });
  var keys = Object.keys(ideas);
  if (keys.length <= MAX_IDEAS) return;
  keys.sort(function(a, b) { return (ideas[a].count - ideas[b].count) || (ideas[a].last - ideas[b].last); })
    .slice(0, keys.length - MAX_IDEAS)
    .forEach(function(k) { delete ideas[k]; });
}

/** Called after Claude sorted an email and suggested a new label for it. */
function considerLabelIdea(run, ai, f) {
  var name = ai.new_label;
  if (!name || ai.sender_type === 'cold_outreach') return;
  if (run.labels.map[name.toLowerCase()] || findLabel(name)) return; // already a label
  // Only sub-labels of a label you already have: the sorter never invents a parent label.
  var slash = name.lastIndexOf('/');
  if (slash > 0 && !findLabel(name.substring(0, slash))) return;
  if (!run.ideas) run.ideas = loadIdeas();
  var idea = addLabelIdea(run.ideas, name, ai.new_label_description, f.threadId, run.now,
    getConfigNumber('new_label_after'));
  run.ideasDirty = true;
  if (!idea) return;

  if (String(getConfig('auto_create_labels')).toLowerCase().indexOf('y') !== 0) {
    if (!idea.announced) {
      idea.announced = true;
      logEvent(run, 'Label idea', 'Claude has suggested "' + idea.name + '" for ' + idea.count +
        ' emails (' + (idea.description || 'no description') + '). Create it in Gmail, or set ' +
        'auto_create_labels to yes on the Config sheet.', f.threadId, f.subject);
    }
    return;
  }
  createLabelFromIdea_(run, idea);
}

function createLabelFromIdea_(run, idea) {
  ensureLabel(idea.name);
  upsertLabelRow(idea.name, idea.description, ACTIONS.KEEP, '',
    'Created by the sorter on ' + formatDate_(new Date(run.now)).substring(0, 10));
  var filed = 0;
  idea.threads.forEach(function(id) {
    var t = null;
    try { t = GmailApp.getThreadById(id); } catch (e) { t = null; }
    if (!t) return;
    applyLabel(t, idea.name);
    filed++;
  });
  delete run.ideas[idea.name.toLowerCase()];
  run.ideasDirty = true;
  run.stats.labelsCreated = (run.stats.labelsCreated || 0) + 1;

  // Offer it to Claude for the rest of this run.
  run.labels = readLabels();
  run.prompt = null;

  logEvent(run, 'New label', 'Created "' + idea.name + '" because Claude suggested it for ' + idea.count +
    ' different emails' + (idea.description ? ': ' + idea.description : '') + '. Filed ' + filed +
    ' of them under it. It keeps mail in the inbox until you choose an Inbox action on the Labels sheet.');
}

// ============================================================================
// LABELS YOU CHANGE IN GMAIL
// ============================================================================

/** Remembers the labels on a conversation right after sorting, so a later change can be noticed. */
function watchLabel(run, thread, f, decision) {
  if (!(decision.labels || []).length || (decision.by !== 'claude' && decision.by !== 'memory')) return;
  var now = userLabelsOf(thread, [run.reviewLabel]);
  stateSetLabeled(run.state, f.threadId, run.now, decision.type || '', now);
}

/**
 * Pure: what you changed about a conversation's labels, or null.
 *
 * @param {string[]} before  your labels right after the sorter labelled it
 * @param {string[]} now     your labels now
 * @returns {{ was: string[], now: string[] }|null} the specific labels before and
 *   after. Parent labels left behind when you remove a sub-label don't count
 *   as a choice, and removing labels without adding any is not treated as a
 *   correction (it is often just tidying up).
 */
function labelChange(before, now) {
  if (sameLabels(before, now)) return null;
  var beforeLower = before.map(lower_);
  var nowLower = now.map(lower_);
  var added = now.filter(function(n) { return beforeLower.indexOf(n.toLowerCase()) < 0; });
  if (!added.length) return null;
  var kept = leafLabels(before).filter(function(n) { return nowLower.indexOf(n.toLowerCase()) >= 0; });
  var result = leafLabels(kept.concat(added));
  var was = leafLabels(before);
  return sameLabels(result, was) ? null : { was: was, now: result };
}

/** Checks recently sorted conversations for labels you changed. Runs with the hourly sweep. */
function checkRelabels(run) {
  var ids = Object.keys(run.state.labeled)
    .filter(function(id) { return run.now - run.state.labeled[id].at >= RELABEL_GRACE_MS; })
    .sort(function(a, b) { return run.state.labeled[b].at - run.state.labeled[a].at; })
    .slice(0, RELABEL_CHECKS_PER_SWEEP);
  ids.forEach(function(id) {
    if (!timeLeft_(run)) return;
    var entry = run.state.labeled[id];
    var thread = null;
    try { thread = GmailApp.getThreadById(id); } catch (e) { thread = null; }
    if (!thread) { stateDelete(run.state, STATE_PREFIX.LABELED, id); return; }
    var change = labelChange(entry.labels, userLabelsOf(thread, [run.reviewLabel]));
    if (!change) return;                          // unchanged: keep watching
    stateDelete(run.state, STATE_PREFIX.LABELED, id);
    learnRelabel_(run, thread, entry, change);
  });
}

function learnRelabel_(run, thread, entry, change) {
  var f = buildThreadFeatures(thread, run.mineList, run.outreachSignals);
  var who = f.senderEmail;
  var learnable = !!who && !(f.relay && !f.replyTo);
  var was = joinLabels(change.was) || 'no label';
  var now = joinLabels(change.now);
  run.relabels.push([new Date(run.now), who, f.subject, joinLabels(change.was), now]);
  var note = 'You changed "' + f.subject.replace(/"/g, "'").substring(0, 80) + '" from ' + was + ' to ' + now;
  var wasOutreach = change.was.some(function(n) { return n.toLowerCase() === run.outreachLabel.toLowerCase(); });
  var message;

  if (learnable && wasOutreach) {
    teachSender(run.senders, who, { source: 'rescued', action: ACTIONS.KEEP, labels: [], note: note }, run.now);
    message = 'You moved this out of ' + run.outreachLabel + ', so ' + who + ' is no longer treated as a sales ' +
      'email and stays in the inbox. Claude will also see this as an example.';
  } else if (learnable && (entry.type === 'automated' || entry.type === 'bulk')) {
    teachSender(run.senders, who, { source: 'you', labels: change.now, action: '', note: note }, run.now);
    message = 'You changed this from ' + was + ' to ' + now + '. Mail from ' + who + ' will get ' + now +
      ' from now on.';
  } else {
    message = 'You changed this from ' + was + ' to ' + now + '. Claude will use it as an example for ' +
      'similar email (people\'s mail is not locked to fixed labels).';
  }
  run.stats.learned++;
  logEvent(run, 'Learned', message, f.threadId, f.subject);
}

// ============================================================================
// CORRECTIONS SHEET
// ============================================================================

function ensureCorrectionsSheet(ss) {
  if (ss.getSheetByName('Corrections')) return false;
  var sheet = ss.insertSheet('Corrections');
  sheet.getRange(1, 1, 1, CORRECTIONS_HEADER.length).setValues([CORRECTIONS_HEADER]);
  headerStyle_(sheet.getRange(1, 1, 1, CORRECTIONS_HEADER.length), '#e37400');
  sheet.setFrozenRows(1);
  [140, 260, 380, 180, 180].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange('A:A').setNumberFormat('MMM d, h:mm am/pm');
  return true;
}

/** The most recent label changes you made, newest first, for Claude's instructions. */
function readRelabels(max) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Corrections');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var n = Math.min(max || 20, sheet.getLastRow() - 1);
  return sheet.getRange(2, 1, n, CORRECTIONS_HEADER.length).getValues()
    .filter(function(r) { return r[1] && r[3] && r[4]; })
    .map(function(r) {
      return { sender: String(r[1]), subject: String(r[2]).substring(0, 100), was: String(r[3]), now: String(r[4]) };
    });
}

function flushRelabels(run) {
  if (!run.relabels.length) return;
  var ss = SpreadsheetApp.getActive();
  ensureCorrectionsSheet(ss);
  var sheet = ss.getSheetByName('Corrections');
  var rows = run.relabels.slice().reverse();
  run.relabels = [];
  sheet.insertRowsAfter(1, rows.length);
  sheet.getRange(2, 1, rows.length, CORRECTIONS_HEADER.length)
    .setValues(rows.map(function(r) { return r.map(function(v, i) { return i === 0 ? v : safeCell(v); }); }));
  var extra = sheet.getLastRow() - 1 - CORRECTIONS_MAX_ROWS;
  if (extra > 0) sheet.deleteRows(CORRECTIONS_MAX_ROWS + 2, extra);
}
