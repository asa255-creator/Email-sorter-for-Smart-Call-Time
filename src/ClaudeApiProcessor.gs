/**
 * Smart Call Time - Flow Integrator
 * Claude API Processor Module
 *
 * Handles direct email categorization via the Anthropic Claude API.
 * This mode BYPASSES the Hub and Google Chat entirely.
 *
 * CONFIG KEYS (set in Config sheet):
 *   connection_mode    - 'direct_claude_api' to activate this module
 *   claude_api_key     - Your Anthropic API key (sk-ant-...)
 *   claude_model       - Model ID (e.g. claude-opus-4-5, claude-sonnet-4-5)
 *   claude_system_prompt - System instruction packet sent with every request
 *
 * FLOW (direct_claude_api mode):
 *   1. QueueProcessor scans inbox and builds email context
 *   2. callClaudeForLabels() sends email + labels to Claude API
 *   3. Claude returns label names as plain text
 *   4. Labels are applied immediately — no Hub, no Chat, no webhook
 */

// ============================================================================
// AVAILABLE CLAUDE MODELS
// ============================================================================

var CLAUDE_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-opus-4-0',
  'claude-sonnet-4-0',
  'claude-haiku-4-0',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229'
];

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_API_VERSION = '2023-06-01';

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Categorizes an email by calling the Claude API directly.
 * Returns a comma-separated label string (or 'NONE').
 *
 * @param {string} emailId   - Gmail message ID (used for logging)
 * @param {string} subject   - Email subject
 * @param {string} from      - Sender address
 * @param {string} body      - Plain-text email body (may be truncated)
 * @returns {string|null}    - Comma-separated labels, 'NONE', or null on error
 */
function callClaudeForLabels(emailId, subject, from, body) {
  var apiKey = getConfigValue('claude_api_key');
  if (!apiKey || apiKey.trim() === '') {
    logAction(emailId, 'CLAUDE_ERROR', 'No claude_api_key set in Config sheet');
    return null;
  }

  var model = getConfigValue('claude_model') || 'claude-sonnet-4-5';
  var systemPrompt = getConfigValue('claude_system_prompt') || buildDefaultSystemPrompt();
  var labelsText = getLabelsForNotification();

  var userMessage = buildEmailPrompt(labelsText, emailId, subject, from, body);

  logAction(emailId, 'CLAUDE_SENDING', 'Calling Claude API (' + model + ')');

  try {
    var payload = {
      model: model,
      max_tokens: 256,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage }
      ]
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': CLAUDE_API_VERSION
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
    var code = response.getResponseCode();
    var raw = response.getContentText();

    if (code !== 200) {
      logAction(emailId, 'CLAUDE_ERROR', 'HTTP ' + code + ': ' + raw.substring(0, 300));
      return null;
    }

    var result = JSON.parse(raw);
    var labelText = result.content && result.content[0] && result.content[0].text
      ? result.content[0].text.trim()
      : '';

    logAction(emailId, 'CLAUDE_RESPONSE', labelText.substring(0, 200));
    return labelText || 'NONE';

  } catch (error) {
    logAction(emailId, 'CLAUDE_ERROR', error.message);
    return null;
  }
}

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

/**
 * Builds the user-facing prompt containing labels and email content.
 *
 * @param {string} labelsText - Formatted label list from Labels sheet
 * @param {string} emailId    - Gmail message ID
 * @param {string} subject    - Email subject
 * @param {string} from       - Sender address
 * @param {string} body       - Email body (plain text)
 * @returns {string} Full user prompt
 */
function buildEmailPrompt(labelsText, emailId, subject, from, body) {
  return '===== AVAILABLE LABELS =====\n' +
    (labelsText || '(no labels configured)') +
    '\n\n===== EMAIL TO CATEGORIZE =====\n' +
    'Email ID: ' + emailId + '\n' +
    'Subject: ' + subject + '\n' +
    'From: ' + from + '\n\n' +
    'Body:\n' + (body || '(no body)') +
    '\n\n===== INSTRUCTIONS =====\n' +
    'Reply with ONLY the label names (comma-separated). Example: Work, Urgent\n' +
    'If no label fits, reply with: NONE\n' +
    'Do NOT include any explanation — only the label names.';
}

/**
 * Default system prompt used when claude_system_prompt is not configured.
 * @returns {string} System prompt text
 */
function buildDefaultSystemPrompt() {
  return 'You are an email categorization assistant for Smart Call Time. ' +
    'Your job is to read an email and assign it one or more labels from the provided list. ' +
    'You MUST only use labels from the provided list. ' +
    'Respond with ONLY the label name(s) separated by commas. ' +
    'If no label fits, respond with NONE. ' +
    'Do not include explanations, punctuation, or extra text.';
}

// ============================================================================
// SETTINGS UI
// ============================================================================

/**
 * Opens the Claude API settings dialog.
 * Lets the user configure API key, model, and system prompt.
 */
function showClaudeApiSettings() {
  var ui = SpreadsheetApp.getUi();

  var currentKey = getConfigValue('claude_api_key') || '';
  var maskedKey = currentKey ? currentKey.substring(0, 12) + '...' : '(not set)';
  var currentModel = getConfigValue('claude_model') || 'claude-sonnet-4-5';
  var currentPrompt = getConfigValue('claude_system_prompt') || '';

  var info = [
    'Current Claude API Settings',
    '',
    'API Key: ' + maskedKey,
    'Model:   ' + currentModel,
    'System Prompt: ' + (currentPrompt ? currentPrompt.substring(0, 60) + '...' : '(using default)'),
    '',
    'To change settings, use the sub-options below.',
  ].join('\n');

  ui.alert('Claude API Settings', info, ui.ButtonSet.OK);
}

/**
 * Prompts the user to enter their Anthropic API key.
 */
function setClaudeApiKey() {
  var ui = SpreadsheetApp.getUi();
  var current = getConfigValue('claude_api_key') || '';
  var masked = current ? current.substring(0, 12) + '...' : '(not set)';

  var response = ui.prompt(
    'Set Claude API Key',
    'Current key: ' + masked + '\n\n' +
    'Enter your Anthropic API key.\n' +
    'It starts with sk-ant-\n\n' +
    'Find it at: console.anthropic.com > API Keys',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var key = response.getResponseText().trim();
  if (!key) return;

  if (!key.startsWith('sk-ant-')) {
    ui.alert('Invalid Key',
      'That doesn\'t look like a valid Anthropic API key.\n' +
      'Keys start with sk-ant-\n\n' +
      'Try again or paste from console.anthropic.com.',
      ui.ButtonSet.OK);
    return;
  }

  setConfigValue('claude_api_key', key);
  ui.alert('Saved', 'Claude API key saved to Config sheet.', ui.ButtonSet.OK);
  logAction('CONFIG', 'CLAUDE_API_KEY_SET', 'API key updated');
}

/**
 * Prompts the user to select a Claude model.
 */
function setClaudeModel() {
  var ui = SpreadsheetApp.getUi();
  var current = getConfigValue('claude_model') || 'claude-sonnet-4-5';

  var modelList = CLAUDE_MODELS.map(function(m, i) {
    return (i + 1) + '. ' + m + (m === current ? ' (current)' : '');
  }).join('\n');

  var response = ui.prompt(
    'Select Claude Model',
    'Current model: ' + current + '\n\n' +
    'Available models:\n' + modelList + '\n\n' +
    'Enter the model name exactly as shown above\n' +
    '(e.g. claude-sonnet-4-5):',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var model = response.getResponseText().trim();
  if (!model) return;

  if (CLAUDE_MODELS.indexOf(model) === -1) {
    var result = ui.alert(
      'Unknown Model',
      '"' + model + '" is not in the known models list.\n\n' +
      'Save it anyway? (It may still work if it\'s a valid model ID.)',
      ui.ButtonSet.YES_NO
    );
    if (result !== ui.Button.YES) return;
  }

  setConfigValue('claude_model', model);
  ui.alert('Saved', 'Claude model set to: ' + model, ui.ButtonSet.OK);
  logAction('CONFIG', 'CLAUDE_MODEL_SET', 'Model set to: ' + model);
}

/**
 * Prompts the user to edit the Claude system prompt (instruction packet).
 */
function setClaudeSystemPrompt() {
  var ui = SpreadsheetApp.getUi();
  var current = getConfigValue('claude_system_prompt') || '';

  var response = ui.prompt(
    'Claude System Prompt (Instruction Packet)',
    'This is sent to Claude with every email request.\n' +
    'Leave blank to use the default prompt.\n\n' +
    'Current:\n' + (current || '(using default — see ClaudeApiProcessor.gs)') + '\n\n' +
    'Enter new system prompt (or clear to reset to default):',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var prompt = response.getResponseText().trim();
  setConfigValue('claude_system_prompt', prompt);

  if (prompt) {
    ui.alert('Saved', 'System prompt updated in Config sheet.', ui.ButtonSet.OK);
    logAction('CONFIG', 'CLAUDE_SYSTEM_PROMPT_SET', 'System prompt updated (' + prompt.length + ' chars)');
  } else {
    ui.alert('Reset', 'System prompt cleared. Default prompt will be used.', ui.ButtonSet.OK);
    logAction('CONFIG', 'CLAUDE_SYSTEM_PROMPT_CLEAR', 'System prompt reset to default');
  }
}

/**
 * Sends a test email to Claude to verify API key and model work.
 */
function testClaudeApiConnection() {
  var ui = SpreadsheetApp.getUi();

  var apiKey = getConfigValue('claude_api_key');
  if (!apiKey || apiKey.trim() === '') {
    ui.alert('No API Key',
      'Claude API key is not set.\n\n' +
      'Go to Settings > Claude API > Set API Key.',
      ui.ButtonSet.OK);
    return;
  }

  var model = getConfigValue('claude_model') || 'claude-sonnet-4-5';

  ui.alert('Testing...', 'Sending test request to Claude API (' + model + ').\nThis may take a few seconds.', ui.ButtonSet.OK);

  var labelsText = getLabelsForNotification() || 'Work, Personal, Spam';
  var result = callClaudeForLabels(
    'test-connection',
    'Test Subject: Hello from Smart Call Time',
    'test@example.com',
    'This is a test email to verify the Claude API connection is working correctly.'
  );

  if (result !== null) {
    ui.alert('Connection Successful',
      'Claude API is working.\n\n' +
      'Model: ' + model + '\n' +
      'Test response: "' + result + '"\n\n' +
      'Your Direct Claude API mode is ready.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Connection Failed',
      'Could not get a response from Claude API.\n\n' +
      'Check:\n' +
      '1. API key is correct (Settings > Claude API > Set API Key)\n' +
      '2. Model name is valid (Settings > Claude API > Select Model)\n' +
      '3. Log sheet for error details',
      ui.ButtonSet.OK);
  }
}
