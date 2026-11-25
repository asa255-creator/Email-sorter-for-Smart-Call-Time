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

var RULES_HEADER = ['On', 'If this field', 'contains (use | for "or")', 'Label', 'Inbox action',
  'Archive after (days)', 'Note'];

var DEFAULT_RULES = [
  [true, 'Subject', '] run failed',
    'GitHub', ACTIONS.ARCHIVE_LATER, 1, 'Failed GitHub Actions runs: visible for a day, then archived'],
  [true, 'Cc', 'review_requested@noreply.github.com | mention@noreply.github.com | ' +
    'team_mention@noreply.github.com | assign@noreply.github.com | security_alert@noreply.github.com',
    'GitHub', ACTIONS.KEEP, '', 'GitHub needs you: review requests, @mentions, assignments, security alerts'],
  [true, 'Cc', 'ci_activity@noreply.github.com | push@noreply.github.com | subscribed@noreply.github.com | ' +
    'state_change@noreply.github.com | your_activity@noreply.github.com',
    'GitHub', ACTIONS.ARCHIVE_READ, '', 'GitHub noise: successful CI runs, pushes, threads you only watch, merges/closes'],
  [true, 'Cc', 'comment@noreply.github.com | author@noreply.github.com | manual@noreply.github.com',
    'GitHub', ACTIONS.ARCHIVE_LATER, 2, 'Comments on your PRs and issues: visible for 2 days, then archived'],
  [true, 'From', 'notifications@github.com',
    'GitHub', ACTIONS.ARCHIVE_LATER, 2, 'Any other GitHub notification']
];

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
      label: String(r[3] || '').trim(),
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
  if (v.indexOf('read') >= 0) return ACTIONS.ARCHIVE_READ;
  if (v.indexOf('after') >= 0 || v.indexOf('later') >= 0) return ACTIONS.ARCHIVE_LATER;
  return '';
}
