/**
 * Email Sorter — decision policy.
 *
 * Order, first match wins:
 *   1. Your explicit choice for this sender (Senders sheet, Source = you).
 *   2. A rule on the Rules sheet.
 *   3. A sender the sorter has learned (or one you accepted from Suggestions).
 *   4. Claude.
 *
 * On top of that, mail from people you know is never archived, whatever
 * step 2-4 decided. "People you know" means you have emailed them, you
 * wrote in this conversation, or you marked them "Always keep".
 * Only your own explicit choice (step 1) can archive them.
 *
 * Every function here is pure: given the same facts it returns the same
 * decision, which is what the tests check.
 */

var TRUSTED_SOURCES = ['you', 'suggested'];
var LEARNABLE_TYPES = ['automated', 'bulk', 'cold_outreach'];
var DEFAULT_ARCHIVE_DAYS = 3;

/**
 * Decides without Claude when possible.
 *
 * @param {Object} ctx
 *   ctx.senderRow   Senders sheet row for this sender (or null)
 *   ctx.known       { strong: boolean, why: string } — you know this sender
 *   ctx.rule        matching rule (or null)
 *   ctx.labels      map of lower-case label name -> { name, action, days, ai }
 *   ctx.learnAfter  number of agreeing Claude decisions before a sender is trusted
 * @returns {Object|null} decision, or null when Claude is needed
 */
function decideWithoutClaude(ctx) {
  var row = ctx.senderRow;

  if (row && row.source === 'you' && (row.action || row.labels.length)) {
    return finishDecision_({
      by: 'you',
      labels: row.labels,
      action: row.action,
      days: null,
      type: row.type,
      reason: 'You chose this for ' + (row.sender || 'this sender')
    }, ctx, false);
  }

  if (ctx.rule) {
    return finishDecision_({
      by: 'rule',
      labels: ctx.rule.labels,
      action: ctx.rule.action,
      days: ctx.rule.days,
      type: '',
      reason: 'Rule: ' + (ctx.rule.note || ctx.rule.field + ' contains ' + ctx.rule.patterns.join(' | '))
    }, ctx, true);
  }

  if (isTrustedSender(row, ctx.learnAfter)) {
    return finishDecision_({
      by: 'memory',
      labels: row.labels,
      action: row.action,
      days: null,
      type: row.type,
      reason: row.source === 'suggested'
        ? 'Sender from accepted suggestions'
        : 'Learned: Claude sorted this sender the same way ' + row.agreed + ' times'
    }, ctx, true);
  }

  return null;
}

/**
 * Turns Claude's answer into a decision.
 *
 * @param {Object} ctx  as for decideWithoutClaude, plus outreachLabel and reviewLabel
 * @param {Object} ai   { sender_type, labels, needs_attention, confidence, reason }
 */
function decideFromClaude(ctx, ai) {
  var type = ai.sender_type;
  var labels = (ai.labels || []).slice();
  var strong = ctx.known && ctx.known.strong;

  if (type === 'cold_outreach' && !strong) labels = [ctx.outreachLabel];

  var decision = {
    by: 'claude',
    labels: labels,
    action: '',
    days: null,
    type: type,
    confidence: ai.confidence,
    // A sales pitch always "asks for a reply"; that is not a reason to keep it.
    needsAttention: !!ai.needs_attention && type !== 'cold_outreach',
    review: ai.confidence === 'low',
    reason: ai.reason || ''
  };
  resolveAction_(decision, ctx.labels);

  var keepBecause = [];
  if (strong) keepBecause.push(ctx.known.why);
  if (ctx.senderRow && ctx.senderRow.source === 'rescued') keepBecause.push('you moved their mail back to the inbox');
  if (type === 'person') keepBecause.push('written by a person');
  if (decision.needsAttention) keepBecause.push('needs your attention');
  if (decision.review) keepBecause.push('Claude was not sure');
  if (keepBecause.length && decision.action !== ACTIONS.KEEP) {
    decision.action = ACTIONS.KEEP;
    decision.days = null;
    decision.reason += ' (kept: ' + keepBecause.join(', ') + ')';
  }
  return decision;
}

/** A learned sender can be sorted without Claude. */
function isTrustedSender(row, learnAfter) {
  if (!row || (!row.action && !row.labels.length)) return false;
  if (TRUSTED_SOURCES.indexOf(row.source) >= 0) return true;
  if (row.source === 'claude') {
    return row.agreed >= learnAfter && LEARNABLE_TYPES.indexOf(row.type) >= 0;
  }
  return false;
}

/**
 * Fills in action and days from the labels' settings when not given. With
 * several labels the most careful action wins: the email only leaves the
 * inbox if every one of its labels says so.
 */
function resolveAction_(decision, labels) {
  var combined = combineLabelActions(decision.labels || [], labels);
  if (!decision.action) decision.action = combined.action;
  if (decision.action === ACTIONS.ARCHIVE_LATER) {
    if (!isDayCount_(decision.days)) {
      decision.days = isDayCount_(combined.days) ? combined.days : DEFAULT_ARCHIVE_DAYS;
    }
  } else {
    decision.days = null;
  }
  return decision;
}

/** The least aggressive action among the labels (no labels, or a label with no settings: keep). */
function combineLabelActions(names, labels) {
  var order = [ACTIONS.KEEP, ACTIONS.ARCHIVE_LATER, ACTIONS.ARCHIVE, ACTIONS.ARCHIVE_READ];
  if (!names.length) return { action: ACTIONS.KEEP, days: null };
  var rank = order.length - 1;
  var days = null;
  names.forEach(function(n) {
    var info = labels[String(n).toLowerCase()];
    var action = info && info.action ? info.action : ACTIONS.KEEP;
    rank = Math.min(rank, order.indexOf(action) < 0 ? 0 : order.indexOf(action));
    if (action === ACTIONS.ARCHIVE_LATER) {
      var d = info && isDayCount_(info.days) ? info.days : DEFAULT_ARCHIVE_DAYS;
      days = days === null ? d : Math.max(days, d);
    }
  });
  return { action: order[rank], days: order[rank] === ACTIONS.ARCHIVE_LATER ? days : null };
}

function isDayCount_(n) {
  return typeof n === 'number' && !isNaN(n) && n >= 0;
}

function finishDecision_(decision, ctx, protectionApplies) {
  resolveAction_(decision, ctx.labels);
  if (protectionApplies && ctx.known && ctx.known.strong && decision.action !== ACTIONS.KEEP) {
    decision.action = ACTIONS.KEEP;
    decision.days = null;
    decision.reason += ' (kept: ' + ctx.known.why + ')';
  }
  return decision;
}
