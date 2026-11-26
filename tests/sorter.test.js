'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSorter, claudeOk, DAY } = require('./fakes');

const ME = 'me@example.com';
const ago = (ms) => new Date(Date.now() - ms);
const HOUR = 3600 * 1000;

/** Builds a v1-style spreadsheet, then runs the upgrade the way the menu does. */
function upgradedWorld(claude) {
  const w = loadSorter({ me: ME, claude, uiAnswers: [] });
  const { ss, ctx: S, gmail } = w;

  // --- v1 leftovers ---
  const config = ss.insertSheet('Config');
  [['Setting', 'Value', 'Description'],
    ['connection_mode', 'direct_claude_api', ''],
    ['claude_api_key', 'sk-ant-old-key', ''],
    ['claude_model', 'claude-sonnet-4-6', ''],
    ['chat_webhook_url', 'https://chat.googleapis.com/v1/spaces/X/messages?key=SECRET', ''],
    ['none_label', 'Needs Review', ''],
    ['batch_size', '50', '']].forEach((r) => config.appendRow(r));
  const labels = ss.insertSheet('Labels');
  [['Label Name', 'Label ID', 'Nested Path', 'Type', 'Description', 'Last Synced'],
    ['Newsletters', 'Newsletters', '', 'Top-level', 'Newsletters and digests I subscribed to', ''],
    ['Clients', 'Clients', '', 'Top-level', 'Customers and prospects I am working with', '']]
    .forEach((r) => labels.appendRow(r));
  ss.insertSheet('Queue').appendRow(['Email ID', 'Subject']);
  ss.insertSheet('Instructions').appendRow(['old']);
  ss.insertSheet('Log').appendRow(['Timestamp', 'Email ID', 'Action', 'Details', 'Result', 'Notes']);
  ['Newsletters', 'Clients', 'Needs Review'].forEach((n) => gmail.label(n));

  // --- the upgrade (what setupSorter does, minus the dialogs) ---
  const notes = S.ensureConfigSheet(ss);
  const old = S.ensureLabelsSheet(ss, notes);
  S.ensureRulesSheet(ss);
  S.ensureSendersSheet(ss);
  S.ensureLogSheet(ss);
  S.ensureSorterLabels();
  S.syncLabelsToSheet(old);
  S.removeV1Sheets(ss);
  w.notes = notes;
  return w;
}

function setLabelAction(ss, name, action, days) {
  const sheet = ss.getSheetByName('Labels');
  for (let r = 2; r <= sheet.getLastRow(); r++) {
    if (sheet.get(r, 1) === name) { sheet.set(r, 3, action); sheet.set(r, 4, days || ''); return; }
  }
  throw new Error('no label row ' + name);
}

const senderRows = (ss) => {
  const out = {};
  ss.getSheetByName('Senders').data(11).forEach((r) => { out[r[0]] = r; });
  return out;
};

test('upgrade keeps your data, moves the key, switches to Sonnet 5.5 and drops the Hub settings', () => {
  const { ss, ctx: S, userProps, notes } = upgradedWorld();
  assert.equal(userProps.getProperty('claude_api_key'), 'sk-ant-old-key');
  const config = ss.getSheetByName('Config').data(3);
  const keys = config.map((r) => r[0]);
  assert.ok(!keys.includes('claude_api_key'), 'key is no longer in the sheet');
  assert.ok(!keys.includes('chat_webhook_url'), 'chat webhook secret removed');
  assert.ok(!keys.includes('connection_mode'));
  assert.equal(config.find((r) => r[0] === 'claude_model')[1], 'claude-sonnet-5-5');
  assert.equal(config.find((r) => r[0] === 'review_label')[1], 'Needs Review');
  assert.ok(notes.some((n) => /Sonnet|sonnet-5-5/.test(n)));

  const labels = ss.getSheetByName('Labels').data(6);
  const byName = Object.fromEntries(labels.map((r) => [r[0], r]));
  assert.equal(byName.Newsletters[1], 'Newsletters and digests I subscribed to', 'description kept');
  assert.equal(byName.Clients[2], 'Keep in inbox');
  assert.equal(byName['Cold Outreach'][2], 'Archive + mark read');
  assert.equal(byName['Cold Outreach'][4], false, 'Claude cannot choose the outreach label directly');
  assert.equal(byName['Needs Review'][4], false, 'the review label is no longer offered to Claude (v1 bug)');
  assert.equal(ss.getSheetByName('Queue'), null);
  assert.equal(ss.getSheetByName('Instructions'), null);
  assert.equal(S.readRules().length, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(S.readLabels().aiList.map((l) => l.name))), ['Clients', 'Newsletters']);
});

test('a full run sorts GitHub, people, sales sequences and newsletters correctly', () => {
  const claudeCalls = [];
  const w = upgradedWorld((payload, params) => {
    const email = payload.messages[0].content;
    claudeCalls.push({ email, payload, headers: params.headers });
    if (/growthly/.test(email)) {
      return claudeOk({ reason: 'Templated pitch with HubSpot tracking from a stranger.', sender_type: 'cold_outreach',
        label: 'NONE', needs_attention: false, confidence: 'high' });
    }
    if (/weekly-digest/.test(email)) {
      return claudeOk({ reason: 'Weekly newsletter.', sender_type: 'bulk', label: 'Newsletters',
        needs_attention: false, confidence: 'high' });
    }
    if (/client@acme/.test(email)) {
      // Even if Claude got it wrong, a known contact must stay in the inbox.
      return claudeOk({ reason: 'Looks like marketing.', sender_type: 'cold_outreach', label: 'Newsletters',
        needs_attention: false, confidence: 'high' });
    }
    return claudeOk({ reason: 'Unclear.', sender_type: 'person', label: 'NONE', needs_attention: false, confidence: 'low' });
  });
  const { ss, ctx: S, gmail } = w;
  setLabelAction(ss, 'Newsletters', 'Archive');

  const gh = (id, reason, subject) => gmail.addThread(id, [{
    from: '"Org" <notifications@github.com>', to: '"org/repo" <repo@noreply.github.com>',
    cc: '"Reason" <' + reason + '@noreply.github.com>', subject, date: ago(HOUR),
    headers: { 'List-Id': 'repo <repo.owner.github.com>' }, plain: 'GitHub says hi'
  }]);
  gh('gh-ci', 'ci_activity', '[org/repo] Run succeeded: Deploy Dev');
  gh('gh-failed', 'ci_activity', '[org/repo] Run failed: Integration Tests');
  gh('gh-review', 'review_requested', '[repo] Please review #12');
  gh('gh-comment', 'comment', 'Re: [repo] Fix bug (#13)');
  // You have emailed this client before.
  gmail.addThread('sent-1', [{ from: 'Me <' + ME + '>', to: 'Client <client@acme.com>', subject: 'Contract',
    date: ago(20 * DAY), plain: 'Attached.' }], { inbox: false });
  gmail.addThread('client', [{ from: 'Client <client@acme.com>', to: ME, subject: 'Special offer for you',
    date: ago(2 * HOUR), plain: 'We have a new product.' }]);
  gmail.addThread('sales', [{ from: 'Jordan Blake <jordan@growthly.io>', to: ME, subject: 'Quick question',
    date: ago(3 * HOUR), plain: 'Worth a 15 minute chat? https://meetings.hubspot.com/jordan',
    html: '<a href="https://t.hubspotlinks.com/x">book</a><img src="https://t.hubspotlinks.com/p.gif" width="1" height="1">' }]);
  gmail.addThread('news', [{ from: 'Digest <news@weekly-digest.com>', to: ME, subject: 'This week',
    date: ago(4 * HOUR), headers: { 'List-Unsubscribe': '<mailto:u@weekly-digest.com>' }, plain: 'Top stories' }]);
  gmail.addThread('mystery', [{ from: 'Sam <sam@unknown.org>', to: ME, subject: 'hey', date: ago(5 * HOUR), plain: 'hey' }]);

  const stats = S.runSorter();

  // GitHub: rules, no Claude.
  assert.equal(gmail.thread('gh-ci').inbox, false);
  assert.equal(gmail.thread('gh-ci').unread, true, 'CI runs are filed but left unread');
  assert.ok(gmail.thread('gh-ci').labels.has('GitHub'));
  assert.ok(gmail.thread('gh-ci').labels.has('Sorter/Archived'));
  assert.equal(gmail.thread('gh-review').inbox, true);
  assert.equal(gmail.thread('gh-comment').inbox, true, 'comment stays for 2 days');
  assert.equal(gmail.thread('gh-failed').inbox, true, 'a failed run stays visible for a day');
  assert.ok(claudeCalls.every((c) => !/github/.test(c.email)), 'GitHub never goes to Claude');

  // Known contact: kept no matter what Claude said, and not branded cold outreach.
  assert.equal(gmail.thread('client').inbox, true);
  assert.ok(!gmail.thread('client').labels.has('Cold Outreach'));

  // HubSpot-style sequence from a stranger.
  const sales = gmail.thread('sales');
  assert.equal(sales.inbox, false);
  assert.ok(sales.labels.has('Cold Outreach'));
  const salesCall = claudeCalls.find((c) => /growthly/.test(c.email));
  assert.match(salesCall.email, /Has emailed this sender before: no/);
  assert.match(salesCall.email, /Sales or marketing tool fingerprints: hubspot/);
  assert.match(salesCall.email, /Tracking pixel: yes/);

  // Newsletter follows the label's action.
  assert.equal(gmail.thread('news').inbox, false);
  assert.ok(gmail.thread('news').labels.has('Newsletters'));

  // Unsure: stays, flagged.
  assert.equal(gmail.thread('mystery').inbox, true);
  assert.ok(gmail.thread('mystery').labels.has('Needs Review'));

  // Everything is marked sorted with a hidden label.
  ['gh-ci', 'gh-review', 'client', 'sales', 'news', 'mystery'].forEach((id) =>
    assert.ok(gmail.thread(id).labels.has('_sorted'), id + ' marked sorted'));
  assert.ok(gmail.hiddenLabels.some((l) => l.name === '_sorted' && l.labelListVisibility === 'labelHide'));

  // Request shape: Sonnet 5.5, structured output, fallbacks.
  assert.equal(claudeCalls[0].payload.model, 'claude-sonnet-5-5');
  assert.equal(claudeCalls[0].payload.output_config.format.type, 'json_schema');
  assert.equal(claudeCalls[0].headers['x-api-key'], 'sk-ant-old-key');
  assert.equal(stats.claude, 4);
  assert.equal(stats.rules, 4);

  // Sender memory and log.
  const senders = senderRows(ss);
  assert.equal(senders['client@acme.com'][7], 'yes', 'known contact cached');
  assert.equal(senders['jordan@growthly.io'][1], 'Cold Outreach');
  assert.equal(senders['jordan@growthly.io'][6], 'claude');
  const log = ss.getSheetByName('Log').data(7);
  assert.equal(log.length, 8);
  const salesLog = log.find((r) => r[2] === 'Quick question');
  assert.equal(salesLog[3], 'Claude');
  assert.equal(salesLog[5], 'Archived + read');
  assert.ok(Object.values(ss.getSheetByName('Log').links).some((u) => /#all\/sales$/.test(u)));

  // A second run does nothing new and calls Claude no more.
  const before = claudeCalls.length;
  const again = S.runSorter();
  assert.equal(again.sorted, 0);
  assert.equal(claudeCalls.length, before);
});

test('a repeat automated sender is sorted from memory after it is learned', () => {
  let calls = 0;
  const w = upgradedWorld(() => {
    calls++;
    return claudeOk({ reason: 'Newsletter.', sender_type: 'bulk', label: 'Newsletters', needs_attention: false, confidence: 'high' });
  });
  const { ss, ctx: S, gmail } = w;
  setLabelAction(ss, 'Newsletters', 'Archive');
  for (let i = 0; i < 5; i++) {
    gmail.addThread('n' + i, [{ from: 'news@weekly-digest.com', to: ME, subject: 'Issue ' + i,
      date: ago((10 - i) * HOUR), plain: 'stories' }]);
    S.runSorter();
  }
  assert.equal(calls, 3, 'Claude asked 3 times (learn_after), then memory took over');
  assert.equal(gmail.thread('n4').inbox, false);
  const log = ss.getSheetByName('Log').data(7);
  assert.equal(log[0][3], 'Memory');
});

test('you teach it from Gmail: Always archive, Always keep, and moving mail back', () => {
  const w = upgradedWorld(() => claudeOk({ reason: 'Newsletter.', sender_type: 'bulk', label: 'Newsletters',
    needs_attention: false, confidence: 'high' }));
  const { ss, ctx: S, gmail, scriptProps } = w;
  setLabelAction(ss, 'Newsletters', 'Archive');

  // Always archive: a "personal" sales email you want gone.
  gmail.addThread('pitch', [{ from: 'Rep <rep@sequencer.io>', to: ME, subject: 'Following up', date: ago(HOUR),
    plain: 'Bumping this.' }], { labels: ['Sorter/Always archive', '_sorted'] });
  // Always keep: something the sorter archived that you want to see.
  gmail.addThread('keep', [{ from: 'Bank <alerts@bank.com>', to: ME, subject: 'Statement ready', date: ago(HOUR),
    plain: 'Your statement' }], { labels: ['Sorter/Always keep', 'Sorter/Archived', '_sorted'], inbox: false });

  // Rescue: archived by the sorter an hour after it arrived, then you moved it back.
  const arrived = ago(5 * HOUR);
  gmail.addThread('rescued', [{ from: 'news@weekly-digest.com', to: ME, subject: 'Issue 9', date: arrived,
    plain: 'stories' }], { labels: ['Newsletters', 'Sorter/Archived', '_sorted'], inbox: true });
  scriptProps.setProperty('a:rescued', S.encodeTime(arrived.getTime() + HOUR));
  // Not a rescue: archived, then a new reply arrived.
  gmail.addThread('replied', [{ from: 'news@other.com', to: ME, subject: 'Old', date: ago(HOUR) }],
    { labels: ['Sorter/Archived', '_sorted'], inbox: true });
  scriptProps.setProperty('a:replied', S.encodeTime(Date.now() - 3 * HOUR));

  S.runSorter();
  const senders = senderRows(ss);

  assert.equal(gmail.thread('pitch').inbox, false);
  assert.equal(gmail.thread('pitch').labels.has('Sorter/Always archive'), false, 'teaching label removed');
  assert.equal(senders['rep@sequencer.io'][6], 'you');
  assert.equal(senders['rep@sequencer.io'][2], 'Archive + mark read');
  assert.match(senders['rep@sequencer.io'][10], /"Following up"$/);

  assert.equal(gmail.thread('keep').inbox, true);
  assert.equal(gmail.thread('keep').labels.has('Sorter/Archived'), false);
  assert.equal(senders['alerts@bank.com'][2], 'Keep in inbox');

  assert.equal(gmail.thread('rescued').inbox, true, 'rescued mail is not archived again');
  assert.equal(senders['news@weekly-digest.com'][6], 'rescued');
  // A new message brought it back, so it was simply sorted again (and archived again), not learned from.
  assert.equal(gmail.thread('replied').inbox, false);
  assert.equal(senders['news@other.com'][6], 'claude', 'a reply is not a rescue');

  // The learned choices show up in Claude's instructions next time.
  const corrections = JSON.parse(JSON.stringify(S.senderCorrections(S.loadSenders(), 25).map((c) => c.sender)));
  assert.deepEqual(corrections, ['alerts@bank.com', 'news@weekly-digest.com', 'rep@sequencer.io']);

  // Future mail from the rescued newsletter stays in the inbox even though its label archives.
  gmail.addThread('rescued-2', [{ from: 'news@weekly-digest.com', to: ME, subject: 'Issue 10', date: ago(10 * 60000),
    plain: 'stories' }]);
  gmail.addThread('pitch-2', [{ from: 'Rep <rep@sequencer.io>', to: ME, subject: 'Last try', date: ago(10 * 60000) }]);
  S.runSorter();
  assert.equal(gmail.thread('rescued-2').inbox, true);
  assert.equal(gmail.thread('pitch-2').inbox, false, 'always-archive sender handled without Claude');
});

test('"archive after days" conversations leave the inbox when due, unless you reply', () => {
  const w = upgradedWorld(() => claudeOk({}));
  const { ctx: S, gmail, scriptProps } = w;
  gmail.addThread('due', [{ from: 'GitHub <notifications@github.com>', to: ME, subject: 'Re: PR', date: ago(3 * DAY),
    cc: 'comment@noreply.github.com' }], { labels: ['GitHub', '_sorted'] });
  scriptProps.setProperty('d:due', S.encodeTime(Date.now() - HOUR));
  scriptProps.setProperty('s:due', S.encodeTime(Date.now() - 3 * DAY));

  // A fresh GitHub comment gets scheduled; then you reply, which cancels it.
  gmail.addThread('talk', [{ from: 'GitHub <notifications@github.com>', to: ME, subject: 'Re: Issue', date: ago(HOUR),
    cc: 'Author <author@noreply.github.com>' }]);
  S.runSorter();
  assert.equal(gmail.thread('due').inbox, false, 'due conversation archived');
  assert.equal(gmail.thread('talk').inbox, true);
  assert.ok(scriptProps.getProperty('d:talk'), 'comment scheduled for later');

  gmail.thread('talk').messages.push(new (gmail.thread('talk').messages[0].constructor)({
    from: 'Me <' + ME + '>', to: 'reply@reply.github.com', subject: 'Re: Issue', date: new Date() }));
  S.runSorter();
  assert.equal(scriptProps.getProperty('d:talk'), null, 'your reply cancels the scheduled archive');
});

test('when Claude is unavailable, rules keep working and the error is logged once', () => {
  let calls = 0;
  const w = upgradedWorld(() => { calls++; return { code: 401, body: '{"error":{"message":"invalid x-api-key"}}' }; });
  const { ss, ctx: S, gmail } = w;
  gmail.addThread('a', [{ from: 'x@one.com', to: ME, subject: 'One', date: ago(HOUR) }]);
  gmail.addThread('b', [{ from: 'y@two.com', to: ME, subject: 'Two', date: ago(2 * HOUR) }]);
  gmail.addThread('ci', [{ from: 'GitHub <notifications@github.com>', to: ME, subject: 'CI', date: ago(3 * HOUR),
    cc: 'ci_activity@noreply.github.com' }]);

  S.runSorter();
  S.runSorter();
  assert.equal(calls, 1, 'stops calling Claude after a key error');
  assert.equal(gmail.thread('ci').inbox, false, 'rules still ran');
  assert.ok(!gmail.thread('a').labels.has('_sorted'), 'Claude-needing mail waits to be retried');
  const errors = ss.getSheetByName('Log').data(7).filter((r) => r[3] === 'Error');
  assert.equal(errors.length, 1);
  assert.match(errors[0][6], /rejected the API key/);
});

test('suggestions are parsed from the sheet and applied as labels and senders', () => {
  const w = upgradedWorld();
  const { ss, ctx: S, gmail } = w;
  S.writeSuggestions_({
    notes: 'Most clutter is shipping updates.',
    labels: [
      { name: 'Shipping', description: 'Order and delivery updates', inbox_action: 'Archive after days', archive_after_days: 3, already_exists: false },
      { name: 'Clients', description: 'Customers', inbox_action: 'Keep in inbox', archive_after_days: 0, already_exists: true }
    ],
    senders: [{ sender: 'ship@store.com', label: 'Shipping' }, { sender: 'x@y.com', label: 'Made Up' }]
  }, [{ name: 'Clients' }]);
  const parsed = S.parseSuggestionsSheet(ss.getSheetByName('Suggestions').rows.map((r) => r.concat(Array(6).fill('')).slice(0, 6)));
  assert.equal(parsed.labels.length, 2);
  assert.equal(parsed.senders.length, 2);
  S.applySuggestions();
  assert.ok(gmail.getUserLabelByName('Shipping'));
  const shipping = S.readLabels().map.shipping;
  assert.equal(shipping.action, 'Archive after days');
  assert.equal(shipping.days, 3);
  const senders = senderRows(ss);
  assert.equal(senders['ship@store.com'][6], 'suggested');
  assert.equal(senders['x@y.com'], undefined, 'unknown labels are skipped');
});

test('Docs shares are judged by who shared them; colleagues at your domain are never archived', () => {
  const seen = [];
  const w = upgradedWorld((payload) => {
    seen.push(payload.messages[0].content);
    return claudeOk({ reason: 'Automated notice.', sender_type: 'automated', label: 'Newsletters',
      needs_attention: false, confidence: 'high' });
  });
  const { ss, ctx: S, gmail } = w;
  setLabelAction(ss, 'Newsletters', 'Archive');
  const share = (id, who) => gmail.addThread(id, [{
    from: '"' + who + ' (via Google Docs)" <drive-shares-dm-noreply@google.com>', replyTo: who + ' <' + who.toLowerCase() + '@partner.org>',
    to: ME, subject: 'Document shared with you: "Plan ' + id + '"', date: ago(HOUR), plain: 'I\'ve shared an item with you.'
  }]);
  // Five shares from five different people: the relay address must never become a learned sender.
  ['A', 'B', 'C', 'D', 'E'].forEach((x) => { share('share' + x, 'Person' + x); S.runSorter(); });
  const senders = senderRows(ss);
  assert.equal(senders['drive-shares-dm-noreply@google.com'], undefined, 'relay address not learned');
  assert.ok(senders['persona@partner.org'], 'the person who shared is the sender');
  assert.match(seen[0], /Sent on behalf of: persona@partner.org/);
  assert.equal(seen.length, 5, 'each share went to Claude, none skipped via memory of the relay');

  // A colleague at your own (non-free-mail) domain, never emailed before.
  w.scriptProps.setProperty('status_my_addresses', 'me@mycompany.com');
  w.scriptProps.setProperty('status_my_addresses_at', String(Date.now()));
  gmail.addThread('colleague', [{ from: 'Sam <sam@mycompany.com>', to: 'me@mycompany.com',
    subject: 'Q3 plan', date: ago(10 * 60000), plain: 'Thoughts?' }]);
  S.runSorter();
  assert.equal(gmail.thread('colleague').inbox, true);
  assert.match(ss.getSheetByName('Log').data(7)[0][6], /they are at your company/);
});

test('Claude can create a new sub-label after suggesting it for three different emails', () => {
  const w = upgradedWorld(() => claudeOk({ reason: 'Receipt.', sender_type: 'automated', label: 'NONE',
    needs_attention: false, confidence: 'high', new_label: 'Finance/Receipts',
    new_label_description: 'Receipts and invoices for purchases' }));
  const { ss, ctx: S, gmail } = w;
  ['shop1', 'shop2', 'shop3'].forEach((id, i) => gmail.addThread(id, [{ from: 'orders@' + id + '.com', to: ME,
    subject: 'Your receipt', date: ago((i + 1) * HOUR) }]));
  const stats = S.runSorter();
  assert.equal(stats.labelsCreated, 1);
  assert.ok(gmail.getUserLabelByName('Finance/Receipts'));
  assert.ok(gmail.getUserLabelByName('Finance'), 'parent created too');
  ['shop1', 'shop2', 'shop3'].forEach((id) => assert.ok(gmail.thread(id).labels.has('Finance/Receipts'), id));
  const row = S.readLabels().map['finance/receipts'];
  assert.equal(row.description, 'Receipts and invoices for purchases');
  assert.equal(row.action, 'Keep in inbox');
  assert.equal(row.ai, true, 'Claude can choose it from now on');
  assert.ok(ss.getSheetByName('Log').data(7).some((r) => r[3] === 'New label'));

  // With auto-create off, the idea is only logged.
  const w2 = upgradedWorld(() => claudeOk({ reason: 'Receipt.', sender_type: 'automated', label: 'NONE',
    needs_attention: false, confidence: 'high', new_label: 'Finance/Receipts', new_label_description: 'Receipts' }));
  w2.ctx.setConfig('auto_create_labels', 'no');
  ['a', 'b', 'c'].forEach((id) => w2.gmail.addThread(id, [{ from: 'x@' + id + '.com', to: ME, subject: 'r', date: ago(HOUR) }]));
  w2.ctx.runSorter();
  assert.equal(w2.gmail.getUserLabelByName('Finance/Receipts'), null);
  assert.ok(w2.ss.getSheetByName('Log').data(7).some((r) => r[3] === 'Label idea'));
});

test('changing a label in Gmail teaches it: automated senders follow you, people become examples', () => {
  const w = upgradedWorld((payload) => {
    const person = /Pat </.test(payload.messages[0].content);
    return claudeOk({ reason: 'x', sender_type: person ? 'person' : 'automated', label: 'Newsletters',
      needs_attention: false, confidence: 'high', new_label: '', new_label_description: '' });
  });
  const { ss, ctx: S, gmail, scriptProps } = w;
  gmail.label('Receipts');
  S.syncLabelsToSheet();
  gmail.addThread('bill', [{ from: 'billing@saas.com', to: ME, subject: 'Invoice 7', date: ago(2 * HOUR) }]);
  gmail.addThread('pat', [{ from: 'Pat <pat@friend.org>', to: ME, subject: 'Lunch?', date: ago(2 * HOUR) }]);
  S.runSorter();
  assert.ok(scriptProps.getProperty('l:bill'), 'the sorter remembers what it chose');

  // You swap Newsletters for Receipts on both, an hour later.
  ['bill', 'pat'].forEach((id) => {
    gmail.thread(id).labels.delete('Newsletters');
    gmail.thread(id).labels.add('Receipts');
    const v = scriptProps.getProperty('l:' + id).split('|');
    scriptProps.setProperty('l:' + id, [S.encodeTime(Date.now() - 2 * HOUR)].concat(v.slice(1)).join('|'));
  });
  S.runSorter_({ forceSweep: true });

  const senders = senderRows(ss);
  assert.equal(senders['billing@saas.com'][1], 'Receipts');
  assert.equal(senders['billing@saas.com'][6], 'you');
  assert.notEqual(senders['pat@friend.org'][6], 'you', 'a person is not locked to one label');
  const corrections = ss.getSheetByName('Corrections').data(5);
  assert.equal(corrections.length, 2);
  assert.deepEqual(corrections.map((r) => r.slice(1)).sort(), [
    ['billing@saas.com', 'Invoice 7', 'Newsletters', 'Receipts'],
    ['pat@friend.org', 'Lunch?', 'Newsletters', 'Receipts']
  ]);
  assert.match(S.buildClassifierSystemPrompt([], '', [], S.readRelabels(20)), /they moved it to Receipts/);

  // Next invoice from that sender goes straight to Receipts, no Claude.
  gmail.addThread('bill2', [{ from: 'billing@saas.com', to: ME, subject: 'Invoice 8', date: ago(60000) }]);
  S.runSorter();
  assert.ok(gmail.thread('bill2').labels.has('Receipts'));
  assert.equal(ss.getSheetByName('Log').data(7)[0][3], 'You');
});

test('a run with nothing new does no sheet work', () => {
  const w = upgradedWorld(() => claudeOk({}));
  const { ctx: S, ss } = w;
  S.runSorter_({ forceSweep: true });
  const before = ss.getSheetByName('Log').getLastRow();
  const sheetsRead = [];
  const orig = ss.getSheetByName.bind(ss);
  ss.getSheetByName = (n) => { sheetsRead.push(n); return orig(n); };
  const r = S.runSorter();
  assert.equal(r.idle, true);
  assert.ok(!sheetsRead.includes('Senders') && !sheetsRead.includes('Labels'), 'only Config is read: ' + sheetsRead);
  assert.equal(ss.getSheetByName('Log').getLastRow(), before);
});
