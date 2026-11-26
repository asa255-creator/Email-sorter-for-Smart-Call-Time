/**
 * Email Sorter — the run.
 *
 * runSorter() is called by a trigger every run_every_minutes. Each run first
 * checks cheaply whether there is anything to do, then:
 *   1. Learns from you: "Sorter/Always keep", "Sorter/Always archive", and
 *      archived mail you moved back to the inbox.
 *   2. Sorts inbox conversations that are new, or that got a new message
 *      since they were sorted.
 *   3. Once an hour, archives "Archive after days" conversations that are due
 *      and learns from labels you changed in Gmail (Learn.gs).
 *
 * Gmail itself is the queue: a hidden "_sorted" label marks conversations
 * already handled, so there is no Queue sheet to fall out of step.
 */

var RUN_TIME_LIMIT_MS = 4.5 * 60 * 1000;   // Apps Script stops scripts at 6 minutes
var SWEEP_EVERY_MS = 55 * 60 * 1000;
var CLAUDE_RETRY_MS = 60 * 60 * 1000;      // after a key/credit problem, try Claude again hourly
var MAX_FAILURES = 3;

/** Trigger entry point. */
function runSorter() {
  return runSorter_({});
}

function runSorter_(opts) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { busy: true };
  var run = null;
  try {
    var now = Date.now();
    var state = loadState();
    var work = scanForWork_(state);
    var sweepDue = opts.forceSweep || now - Number(getStatus('last_sweep') || 0) > SWEEP_EVERY_MS;
    if (!work.any && !sweepDue) {
      // Nothing new: skip loading the sheets, so frequent runs stay cheap.
      setStatus('last_run', now);
      return { sorted: 0, idle: true };
    }
    run = startRun_(state, now);
    run.problem = run.claudeBlocked;
    if (opts.timeLimitMs) run.timeLimit = opts.timeLimitMs;
    if (opts.markReadBatches) run.markReadBatches = opts.markReadBatches;
    processCorrections_(run, work);
    processInbox_(run, work.inbox);
    if (sweepDue) {
      sweepDue_(run);
      markOldUnreadRead(run);
      checkRelabels(run);
      setStatus('last_sweep', run.now);
    }
    setStatus('last_error', run.problem || '');
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    if (run) logEvent(run, 'Error', 'Run stopped: ' + e.message);
    setStatus('last_error', e.message);
  } finally {
    if (run) finishRun_(run);
    lock.releaseLock();
  }
  if (run) run.stats.moreToDo = !!run.ranOut || run.stats.sorted >= getConfigNumber('max_threads_per_run');
  return run ? run.stats : {};
}

function startRun_(state, now) {
  var mineList = getMyAddresses();
  var mine = {};
  mineList.forEach(function(a) { mine[a] = true; });
  return {
    now: now || Date.now(),
    started: Date.now(),
    mineList: mineList,
    mine: mine,
    labels: readLabels(),
    rules: readRules(),
    senders: loadSenders(),
    state: state || loadState(),
    learnAfter: getConfigNumber('learn_after'),
    outreachLabel: getConfig('outreach_label'),
    reviewLabel: getConfig('review_label'),
    outreachSignals: splitList(getConfig('outreach_signals')),
    prompt: null,
    claudeBlocked: claudeBlockedReason_(),
    ideas: null,
    ideasDirty: false,
    relabels: [],
    logs: [],
    stats: { sorted: 0, archived: 0, kept: 0, claude: 0, rules: 0, memory: 0, learned: 0, labelsCreated: 0, cost: 0 },
    stop: false,
    problem: ''
  };
}

function finishRun_(run) {
  var steps = [
    function() { saveSenders(run.senders); },
    function() { saveState(run.state); },
    function() { if (run.ideasDirty) saveIdeas(run.ideas); },
    function() { flushRelabels(run); },
    function() { flushLog(run); },
    function() { recordStats_(run.stats); },
    function() { setStatus('last_run', run.now); }
  ];
  steps.forEach(function(step) {
    try { step(); } catch (e) { console.error('Saving run results failed: ' + e.message); }
  });
}

function timeLeft_(run) {
  var ok = Date.now() - run.started < (run.timeLimit || RUN_TIME_LIMIT_MS);
  if (!ok) run.ranOut = true;
  return ok;
}

// ============================================================================
// 1. LEARN FROM YOU
// ============================================================================

/**
 * Finds everything this run has to do with a handful of Gmail calls and no
 * sheet reads, so a run with nothing new costs almost nothing.
 */
function scanForWork_(state) {
  var work = { teach: [], rescued: [], inbox: [], any: false };
  [
    { name: SORTER_LABELS.ALWAYS_KEEP, keep: true },
    { name: SORTER_LABELS.ALWAYS_ARCHIVE, keep: false }
  ].forEach(function(t) {
    var label = findLabel(t.name);
    if (!label) return;
    label.getThreads(0, 30).forEach(function(thread) {
      work.teach.push({ thread: thread, label: label, keep: t.keep });
    });
  });

  work.rescued = GmailApp.search('in:inbox ' + labelSearchTerm(SORTER_LABELS.ARCHIVED), 0, 50);

  var max = getConfigNumber('max_threads_per_run');
  var sortedTerm = labelSearchTerm(SORTER_LABELS.SORTED);
  var queued = {};
  // Conversations sorted before that have a newer message (Gmail moves those back to the inbox).
  // Only look at messages since the previous run (with a margin) to keep Gmail calls low.
  var lastRun = Number(getStatus('last_run') || 0);
  var since = lastRun ? 'after:' + Math.floor((lastRun - 20 * 60 * 1000) / 1000) : 'newer_than:1d';
  GmailApp.search('in:inbox ' + sortedTerm + ' ' + since, 0, 100).forEach(function(thread) {
    var id = thread.getId();
    var seen = state.seen[id];
    if (seen && thread.getLastMessageDate().getTime() <= seen + 1000) return;
    if (!queued[id]) { queued[id] = true; work.inbox.push({ thread: thread, sortedBefore: true }); }
  });
  // Conversations never sorted, newest first.
  GmailApp.search('in:inbox -' + sortedTerm + ' newer_than:' + getConfigNumber('backfill_days') + 'd', 0, max)
    .forEach(function(thread) {
      var id = thread.getId();
      if (!queued[id]) { queued[id] = true; work.inbox.push({ thread: thread, sortedBefore: false }); }
    });

  work.any = work.teach.length + work.rescued.length + work.inbox.length > 0;
  return work;
}

function processCorrections_(run, work) {
  work.teach.forEach(function(t) {
    if (!timeLeft_(run)) return;
    learnFromLabel_(run, t.thread, t.label, t.keep);
  });
  work.rescued.forEach(function(thread) {
    if (!timeLeft_(run)) return;
    learnFromRescue_(run, thread);
  });
}

function learnFromLabel_(run, thread, teachLabel, keep) {
  var f = buildThreadFeatures(thread, run.mineList, run.outreachSignals);
  var id = f.threadId;
  var current = leafLabels(userLabelsOf(thread, [run.reviewLabel]));
  var when = formatDate_(new Date(run.now)).substring(0, 10);
  var who = f.senderEmail;
  var row = teachSender(run.senders, who, {
    source: 'you',
    action: keep ? ACTIONS.KEEP : ACTIONS.ARCHIVE_READ,
    labels: current.length ? current : ((findSender(run.senders, who) || {}).labels || []),
    type: keep ? 'person' : ((run.senders.byKey[who] || {}).type || ''),
    note: 'You chose ' + teachLabel.getName() + ' on ' + when + ': "' + f.subject.replace(/"/g, "'").substring(0, 100) + '"'
  }, run.now);

  thread.removeLabel(teachLabel);
  if (keep) {
    thread.moveToInbox();
    var archivedLabel = findLabel(SORTER_LABELS.ARCHIVED);
    if (archivedLabel) thread.removeLabel(archivedLabel);
    stateDelete(run.state, STATE_PREFIX.DUE, id);
    stateDelete(run.state, STATE_PREFIX.ARCHIVED, id);
  } else {
    archiveThread_(run, thread, id, true);
  }
  thread.addLabel(ensureLabel(SORTER_LABELS.SORTED, 'all'));
  stateSet(run.state, STATE_PREFIX.SEEN, id, f.lastMessageDate.getTime());
  run.stats.learned++;

  logEvent(run, 'Learned', row
    ? (keep ? 'Mail from ' + who + ' will always stay in the inbox.'
            : 'Mail from ' + who + ' will always be archived and marked read.')
    : 'Could not tell who sent this email, so nothing was learned.', id, f.subject);
}

function learnFromRescue_(run, thread) {
  var id = thread.getId();
  var archivedAt = run.state.archived[id];
  var last = thread.getLastMessageDate().getTime();
  var archivedLabel = findLabel(SORTER_LABELS.ARCHIVED);
  if (archivedLabel) thread.removeLabel(archivedLabel);
  stateDelete(run.state, STATE_PREFIX.ARCHIVED, id);

  // No record of when it was archived: stop tracking it, learn nothing.
  if (!archivedAt) return;
  // A new message brought it back; normal sorting below handles it.
  if (last > archivedAt + 60 * 1000) return;

  // You moved it back yourself.
  stateDelete(run.state, STATE_PREFIX.DUE, id);
  stateSet(run.state, STATE_PREFIX.SEEN, id, last);
  var f = buildThreadFeatures(thread, run.mineList, run.outreachSignals);
  var who = f.senderEmail;
  var row = run.senders.byKey[who];
  var rule = matchRule(run.rules, f);
  var message;
  if (row && row.source === 'you') {
    message = 'You moved this back to the inbox. Your own setting for ' + who +
      ' on the Senders sheet was left as it is.';
  } else {
    teachSender(run.senders, who, {
      source: 'rescued', action: ACTIONS.KEEP,
      note: 'You moved "' + f.subject.replace(/"/g, "'").substring(0, 100) + '" back to the inbox'
    }, run.now);
    message = 'You moved this back to the inbox, so mail from ' + who + ' will stay in the inbox.';
    if (rule) {
      message += ' It was archived by a rule (' + (rule.note || rule.field) + '); change it on the Rules sheet if that rule is wrong.';
    }
  }
  run.stats.learned++;
  logEvent(run, 'Learned', message, id, f.subject);
}

// ============================================================================
// 2. SORT THE INBOX
// ============================================================================

function processInbox_(run, todo) {
  var max = getConfigNumber('max_threads_per_run');
  for (var i = 0; i < todo.length && i < max; i++) {
    if (run.stop || !timeLeft_(run)) break;
    var thread = todo[i].thread;
    try {
      sortThread_(run, thread, todo[i].sortedBefore);
      clearFailures_(thread.getId());
    } catch (e) {
      handleSortError_(run, thread, e);
    }
  }
}

/**
 * Sorts one conversation. Separated from processInbox_ so tests can run it
 * against fake Gmail objects.
 */
function sortThread_(run, thread, sortedBefore) {
  var f = buildThreadFeatures(thread, run.mineList, run.outreachSignals);
  var id = f.threadId;

  // Only your own reply is new: nothing to re-sort, and it stays put.
  if (sortedBefore && f.newestIsYours) {
    stateDelete(run.state, STATE_PREFIX.DUE, id);
    stateSet(run.state, STATE_PREFIX.SEEN, id, f.lastMessageDate.getTime());
    return null;
  }

  var result = decideThread_(run, f, true);
  var decision = result.decision;
  var answer = result.answer;
  applyDecision_(run, thread, f, decision);
  watchLabel(run, thread, f, decision);
  logDecision(run, f, decision);
  if (answer && answer.ai.new_label) considerLabelIdea(run, answer.ai, f);
  return decision;
}

/**
 * Decides what to do with a conversation. Shared by sorting and Preview.
 * With `remember` false nothing is learned (Preview must not change anything).
 */
function decideThread_(run, f, remember) {
  var email = f.senderEmail;
  var knownContact = f.allFromYou ? true : isKnownContact(run.senders, email, run.mine, run.now);
  // A relay address with no Reply-To (e.g. a Docs share) stands for many people: never learn it.
  var learnable = !!email && !(f.relay && !f.replyTo);
  var row = findSender(run.senders, email);
  var ctx = {
    senderRow: learnable || (row && row.source === 'you') ? row : null,
    known: protectionFor(f, knownContact),
    rule: matchRule(run.rules, f),
    labels: run.labels.map,
    learnAfter: run.learnAfter,
    outreachLabel: run.outreachLabel,
    reviewLabel: run.reviewLabel
  };

  var answer = null;
  var decision = decideWithoutClaude(ctx);
  if (decision) {
    if (decision.by === 'rule') run.stats.rules++;
    if (decision.by === 'memory') run.stats.memory++;
  } else {
    if (run.claudeBlocked) {
      var skip = new Error(run.claudeBlocked);
      skip.kind = 'skip';
      throw skip;
    }
    answer = classifyWithClaude(f, knownContact, getPrompt_(run));
    run.stats.claude++;
    run.stats.cost += answer.cost || 0;
    decision = decideFromClaude(ctx, answer.ai);
    if (remember && learnable) rememberClaudeDecision(run.senders, email, decision);
  }
  if (remember && email) touchSender(run.senders, email, run.now);
  return { decision: decision, answer: answer };
}

/** Why a sender must never be archived, if they must not. */
function protectionFor(f, knownContact) {
  if (f.allFromYou) return { strong: true, why: 'you sent it' };
  if (f.youWroteInThread) return { strong: true, why: 'you wrote in this conversation' };
  if (knownContact) return { strong: true, why: 'you have emailed this sender' };
  if (f.sameCompany) return { strong: true, why: 'they are at your company' };
  return { strong: false, why: '' };
}

/** Claude's instructions, built once per run. */
function getPrompt_(run) {
  if (!run.prompt) {
    var names = run.labels.aiList.map(function(l) { return l.name; });
    run.prompt = {
      labelNames: names,
      schema: buildClassifierSchema(names),
      system: buildClassifierSystemPrompt(run.labels.aiList, getConfig('sorting_notes'),
        senderCorrections(run.senders, 25), readRelabels(20))
    };
  }
  return run.prompt;
}

function applyDecision_(run, thread, f, d) {
  var id = f.threadId;
  var names = expandLabelAncestors(d.labels || []);
  if (d.review && run.reviewLabel) names.push(run.reviewLabel);
  names.forEach(function(n) { thread.addLabel(ensureLabel(n)); });
  thread.addLabel(ensureLabel(SORTER_LABELS.SORTED, 'all'));

  var lastMs = f.lastMessageDate.getTime();
  stateSet(run.state, STATE_PREFIX.SEEN, id, lastMs);
  stateDelete(run.state, STATE_PREFIX.DUE, id);
  run.stats.sorted++;

  if (d.action === ACTIONS.ARCHIVE) {
    archiveThread_(run, thread, id, false);
  } else if (d.action === ACTIONS.KEEP_READ) {
    thread.markRead();
    run.stats.kept++;
  } else if (d.action === ACTIONS.ARCHIVE_READ) {
    archiveThread_(run, thread, id, true);
  } else if (d.action === ACTIONS.ARCHIVE_LATER) {
    var due = lastMs + d.days * DAY_MS;
    if (due <= run.now) archiveThread_(run, thread, id, false);
    else stateSet(run.state, STATE_PREFIX.DUE, id, due);
  } else {
    run.stats.kept++;
  }
}

function archiveThread_(run, thread, id, markRead) {
  if (markRead) thread.markRead();
  thread.moveToArchive();
  thread.addLabel(ensureLabel(SORTER_LABELS.ARCHIVED, 'messages'));
  stateSet(run.state, STATE_PREFIX.ARCHIVED, id, Date.now());
  run.stats.archived++;
}

function handleSortError_(run, thread, e) {
  var kind = e && e.kind;
  var subject = '';
  try { subject = thread.getFirstMessageSubject(); } catch (x) { subject = ''; }

  if (kind === 'skip') return; // waiting for a Claude problem to clear; tried again later

  if (kind === 'fatal') {
    // Keep sorting what rules and memory can handle; leave the rest for later.
    run.claudeBlocked = e.message;
    run.problem = e.message;
    setStatus('claude_blocked', e.message);
    setStatus('claude_blocked_at', Date.now());
    logEvent(run, 'Error', e.message + ' Rules and learned senders keep working; ' +
      'everything else waits. Trying Claude again in an hour.', thread.getId(), subject);
    return;
  }

  if (kind === 'busy') {
    run.stop = true;
    run.problem = e.message;
    logEvent(run, 'Error', e.message, thread.getId(), subject);
    return;
  }

  var failures = countFailure_(thread.getId());
  if (kind === 'refusal' || failures >= MAX_FAILURES) {
    // Give up on this one: leave it in the inbox, flagged for you.
    try {
      thread.addLabel(ensureLabel(run.reviewLabel));
      thread.addLabel(ensureLabel(SORTER_LABELS.SORTED, 'all'));
      stateSet(run.state, STATE_PREFIX.SEEN, thread.getId(), thread.getLastMessageDate().getTime());
    } catch (x) { /* best effort */ }
    logEvent(run, 'Error', (kind === 'refusal' ? e.message : 'Could not sort this after ' + failures +
      ' tries (' + e.message + ').') + ' Left in the inbox with the ' + run.reviewLabel + ' label.',
      thread.getId(), subject);
    return;
  }
  logEvent(run, 'Error', 'Could not sort this yet (' + (e && e.message) + '). Will try again.',
    thread.getId(), subject);
}

/** The reason Claude is unusable right now, or '' (re-checked hourly). */
function claudeBlockedReason_() {
  if (!getApiKey()) return 'No Claude API key yet. Set one: Email Sorter > Settings > Set Claude API key.';
  var at = Number(getStatus('claude_blocked_at') || 0);
  if (at && Date.now() - at < CLAUDE_RETRY_MS) return getStatus('claude_blocked');
  return '';
}

function clearClaudeBlock() {
  setStatus('claude_blocked', '');
  setStatus('claude_blocked_at', '');
}

function countFailure_(id) {
  var cache = CacheService.getScriptCache();
  var n = (parseInt(cache.get('fail:' + id), 10) || 0) + 1;
  cache.put('fail:' + id, String(n), 6 * 3600);
  return n;
}

function clearFailures_(id) {
  try { CacheService.getScriptCache().remove('fail:' + id); } catch (e) { /* ignore */ }
}

// ============================================================================
// 3. ARCHIVE WHAT IS DUE
// ============================================================================

function sweepDue_(run) {
  var ids = Object.keys(run.state.due).filter(function(id) { return run.state.due[id] <= run.now; });
  ids.slice(0, 100).forEach(function(id) {
    if (!timeLeft_(run)) return;
    stateDelete(run.state, STATE_PREFIX.DUE, id);
    var thread = null;
    try { thread = GmailApp.getThreadById(id); } catch (e) { thread = null; }
    if (!thread || !thread.isInInbox()) return;
    archiveThread_(run, thread, id, false);
    logEvent(run, 'Cleanup', 'Archived: its time in the inbox was up.', id, thread.getFirstMessageSubject());
  });
  pruneState(run.state, run.now);
}

// ============================================================================
// MARK OLD UNREAD MAIL READ (mark_read_after_days)
// ============================================================================

/**
 * Marks conversations read when their newest message is older than
 * mark_read_after_days and they are still unread. A conversation with a
 * newer unread reply is left alone.
 */
function markOldUnreadRead(run) {
  var days = parseInt(getConfig('mark_read_after_days'), 10);
  if (!(days > 0)) return 0;
  var cutoff = run.now - days * DAY_MS;
  var query = 'is:unread older_than:' + days + 'd -in:spam -in:trash -in:chats';
  var marked = 0;
  var start = 0;
  for (var batch = 0; batch < (run.markReadBatches || 10) && timeLeft_(run); batch++) {
    var threads = GmailApp.search(query, start, 100);
    if (!threads.length) break;
    var old = threads.filter(function(t) { return t.getLastMessageDate().getTime() < cutoff; });
    if (old.length) GmailApp.markThreadsRead(old);
    marked += old.length;
    start += threads.length - old.length; // marked ones drop out of the results; skip the rest
  }
  if (marked) {
    logEvent(run, 'Cleanup', 'Marked ' + marked + ' conversation' + (marked === 1 ? '' : 's') +
      ' read that had been unread for over ' + days + ' days.');
  }
  run.stats.markedRead = (run.stats.markedRead || 0) + marked;
  return marked;
}

// ============================================================================
// STATS
// ============================================================================

function todayKey_() {
  return formatDate_(new Date()).substring(0, 10);
}

function recordStats_(stats) {
  var today = todayKey_();
  var saved = {};
  try { saved = JSON.parse(getStatus('stats') || '{}'); } catch (e) { saved = {}; }
  if (saved.day !== today) saved = { day: today };
  Object.keys(stats).forEach(function(k) { saved[k] = (saved[k] || 0) + stats[k]; });
  setStatus('stats', JSON.stringify(saved));
}
