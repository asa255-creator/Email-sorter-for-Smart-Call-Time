'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSorter, claudeOk } = require('./fakes');

const { ctx: S } = loadSorter();
const plain = (v) => JSON.parse(JSON.stringify(v)); // vm objects -> plain for deepEqual

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

test('parseAddress handles names, quotes and bare addresses', () => {
  assert.deepEqual(plain(S.parseAddress('Jane Doe <Jane@Acme.com>')), { name: 'Jane Doe', email: 'jane@acme.com' });
  assert.deepEqual(plain(S.parseAddress('"Doe, Jane" <jane@acme.com>')), { name: 'Doe, Jane', email: 'jane@acme.com' });
  assert.deepEqual(plain(S.parseAddress('jane@acme.com')), { name: '', email: 'jane@acme.com' });
  assert.equal(S.parseAddress('').email, '');
});

test('extractEmails finds every address in a header', () => {
  assert.deepEqual(plain(S.extractEmails('"A, B" <a@x.com>, c@y.org; D <D@Z.io>')), ['a@x.com', 'c@y.org', 'd@z.io']);
});

test('no-reply style addresses are recognised, real names are not', () => {
  assert.equal(S.isAutomatedAddress('noreply@github.com'), true);
  assert.equal(S.isAutomatedAddress('no-reply@accounts.google.com'), true);
  assert.equal(S.isAutomatedAddress('notifications@github.com'), true);
  assert.equal(S.isAutomatedAddress('jane@acme.com'), false);
  assert.equal(S.isAutomatedAddress('nora@acme.com'), false);
});

test('stripQuotedText keeps only the new part of a reply', () => {
  const gmail = 'Sounds good, see you then.\n\nOn Mon, Nov 24, 2026 at 9:00 AM Jane Doe <\njane@acme.com> wrote:\n> Are we on for Tuesday?\n> Thanks';
  assert.equal(S.stripQuotedText(gmail).trim(), 'Sounds good, see you then.');
  const outlook = 'Approved.\n\nFrom: Bob <bob@x.com>\nSent: Monday\nSubject: PO 7';
  assert.equal(S.stripQuotedText(outlook).trim(), 'Approved.');
  const forward = '---------- Forwarded message ---------\nFrom: x\nThe actual content';
  assert.match(S.stripQuotedText(forward), /actual content/);
});

test('cleanBody shrinks links to hosts and caps length', () => {
  const body = 'Read more: https://www.hubspotlinks.com/Ctc/abc123?x=1   now\n\n\n\nbye';
  assert.equal(S.cleanBody(body), 'Read more: [link: hubspotlinks.com] now\n\nbye');
  const long = S.cleanBody('x'.repeat(5000), 100);
  assert.ok(long.length < 140 && long.endsWith('[... rest of email not shown]'));
});

test('link hosts, tracking pixels and outreach fingerprints come from the HTML', () => {
  const html = '<a href="https://t.hubspotlinks.com/a">x</a><a href="https://acme.com/p">y</a>' +
    '<a href="https://t.hubspotlinks.com/b">z</a><img src="https://track.example.com/o.gif" width="1" height="1">';
  const hosts = S.extractLinkHosts(html);
  assert.deepEqual(plain(hosts), ['t.hubspotlinks.com', 'acme.com', 'track.example.com']);
  assert.equal(S.hasTrackingPixel(html), true);
  assert.equal(S.hasTrackingPixel('<img src="logo.png" width="120" height="40">'), false);
  assert.deepEqual(plain(S.findOutreachSignals(hosts, '', ['hubspot', 'apollo.io'])), ['hubspot']);
});

test('bulk headers are described in plain words', () => {
  const headers = { 'list-unsubscribe': '<mailto:u@x>', 'precedence': 'bulk', 'auto-submitted': 'no' };
  const out = S.describeBulkHeaders((n) => headers[n.toLowerCase()] || '');
  assert.deepEqual(plain(out), ['has an unsubscribe header', 'Precedence: bulk']);
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function features(over) {
  const headers = Object.assign({}, over && over.headers);
  return Object.assign({
    threadId: 't', fromHeader: 'x@y.com', fromEmail: 'x@y.com', toHeader: '', ccHeader: '', subject: '', body: '',
    header: (n) => headers[n.toLowerCase()] || ''
  }, over);
}

test('default GitHub rules split notifications by reason', () => {
  const rules = S.parseRules(S.DEFAULT_RULES);
  assert.equal(rules.length, 6);
  const gh = (reason, subject) => S.matchRule(rules, features({
    fromHeader: '"Org" <notifications@github.com>', subject: subject || '[org/repo] Something',
    ccHeader: reason ? '"Reason" <' + reason + '@noreply.github.com>' : ''
  }));
  const failed = gh('ci_activity', '[org/repo] Run failed: Integration Tests');
  assert.equal(failed.action, S.ACTIONS.ARCHIVE_LATER, 'failed runs stay visible for a day');
  assert.equal(failed.days, 1);
  assert.equal(gh('ci_activity', '[org/repo] Run succeeded: Deploy Dev').action, S.ACTIONS.ARCHIVE,
    'filed right away but left unread');
  assert.equal(gh('review_requested').action, S.ACTIONS.KEEP);
  assert.equal(gh('mention').action, S.ACTIONS.KEEP);
  assert.equal(gh('ci_activity').action, S.ACTIONS.ARCHIVE);
  assert.equal(gh('subscribed').action, S.ACTIONS.ARCHIVE);
  assert.equal(gh('comment').action, S.ACTIONS.ARCHIVE_LATER);
  assert.equal(gh('comment').days, 2);
  assert.equal(gh('').note, 'Any other GitHub notification');
  assert.equal(S.matchRule(rules, features({ fromHeader: 'Jane <jane@acme.com>' })), null);
});

test('rules skip disabled and incomplete rows; actions are normalised', () => {
  const rules = S.parseRules([
    [false, 'From', 'a@b.com', 'X', 'Archive', '', ''],
    [true, '', 'a@b.com', 'X', 'Archive', '', ''],
    ['TRUE', 'subject', 'Invoice | Receipt', 'Finance', 'archive', '', '']
  ]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].action, S.ACTIONS.ARCHIVE);
  assert.equal(S.matchRule(rules, features({ subject: 'Your RECEIPT from Acme' })).label, 'Finance');
  assert.equal(S.normalizeAction('archive + mark read'), S.ACTIONS.ARCHIVE_READ);
  assert.equal(S.normalizeAction('nonsense'), '');
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const LABELS = {
  newsletters: { name: 'Newsletters', action: 'Archive', days: null },
  receipts: { name: 'Receipts', action: 'Archive after days', days: 5 },
  clients: { name: 'Clients', action: 'Keep in inbox', days: null },
  'cold outreach': { name: 'Cold Outreach', action: 'Archive + mark read', days: null }
};

function ctxWith(over) {
  return Object.assign({
    senderRow: null, known: { strong: false, why: '' }, rule: null, labels: LABELS, learnAfter: 3,
    outreachLabel: 'Cold Outreach', reviewLabel: 'Needs Review'
  }, over);
}

const ai = (over) => Object.assign({ sender_type: 'bulk', label: 'Newsletters', needs_attention: false,
  confidence: 'high', reason: 'A newsletter.' }, over);

test('people you know are never archived, even by a rule', () => {
  const rule = { label: 'Newsletters', action: 'Archive', days: null, note: 'n', field: 'From', patterns: ['x'] };
  const d = S.decideWithoutClaude(ctxWith({ rule, known: { strong: true, why: 'you have emailed this sender' } }));
  assert.equal(d.by, 'rule');
  assert.equal(d.label, 'Newsletters');
  assert.equal(d.action, S.ACTIONS.KEEP);
  assert.match(d.reason, /you have emailed this sender/);
});

test('your explicit "always archive" wins over everything', () => {
  const row = { sender: 'rep@sales.io', source: 'you', action: 'Archive + mark read', label: '', type: '' };
  const d = S.decideWithoutClaude(ctxWith({ senderRow: row, known: { strong: true, why: 'you have emailed this sender' } }));
  assert.equal(d.by, 'you');
  assert.equal(d.action, S.ACTIONS.ARCHIVE_READ);
});

test('learned senders skip Claude only after agreeing enough times', () => {
  const row = { sender: 'news@x.com', source: 'claude', label: 'Newsletters', action: '', type: 'bulk', agreed: 2 };
  assert.equal(S.decideWithoutClaude(ctxWith({ senderRow: row })), null);
  row.agreed = 3;
  const d = S.decideWithoutClaude(ctxWith({ senderRow: row }));
  assert.equal(d.by, 'memory');
  assert.equal(d.action, S.ACTIONS.ARCHIVE);
  row.type = 'person';
  assert.equal(S.decideWithoutClaude(ctxWith({ senderRow: row })), null, 'people are never sorted from memory');
});

test('cold outreach from a stranger gets the outreach label and its action', () => {
  const d = S.decideFromClaude(ctxWith(), ai({ sender_type: 'cold_outreach', label: 'NONE' }));
  assert.equal(d.label, 'Cold Outreach');
  assert.equal(d.action, S.ACTIONS.ARCHIVE_READ);
  const pushy = S.decideFromClaude(ctxWith(), ai({ sender_type: 'cold_outreach', label: 'NONE', needs_attention: true }));
  assert.equal(pushy.action, S.ACTIONS.ARCHIVE_READ, '"worth a quick chat?" does not keep a pitch in the inbox');
});

test('a "pitch" from someone you have emailed stays in the inbox', () => {
  const d = S.decideFromClaude(ctxWith({ known: { strong: true, why: 'you have emailed this sender' } }),
    ai({ sender_type: 'cold_outreach', label: 'Clients' }));
  assert.equal(d.label, 'Clients');
  assert.equal(d.action, S.ACTIONS.KEEP);
});

test('people, urgent mail and unsure answers stay in the inbox', () => {
  assert.equal(S.decideFromClaude(ctxWith(), ai({ sender_type: 'person' })).action, S.ACTIONS.KEEP);
  assert.equal(S.decideFromClaude(ctxWith(), ai({ needs_attention: true })).action, S.ACTIONS.KEEP);
  const unsure = S.decideFromClaude(ctxWith(), ai({ confidence: 'low' }));
  assert.equal(unsure.action, S.ACTIONS.KEEP);
  assert.equal(unsure.review, true);
  const rescued = S.decideFromClaude(ctxWith({ senderRow: { source: 'rescued' } }), ai());
  assert.equal(rescued.action, S.ACTIONS.KEEP);
});

test('label settings decide the action, including archive-after days', () => {
  assert.equal(S.decideFromClaude(ctxWith(), ai()).action, S.ACTIONS.ARCHIVE);
  const r = S.decideFromClaude(ctxWith(), ai({ sender_type: 'automated', label: 'Receipts' }));
  assert.equal(r.action, S.ACTIONS.ARCHIVE_LATER);
  assert.equal(r.days, 5);
  const none = S.decideFromClaude(ctxWith(), ai({ label: 'NONE' }));
  assert.equal(none.label, '');
  assert.equal(none.action, S.ACTIONS.KEEP);
});

// ---------------------------------------------------------------------------
// Claude request / response
// ---------------------------------------------------------------------------

test('request uses structured output, low effort, caching and fallbacks on Sonnet 5.5', () => {
  const schema = S.buildClassifierSchema(['Clients', 'Newsletters']);
  const req = S.buildClaudeRequest('claude-sonnet-5-5', 'low', 'SYS', 'USER', schema, 1500, 'sk-ant-x');
  assert.equal(req.payload.model, 'claude-sonnet-5-5');
  assert.equal(req.payload.output_config.effort, 'low');
  assert.equal(req.payload.output_config.format.type, 'json_schema');
  assert.deepEqual(plain(req.payload.output_config.format.schema.properties.label.enum), ['Clients', 'Newsletters', 'NONE']);
  assert.equal(req.payload.output_config.format.schema.additionalProperties, false);
  assert.deepEqual(plain(req.payload.system[0].cache_control), { type: 'ephemeral' });
  assert.equal(req.payload.fallbacks, 'default');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal('temperature' in req.payload, false);

  const haiku = S.buildClaudeRequest('claude-haiku-5-5', 'bogus', 'S', 'U', schema, 1500, 'k');
  assert.equal(haiku.payload.fallbacks, undefined);
  assert.equal(haiku.headers['anthropic-beta'], undefined);
  assert.equal(haiku.payload.output_config.effort, 'low');
});

test('responses map to the right error kinds', () => {
  const kind = (code, body) => { try { S.interpretClaudeResponse(code, body); return 'ok'; } catch (e) { return e.kind; } };
  assert.equal(kind(401, '{"error":{"message":"invalid x-api-key"}}'), 'fatal');
  assert.equal(kind(400, '{"error":{"message":"Your credit balance is too low"}}'), 'fatal');
  assert.equal(kind(404, '{"error":{"message":"model not found"}}'), 'fatal');
  assert.equal(kind(429, '{}'), 'busy');
  assert.equal(kind(529, '{}'), 'busy');
  assert.equal(kind(200, JSON.stringify({ stop_reason: 'refusal', content: [] })), 'refusal');
  assert.equal(kind(200, JSON.stringify({ stop_reason: 'max_tokens', content: [] })), 'bad_response');
  assert.equal(kind(200, JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'oops' }] })), 'bad_response');
  const ok = S.interpretClaudeResponse(200, claudeOk({ label: 'Clients' }).body);
  assert.equal(ok.result.label, 'Clients');
});

test('answers outside the allowed values fall back to safe ones', () => {
  const v = S.validateClassification({ sender_type: 'robot', label: 'Invented', confidence: 'sure', reason: 'r' }, ['Clients']);
  assert.equal(v.sender_type, 'person');
  assert.equal(v.label, 'NONE');
  assert.equal(v.confidence, 'low');
  assert.equal(v.needs_attention, false);
});

test('system prompt lists labels, notes and your corrections', () => {
  const p = S.buildClassifierSystemPrompt([{ name: 'Clients', description: 'Paying customers' }],
    'I run a startup.', [{ sender: 'rep@sales.io', subject: 'Quick question', choice: 'archive + mark read' }]);
  assert.match(p, /- Clients: Paying customers/);
  assert.match(p, /I run a startup\./);
  assert.match(p, /rep@sales\.io \(e\.g\. "Quick question"\): archive \+ mark read/);
  assert.match(p, /cold_outreach/);
});

test('cost estimate uses the served model price', () => {
  const usage = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.equal(S.estimateCost('claude-sonnet-5-5', usage), 12);
  assert.equal(S.estimateCost('claude-haiku-5-5', usage), 0.6);
  assert.equal(S.estimateCost('something-else', usage), 0);
});

// ---------------------------------------------------------------------------
// Sender memory
// ---------------------------------------------------------------------------

test('sender memory counts agreement and resets on uncertainty', () => {
  const store = S.makeSenderStore([]);
  const d = { label: 'Newsletters', type: 'bulk', confidence: 'high', needsAttention: false };
  S.rememberClaudeDecision(store, 'news@x.com', d);
  S.rememberClaudeDecision(store, 'news@x.com', d);
  assert.equal(store.byKey['news@x.com'].agreed, 2);
  S.rememberClaudeDecision(store, 'news@x.com', Object.assign({}, d, { needsAttention: true }));
  assert.equal(store.byKey['news@x.com'].agreed, 0);
  S.rememberClaudeDecision(store, 'news@x.com', Object.assign({}, d, { label: 'Receipts' }));
  assert.equal(store.byKey['news@x.com'].agreed, 1);
  assert.equal(store.byKey['news@x.com'].label, 'Receipts');
});

test('sender memory never overwrites your own choice; domain rows apply to the whole domain', () => {
  const store = S.makeSenderStore([
    ['boss@acme.com', 'Clients', 'Keep in inbox', 'person', 1, 0, 'you', '', '', '', ''],
    ['@spammy.io', 'Cold Outreach', 'Archive + mark read', '', 0, 0, 'you', '', '', '', '']
  ]);
  S.rememberClaudeDecision(store, 'boss@acme.com', { label: 'Newsletters', type: 'bulk', confidence: 'high' });
  assert.equal(store.byKey['boss@acme.com'].label, 'Clients');
  assert.equal(S.findSender(store, 'anyone@spammy.io').label, 'Cold Outreach');
  assert.equal(S.findSender(store, 'x@other.com'), null);
});

test('known-contact checks are cached and re-checked after two weeks', () => {
  const store = S.makeSenderStore([]);
  let searches = 0;
  const search = () => { searches++; return false; };
  const now = Date.now();
  assert.equal(S.isKnownContact(store, 'a@b.com', {}, now, search), false);
  assert.equal(S.isKnownContact(store, 'a@b.com', {}, now + 1000, search), false);
  assert.equal(searches, 1);
  assert.equal(S.isKnownContact(store, 'a@b.com', {}, now + 15 * 24 * 3600 * 1000, () => { searches++; return true; }), true);
  assert.equal(searches, 2);
  assert.equal(S.isKnownContact(store, 'me@example.com', { 'me@example.com': true }, now, search), true);
});

test('state times round-trip at second precision', () => {
  const t = Date.UTC(2026, 10, 24, 12, 0, 5);
  assert.equal(S.decodeTime(S.encodeTime(t)), t);
});

test('label search terms match Gmail\'s format', () => {
  assert.equal(S.labelSearchTerm('Sorter/Archived'), 'label:sorter-archived');
  assert.equal(S.labelSearchTerm('_sorted'), 'label:_sorted');
  assert.equal(S.labelSearchTerm('Cold Outreach'), 'label:cold-outreach');
});

test('cells that look like formulas are neutralised', () => {
  assert.equal(S.safeCell('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(S.safeCell('Hello'), 'Hello');
  assert.equal(S.safeCell(null), '');
});

test('Sentry goes to your existing warnings label and stays in the inbox', () => {
  const rules = S.parseRules(S.defaultRulesFor(['Clients', 'warnings (about products or services)', 'Warnings/Old']));
  const r = S.matchRule(rules, features({ fromHeader: 'Sentry <noreply@md.getsentry.com>', subject: 'API-123 - TypeError' }));
  assert.equal(r.label, 'warnings (about products or services)');
  assert.equal(r.action, S.ACTIONS.KEEP);
  assert.equal(S.parseRules(S.defaultRulesFor([]))[0].label, 'Warnings', 'falls back to a Warnings label');
});

test('label ideas count distinct emails and fire at the threshold', () => {
  const ideas = {};
  const now = Date.now();
  assert.equal(S.addLabelIdea(ideas, 'Finance/Receipts', 'Purchase receipts', 't1', now, 3), null);
  assert.equal(S.addLabelIdea(ideas, 'Finance/Receipts', '', 't1', now, 3), null, 'same email counted once');
  assert.equal(S.addLabelIdea(ideas, 'finance/receipts', '', 't2', now, 3), null);
  const idea = S.addLabelIdea(ideas, 'Finance/Receipts', '', 't3', now, 3);
  assert.equal(idea.count, 3);
  assert.equal(idea.description, 'Purchase receipts');
  assert.deepEqual(JSON.parse(JSON.stringify(idea.threads)), ['t1', 't2', 't3']);
  for (let i = 0; i < 30; i++) S.addLabelIdea(ideas, 'Idea ' + i, '', 'x' + i, now + i, 3);
  assert.ok(Object.keys(ideas).length <= 20, 'idea store stays small');
});

test('suggested label names are cleaned and sorter names refused', () => {
  assert.equal(S.normalizeLabelName('  Finance /  Receipts '), 'Finance/Receipts');
  assert.equal(S.normalizeLabelName('NONE'), '');
  assert.equal(S.normalizeLabelName('Sorter/Archived'), '');
  assert.equal(S.normalizeLabelName('_hidden'), '');
  assert.equal(S.normalizeLabelName(''), '');
});

test('a label you swap in Gmail is found; ancestors and sorter labels are not your choice', () => {
  assert.equal(S.findRelabel(['Work', 'Work/Clients'], 'Work/Tech'), 'Work/Clients');
  assert.equal(S.findRelabel(['Work', 'Work/Tech'], 'Work/Tech'), '', 'unchanged');
  assert.equal(S.findRelabel(['Work'], 'Work/Tech'), '', 'only the parent left: nothing chosen');
  assert.equal(S.findRelabel(['Needs Review', 'Receipts'], 'Newsletters', ['Needs Review']), 'Receipts');
  assert.equal(S.findRelabel(['_sorted', 'Sorter/Archived'], 'Newsletters'), '');
});

test('the schema lets Claude suggest a new label; the prompt shows your label changes', () => {
  const schema = S.buildClassifierSchema(['A']);
  assert.ok(schema.required.includes('new_label'));
  const v = S.validateClassification({ sender_type: 'automated', label: 'A', confidence: 'high', reason: 'r',
    new_label: ' Finance / Receipts ', new_label_description: 'Receipts' }, ['A']);
  assert.equal(v.new_label, 'Finance/Receipts');
  const p = S.buildClassifierSystemPrompt([], '', [], [{ sender: 'a@b.com', subject: 'Invoice 7', was: 'Newsletters', now: 'Receipts' }]);
  assert.match(p, /a@b\.com, "Invoice 7": you chose Newsletters, they moved it to Receipts/);
  assert.match(p, /new_label/);
});
