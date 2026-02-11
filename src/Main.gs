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
      .addItem('Queue Unlabeled Emails', 'queueUnlabeledEmails')
      .addItem('Process All Pending', 'processAllPending')
      .addSeparator()
      .addItem('Clear Queue', 'clearQueue'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Settings')
      .addItem('Show Configuration', 'showConfig')
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
    if (handlerName === 'onEditTrigger' || handlerName === 'checkQueueForProcessing') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create 15-minute time-based trigger for queue checking
  ScriptApp.newTrigger('checkQueueForProcessing')
    .timeBased()
    .everyMinutes(15)
    .create();

  logAction('SYSTEM', 'SETUP', 'Time-based trigger installed (every 15 min)');
}

// ============================================================================
// MAIN SETUP FUNCTIONS
// ============================================================================

/**
 * Main setup for Email Sorter module.
 * Creates sheets, syncs labels, sets up triggers, and prompts for instance name.
 */
function emailSorterSetup() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();

  ui.alert('Setup Starting',
    'Creating sheets and syncing Gmail labels...',
    ui.ButtonSet.OK);

  // Create all required sheets
  createConfigSheet(ss);
  createLabelsSheet(ss);
  createQueueSheet(ss);
  createLogSheet(ss);
  createInstructionsSheet(ss);

  // Sync Gmail labels
  syncLabelsToSheet();

  // Setup triggers
  setupTriggers();

  // Prompt for instance name if not set
  promptForInstanceName(ui);

  // Offer Hub registration during setup
  promptForHubRegistration(ui);

  // Navigate to Instructions
  var instructionsSheet = ss.getSheetByName('Instructions');
  if (instructionsSheet) {
    ss.setActiveSheet(instructionsSheet);
  }

  ui.alert('Setup Complete!',
    'Email Sorter is ready.\n\n' +
    '1. Review the Instructions sheet\n' +
    '2. Configure your Google Flows\n' +
    '3. Instance name: ' + (getConfigValue('instance_name') || '(not set)') + '\n\n' +
    'Labels have been synced to the Labels sheet.',
    ui.ButtonSet.OK);
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
    ui.alert('Web App Not Deployed',
      'Deploy this project as a web app first so the Hub can send webhooks to you.\n' +
      'Your webhook URL will be set automatically during deployment.',
      ui.ButtonSet.OK);
    return;
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
    ui.alert('Not Deployed',
      'No webhook URL set. Deploy as web app first.',
      ui.ButtonSet.OK);
    return;
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

  var config = [
    'Instance Name: ' + (getConfigValue('instance_name') || '(not set)'),
    'Chat Webhook: ' + (getChatWebhookUrl() ? 'Set' : 'NOT SET'),
    'Webhook URL: ' + (getWebhookUrl() || '(not set)'),
    'Hub Registered: ' + (getConfigValue('hub_registered') || 'false'),
    '',
    'Rate Limit: ' + (getConfigValue('rate_limit_ms') || '3000') + 'ms',
    'Batch Size: ' + (getConfigValue('batch_size') || '50'),
    'Last Label Sync: ' + (getConfigValue('last_label_sync') || 'Never'),
  ].join('\n');

  ui.alert('Configuration', config, ui.ButtonSet.OK);
}
