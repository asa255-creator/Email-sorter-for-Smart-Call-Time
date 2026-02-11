/**
 * Central Hub - Test Manager
 *
 * Menu-driven tests for webhook and chat connectivity.
 * All Hub input comes through Chat (onMessage). The Hub sends
 * outbound webhooks to user instances.
 */

// ============================================================================
// MENU-TRIGGERED TESTS (HUB)
// ============================================================================

/**
 * Tests webhook connectivity: Hub -> User (one-way webhook from Hub).
 * Hub sends a ping to the user's webhook URL.
 */
function testWebhookPingFromHub() {
  var ui = SpreadsheetApp.getUi();
  var instanceName = promptForTestInstance(ui);

  if (!instanceName) return;

  var testId = Utilities.getUuid();
  var payload = {
    action: 'test_webhook_ping',
    instanceName: instanceName,
    testId: testId,
    message: 'Ping from Hub',
    origin: 'hub'
  };

  var result = sendWebhookToUser(instanceName, payload);

  if (result.success) {
    logHub('TEST_WEBHOOK_PING_SENT', instanceName + ' (' + testId + ')');
    ui.alert('Ping Sent', 'Webhook ping sent to user. Check user Log sheet for confirmation.', ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', 'Could not send ping: ' + result.error, ui.ButtonSet.OK);
  }
}

/**
 * Tests chat connectivity: Hub -> User -> Chat -> Hub.
 * Hub sends webhook to user asking them to post to chat.
 */
function testChatConnectionFromHub() {
  var ui = SpreadsheetApp.getUi();
  var instanceName = promptForTestInstance(ui);

  if (!instanceName) return;

  var testId = Utilities.getUuid();
  var payload = {
    action: 'test_chat_request',
    instanceName: instanceName,
    testId: testId,
    message: 'Send test chat message',
    origin: 'hub'
  };

  var result = sendWebhookToUser(instanceName, payload);

  if (result.success) {
    logHub('TEST_CHAT_REQUEST_SENT', instanceName + ' (' + testId + ')');
    ui.alert('Request Sent', 'Chat test request sent to user. Wait for test message in HubLog.', ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', 'Could not send chat request: ' + result.error, ui.ButtonSet.OK);
  }
}

// ============================================================================
// SHEETS CHAT ROUND-TRIP TEST (Hub-initiated)
// ============================================================================

/**
 * Tests the full Sheets-Chat round-trip from the Hub side.
 *
 * Flow:
 * 1. Hub sends webhook to User with test_sheets_chat_start
 * 2. User sends chat: @instanceName:[testId] SHEETS_CHAT_TEST
 * 3. Hub sees chat (onMessage), sends webhook to User: test_sheets_chat_confirm
 * 4. User sends chat: @instanceName:[testId] CONFIRMED
 * 5. Hub sees CONFIRMED (onMessage), deletes both messages, sends completion webhook
 */
function testSheetsChatFromHub() {
  var ui = SpreadsheetApp.getUi();
  var instanceName = promptForTestInstance(ui);

  if (!instanceName) return;

  var testId = Utilities.getUuid();
  var payload = {
    action: 'test_sheets_chat_start',
    instanceName: instanceName,
    conversationId: testId,
    message: 'Start Sheets Chat round-trip test',
    origin: 'hub'
  };

  var result = sendWebhookToUser(instanceName, payload);

  if (result.success) {
    logHub('SHEETS_CHAT_TEST_INITIATED', instanceName + ' [' + testId + ']');
    ui.alert('Test Initiated',
      'Sheets Chat round-trip test started for ' + instanceName + '.\n\n' +
      'Flow:\n' +
      '1. Webhook sent to User sheet\n' +
      '2. User will post SHEETS_CHAT_TEST to chat\n' +
      '3. Hub will detect and send confirm webhook\n' +
      '4. User will post CONFIRMED to chat\n' +
      '5. Hub will delete both messages\n\n' +
      'Check HubLog for progress.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', 'Could not initiate test: ' + result.error, ui.ButtonSet.OK);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Prompts the admin to select a test target instance.
 *
 * @param {GoogleAppsScript.Base.Ui} ui - UI instance
 * @returns {string|null} Instance name
 */
function promptForTestInstance(ui) {
  var users = getAllActiveUsers();

  if (users.length === 0) {
    ui.alert('No Users', 'No registered users to test with.', ui.ButtonSet.OK);
    return null;
  }

  var list = users.map(function(user) { return user.instanceName; }).join(', ');
  var response = ui.prompt(
    'Select User',
    'Enter instance name to test.\n\nRegistered: ' + list,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return null;
  }

  var instanceName = response.getResponseText().trim();
  if (!instanceName) {
    ui.alert('Missing Instance', 'Please enter a valid instance name.', ui.ButtonSet.OK);
    return null;
  }

  return instanceName;
}
