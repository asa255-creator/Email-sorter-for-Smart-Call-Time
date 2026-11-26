/**
 * Email Sorter — rules.
 *
 * Rules are plain matches you control on the Rules sheet. They run before
 * Claude, cost nothing, and always give the same answer. The first rule
 * that matches wins, so order matters.
 *
 * Defaults cover GitHub notifications, which say why they were sent by Cc'ing
 * an address such as ci_activity@noreply.github.com.
 */

var RULES_HEADER = ['On', 'If this field', 'contains (use | for "or")', 'Labels (use | for several)', 'Inbox action',
  'Archive after (days)', 'Note'];

// ============================================================================
// LABEL LISTS
// An email can carry several labels. Where a sheet holds several in one cell
// (Rules, Senders, Corrections) they are separated by " | ".
// ============================================================================

function splitLabels(text) {
  var out = [];
  String(text || '').split('|').forEach(function(p) {
    var n = p.trim();
    if (n && out.map(lower_).indexOf(n.toLowerCase()) < 0) out.push(n);
  });
  return out;
}

function joinLabels(names) {
  return (names || []).join(' | ');
}

function lower_(s) {
  return String(s).toLowerCase();
}

/** Drops labels that are only parents of another label in the list: [Work, Work/Tech] -> [Work/Tech]. */
function leafLabels(names) {
  var list = splitLabels(joinLabels(names));
  return list.filter(function(n) {
    var prefix = n.toLowerCase() + '/';
    return !list.some(function(m) { return m.toLowerCase().indexOf(prefix) === 0; });
  });
}

function sameLabels(a, b) {
  var x = (a || []).map(lower_).sort();
  var y = (b || []).map(lower_).sort();
  return x.length === y.length && x.every(function(v, i) { return v === y[i]; });
}

// The label "Warnings" is replaced at setup by your own warnings label if you have one.
var WARNINGS_PLACEHOLDER = 'Warnings';

var DEFAULT_RULES = [
  [true, 'From', 'getsentry.com',
    WARNINGS_PLACEHOLDER, ACTIONS.KEEP, '', 'Sentry error alerts and reports: always kept'],
  [true, 'Subject', '] run failed',
    'GitHub', ACTIONS.ARCHIVE_LATER, 1, 'Failed GitHub Actions runs: visible for a day, then archived'],
  [true, 'Cc', 'review_requested@noreply.github.com | mention@noreply.github.com | ' +
    'team_mention@noreply.github.com | assign@noreply.github.com | security_alert@noreply.github.com',
    'GitHub', ACTIONS.KEEP, '', 'GitHub needs you: review requests, @mentions, assignments, security alerts'],
  [true, 'Cc', 'ci_activity@noreply.github.com | push@noreply.github.com | subscribed@noreply.github.com | ' +
    'state_change@noreply.github.com | your_activity@noreply.github.com',
    'GitHub', ACTIONS.ARCHIVE, '', 'Successful CI runs, pushes, watched threads: filed right away and left unread. ' +
    'Your phone still alerts when they arrive.'],
  [true, 'Cc', 'comment@noreply.github.com | author@noreply.github.com | manual@noreply.github.com',
    'GitHub', ACTIONS.ARCHIVE_LATER, 2, 'Comments on your PRs and issues: visible for 2 days, then archived'],
  [true, 'From', 'notifications@github.com',
    'GitHub', ACTIONS.ARCHIVE_LATER, 2, 'Any other GitHub notification']
];

/** Default rules with the warnings placeholder swapped for an existing label like "Warnings (...)". */
function defaultRulesFor(existingLabelNames) {
  var warnings = (existingLabelNames || []).filter(function(n) { return /^warnings?\b/i.test(n); })
    .sort(function(a, b) { return (a.split('/').length - b.split('/').length) || (a.length - b.length); })[0] ||
    WARNINGS_PLACEHOLDER;
  return DEFAULT_RULES.map(function(r) {
    var row = r.slice();
    if (row[3] === WARNINGS_PLACEHOLDER) row[3] = warnings;
    return row;
  });
}

/** Turns Rules sheet rows into rule objects. Rows with no field or match are skipped. */
function parseRules(rows) {
  var rules = [];
  rows.forEach(function(r, i) {
    var enabled = r[0] === true || String(r[0]).toUpperCase() === 'TRUE';
    var field = String(r[1] || '').trim();
    var patterns = String(r[2] || '').split('|')
      .map(function(p) { return p.trim().toLowerCase(); })
      .filter(function(p) { return p.length > 0; });
    if (!enabled || !field || patterns.length === 0) return;
    var days = parseInt(r[5], 10);
    rules.push({
      row: i + 2,
      field: field,
      patterns: patterns,
      labels: splitLabels(r[3]),
      action: normalizeAction(r[4]),
      days: isNaN(days) ? null : days,
      note: String(r[6] || '').trim()
    });
  });
  return rules;
}

/** The text a rule field refers to: From, To, Cc, Subject, Body, or any header name. */
function ruleFieldValue(features, field) {
  switch (field.toLowerCase()) {
    case 'from': return features.fromHeader;
    case 'to': return features.toHeader;
    case 'cc': return features.ccHeader;
    case 'subject': return features.subject;
    case 'body': return features.body;
    default: return features.header(field);
  }
}

/** First enabled rule whose field contains one of its patterns, or null. */
function matchRule(rules, features) {
  for (var i = 0; i < rules.length; i++) {
    var value = String(ruleFieldValue(features, rules[i].field) || '').toLowerCase();
    if (!value) continue;
    for (var j = 0; j < rules[i].patterns.length; j++) {
      if (value.indexOf(rules[i].patterns[j]) >= 0) return rules[i];
    }
  }
  return null;
}

/** Accepts an action as typed in a sheet; returns one of ACTIONS or '' when blank/unknown. */
function normalizeAction(value) {
  var v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  for (var i = 0; i < ACTION_LIST.length; i++) {
    if (ACTION_LIST[i].toLowerCase() === v) return ACTION_LIST[i];
  }
  if (v === 'keep') return ACTIONS.KEEP;
  if (v === 'archive') return ACTIONS.ARCHIVE;
  if (v.indexOf('read') >= 0) return v.indexOf('archive') >= 0 ? ACTIONS.ARCHIVE_READ : ACTIONS.KEEP_READ;
  if (v.indexOf('after') >= 0 || v.indexOf('later') >= 0) return ACTIONS.ARCHIVE_LATER;
  return '';
}
