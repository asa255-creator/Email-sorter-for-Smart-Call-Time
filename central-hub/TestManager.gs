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
