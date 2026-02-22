/**
 * Smart Call Time - Flow Integrator
 * Main entry points, menu setup, and triggers
 *
 * Communication model:
 * - User -> Hub: Via Google Chat messages (chat_webhook_url in Config sheet)
 * - Hub -> User: Via webhooks to our web app URL (webhook_url in Config sheet)
 * - No direct HTTP to Hub (Hub has no web app)
 *
 * MODULES:
 * - SheetSetup.gs: Sheet creation and initialization
 * - LabelManager.gs: Gmail label operations
 * - QueueProcessor.gs: Email queue processing
 * - ConfigManager.gs: Configuration management
 * - Logger.gs: Logging utilities
 */

// ============================================================================
// MENU SETUP
// ============================================================================

/**
 * Creates the custom menu when the spreadsheet is opened.
 * This is a simple trigger that runs automatically.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('Smart Call Time')
    // Email Sorter submenu
    .addSubMenu(ui.createMenu('Email Sorter')
      .addItem('Setup / Refresh', 'emailSorterSetup')
      .addSeparator()
      .addItem('Sync Labels Now', 'syncLabelsToSheet')
      .addItem('Add Custom Label', 'addCustomLabelFromMenu')
      .addItem('Scan Inbox Now', 'scanInboxNow')
      .addSeparator()
      .addItem('Clear Queue', 'clearQueue'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Settings')
      .addItem('Show Configuration', 'showConfig')
      .addSeparator()
      .addItem('Change Label Setup Mode', 'switchLabelModeFromMenu')
      .addItem('Switch Connection Mode (Chat Hub / Claude API)', 'switchConnectionModeFromMenu')
      .addSeparator()
      .addSubMenu(ui.createMenu('Claude API')
        .addItem('Show Claude API Settings', 'showClaudeApiSettings')
        .addItem('Set API Key', 'setClaudeApiKey')
        .addItem('Select Model', 'setClaudeModel')
        .addItem('Edit System Prompt', 'setClaudeSystemPrompt')
        .addItem('Test Claude API Connection', 'testClaudeApiConnection'))
      .addSeparator()
      .addItem('Set Webhook URL', 'setWebhookUrlFromMenu')
      .addItem('Register with Hub (via Chat)', 'registerWithHubFromMenu')
      .addItem('Refresh All', 'refreshAll'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Testing')
      .addItem('Test Webhook Ping (Hub -> User)', 'testWebhookPingFromUser')
      .addItem('Test Chat Connection (User -> Chat -> Hub -> User)', 'testChatConnectionFromUser')
      .addItem('Test Sheets Chat Round-Trip (Full test with cleanup)', 'testSheetsChatFromUser'))
    .addToUi();
}

// ============================================================================
// INSTALLABLE TRIGGERS
// ============================================================================

/**
 * Sets up all installable triggers for the application.
 * Creates a 15-minute time-based trigger to check the queue.
 */
function setupTriggers() {
  // Remove existing triggers for our functions
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    var handlerName = trigger.getHandlerFunction();
    if (handlerName === 'onEditTrigger' || handlerName === 'checkQueueForProcessing' || handlerName === 'checkInboxAndPostNext') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create 15-minute time-based trigger for inbox scanning + posting to Chat
  ScriptApp.newTrigger('checkInboxAndPostNext')
    .timeBased()
    .everyMinutes(15)
    .create();

  logAction('SYSTEM', 'SETUP', 'Time-based trigger installed (checkInboxAndPostNext every 15 min)');
}

// ============================================================================
// MAIN SETUP FUNCTIONS
// ============================================================================

/**
 * Main setup for Email Sorter module.
 * Creates sheets, prompts for label mode and connection mode, sets up triggers.
 */
function emailSorterSetup() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();

  ui.alert('Setup Starting', 'Creating sheets and initializing Smart Call Time...', ui.ButtonSet.OK);

  // Create all required sheets
  createConfigSheet(ss);
  createLabelsSheet(ss);
  createQueueSheet(ss);
  createLogSheet(ss);
  createInstructionsSheet(ss);

  // ── LABEL MODE ──────────────────────────────────────────────────────────────
  var labelMode = promptForLabelMode(ui);

  // Always sync existing Gmail labels into the Labels sheet
  syncLabelsToSheet();

  if (labelMode === 'add_and_scan') {
    // Offer to add new labels to Gmail now
    var addNow = ui.alert(
      'Add Labels',
      'Your existing Gmail labels have been synced.\n\n' +
      'Would you like to add a new label to Gmail now?',
      ui.ButtonSet.YES_NO
    );
    if (addNow === ui.Button.YES) {
      addCustomLabelFromMenu();
    }
  }

  // ── CONNECTION MODE ──────────────────────────────────────────────────────────
  promptForConnectionMode(ui);

  // ── GENERAL SETUP ────────────────────────────────────────────────────────────
  setupTriggers();
  promptForInstanceName(ui);

  // Hub / webhook setup is only needed in Chat Hub mode
  var connectionMode = getConfigValue('connection_mode') || 'chat_hub';
  if (connectionMode === 'chat_hub') {
    ensureWebhookUrl(ui);
    verifyWebhookUrl(ui);
    promptForHubRegistration(ui);
  }

  // Navigate to Instructions
  var instructionsSheet = ss.getSheetByName('Instructions');
  if (instructionsSheet) {
    ss.setActiveSheet(instructionsSheet);
  }

  var modeDesc = connectionMode === 'direct_claude_api'
    ? 'Direct Claude API (Hub bypassed)'
    : 'Chat Hub (via Google Chat)';

  ui.alert('Setup Complete!',
    'Email Sorter is ready.\n\n' +
    'Label Mode:      ' + (labelMode === 'add_and_scan' ? 'Add & Scan' : 'Scan Only') + '\n' +
    'Connection Mode: ' + modeDesc + '\n' +
    'Instance Name:   ' + (getConfigValue('instance_name') || '(not set)') + '\n\n' +
    (connectionMode === 'direct_claude_api'
      ? 'Next: Settings > Claude API > Set API Key'
      : 'Next: Review the Instructions sheet and configure your Google Flows'),
    ui.ButtonSet.OK);
}

// ============================================================================
// LABEL MODE
// ============================================================================

/**
 * Prompts the user to choose how labels are populated during setup.
 * Both options always use Gmail labels for ongoing operation.
 * Saves the choice to Config sheet as 'label_mode'.
 * Returns the chosen mode: 'add_and_scan' or 'scan_only'.
 *
 * @param {Ui} ui - SpreadsheetApp UI
 * @returns {string} 'add_and_scan' or 'scan_only'
 */
function promptForLabelMode(ui) {
  var current = getConfigValue('label_mode') || '';
  var currentDesc = current === 'add_and_scan' ? 'Add & Scan' : current === 'scan_only' ? 'Scan Only' : 'not set';

  var response = ui.alert(
    'Label Setup',
    'Labels are always synced from Gmail. How do you want to set them up now?\n\n' +
    '• YES → Add & Scan\n' +
    '  Sync your existing Gmail labels AND add new ones now.\n\n' +
    '• NO  → Scan Only\n' +
    '  Sync your existing Gmail labels into the Labels sheet.\n' +
    '  You can add labels in Gmail and re-sync anytime.\n\n' +
    (current ? 'Current setting: ' + currentDesc : ''),
    ui.ButtonSet.YES_NO
  );

  var mode = (response === ui.Button.YES) ? 'add_and_scan' : 'scan_only';
  setConfigValue('label_mode', mode);
  logAction('SYSTEM', 'LABEL_MODE', 'Label mode set to: ' + mode);
  return mode;
}

/**
 * Menu action to update the label setup mode at any time.
 * Both modes always use Gmail labels; the choice only affects
 * whether new labels are added during the setup step.
 */
function switchLabelModeFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var mode = promptForLabelMode(ui);

  // Always sync existing Gmail labels regardless of mode
  syncLabelsToSheet();

  if (mode === 'add_and_scan') {
    var addNow = ui.alert(
      'Add Labels',
      'Your Gmail labels have been synced.\n\n' +
      'Would you like to add a new label to Gmail now?',
      ui.ButtonSet.YES_NO
    );
    if (addNow === ui.Button.YES) {
      addCustomLabelFromMenu();
    }
  } else {
    ui.alert('Labels Synced',
      'Your Gmail labels have been synced to the Labels sheet.\n\n' +
      'Use Smart Call Time > Email Sorter > Sync Labels Now to refresh anytime.',
      ui.ButtonSet.OK);
  }
}

/**
 * Menu action to add a single custom label to the Labels sheet.
 * Works in both label modes but is most useful in custom mode.
 */
function addCustomLabelFromMenu() {
  var ui = SpreadsheetApp.getUi();

  var nameResponse = ui.prompt(
    'Add Custom Label',
    'Enter the label name.\n' +
    'This is what will be applied to emails in Gmail.\n\n' +
    'Example: Work, Personal, Urgent, Follow-Up, Clients',
    ui.ButtonSet.OK_CANCEL
  );

  if (nameResponse.getSelectedButton() !== ui.Button.OK) return;
  var labelName = nameResponse.getResponseText().trim();
  if (!labelName) return;

  var descResponse = ui.prompt(
    'Label Description (optional)',
    'Add a short description to help the AI understand what this label is for.\n\n' +
    'Example: "Emails from work colleagues or about work projects"\n\n' +
    'You can leave this blank.',
    ui.ButtonSet.OK_CANCEL
  );

  if (descResponse.getSelectedButton() !== ui.Button.OK) return;
  var description = descResponse.getResponseText().trim();

  // Write to Labels sheet
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Labels');
  if (!sheet) {
    ui.alert('Error', 'Labels sheet not found. Run Setup first.', ui.ButtonSet.OK);
    return;
  }

  var now = new Date().toISOString();
  var newRow = [labelName, labelName, '', 'Custom', description, now];
  sheet.appendRow(newRow);

  logAction('SYSTEM', 'CUSTOM_LABEL_ADD', 'Added custom label: ' + labelName);

  ui.alert('Label Added',
    'Custom label "' + labelName + '" added to the Labels sheet.\n\n' +
    (description ? 'Description: ' + description : '(no description)') + '\n\n' +
    'Note: You must also create this label in Gmail for it to be applied to emails.',
    ui.ButtonSet.OK);
}

// ============================================================================
// CONNECTION MODE
// ============================================================================

/**
 * Prompts the user to choose between Chat Hub mode and Direct Claude API mode.
 * Saves the choice to Config sheet as 'connection_mode'.
 *
 * @param {Ui} ui - SpreadsheetApp UI
 * @returns {string} 'chat_hub' or 'direct_claude_api'
 */
function promptForConnectionMode(ui) {
  var current = getConfigValue('connection_mode') || '';

  var response = ui.alert(
    'Connection Mode',
    'How should emails be sent to AI for categorization?\n\n' +
    '• YES → Chat Hub Mode (current default)\n' +
    '  Emails are posted to Google Chat.\n' +
    '  The Hub routes them through Google Flows to an AI.\n' +
    '  Requires Hub registration and a Chat webhook URL.\n\n' +
    '• NO  → Direct Claude API Mode\n' +
    '  Emails are sent directly to the Anthropic Claude API.\n' +
    '  Bypasses the Hub entirely — no Chat, no Flows needed.\n' +
    '  Requires your own Anthropic API key.\n\n' +
    (current ? 'Current: ' + (current === 'direct_claude_api' ? 'Direct Claude API' : 'Chat Hub') : ''),
    ui.ButtonSet.YES_NO
  );

  var mode = (response === ui.Button.YES) ? 'chat_hub' : 'direct_claude_api';
  setConfigValue('connection_mode', mode);
  logAction('SYSTEM', 'CONNECTION_MODE', 'Connection mode set to: ' + mode);

  if (mode === 'direct_claude_api') {
    ui.alert('Direct Claude API Mode Selected',
      'The Hub and Google Chat will NOT be used.\n\n' +
      'Next steps:\n' +
      '1. Settings > Claude API > Set API Key\n' +
      '2. Settings > Claude API > Select Model\n' +
      '3. (Optional) Settings > Claude API > Edit System Prompt\n' +
      '4. Settings > Claude API > Test Claude API Connection',
      ui.ButtonSet.OK);
  }

  return mode;
}

/**
 * Menu action to switch connection mode at any time.
 */
function switchConnectionModeFromMenu() {
  var ui = SpreadsheetApp.getUi();
  promptForConnectionMode(ui);
}

/**
 * Prompts the user to set their instance name if not already configured.
 * @param {Ui} ui - The SpreadsheetApp UI object
 */
function promptForInstanceName(ui) {
  var currentName = getConfigValue('instance_name');

  if (!currentName) {
    var response = ui.prompt('Instance Name',
      'Enter a unique name for this instance.\n\n' +
      'This name appears in Chat messages and is used by Flow to filter.\n' +
      'Use letters, numbers, and underscores only.\n\n' +
      'Example: Johns_Sorter, Sales_Team, Personal_Email',
      ui.ButtonSet.OK_CANCEL);

    if (response.getSelectedButton() === ui.Button.OK) {
      var instanceName = response.getResponseText().trim();
      // Replace spaces with underscores, remove special characters
      instanceName = instanceName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

      if (instanceName) {
        setConfigValue('instance_name', instanceName);
        logAction('SYSTEM', 'CONFIG', 'Instance name set to: ' + instanceName);
      }
    }
  }
}

/**
 * Ensures the webhook URL (this instance's web app URL) is set in the Config sheet.
 * Tries auto-detection first, then prompts the user to paste it manually.
 * @param {Ui} ui - The SpreadsheetApp UI object
 */
function ensureWebhookUrl(ui) {
  // getWebhookUrl() already tries auto-detection and saves to Config sheet
  var url = getWebhookUrl();
  if (url) {
    logAction('CONFIG', 'WEBHOOK_URL_SET', 'Webhook URL: ' + url);
    return;
  }

  // Auto-detect failed (not deployed as web app yet, or dev mode)
  // Prompt the user to paste it manually
  var response = ui.prompt('Webhook URL',
    'Could not auto-detect your web app URL.\n\n' +
    'To find it:\n' +
    '1. Open Extensions > Apps Script\n' +
    '2. Click Deploy > Manage deployments\n' +
    '3. Copy the Web app URL\n\n' +
    'Paste your deployed web app URL:',
    ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() === ui.Button.OK) {
    var manualUrl = response.getResponseText().trim();
    if (manualUrl && manualUrl.indexOf('script.google.com') !== -1) {
      setWebhookUrl(manualUrl);
      logAction('CONFIG', 'WEBHOOK_URL_MANUAL', 'Manually set webhook URL: ' + manualUrl);
    } else if (manualUrl) {
      ui.alert('Invalid URL',
        'That doesn\'t look like a Google Apps Script web app URL.\n' +
        'It should start with https://script.google.com/macros/s/\n\n' +
        'You can set it later in the Config sheet (webhook_url row).',
        ui.ButtonSet.OK);
    }
  }
}

/**
 * Verifies the webhook URL is reachable by sending a GET request to it.
 * If the GET fails or returns an error page, warns the user and offers
 * to set the URL manually.
 *
 * @param {Ui} ui - The SpreadsheetApp UI object
 */
function verifyWebhookUrl(ui) {
  var url = getConfigValue('webhook_url');
  if (!url) return; // Nothing to verify

  logAction('CONFIG', 'WEBHOOK_VERIFY', 'Verifying webhook URL: ' + url);

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'GET',
      muteHttpExceptions: true,
      followRedirects: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    logAction('CONFIG', 'WEBHOOK_VERIFY_RESULT', 'HTTP ' + code + ' | ' + body.substring(0, 200));

    if (code === 200) {
      // Check the response looks like our doGet (JSON with status field)
      try {
        var parsed = JSON.parse(body);
        if (parsed.status && parsed.status.indexOf('Webhook Active') !== -1) {
          logAction('CONFIG', 'WEBHOOK_VERIFY_OK', 'Webhook URL verified successfully');
          return; // All good
        }
      } catch (e) {
        // Not JSON — might be an error page
      }
    }

    // URL returned something unexpected (error page, redirect to Google login, etc.)
    logAction('CONFIG', 'WEBHOOK_VERIFY_WARN', 'Webhook URL returned unexpected response: HTTP ' + code);

    var bodyPreview = body.length > 300 ? body.substring(0, 300) + '...' : body;
    var result = ui.alert('Webhook URL Warning',
      'The stored webhook URL may not be working correctly.\n\n' +
      'URL: ' + url + '\n' +
      'HTTP Status: ' + code + '\n' +
      'Response: ' + bodyPreview + '\n\n' +
      'This can happen if the web app was re-deployed.\n\n' +
      'Would you like to update the webhook URL now?',
      ui.ButtonSet.YES_NO);

    if (result === ui.Button.YES) {
      // Clear the bad URL and prompt for a new one
      setConfigValue('webhook_url', '');
      ensureWebhookUrl(ui);
    }

  } catch (error) {
    logAction('CONFIG', 'WEBHOOK_VERIFY_ERROR', 'Failed to reach webhook URL: ' + error.message);

    var result = ui.alert('Webhook URL Error',
      'Could not reach your webhook URL:\n' + url + '\n\n' +
      'Error: ' + error.message + '\n\n' +
      'Would you like to update the webhook URL now?',
      ui.ButtonSet.YES_NO);

    if (result === ui.Button.YES) {
      setConfigValue('webhook_url', '');
      ensureWebhookUrl(ui);
    }
  }
}

/**
 * Menu action to manually set or update the webhook URL.
 */
function setWebhookUrlFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var currentUrl = getConfigValue('webhook_url') || '(not set)';

  var response = ui.prompt('Set Webhook URL',
    'Current webhook URL:\n' + currentUrl + '\n\n' +
    'Enter your deployed web app URL:\n' +
    '(Find it in Deploy > Manage deployments in the Apps Script editor)',
    ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() === ui.Button.OK) {
    var url = response.getResponseText().trim();
    if (url && url.indexOf('script.google.com') !== -1) {
      setWebhookUrl(url);
      ui.alert('Saved', 'Webhook URL updated in Config sheet.', ui.ButtonSet.OK);
      logAction('CONFIG', 'WEBHOOK_URL_MANUAL', 'Webhook URL set from menu: ' + url);
    } else if (url) {
      ui.alert('Invalid URL',
        'That doesn\'t look like a Google Apps Script web app URL.\n' +
        'It should start with https://script.google.com/macros/s/',
        ui.ButtonSet.OK);
    }
  }
}

/**
 * Refreshes all modules - syncs labels, updates instructions.
 */
function refreshAll() {
  var ui = SpreadsheetApp.getUi();

  syncLabelsToSheet();

  ui.alert('Refresh Complete',
    'All data has been refreshed.',
    ui.ButtonSet.OK);
}

/**
 * Prompts the user to register with the Hub during setup.
 * Registration goes through Google Chat - no Hub URL needed.
 * @param {Ui} ui - The SpreadsheetApp UI object
 */
function promptForHubRegistration(ui) {
  var chatWebhookUrl = getChatWebhookUrl();

  if (!chatWebhookUrl) {
    ui.alert('Chat Webhook Not Set',
      'To register with the Hub, you need a Chat webhook URL.\n\n' +
      'Set chat_webhook_url in the Config sheet first.\n' +
      'You can register later via Settings > Register with Hub.',
      ui.ButtonSet.OK);
    return;
  }

  var webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    // Try to let user set it right now instead of dead-ending
    ensureWebhookUrl(ui);
    webhookUrl = getConfigValue('webhook_url');
    if (!webhookUrl) {
      ui.alert('Webhook URL Not Set',
        'Your web app URL is not set in the Config sheet.\n\n' +
        'You can set it anytime via:\n' +
        '  Settings > Set Webhook URL\n' +
        '  Or edit the Config sheet directly (webhook_url row)',
        ui.ButtonSet.OK);
      return;
    }
  }

  var response = ui.alert(
    'Hub Registration',
    'Register this sheet with the Central Hub?\n\n' +
    'This posts a REGISTER message to the Chat space.\n' +
    'The Hub will see it, store your webhook URL, and confirm.\n\n' +
    'Chat webhook: ' + chatWebhookUrl.substring(0, 50) + '...\n' +
    'Your webhook: ' + webhookUrl.substring(0, 50) + '...',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  var result = registerWithHub();
  if (result.success) {
    ui.alert('Registration Sent',
      'Registration message posted to Chat.\n\n' +
      'The Hub will:\n' +
      '1. See the REGISTER message\n' +
      '2. Store your webhook URL in the Registry sheet\n' +
      '3. Send a confirmation webhook to your web app\n' +
      '4. Delete the registration chat message\n\n' +
      'Check the Log sheet for confirmation.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Registration Failed', result.error || 'Unknown error', ui.ButtonSet.OK);
  }
}

/**
 * Menu action for registering/re-registering with the Hub.
 * Registration goes through Google Chat - no Hub URL needed.
 */
function registerWithHubFromMenu() {
  var ui = SpreadsheetApp.getUi();

  var chatWebhookUrl = getChatWebhookUrl();
  if (!chatWebhookUrl) {
    ui.alert('Not Configured',
      'Chat webhook URL not set.\n\n' +
      'Set chat_webhook_url in the Config sheet first.\n' +
      '(Unhide the Config sheet: right-click the sheet tab bar)',
      ui.ButtonSet.OK);
    return;
  }

  var webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    ensureWebhookUrl(ui);
    webhookUrl = getConfigValue('webhook_url');
    if (!webhookUrl) {
      ui.alert('Webhook URL Not Set',
        'Your web app URL is not set.\n\n' +
        'Set it via Settings > Set Webhook URL\n' +
        'or edit the Config sheet directly (webhook_url row).',
        ui.ButtonSet.OK);
      return;
    }
  }

  var result = registerWithHub();

  if (result.success) {
    ui.alert('Registration Sent',
      'REGISTER message posted to Chat.\n' +
      'Hub will confirm via webhook. Check Log sheet.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', 'Could not register: ' + (result.error || 'Unknown error'), ui.ButtonSet.OK);
  }
}

// ============================================================================
// AUTHORIZATION
// ============================================================================

/**
 * Touches all OAuth scopes so the consent prompt covers everything at once.
 * Run this function once (from the editor or via clasp run) to authorize.
 * After approving, all other functions will work without further prompts.
 */
function authorize() {
  // Gmail scopes
  GmailApp.getUserLabels();

  // Spreadsheet scope
  SpreadsheetApp.getActive();

  // External request scope (UrlFetchApp)
  UrlFetchApp.getRequest && UrlFetchApp;

  Logger.log('All scopes authorized successfully.');
  return { status: 'authorized', scopes: 'gmail, spreadsheets, urlfetch' };
}

// ============================================================================
// UTILITY SHORTCUTS (Delegates to modules)
// ============================================================================

/**
 * Shows the current configuration.
 */
function showConfig() {
  var ui = SpreadsheetApp.getUi();

  var connectionMode = getConfigValue('connection_mode') || 'chat_hub';
  var labelMode = getConfigValue('label_mode') || 'gmail';
  var apiKey = getConfigValue('claude_api_key') || '';
  var maskedKey = apiKey ? apiKey.substring(0, 12) + '...' : '(not set)';

  var config = [
    '── General ──',
    'Instance Name:    ' + (getConfigValue('instance_name') || '(not set)'),
    'Label Mode:       ' + (labelMode === 'custom' ? 'Custom Labels' : 'Gmail Labels'),
    'Connection Mode:  ' + (connectionMode === 'direct_claude_api' ? 'Direct Claude API' : 'Chat Hub'),
    '',
    '── Claude API (direct mode) ──',
    'API Key:          ' + maskedKey,
    'Model:            ' + (getConfigValue('claude_model') || 'claude-sonnet-4-5'),
    'System Prompt:    ' + (getConfigValue('claude_system_prompt') ? 'Custom (set)' : 'Default'),
    '',
    '── Chat Hub ──',
    'Chat Webhook:     ' + (getChatWebhookUrl() ? 'Set' : 'NOT SET'),
    'Webhook URL:      ' + (getWebhookUrl() || '(not set)'),
    'Hub Registered:   ' + (getConfigValue('hub_registered') || 'false'),
    '',
    '── Processing ──',
    'Rate Limit:       ' + (getConfigValue('rate_limit_ms') || '3000') + 'ms',
    'Batch Size:       ' + (getConfigValue('batch_size') || '50'),
    'Last Label Sync:  ' + (getConfigValue('last_label_sync') || 'Never'),
  ].join('\n');

  ui.alert('Configuration', config, ui.ButtonSet.OK);
}
