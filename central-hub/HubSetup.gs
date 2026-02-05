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
    .addItem('View Registered Users', 'showRegisteredUsers')
    .addItem('View Pending Requests', 'showPendingRequests')
    .addItem('Cleanup Old Requests', 'cleanupPendingRequests')
    .addSeparator()
    .addItem('Test Chat Connection', 'testChatConnection')
    .addItem('Test Route to User', 'testRouteToUser')
    .addItem('Test Invite User', 'testInviteUser')
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

  ui.alert(
    'Hub Setup Complete',
    'Required sheets have been created.\n\n' +
    'Next steps:\n' +
    '1. Deploy this project as a Web App\n' +
    '2. Deploy as a Chat App (for receiving AI messages)\n' +
    '3. Configure the Chat Webhook URL (for outbound messages)\n' +
    '4. Configure the Chat Space ID (for auto-inviting users)\n' +
    '5. Share the Hub Web App URL with users',
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
      // Ensure proper format
      if (!spaceId.startsWith('spaces/')) {
        spaceId = 'spaces/' + spaceId;
      }

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

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Tests the Chat connection by sending a test message.
 */
function testChatConnection() {
  const ui = SpreadsheetApp.getUi();

  const result = sendStatusToChat('Hub test message - Chat connection is working!');

  if (result.success) {
    ui.alert('Success', 'Test message sent to Chat successfully!', ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', `Could not send message: ${result.error}`, ui.ButtonSet.OK);
  }
}

/**
 * Tests routing to a user.
 */
function testRouteToUser() {
  const ui = SpreadsheetApp.getUi();

  const users = getAllActiveUsers();

  if (users.length === 0) {
    ui.alert('No Users', 'No registered users to test with.', ui.ButtonSet.OK);
    return;
  }

  // Use first user for test
  const testUser = users[0];

  const response = ui.prompt(
    'Test Route',
    `Test routing to ${testUser.instanceName}?\n\nEnter test labels (e.g., "Test, Demo"):`,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const labels = response.getResponseText().trim() || 'Test Label';

    const result = routeLabelsToUser(testUser.instanceName, labels, 'test_email_id');

    if (result.success) {
      ui.alert('Success', `Routed "${labels}" to ${testUser.instanceName}\n\nWebhook response: ${JSON.stringify(result.webhookResponse)}`, ui.ButtonSet.OK);
    } else {
      ui.alert('Failed', `Routing failed: ${result.error}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * Tests inviting a user to the Chat space.
 */
function testInviteUser() {
  const ui = SpreadsheetApp.getUi();

  const spaceId = getHubConfig('chat_space_id');
  if (!spaceId) {
    ui.alert('Not Configured', 'Chat space ID not configured. Run "Configure Chat Space" first.', ui.ButtonSet.OK);
    return;
  }

  const response = ui.prompt(
    'Test Invite',
    'Enter email address to invite to the Chat space:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const email = response.getResponseText().trim();

    if (email) {
      const result = inviteUserToSpace(email);

      if (result.success) {
        ui.alert('Success', result.message, ui.ButtonSet.OK);
      } else {
        ui.alert('Failed', `Invite failed: ${result.error}`, ui.ButtonSet.OK);
      }
    }
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
