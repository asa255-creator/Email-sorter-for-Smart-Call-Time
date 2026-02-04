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
      .addItem('Refresh All', 'refreshAll'))
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
 * Creates sheets, syncs labels, and sets up triggers.
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

  // Navigate to Instructions
  const instructionsSheet = ss.getSheetByName('Instructions');
  if (instructionsSheet) {
    ss.setActiveSheet(instructionsSheet);
  }

  ui.alert('Setup Complete!',
    'Email Sorter is ready.\n\n' +
    '1. Review the Instructions sheet\n' +
    '2. Configure your Google Flows\n\n' +
    'Labels have been synced to the Labels sheet.',
    ui.ButtonSet.OK);
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

