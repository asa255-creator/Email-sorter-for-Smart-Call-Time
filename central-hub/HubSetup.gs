/**
 * Central Hub - Setup Functions
 *
 * Initial setup and configuration for the Central Hub.
 * Run these after deploying the Hub.
 */

// ============================================================================
// SETUP MENU
// ============================================================================

/**
 * Creates the Hub menu when the spreadsheet opens.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Hub Admin')
    .addItem('Initial Setup', 'runHubSetup')
    .addItem('Configure Chat Webhook', 'configureChatWebhook')
    .addItem('Configure Chat Space (for invites)', 'configureChatSpace')
    .addSeparator()
    .addSubMenu(ui.createMenu('Timer')
      .addItem('Start Hub Timer (5-min)', 'setupHubTimer')
      .addItem('Stop Hub Timer', 'removeHubTimer')
      .addItem('Run Timer Now (manual)', 'hubTimerProcess'))
    .addSeparator()
    .addItem('View Recent Chat Messages', 'viewRecentChatMessagesFromHub')
    .addItem('View Registered Users', 'showRegisteredUsers')
    .addItem('View Pending Requests', 'showPendingRequests')
    .addItem('View Labeling Queue', 'showLabelingQueue')
    .addItem('Cleanup Old Requests', 'cleanupPendingRequests')
    .addSeparator()
    .addItem('Delete Pending Chat Messages', 'deletePendingChatMessages')
    .addItem('Clear All Chat Messages', 'clearAllChatMessages')
    .addSeparator()
    .addItem('Test Webhook Ping (Hub → User → Hub)', 'testWebhookPingFromHub')
    .addItem('Test Chat Connection (Hub → User → Chat → Hub)', 'testChatConnectionFromHub')
    .addItem('Test Sheets Chat Round-Trip (Full test with message cleanup)', 'testSheetsChatFromHub')
    .addSeparator()
    .addItem('Retry Pending Registration Webhooks', 'retryPendingRegistrationWebhooks')
    .addItem('Diagnose All Registry Users', 'diagnosePendingUsers')
    .addToUi();
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Runs initial Hub setup.
 * Creates required sheets and sets default configuration.
 */
function runHubSetup() {
  const ui = SpreadsheetApp.getUi();

  // Create all required sheets
  getOrCreateRegistrySheet();
  getOrCreatePendingSheet();
  getOrCreateLogSheet();
  getOrCreateConfigSheet();
  getOrCreateLabelingSheet();

  ui.alert(
    'Hub Setup Complete',
    'Required sheets have been created.\n\n' +
    'Next steps:\n' +
    '1. Enable the Google Chat API in Google Cloud Console\n' +
    '2. Configure Chat Space ID (Hub Admin > Configure Chat Space)\n' +
    '3. Configure Chat Webhook (Hub Admin > Configure Chat Webhook)\n' +
    '4. Start the Hub Timer (Hub Admin > Timer > Start Hub Timer)\n\n' +
    'The Hub is purely timer-driven — it polls Chat every 5 minutes.\n' +
    'No Chat App HTTP endpoint is needed.\n\n' +
    'See README.md for detailed instructions.',
    ui.ButtonSet.OK
  );
}

/**
 * Prompts for and saves the Chat webhook URL.
 */
function configureChatWebhook() {
  const ui = SpreadsheetApp.getUi();

  const currentUrl = getChatWebhookUrl();
  const prompt = currentUrl
    ? `Current URL: ${currentUrl}\n\nEnter new Chat space webhook URL (or cancel to keep current):`
    : 'Enter the Google Chat space webhook URL:';

  const response = ui.prompt('Configure Chat Webhook', prompt, ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() === ui.Button.OK) {
    const url = response.getResponseText().trim();

    if (url) {
      setChatWebhookUrl(url);
      ui.alert('Chat webhook URL saved successfully!');
    }
  }
}

/**
 * Prompts for and saves the Chat space ID (for inviting users).
 * The space ID is in the format "spaces/XXXXXXXXX".
 */
function configureChatSpace() {
  const ui = SpreadsheetApp.getUi();

  const currentSpaceId = getHubConfig('chat_space_id');

  ui.alert(
    'Chat Space ID',
    'To find your Chat space ID:\n\n' +
    '1. Open the Chat space in a browser\n' +
    '2. Look at the URL: https://chat.google.com/room/XXXXXXXXX\n' +
    '3. The space ID is "spaces/XXXXXXXXX"\n\n' +
    'Or use Apps Script to list spaces with Chat.Spaces.list()',
    ui.ButtonSet.OK
  );

  const prompt = currentSpaceId
    ? `Current: ${currentSpaceId}\n\nEnter space ID (format: spaces/XXXXXXXXX):`
    : 'Enter the Chat space ID (format: spaces/XXXXXXXXX):';

  const response = ui.prompt('Configure Chat Space', prompt, ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() === ui.Button.OK) {
    let spaceId = response.getResponseText().trim();

    if (spaceId) {
      // Clean up common mistakes from Chat URLs
      // URL might be: chat.google.com/chat/u/0/#chat/space/AAQAULujEoo
      // Or pasted as: spaces/space/AAQAULujEoo (wrong — extra /space/)
      // Correct format: spaces/AAQAULujEoo

      // Strip everything before the actual space code
      var spaceCode = spaceId.replace(/.*\/space\//, '')   // from URL paths
                             .replace(/.*\/room\//, '')     // from room URLs
                             .replace(/^spaces\//, '')      // strip spaces/ prefix
                             .replace(/\/.*/g, '')          // strip trailing paths
                             .trim();

      spaceId = 'spaces/' + spaceCode;

      setHubConfig('chat_space_id', spaceId);
      ui.alert('Success', `Chat space ID saved: ${spaceId}\n\nNew user registrations will now receive automatic invites.`, ui.ButtonSet.OK);
    }
  }
}

// ============================================================================
// ADMIN VIEW FUNCTIONS
// ============================================================================

/**
 * Shows registered users in a dialog.
 */
function showRegisteredUsers() {
  const ui = SpreadsheetApp.getUi();
  const users = getAllActiveUsers();

  if (users.length === 0) {
    ui.alert('No Users', 'No users are currently registered.', ui.ButtonSet.OK);
    return;
  }

  let message = `${users.length} registered user(s):\n\n`;

  for (const user of users) {
    message += `- ${user.instanceName} (${user.email})\n`;
    message += `  Webhook: ${user.webhookUrl}\n\n`;
  }

  ui.alert('Registered Users', message, ui.ButtonSet.OK);
}

/**
 * Shows pending requests in a dialog.
 */
function showPendingRequests() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    ui.alert('No Requests', 'No pending requests.', ui.ButtonSet.OK);
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  let pending = 0;
  let message = '';

  for (const row of data) {
    if (row[3] === 'pending') {
      pending++;
      message += `- ${row[1]}: ${row[2]} (${row[4]})\n`;
    }
  }

  if (pending === 0) {
    ui.alert('No Pending', 'No pending requests. All have been processed.', ui.ButtonSet.OK);
  } else {
    ui.alert('Pending Requests', `${pending} pending request(s):\n\n${message}`, ui.ButtonSet.OK);
  }
}

/**
 * Shows labeling queue status in a dialog.
 */
function showLabelingQueue() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getOrCreateLabelingSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    ui.alert('Empty', 'No entries in the labeling queue.', ui.ButtonSet.OK);
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var counts = { 'new': 0, dispatched: 0, completed: 0 };
  var details = '';

  for (var i = 0; i < data.length; i++) {
    var status = data[i][4] || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    if (status !== 'completed') {
      details += '- ' + data[i][1] + '/' + data[i][0] + ': ' + data[i][2] + ' [' + status + ']\n';
    }
  }

  var message = 'Labeling Queue Summary:\n\n' +
    'New (pending dispatch): ' + counts['new'] + '\n' +
    'Dispatched (awaiting confirm): ' + counts.dispatched + '\n' +
    'Completed: ' + counts.completed + '\n';

  if (details) {
    message += '\nActive entries:\n' + details;
  }

  ui.alert('Labeling Queue', message, ui.ButtonSet.OK);
}

// ============================================================================
// MESSAGE MANAGEMENT
// ============================================================================

/**
 * Deletes all chat messages tracked in pending requests, then clears pending entries.
 * Use this to clean up stuck pending messages (e.g. after failed registrations or tests).
 */
function deletePendingChatMessages() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getOrCreatePendingSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    ui.alert('No Pending', 'No pending requests to clean up.', ui.ButtonSet.OK);
    return;
  }

  var result = ui.alert(
    'Delete Pending Chat Messages',
    'This will delete all chat messages tracked in pending requests and clear the pending list.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (result !== ui.Button.YES) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var totalDeleted = 0;
  var totalPending = 0;

  for (var i = 0; i < data.length; i++) {
    var metadata = {};
    try { metadata = JSON.parse(data[i][5] || '{}'); } catch (e) {}

    if (metadata.messageNames && metadata.messageNames.length > 0) {
      var deleteResult = deleteChatMessages(metadata.messageNames);
      totalDeleted += deleteResult.deleted;
    }
    totalPending++;
  }

  // Clear all pending rows
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  logHub('PENDING_MESSAGES_CLEARED', 'Deleted ' + totalDeleted + ' chat messages from ' + totalPending + ' pending requests');
  ui.alert('Done', 'Deleted ' + totalDeleted + ' chat messages and cleared ' + totalPending + ' pending requests.', ui.ButtonSet.OK);
}

/**
 * Clears ALL messages from the Chat space.
 * Lists recent messages via Chat API and deletes them.
 * Use this as a nuclear option to clean up the chat space.
 */
function clearAllChatMessages() {
  var ui = SpreadsheetApp.getUi();
  var spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    ui.alert('Error', 'Chat space ID not configured. Run Hub Admin > Configure Chat Space first.', ui.ButtonSet.OK);
    return;
  }

  var result = ui.alert(
    'Clear ALL Chat Messages',
    'This will delete ALL messages posted by the Hub in the Chat space.\n\nThis cannot be undone. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result !== ui.Button.YES) return;

  var totalDeleted = 0;
  var pageToken = null;

  try {
    // List and delete messages in batches
    do {
      var params = { pageSize: 100 };
      if (pageToken) params.pageToken = pageToken;

      var response = Chat.Spaces.Messages.list(spaceId, params);
      var messages = response.messages || [];

      for (var i = 0; i < messages.length; i++) {
        try {
          Chat.Spaces.Messages.remove(messages[i].name);
          totalDeleted++;
        } catch (delErr) {
          // Skip messages we can't delete (e.g. from other senders)
          logHub('CLEAR_SKIP', messages[i].name + ': ' + delErr.message);
        }
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    // Also clear the pending sheet since those messages are now gone
    var pendingSheet = getOrCreatePendingSheet();
    var pendingLastRow = pendingSheet.getLastRow();
    if (pendingLastRow > 1) {
      pendingSheet.deleteRows(2, pendingLastRow - 1);
    }

    logHub('ALL_MESSAGES_CLEARED', 'Deleted ' + totalDeleted + ' messages from chat space');
    ui.alert('Done', 'Deleted ' + totalDeleted + ' messages from the chat space and cleared pending requests.', ui.ButtonSet.OK);

  } catch (error) {
    logHub('CLEAR_ERROR', error.message);
    ui.alert('Error', 'Failed to clear messages: ' + error.message, ui.ButtonSet.OK);
  }
}

// ============================================================================
// SHEET CREATION HELPERS
// ============================================================================

/**
 * Gets or creates the HubLog sheet.
 */
function getOrCreateLogSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName('HubLog');

  if (!sheet) {
    sheet = ss.insertSheet('HubLog');
    sheet.getRange(1, 1, 1, 3).setValues([['Timestamp', 'Action', 'Details']]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }

  return sheet;
}

/**
 * Gets or creates the HubConfig sheet.
 */
function getOrCreateConfigSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName('HubConfig');

  if (!sheet) {
    sheet = ss.insertSheet('HubConfig');
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');

    // Add default config
    sheet.appendRow(['hub_version', '1.0.0']);
  }

  return sheet;
}
