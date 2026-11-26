/**
 * Email Sorter — Gmail helpers: labels, your addresses, known contacts.
 */

var DAY_MS = 24 * 3600 * 1000;

// ============================================================================
// LABELS
// ============================================================================

var _labelCache = null;

function labelCache_() {
  if (!_labelCache) {
    _labelCache = {};
    GmailApp.getUserLabels().forEach(function(l) { _labelCache[l.getName().toLowerCase()] = l; });
  }
  return _labelCache;
}

function findLabel(name) {
  return labelCache_()[String(name).toLowerCase()] || null;
}

/** True for labels that belong to you rather than to the sorter. */
function isUserLabelName(name) {
  var n = String(name || '');
  return n.length > 0 && n.charAt(0) !== '_' && n !== SORTER_LABELS.PARENT &&
    n.indexOf(SORTER_LABELS.PARENT + '/') !== 0;
}

/**
 * Returns a Gmail label, creating it if needed. Parent labels are only
 * created when createParents is true (labels you approved, or the sorter's
 * own "Sorter/..." labels); otherwise the sorter never invents a parent.
 *
 * @param {string} name
 * @param {string} [hide] 'all' hides it everywhere; 'list' keeps it out of
 *   your Gmail sidebar but shows it on emails; 'messages' hides it on emails
 *   but shows it in the sidebar. Needs the Gmail advanced service; without it
 *   the label is created visible.
 * @param {boolean} [createParents]
 */
function ensureLabel(name, hide, createParents) {
  var existing = findLabel(name);
  if (existing) return existing;

  var slash = name.lastIndexOf('/');
  if (slash > 0 && createParents) ensureLabel(name.substring(0, slash), null, true);

  var label = null;
  if (hide && typeof Gmail !== 'undefined') {
    try {
      Gmail.Users.Labels.create({
        name: name,
        labelListVisibility: hide === 'messages' ? 'labelShow' : 'labelHide',
        messageListVisibility: hide === 'list' ? 'show' : 'hide'
      }, 'me');
      label = GmailApp.getUserLabelByName(name);
    } catch (e) {
      console.warn('Could not create hidden label ' + name + ': ' + e.message);
    }
  }
  if (!label) label = GmailApp.createLabel(name);
  labelCache_()[name.toLowerCase()] = label;
  return label;
}

/** Creates the sorter's own labels. */
/**
 * Creates the sorter's own labels, kept out of your Gmail sidebar. The
 * "Sorter/Always keep" and "Sorter/Always archive" labels still appear in
 * the "Label as" menu on an email.
 */
function ensureSorterLabels() {
  ensureLabel(SORTER_LABELS.SORTED, 'all');
  ensureLabel(SORTER_LABELS.PARENT, 'list');
  ensureLabel(SORTER_LABELS.ARCHIVED, 'all');
  ensureLabel(SORTER_LABELS.ALWAYS_KEEP, 'list');
  ensureLabel(SORTER_LABELS.ALWAYS_ARCHIVE, 'list');
  hideSorterLabels();
}

/**
 * Takes labels the sorter created out of your Gmail sidebar (they keep
 * working, and stay searchable). Returns false when the Gmail advanced
 * service is unavailable.
 */
function hideSorterLabels() {
  if (typeof Gmail === 'undefined') return false;
  var names = [SORTER_LABELS.SORTED, SORTER_LABELS.PARENT, SORTER_LABELS.ARCHIVED, SORTER_LABELS.ALWAYS_KEEP,
    SORTER_LABELS.ALWAYS_ARCHIVE, getConfig('outreach_label')].map(function(n) { return n.toLowerCase(); });
  var labels = (Gmail.Users.Labels.list('me') || {}).labels || [];
  labels.forEach(function(l) {
    if (names.indexOf(String(l.name).toLowerCase()) >= 0 && l.labelListVisibility !== 'labelHide') {
      Gmail.Users.Labels.patch({ labelListVisibility: 'labelHide' }, 'me', l.id);
    }
  });
  return true;
}

/**
 * Puts a label on a conversation, plus whichever of its parent labels
 * already exist ("Work/Tech" also gets "Work" if you have a "Work" label).
 * A parent that doesn't exist is never created.
 */
function applyLabel(thread, name, hide) {
  var parts = String(name).split('/');
  for (var i = 1; i < parts.length; i++) {
    var parent = findLabel(parts.slice(0, i).join('/'));
    if (parent) thread.addLabel(parent);
  }
  thread.addLabel(ensureLabel(name, hide));
}

/** "Work/Clients/Acme" -> ["Work", "Work/Clients", "Work/Clients/Acme"] */
function expandLabelAncestors(names) {
  var out = [];
  names.forEach(function(name) {
    if (!name) return;
    var parts = String(name).split('/');
    for (var i = 1; i <= parts.length; i++) {
      var path = parts.slice(0, i).join('/');
      if (out.indexOf(path) < 0) out.push(path);
    }
  });
  return out;
}

/**
 * The Gmail search term for a label. Gmail writes spaces and slashes in
 * label names as dashes in searches: "Sorter/Archived" -> label:sorter-archived.
 */
function labelSearchTerm(name) {
  return 'label:' + String(name).toLowerCase().replace(/[\s\/]+/g, '-');
}

/** Your own labels on a conversation (not the sorter's), minus any in `exclude`. */
function userLabelsOf(thread, exclude) {
  var skip = (exclude || []).map(function(n) { return String(n).toLowerCase(); });
  return thread.getLabels()
    .map(function(l) { return l.getName(); })
    .filter(function(n) { return isUserLabelName(n) && skip.indexOf(n.toLowerCase()) < 0; });
}

// ============================================================================
// YOUR ADDRESSES
// ============================================================================

/** Your addresses, lower-case: account address, Gmail aliases, and the my_addresses setting. */
function getMyAddresses() {
  var list = [];
  var cached = getStatus('my_addresses');
  var cachedAt = Number(getStatus('my_addresses_at') || 0);
  if (cached && Date.now() - cachedAt < DAY_MS) {
    list = cached.split(',');
  } else {
    try {
      var me = Session.getEffectiveUser().getEmail();
      if (me) list.push(me);
    } catch (e) { /* scope not granted; fall through */ }
    try {
      GmailApp.getAliases().forEach(function(a) { list.push(a); });
    } catch (e) { /* aliases unavailable */ }
    if (list.length === 0) list = guessAddressFromSentMail_();
    list = uniqueLower_(list);
    if (list.length) {
      setStatus('my_addresses', list.join(','));
      setStatus('my_addresses_at', Date.now());
    }
  }
  return uniqueLower_(list.concat(splitList(getConfig('my_addresses'))));
}

/** The address that appears in the most of your recent sent conversations. */
function guessAddressFromSentMail_() {
  var counts = {};
  try {
    GmailApp.search('in:sent', 0, 5).forEach(function(t) {
      var inThread = {};
      t.getMessages().forEach(function(m) { inThread[parseAddress(m.getFrom()).email] = true; });
      Object.keys(inThread).forEach(function(a) { counts[a] = (counts[a] || 0) + 1; });
    });
  } catch (e) { return []; }
  var best = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; })[0];
  return best ? [best] : [];
}

function uniqueLower_(list) {
  var seen = {};
  return list.map(function(a) { return String(a).trim().toLowerCase(); })
    .filter(function(a) { if (!a || seen[a]) return false; seen[a] = true; return true; });
}

// ============================================================================
// KNOWN CONTACTS
// ============================================================================

/** True if you have ever sent mail to this address (To, Cc or Bcc). */
function hasEmailedAddress(email) {
  if (!/^[^\s()<>,;:"\\]+@[^\s()<>,;:"\\]+$/.test(String(email || ''))) return false;
  var q = 'in:sent (to:' + email + ' OR cc:' + email + ' OR bcc:' + email + ')';
  return GmailApp.search(q, 0, 1).length > 0;
}
