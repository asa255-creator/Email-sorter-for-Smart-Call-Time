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
 * Returns a Gmail label, creating it (and its parents) if needed.
 *
 * @param {string} name
 * @param {string} [hide] 'all' hides it everywhere; 'messages' hides the chip
 *   on emails but keeps it in the label list. Needs the Gmail advanced
 *   service; without it the label is created visible.
 */
function ensureLabel(name, hide) {
  var existing = findLabel(name);
  if (existing) return existing;

  var slash = name.lastIndexOf('/');
  if (slash > 0) ensureLabel(name.substring(0, slash));

  var label = null;
  if (hide && typeof Gmail !== 'undefined') {
    try {
      Gmail.Users.Labels.create({
        name: name,
        labelListVisibility: hide === 'all' ? 'labelHide' : 'labelShow',
        messageListVisibility: 'hide'
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
function ensureSorterLabels() {
  ensureLabel(SORTER_LABELS.SORTED, 'all');
  ensureLabel(SORTER_LABELS.PARENT);
  ensureLabel(SORTER_LABELS.ARCHIVED, 'messages');
  ensureLabel(SORTER_LABELS.ALWAYS_KEEP);
  ensureLabel(SORTER_LABELS.ALWAYS_ARCHIVE);
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

/** The most specific of your own labels on a conversation, or ''. */
function userLabelOf(thread, exclude) {
  var skip = (exclude || []).map(function(n) { return String(n).toLowerCase(); });
  var names = thread.getLabels()
    .map(function(l) { return l.getName(); })
    .filter(function(n) { return isUserLabelName(n) && skip.indexOf(n.toLowerCase()) < 0; })
    .sort(function(a, b) { return b.split('/').length - a.split('/').length; });
  return names[0] || '';
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
