/**
 * Email Sorter — features.
 *
 * Turns a Gmail conversation into the facts the sorter decides on: who sent
 * the latest message, whether you know them, what the headers and links say
 * about how it was sent, and a cleaned-up body for Claude.
 *
 * Everything except buildThreadFeatures() is a pure function so it can be
 * tested outside Apps Script.
 */

var MAX_BODY_CHARS = 3000;

// Addresses that only machines send from.
var AUTOMATED_LOCAL_PART = /^(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|mailer-daemon|postmaster|bounces?|automated|auto-confirm|system)([+._-].*)?$/i;

// ============================================================================
// ADDRESSES
// ============================================================================

/** "Jane Doe <jane@acme.com>" -> { name: 'Jane Doe', email: 'jane@acme.com' } */
function parseAddress(header) {
  var text = String(header || '').trim();
  var angle = text.match(/<([^>]+)>/);
  var email = '';
  var name = '';
  if (angle) {
    email = angle[1].trim();
    name = text.substring(0, text.indexOf('<')).trim().replace(/^"|"$/g, '').trim();
  } else {
    var bare = text.match(/[^\s<>"',;]+@[^\s<>"',;]+/);
    email = bare ? bare[0] : '';
  }
  return { name: name, email: email.toLowerCase() };
}

/** Every email address in a To/Cc style header, lower-cased. */
function extractEmails(header) {
  var found = String(header || '').match(/[^\s<>"',;:]+@[^\s<>"',;:]+\.[a-z]{2,}/gi) || [];
  return found.map(function(e) { return e.toLowerCase(); });
}

function domainOf(email) {
  var at = String(email || '').lastIndexOf('@');
  return at >= 0 ? email.substring(at + 1).toLowerCase() : '';
}

function isAutomatedAddress(email) {
  var local = String(email || '').split('@')[0];
  return AUTOMATED_LOCAL_PART.test(local);
}

// Addresses that send on behalf of many different people (Google Docs shares,
// calendar invites, comment notifications). Their From address says nothing
// about who wrote the email, so the sorter never learns them as a sender.
var RELAY_ADDRESSES = [
  'drive-shares-dm-noreply@google.com', 'drive-shares-noreply@google.com',
  'comments-noreply@docs.google.com', 'calendar-notification@google.com'
];

/** True for "Jane Doe (via Google Docs)" style senders. */
function isRelaySender(name, email) {
  return /\(via [^)]+\)/i.test(String(name || '')) || RELAY_ADDRESSES.indexOf(String(email || '').toLowerCase()) >= 0;
}

var FREE_MAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'hey.com'];

/** Your company domains: the domains of your own addresses, minus free email providers. */
function workDomains(myAddresses) {
  var out = [];
  (myAddresses || []).forEach(function(a) {
    var d = domainOf(a);
    if (d && FREE_MAIL_DOMAINS.indexOf(d) < 0 && out.indexOf(d) < 0) out.push(d);
  });
  return out;
}

// ============================================================================
// BODY CLEAN-UP
// ============================================================================

/** Removes the quoted history under a reply so Claude reads only the new part. */
function stripQuotedText(body) {
  var text = String(body || '').replace(/\r\n?/g, '\n');
  // A forwarded message is the content, so "Forwarded message" is not a cut point.
  var cutMarkers = [
    /^On [^\n]{0,200}(?:\n[^\n]{0,120})?wrote:\s*$/m,         // Gmail / Apple Mail (may wrap)
    /^-{2,}\s*Original Message\s*-{2,}/im,                     // Outlook
    /^_{10,}\s*$/m,                                            // Outlook separator line
    /^From: .+\n(?:Sent|Date): .+/m                            // Outlook header block
  ];
  var cut = text.length;
  cutMarkers.forEach(function(re) {
    var m = re.exec(text);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  });
  text = text.substring(0, cut);
  return text.split('\n').filter(function(line) { return !/^\s*>/.test(line); }).join('\n');
}

/** Shrinks links to their host, collapses blank space, and trims to a size Claude reads quickly. */
function cleanBody(body, maxChars) {
  var limit = maxChars || MAX_BODY_CHARS;
  var text = String(body || '')
    .replace(/<?(https?:\/\/[^\s<>()"]+)>?/gi, function(_, url) {
      var host = hostOf(url);
      return host ? '[link: ' + host + ']' : '[link]';
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > limit) {
    text = text.substring(0, limit) + '\n[... rest of email not shown]';
  }
  return text;
}

function hostOf(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/?#:\s]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

// ============================================================================
// HTML SIGNALS
// ============================================================================

/** Unique link and image hosts in an HTML body, most frequent first. */
function extractLinkHosts(html, max) {
  var counts = {};
  var re = /(?:href|src)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var host = hostOf(m[1]);
    if (host) counts[host] = (counts[host] || 0) + 1;
  }
  return Object.keys(counts)
    .sort(function(a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); })
    .slice(0, max || 20);
}

/** True when the HTML has a 1x1 (or 0x0) image — the usual open-tracking pixel. */
function hasTrackingPixel(html) {
  var imgs = String(html || '').match(/<img\b[^>]*>/gi) || [];
  return imgs.some(function(tag) {
    var w = tag.match(/width\s*[=:]\s*["']?\s*([0-9]+)/i);
    var h = tag.match(/height\s*[=:]\s*["']?\s*([0-9]+)/i);
    return (w && parseInt(w[1], 10) <= 1) || (h && parseInt(h[1], 10) <= 1);
  });
}

/** Which of the configured sales/marketing tool fingerprints appear in the links or headers. */
function findOutreachSignals(linkHosts, headerText, signals) {
  var haystack = (linkHosts || []).join(' ') + ' ' + String(headerText || '').toLowerCase();
  return (signals || []).filter(function(sig) { return sig && haystack.indexOf(sig) >= 0; });
}

/** Human-readable list of the headers that show an email went to a list. */
function describeBulkHeaders(getHeader) {
  var out = [];
  if (getHeader('List-Unsubscribe')) out.push('has an unsubscribe header');
  var listId = getHeader('List-Id');
  if (listId) out.push('mailing list ' + listId.substring(0, 80));
  var precedence = getHeader('Precedence');
  if (/bulk|list|junk/i.test(precedence)) out.push('Precedence: ' + precedence.trim());
  var auto = getHeader('Auto-Submitted');
  if (auto && !/^no$/i.test(auto.trim())) out.push('Auto-Submitted: ' + auto.trim());
  if (getHeader('Feedback-ID')) out.push('sent through a bulk email service');
  return out;
}

// ============================================================================
// GMAIL -> FEATURES
// ============================================================================

/**
 * Collects everything the sorter needs from a conversation.
 *
 * @param {GmailThread} thread
 * @param {string[]} myAddresses - your addresses, lower-case
 * @param {string[]} outreachSignals - from the outreach_signals setting
 */
function buildThreadFeatures(thread, myAddresses, outreachSignals) {
  var messages = thread.getMessages();
  var mine = {};
  myAddresses.forEach(function(a) { mine[a] = true; });

  // Decide on the newest message someone else sent; your own replies say
  // nothing about what kind of email this is.
  var latest = null;
  var youWrote = false;
  for (var i = messages.length - 1; i >= 0; i--) {
    var fromEmail = parseAddress(messages[i].getFrom()).email;
    if (mine[fromEmail]) {
      youWrote = true;
    } else if (!latest) {
      latest = messages[i];
    }
  }
  var allFromYou = !latest;
  var newestIsYours = !!mine[parseAddress(messages[messages.length - 1].getFrom()).email];
  if (!latest) latest = messages[messages.length - 1];

  var headerCache = {};
  var getHeader = function(name) {
    var key = String(name).toLowerCase();
    if (!(key in headerCache)) {
      var value = '';
      try { value = latest.getHeader(name) || ''; } catch (e) { value = ''; }
      headerCache[key] = String(value);
    }
    return headerCache[key];
  };

  var from = parseAddress(latest.getFrom());
  var replyTo = '';
  try { replyTo = parseAddress(latest.getReplyTo() || '').email; } catch (e) { replyTo = ''; }
  var relay = isRelaySender(from.name, from.email);
  // For "Jane (via Google Docs)" style mail, the person is in Reply-To.
  var senderEmail = relay && replyTo ? replyTo : from.email;
  var senderDomain = domainOf(senderEmail);
  var toHeader = latest.getTo() || '';
  var ccHeader = latest.getCc() || '';
  var toList = extractEmails(toHeader);
  var ccList = extractEmails(ccHeader);
  var position = 'not listed (BCC, an alias or a mailing list)';
  if (toList.some(function(a) { return mine[a]; })) position = 'To';
  else if (ccList.some(function(a) { return mine[a]; })) position = 'Cc';

  var html = '';
  try { html = latest.getBody() || ''; } catch (e) { html = ''; }
  var linkHosts = extractLinkHosts(html, 20);
  var headerSample = [getHeader('List-Unsubscribe'), getHeader('X-Mailer'),
    getHeader('Return-Path'), getHeader('Message-ID')].join(' ');

  return {
    threadId: thread.getId(),
    messageCount: messages.length,
    lastMessageDate: thread.getLastMessageDate(),
    fromHeader: latest.getFrom() || '',
    fromName: from.name,
    fromEmail: from.email,
    fromDomain: domainOf(from.email),
    replyTo: replyTo,
    relay: relay,
    // Who the sorter treats as the sender: memory, known-contact checks and teaching use this.
    senderEmail: senderEmail,
    sameCompany: !isAutomatedAddress(senderEmail) && workDomains(myAddresses).indexOf(senderDomain) >= 0,
    toHeader: toHeader,
    ccHeader: ccHeader,
    recipientCount: toList.length + ccList.length,
    yourPosition: position,
    youWroteInThread: youWrote,
    allFromYou: allFromYou,
    newestIsYours: newestIsYours,
    subject: latest.getSubject() || thread.getFirstMessageSubject() || '(no subject)',
    date: latest.getDate(),
    body: cleanBody(stripQuotedText(latest.getPlainBody() || '')),
    linkHosts: linkHosts,
    trackingPixel: hasTrackingPixel(html),
    automatedAddress: isAutomatedAddress(from.email),
    bulkHeaders: describeBulkHeaders(getHeader),
    outreachSignals: findOutreachSignals(linkHosts, headerSample, outreachSignals),
    header: getHeader
  };
}
