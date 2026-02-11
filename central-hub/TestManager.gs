/**
 * Central Hub - Test Manager
 *
 * Menu-driven tests for webhook and chat connectivity.
 * These reuse the same webhook routing primitives as production flow.
 */

// ============================================================================
// MENU-TRIGGERED TESTS (HUB)
// ============================================================================

/**
 * Tests webhook connectivity: Hub -> User -> Hub.
 */
function testWebhookPingFromHub() {
  const ui = SpreadsheetApp.getUi();
  const instanceName = promptForTestInstance(ui);

  if (!instanceName) return;

  const testId = Utilities.getUuid();
  const payload = {
    action: 'test_webhook_ping',
    instanceName: instanceName,
    testId: testId,
    message: 'This is a test',
    origin: 'hub'
  };

  const result = sendWebhookToUser(instanceName, payload);

  if (result.success) {
    logHub('TEST_WEBHOOK_PING_SENT', `${instanceName} (${testId})`);
    ui.alert('Ping Sent', 'Webhook ping sent to user. Wait for "test successful" in HubLog.', ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', `Could not send ping: ${result.error}`, ui.ButtonSet.OK);
  }
}

/**
 * Tests chat connectivity: Hub -> User -> Chat -> Hub.
 */
function testChatConnectionFromHub() {
  const ui = SpreadsheetApp.getUi();
  const instanceName = promptForTestInstance(ui);

  if (!instanceName) return;

  const testId = Utilities.getUuid();
  const payload = {
    action: 'test_chat_request',
    instanceName: instanceName,
    testId: testId,
    message: 'Send test chat message',
    origin: 'hub'
  };

  const result = sendWebhookToUser(instanceName, payload);

  if (result.success) {
    logHub('TEST_CHAT_REQUEST_SENT', `${instanceName} (${testId})`);
    ui.alert('Request Sent', 'Chat test request sent to user. Wait for "test successful" in HubLog.', ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', `Could not send chat request: ${result.error}`, ui.ButtonSet.OK);
  }
}

// ============================================================================
// WEBHOOK HANDLERS (HUB)
// ============================================================================

/**
 * Handles User -> Hub test webhook ping.
 *
 * @param {Object} data - Request payload
 * @returns {Object} Result
 */
function handleTestWebhookPing(data) {
  const instanceName = data.instanceName;

  if (!instanceName) {
    return { success: false, error: 'Missing instanceName' };
  }

  logHub('TEST_WEBHOOK_PING_RECEIVED', `${instanceName} (${data.testId || 'no-id'})`);

  const payload = {
    action: 'test_webhook_success',
    instanceName: instanceName,
    testId: data.testId || '',
    message: 'Test successful',
    origin: 'hub',
    timestamp: new Date().toISOString()
  };

  const result = sendWebhookToUser(instanceName, payload);

  if (result.success) {
    logHub('TEST_WEBHOOK_SUCCESS_SENT', `${instanceName} (${data.testId || 'no-id'})`);
    return { success: true };
  }

  logHub('TEST_WEBHOOK_SUCCESS_FAILED', `${instanceName}: ${result.error}`);
  return { success: false, error: result.error };
}

/**
 * Handles User -> Hub success response for webhook test.
 *
 * @param {Object} data - Request payload
 * @returns {Object} Result
 */
function handleTestWebhookSuccess(data) {
  logHub('TEST_WEBHOOK_SUCCESS', `${data.instanceName || 'unknown'} (${data.testId || 'no-id'})`);
  return { success: true };
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
  const users = getAllActiveUsers();

  if (users.length === 0) {
    ui.alert('No Users', 'No registered users to test with.', ui.ButtonSet.OK);
    return null;
  }

  const list = users.map(user => user.instanceName).join(', ');
  const response = ui.prompt(
    'Select User',
    `Enter instance name to test.\n\nRegistered: ${list}`,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return null;
  }

  const instanceName = response.getResponseText().trim();
  if (!instanceName) {
    ui.alert('Missing Instance', 'Please enter a valid instance name.', ui.ButtonSet.OK);
    return null;
  }

  return instanceName;
}
