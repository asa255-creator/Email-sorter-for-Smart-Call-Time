/**
 * Smart Call Time - Flow Integrator
 * Main entry points, menu setup, and triggers
 *
 * This is the main orchestration file that sets up menus and triggers.
 * All functionality is delegated to specialized modules.
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
  const ui = SpreadsheetApp.getUi();

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
      .addItem('Register / Re-register with Hub', 'registerWithHubFromMenu')
      .addItem('Refresh All', 'refreshAll'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Testing')
      .addItem('Test Webhook Ping (User → Hub → User)', 'testWebhookPingFromUser')
      .addItem('Test Chat Connection (User → Chat → Hub → User)', 'testChatConnectionFromUser'))
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
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    const handlerName = trigger.getHandlerFunction();
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
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();

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
  const instructionsSheet = ss.getSheetByName('Instructions');
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
  const currentName = getConfigValue('instance_name');

  if (!currentName) {
    const response = ui.prompt('Instance Name',
      'Enter a unique name for this instance.\n\n' +
      'This name appears in Chat messages and is used by Flow to filter.\n' +
      'Use letters, numbers, and underscores only.\n\n' +
      'Example: Johns_Sorter, Sales_Team, Personal_Email',
      ui.ButtonSet.OK_CANCEL);

    if (response.getSelectedButton() === ui.Button.OK) {
      let instanceName = response.getResponseText().trim();
      // Replace spaces with underscores, remove special characters
      instanceName = instanceName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

      if (instanceName) {
        setConfigValue('instance_name', instanceName);
        logAction('SYSTEM', 'CONFIG', `Instance name set to: ${instanceName}`);
      }
    }
  }
}

/**
 * Refreshes all modules - syncs labels, updates instructions.
 */
function refreshAll() {
  const ui = SpreadsheetApp.getUi();

  syncLabelsToSheet();

  ui.alert('Refresh Complete',
    'All data has been refreshed.',
    ui.ButtonSet.OK);
}

/**
 * Prompts the user to register/re-register with the Hub during setup.
 * @param {Ui} ui - The SpreadsheetApp UI object
 */
function promptForHubRegistration(ui) {
  const currentHubUrl = getHubUrl();

  const response = ui.alert(
    'Hub Registration',
    'Would you like to register this sheet with the Central Hub now?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  const hubUrl = promptForHubUrl(ui, currentHubUrl);
  if (!hubUrl) {
    return;
  }

  const result = registerWithHub(hubUrl);
  if (result.success) {
    ui.alert('Success', 'This sheet is now registered with the Hub.', ui.ButtonSet.OK);
  } else {
    ui.alert('Registration Failed', result.error || 'Unknown error', ui.ButtonSet.OK);
  }
}

/**
 * Menu action for registering/re-registering with the Hub.
 */
function registerWithHubFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const currentHubUrl = getHubUrl();
  const hubUrl = promptForHubUrl(ui, currentHubUrl);

  if (!hubUrl) {
    return;
  }

  const result = registerWithHub(hubUrl);

  if (result.success) {
    ui.alert('Success', 'Hub registration completed successfully.', ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', `Could not register with Hub: ${result.error || 'Unknown error'}`, ui.ButtonSet.OK);
  }
}

/**
 * Prompts for Hub URL and returns it, prefilling with existing value if available.
 * @param {Ui} ui - The SpreadsheetApp UI object
 * @param {string|null} currentHubUrl - Existing Hub URL
 * @returns {string|null} Hub URL or null if cancelled/empty
 */
function promptForHubUrl(ui, currentHubUrl) {
  const message = currentHubUrl
    ? `Current Hub URL:\n${currentHubUrl}\n\nEnter Hub web app URL (or click Cancel):`
    : 'Enter the Central Hub web app URL:';

  const response = ui.prompt('Hub URL', message, ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() !== ui.Button.OK) {
    return null;
  }

  const entered = response.getResponseText().trim();
  if (!entered) {
    ui.alert('No URL Entered', 'Hub registration skipped.', ui.ButtonSet.OK);
    return null;
  }

  return entered;
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
  // Just referencing the service is enough; no actual request needed
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
  const ui = SpreadsheetApp.getUi();

  const config = [
    'Rate Limit: ' + (getConfigValue('rate_limit_ms') || '3000') + 'ms',
    'Batch Size: ' + (getConfigValue('batch_size') || '50'),
    'Last Label Sync: ' + (getConfigValue('last_label_sync') || 'Never'),
  ].join('\n');

  ui.alert('Configuration', config, ui.ButtonSet.OK);
}
