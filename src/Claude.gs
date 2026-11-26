/**
 * Email Sorter — Claude.
 *
 * One Messages API call per email that rules and memory could not sort.
 * Structured outputs force the answer into a fixed JSON shape whose
 * "label" can only be one of your label names (or NONE), so there is no
 * free text to parse and no misspelled labels.
 */

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_API_VERSION = '2023-06-01';
var FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Models that accept server-side fallbacks: if a safety filter declines an
// email, the API retries it on another model inside the same call.
var MODELS_WITH_FALLBACK = ['claude-sonnet-5-5', 'claude-opus-5-5'];
var EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Dollars per million tokens: [input, output, cache read, cache write]. Used for the
// cost estimate on the Status screen only.
var MODEL_PRICES = {
  'claude-sonnet-5-5': [2, 10, 0.10, 2.5],
  'claude-haiku-5-5': [0.10, 0.50, 0.01, 0.125],
  'claude-opus-5-5': [4, 20, 0.20, 5]
};

// ============================================================================
// PROMPT
// ============================================================================

/**
 * The instructions sent with every email. Built from your labels, your
 * sorting notes and the choices you made, and kept byte-for-byte stable
 * between emails so the API can cache it.
 *
 * @param {Object[]} labels       [{ name, description }]
 * @param {string}   notes        sorting_notes setting
 * @param {Object[]} corrections  sender-level choices: [{ sender, choice, subject }]
 * @param {Object[]} [relabels]   labels you changed in Gmail: [{ sender, subject, was, now }]
 */
function buildClassifierSystemPrompt(labels, notes, corrections, relabels) {
  var lines = [
    'You sort incoming email for one person, using their own labels. For each email you get the sender, ' +
    'some facts about how it was sent, and the start of the latest message. Decide what kind of sender ' +
    'wrote it and which labels fit.',
    '',
    'Sender types:',
    '- person: a human writing to this person as an individual. Colleagues, clients, friends, family, ' +
    'someone they have been talking with, a recruiter or vendor replying to them. Usually specific to them, ' +
    'with no unsubscribe link.',
    '- cold_outreach: a sales, marketing, fundraising or recruiting email made to look personal. It comes ' +
    'from one person\'s name but is part of a campaign or sequence sent to many people (HubSpot, Apollo, ' +
    'Outreach, Salesloft, Lemlist and similar tools). Typical signs: this person has never emailed the sender; ' +
    'a pitch that could go to anyone with a name or company dropped in; "just following up", "bumping this ' +
    'up", "worth a quick chat?"; a calendar link; tracking links or a tracking pixel; an unsubscribe or ' +
    '"not interested?" line.',
    '- automated: sent by a system. Notifications, receipts, alerts, sign-in codes, calendar invites, ' +
    'shipping and billing updates.',
    '- bulk: newsletters, promotions and announcements sent to a list.',
    '',
    'If this person has emailed the sender before, treat the sender as a person even when the email reads ' +
    'like a pitch: they have a relationship.',
    '',
    'Labels. Choose every label that clearly applies: usually one, sometimes two or three (for example a ' +
    'topic label and a label about urgency). Use the most specific sub-label that fits; its parent labels are ' +
    'added automatically, so do not list them too. Return an empty list when nothing clearly fits. The ' +
    'descriptions are the person\'s own definitions; follow them over your own idea of what a label name means.'
  ];

  if (labels.length === 0) {
    lines.push('(The person has no labels yet. Return an empty list.)');
  } else {
    labels.forEach(function(l) {
      lines.push('- ' + l.name + (l.description ? ': ' + l.description : ''));
    });
  }

  lines.push(
    '',
    'needs_attention: true when the person should see this soon even though a system or list sent it: a ' +
    'failed payment, an unexpected security alert, a deadline, something waiting on them. ' +
    'False for routine confirmations, digests and marketing, and always false for cold_outreach (a sales ' +
    'pitch asking for a call is not something waiting on them).',
    '',
    'confidence: high when both the sender type and the labels are clear; medium when they are probably right; ' +
    'low when you are guessing. Low-confidence emails stay in the inbox for the person to check.',
    '',
    'reason: one short sentence for the person\'s log saying what decided it.',
    '',
    'new_label: usually an empty string. Fill it in only when no existing label fits well, or a more specific ' +
    'sub-label clearly would, and more email like this is likely to keep coming. Prefer a sub-label of an ' +
    'existing label, written Parent/Child (for example Finance/Receipts under Finance). Name a lasting ' +
    'category, not a single conversation or person, and never suggest one for cold_outreach. ' +
    'new_label_description: one sentence on what belongs in that label, or an empty string.'
  );

  if (notes) {
    lines.push('', 'About this person, in their words:', String(notes).trim());
  }

  if (corrections && corrections.length) {
    lines.push('', 'Choices this person made themselves. Treat similar senders the same way:');
    corrections.forEach(function(c) {
      lines.push('- ' + c.sender + (c.subject ? ' (e.g. "' + c.subject + '")' : '') + ': ' + c.choice);
    });
  }

  if (relabels && relabels.length) {
    lines.push('', 'Emails this person re-labelled after you sorted them. Learn from these for similar email:');
    relabels.forEach(function(r) {
      lines.push('- ' + r.sender + (r.subject ? ', "' + r.subject + '"' : '') + ': you chose ' + (r.was || 'no label') +
        ', they changed it to ' + r.now);
    });
  }

  return lines.join('\n');
}

/** The JSON shape Claude must answer in. */
function buildClassifierSchema(labelNames) {
  return {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      sender_type: { type: 'string', enum: SENDER_TYPES.slice() },
      labels: { type: 'array', items: { type: 'string', enum: labelNames.length ? labelNames.slice() : ['NONE'] } },
      needs_attention: { type: 'boolean' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      new_label: { type: 'string' },
      new_label_description: { type: 'string' }
    },
    required: ['reason', 'sender_type', 'labels', 'needs_attention', 'confidence', 'new_label',
      'new_label_description'],
    additionalProperties: false
  };
}

/** The per-email message: facts first, then the cleaned-up body. */
function buildEmailMessage(f, knownContact) {
  var yesNo = function(b) { return b ? 'yes' : 'no'; };
  var lines = ['From: ' + f.fromHeader];
  if (f.relay) lines.push('Sent on behalf of: ' + (f.replyTo || 'unknown (relay address)'));
  lines = lines.concat([
    'Works at the same company as this person: ' + yesNo(f.sameCompany),
    'Has emailed this sender before: ' + yesNo(knownContact),
    'Has written in this conversation: ' + yesNo(f.youWroteInThread),
    'This person is in: ' + f.yourPosition + ' (' + f.recipientCount + ' recipient' +
      (f.recipientCount === 1 ? '' : 's') + ')',
    'Messages in conversation: ' + f.messageCount,
    'Sent from a no-reply style address: ' + yesNo(f.automatedAddress),
    'List headers: ' + (f.bulkHeaders.length ? f.bulkHeaders.join('; ') : 'none'),
    'Sales or marketing tool fingerprints: ' + (f.outreachSignals.length ? f.outreachSignals.join(', ') : 'none'),
    'Tracking pixel: ' + yesNo(f.trackingPixel),
    'Link domains: ' + (f.linkHosts.length ? f.linkHosts.slice(0, 12).join(', ') : 'none'),
    'Subject: ' + f.subject,
    'Date: ' + formatDate_(f.date),
    '',
    'Latest message:',
    f.body || '(empty)'
  ]);
  return lines.join('\n');
}

function formatDate_(d) {
  try {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  } catch (e) {
    return d && d.toISOString ? d.toISOString().substring(0, 16) : String(d);
  }
}

// ============================================================================
// API CALL
// ============================================================================

function claudeError_(kind, message) {
  var e = new Error(message);
  e.kind = kind; // fatal | busy | refusal | bad_response
  return e;
}

/** Builds the request body and headers (separate so it can be tested). */
function buildClaudeRequest(model, effort, system, user, schema, maxTokens, apiKey) {
  var payload = {
    model: model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: {
      effort: EFFORT_LEVELS.indexOf(effort) >= 0 ? effort : 'low',
      format: { type: 'json_schema', schema: schema }
    }
  };
  var headers = {
    'x-api-key': apiKey,
    'anthropic-version': CLAUDE_API_VERSION
  };
  if (MODELS_WITH_FALLBACK.indexOf(model) >= 0) {
    payload.fallbacks = 'default';
    headers['anthropic-beta'] = FALLBACK_BETA;
  }
  return { payload: payload, headers: headers };
}

/**
 * Turns an HTTP response into the parsed JSON answer, or throws an error
 * whose .kind says what the caller should do.
 */
function interpretClaudeResponse(code, text) {
  var data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  var apiMessage = data && data.error && data.error.message ? data.error.message : String(text).substring(0, 300);

  if (code === 401) {
    throw claudeError_('fatal', 'Claude rejected the API key. Set a new one: Email Sorter > Settings > Set Claude API key.');
  }
  if (code === 400 && /credit balance/i.test(apiMessage)) {
    throw claudeError_('fatal', 'Your Anthropic account is out of credits. Add credits at console.anthropic.com, then sorting resumes on its own.');
  }
  if (code === 429) throw claudeError_('busy', 'Claude rate limit reached (429). Will retry next run.');
  if (code === 529 || code >= 500) throw claudeError_('busy', 'Claude is busy (' + code + '). Will retry next run.');
  if (code !== 200) throw claudeError_('fatal', 'Claude API error ' + code + ': ' + apiMessage);

  if (!data) throw claudeError_('bad_response', 'Claude returned something that is not JSON.');
  if (data.stop_reason === 'refusal') throw claudeError_('refusal', 'Claude declined to read this email.');
  if (data.stop_reason === 'max_tokens') throw claudeError_('bad_response', 'Claude ran out of room before answering.');

  var out = (data.content || [])
    .filter(function(b) { return b.type === 'text'; })
    .map(function(b) { return b.text; })
    .join('');
  var result;
  try {
    result = JSON.parse(out);
  } catch (e) {
    throw claudeError_('bad_response', 'Could not read Claude\'s answer: ' + out.substring(0, 120));
  }
  return { result: result, model: data.model || '', usage: data.usage || {} };
}

/** Sends one request and returns { result, model, usage }. */
function callClaudeJson(system, user, schema, opts) {
  opts = opts || {};
  var apiKey = getApiKey();
  if (!apiKey) {
    throw claudeError_('fatal', 'No Claude API key yet. Set one: Email Sorter > Settings > Set Claude API key.');
  }
  var model = opts.model || getConfig('claude_model');
  var effort = opts.effort || getConfig('claude_effort');
  var req = buildClaudeRequest(model, effort, system, user, schema, opts.maxTokens || 1500, apiKey);

  var response;
  try {
    response = UrlFetchApp.fetch(CLAUDE_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: req.headers,
      payload: JSON.stringify(req.payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    throw claudeError_('busy', 'Could not reach Claude: ' + e.message);
  }
  var answer = interpretClaudeResponse(response.getResponseCode(), response.getContentText());
  answer.cost = estimateCost(answer.model || model, answer.usage);
  return answer;
}

/** Rough dollar cost of one call, for the Status screen. */
function estimateCost(model, usage) {
  var key = Object.keys(MODEL_PRICES).filter(function(k) { return String(model).indexOf(k) === 0; })[0];
  var p = MODEL_PRICES[key];
  if (!p || !usage) return 0;
  return ((usage.input_tokens || 0) * p[0] +
          (usage.output_tokens || 0) * p[1] +
          (usage.cache_read_input_tokens || 0) * p[2] +
          (usage.cache_creation_input_tokens || 0) * p[3]) / 1e6;
}

/** Makes sure Claude's answer only uses values the sorter understands. */
function validateClassification(result, labelNames) {
  var names = {};
  labelNames.forEach(function(n) { names[n] = true; });
  var r = result || {};
  return {
    reason: String(r.reason || '').substring(0, 300),
    sender_type: SENDER_TYPES.indexOf(r.sender_type) >= 0 ? r.sender_type : 'person',
    labels: leafLabels((Array.isArray(r.labels) ? r.labels : []).filter(function(n) { return names[n]; })).slice(0, 4),
    needs_attention: r.needs_attention === true,
    confidence: ['high', 'medium', 'low'].indexOf(r.confidence) >= 0 ? r.confidence : 'low',
    new_label: normalizeLabelName(r.new_label),
    new_label_description: String(r.new_label_description || '').trim().substring(0, 200)
  };
}

/**
 * Classifies one conversation.
 * @param {Object} f       features from buildThreadFeatures
 * @param {boolean} known  whether you have emailed the sender
 * @param {Object} prompt  { system, schema, labelNames } prepared once per run
 */
function classifyWithClaude(f, known, prompt) {
  var answer = callClaudeJson(prompt.system, buildEmailMessage(f, known), prompt.schema);
  return {
    ai: validateClassification(answer.result, prompt.labelNames),
    cost: answer.cost,
    model: answer.model
  };
}
