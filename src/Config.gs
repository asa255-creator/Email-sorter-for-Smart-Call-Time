/**
 * Email Sorter — settings, constants and private state.
 *
 * Settings live on the Config sheet (one row per setting) so they can be
 * edited by hand. The Claude API key and the sorter's bookkeeping live in
 * PropertiesService, where nobody with access to the spreadsheet can read
 * them.
 */

var SORTER_VERSION = '2.0.0';

// What happens to a conversation after it is sorted.
var ACTIONS = {
  KEEP: 'Keep in inbox',
  ARCHIVE: 'Archive',
  ARCHIVE_READ: 'Archive + mark read',
  ARCHIVE_LATER: 'Archive after days'
};
var ACTION_LIST = [ACTIONS.KEEP, ACTIONS.ARCHIVE, ACTIONS.ARCHIVE_READ, ACTIONS.ARCHIVE_LATER];

// The kinds of sender Claude can say an email came from.
var SENDER_TYPES = ['person', 'cold_outreach', 'automated', 'bulk'];

// Gmail labels the sorter owns. Anything under "Sorter/" or starting with
// "_" is never offered to Claude and never synced to the Labels sheet.
var SORTER_LABELS = {
  SORTED: '_sorted',                       // hidden marker: conversation has been sorted
  PARENT: 'Sorter',
  ARCHIVED: 'Sorter/Archived',             // everything the sorter archived
  ALWAYS_KEEP: 'Sorter/Always keep',       // you apply it: never archive this sender
  ALWAYS_ARCHIVE: 'Sorter/Always archive'  // you apply it: always archive this sender
};

var CLAUDE_MODELS = [
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    price: '$0.10 in / $0.50 out per million tokens',
    note: 'Default. Fast and very cheap: well under a tenth of a cent per email.'
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    price: '$2 in / $10 out per million tokens',
    note: 'About 20x the price. Switch to it if the Log shows Haiku mis-sorting.'
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    price: '$4 in / $20 out per million tokens',
    note: 'Most capable. Rarely needed for sorting.'
  }
];

// Models from v1 that get moved to the default model on upgrade.
var OLD_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-4-5'];

var DEFAULT_CONFIG = [
  ['claude_model', 'claude-haiku-5-5',
    'Claude model. Change with Email Sorter > Settings > Choose model.'],
  ['claude_effort', 'low',
    'How hard Claude thinks about each email: low (recommended), medium or high. Higher costs more.'],
  ['sorting_notes', '',
    'Anything Claude should know about you when sorting, in plain English. Example: "I run a startup. Investor and customer emails always need my attention."'],
  ['run_every_minutes', '5',
    'How often new mail is sorted: 1, 5, 10, 15 or 30 minutes. 1 gets alerts out of the inbox almost ' +
    'immediately. Run Email Sorter > Resume automatic sorting after changing it.'],
  ['max_threads_per_run', '30',
    'Most conversations sorted per run.'],
  ['backfill_days', '14',
    'Unsorted inbox mail older than this many days is left alone. Raise it once to clean up an old inbox (costs more).'],
  ['learn_after', '3',
    'After Claude sorts an automated or bulk sender the same way this many times, their mail is sorted from memory without asking Claude.'],
  ['auto_create_labels', 'yes',
    'yes: when Claude suggests the same new label (or sub-label) for several different emails, the sorter ' +
    'creates it. New labels keep mail in the inbox until you choose an Inbox action. no: just log the idea.'],
  ['new_label_after', '3',
    'How many different emails must get the same label suggestion before it is created.'],
  ['outreach_label', 'Cold Outreach',
    'Label for sales and marketing emails dressed up as personal (HubSpot, Apollo, Outreach sequences). Its inbox action is set on the Labels sheet.'],
  ['review_label', 'Needs Review',
    'Label added when Claude is not sure. These always stay in the inbox.'],
  ['my_addresses', '',
    'Other addresses of yours, comma separated. Your main address and Gmail aliases are found automatically.'],
  ['outreach_signals',
    'hubspot, hs-sales, sidekickopen, outreach.io, salesloft, apollo.io, lemlist, mailshake, reply.io, ' +
    'yesware, mixmax, instantly, smartlead, woodpecker.co, gong.io, close.com, pardot, marketo, ' +
    'mailchimp, sendgrid, klaviyo',
    'Text that, when found in an email\'s links or headers, suggests it was sent by a sales or marketing tool. ' +
    'Claude treats this as a hint, not a rule.'],
  ['version', SORTER_VERSION, 'Installed version.']
];

// Config keys from v1 that no longer mean anything (and one held a secret).
var RETIRED_CONFIG_KEYS = [
  'label_mode', 'connection_mode', 'claude_api_key', 'claude_system_prompt',
  'chat_webhook_url', 'webhook_url', 'instance_name', 'hub_registered',
  'rate_limit_ms', 'batch_size', 'last_label_sync', 'setup_complete', 'none_label'
];

// ============================================================================
// CONFIG SHEET ACCESS
// ============================================================================

var _configCache = null;

/** Reads the Config sheet once per execution. */
function getConfigMap_() {
  if (_configCache) return _configCache;
  var map = {};
  var sheet = SpreadsheetApp.getActive().getSheetByName('Config');
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    rows.forEach(function(r) {
      if (r[0] !== '' && r[0] !== null) map[String(r[0]).trim()] = r[1];
    });
  }
  _configCache = map;
  return map;
}

function defaultConfigValue_(key) {
  for (var i = 0; i < DEFAULT_CONFIG.length; i++) {
    if (DEFAULT_CONFIG[i][0] === key) return DEFAULT_CONFIG[i][1];
  }
  return '';
}

/** Returns a setting, falling back to its default when blank. */
function getConfig(key) {
  var v = getConfigMap_()[key];
  if (v === undefined || v === null || String(v).trim() === '') return defaultConfigValue_(key);
  return String(v).trim();
}

function getConfigNumber(key) {
  var n = parseInt(getConfig(key), 10);
  if (isNaN(n)) n = parseInt(defaultConfigValue_(key), 10);
  return n;
}

function setConfig(key, value) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sheet) return;
  var last = sheet.getLastRow();
  if (last > 1) {
    var keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        _configCache = null;
        return;
      }
    }
  }
  sheet.appendRow([key, value, '']);
  _configCache = null;
}

/** Splits a comma-separated setting into trimmed, lower-case, non-empty parts. */
function splitList(text) {
  return String(text || '')
    .split(/[,\n]/)
    .map(function(s) { return s.trim().toLowerCase(); })
    .filter(function(s) { return s.length > 0; });
}

// ============================================================================
// API KEY (kept out of the spreadsheet)
// ============================================================================

function getApiKey() {
  return PropertiesService.getUserProperties().getProperty('claude_api_key') || '';
}

function setApiKey(key) {
  PropertiesService.getUserProperties().setProperty('claude_api_key', key);
}

// ============================================================================
// STATE (ScriptProperties)
//
// s:<threadId> -> when the conversation was last sorted (its last message time)
// a:<threadId> -> when the sorter archived it (to tell your rescues from replies)
// d:<threadId> -> when an "Archive after days" conversation is due to be archived
// l:<threadId> -> the labels on the conversation after sorting, so labels you change in Gmail can be learned from
//
// Times are stored as base-36 epoch seconds to stay well inside the 500 KB
// property quota.
// ============================================================================

var STATE_PREFIX = { SEEN: 's:', ARCHIVED: 'a:', DUE: 'd:', LABELED: 'l:' };

function encodeTime(ms) {
  return Math.floor(ms / 1000).toString(36);
}

function decodeTime(text) {
  var n = parseInt(text, 36);
  return isNaN(n) ? 0 : n * 1000;
}

/**
 * Loads all state into memory. Changes are collected and written once by
 * saveState().
 */
function loadState() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var state = { seen: {}, archived: {}, due: {}, labeled: {}, other: {}, changes: {}, deletes: {} };
  Object.keys(all).forEach(function(key) {
    var id = key.substring(2);
    if (key.indexOf(STATE_PREFIX.LABELED) === 0) {
      try {
        var v = JSON.parse(all[key]);
        state.labeled[id] = { at: decodeTime(v.t), type: v.y || '', labels: v.l || [] };
      } catch (e) {
        state.deletes[key] = true; // unreadable entry from an older version
      }
    } else if (key.indexOf(STATE_PREFIX.SEEN) === 0) state.seen[id] = decodeTime(all[key]);
    else if (key.indexOf(STATE_PREFIX.ARCHIVED) === 0) state.archived[id] = decodeTime(all[key]);
    else if (key.indexOf(STATE_PREFIX.DUE) === 0) state.due[id] = decodeTime(all[key]);
    else state.other[key] = all[key];
  });
  return state;
}

function stateBucket_(state, prefix) {
  if (prefix === STATE_PREFIX.SEEN) return state.seen;
  if (prefix === STATE_PREFIX.ARCHIVED) return state.archived;
  if (prefix === STATE_PREFIX.LABELED) return state.labeled;
  return state.due;
}

/** Remembers the labels a conversation had right after sorting, so a later change by you can be learned from. */
function stateSetLabeled(state, threadId, at, type, labels) {
  state.labeled[threadId] = { at: at, type: type || '', labels: labels.slice() };
  state.changes[STATE_PREFIX.LABELED + threadId] = JSON.stringify({ t: encodeTime(at), y: type || '', l: labels });
  delete state.deletes[STATE_PREFIX.LABELED + threadId];
}

function stateSet(state, prefix, threadId, ms) {
  stateBucket_(state, prefix)[threadId] = ms;
  state.changes[prefix + threadId] = encodeTime(ms);
  delete state.deletes[prefix + threadId];
}

function stateDelete(state, prefix, threadId) {
  var bucket = stateBucket_(state, prefix);
  if (bucket[threadId] === undefined) return;
  delete bucket[threadId];
  delete state.changes[prefix + threadId];
  state.deletes[prefix + threadId] = true;
}

/** Drops bookkeeping that is no longer useful. */
function pruneState(state, nowMs) {
  var DAY = 24 * 3600 * 1000;
  Object.keys(state.seen).forEach(function(id) {
    if (nowMs - state.seen[id] > 10 * DAY) stateDelete(state, STATE_PREFIX.SEEN, id);
  });
  Object.keys(state.archived).forEach(function(id) {
    if (nowMs - state.archived[id] > 45 * DAY) stateDelete(state, STATE_PREFIX.ARCHIVED, id);
  });
  Object.keys(state.labeled).forEach(function(id) {
    if (nowMs - state.labeled[id].at > LABEL_WATCH_DAYS * DAY) stateDelete(state, STATE_PREFIX.LABELED, id);
  });
}

// How long after sorting a label you change in Gmail is still learned from.
var LABEL_WATCH_DAYS = 7;

function saveState(state) {
  var props = PropertiesService.getScriptProperties();
  var changes = Object.keys(state.changes);
  if (changes.length) props.setProperties(state.changes, false);
  Object.keys(state.deletes).forEach(function(key) { props.deleteProperty(key); });
  state.changes = {};
  state.deletes = {};
}

function getStatus(key) {
  return PropertiesService.getScriptProperties().getProperty('status_' + key) || '';
}

function setStatus(key, value) {
  PropertiesService.getScriptProperties().setProperty('status_' + key, String(value));
}
