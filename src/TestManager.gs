/**
 * Smart Call Time - Test Manager
 *
 * Provides menu-driven test workflows for webhook and chat connectivity.
 * These tests reuse the existing routing/webhook primitives so only the
 * message contents change.
 */

// ============================================================================
// MENU-TRIGGERED TESTS (USER SHEET)
// ============================================================================

/**
 * Tests webhook connectivity: User -> Hub -> User.
 */
function testWebhookPingFromUser() {
  const ui = SpreadsheetApp.getUi();
  const hubUrl = getHubUrl();

  if (!hubUrl) {
    ui.alert('Not Configured', 'Hub URL is not set. Run Setup or reconnect to the Hub.', ui.ButtonSet.OK);
    return;
  }

  const instanceName = getInstanceName();
  const testId = Utilities.getUuid();

  const payload = {
    action: 'test_webhook_ping',
    instanceName: instanceName,
    testId: testId,
    message: 'This is a test',
    origin: 'user'
  };

  const result = sendWebhookToHub(hubUrl, payload);

  if (result.success) {
    logAction('SYSTEM', 'TEST_WEBHOOK_PING_SENT', `Sent ping to Hub (${testId})`);
    ui.alert('Ping Sent', 'Webhook ping sent to Hub. Wait for "test successful" to appear in the Log sheet.', ui.ButtonSet.OK);
  } else {
    ui.alert('Failed', `Could not send ping: ${result.error}`, ui.ButtonSet.OK);
  }
}

/**
 * Tests chat connectivity: User -> Chat -> Hub -> User.
 */
function testChatConnectionFromUser() {
  const ui = SpreadsheetApp.getUi();
  const webhookUrl = getConfigValue('chat_webhook_url');

  if (!webhookUrl) {
    ui.alert('Not Configured', 'Chat webhook URL not set. Configure chat_webhook_url first.', ui.ButtonSet.OK);
    return;
  }

  const instanceName = getInstanceName();
  const testId = Utilities.getUuid();
  const message = buildTestChatMessage(instanceName, testId);

  postToChat(webhookUrl, message);
  logAction('SYSTEM', 'TEST_CHAT_SENT', `Sent chat test message (${testId})`);

  ui.alert('Test Sent', 'Chat test message sent. Wait for "test successful" in the Log sheet.', ui.ButtonSet.OK);
}

// ============================================================================
// INBOUND TEST HANDLERS (USER WEBHOOK)
// ============================================================================

/**
 * Handles Hub -> User test ping by replying back to Hub.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestWebhookPing(data) {
  const hubUrl = getHubUrl();
  const instanceName = getInstanceName();

  logAction('SYSTEM', 'TEST_WEBHOOK_PING_RECEIVED', `Ping from Hub (${data.testId || 'no-id'})`);

  if (!hubUrl) {
    return jsonResponse({ success: false, error: 'Hub URL not configured' });
  }

  const payload = {
    action: 'test_webhook_success',
    instanceName: instanceName,
    testId: data.testId || '',
    message: 'Test successful',
    origin: 'user'
  };

  const result = sendWebhookToHub(hubUrl, payload);

  if (result.success) {
    logAction('SYSTEM', 'TEST_WEBHOOK_SUCCESS_SENT', `Sent success to Hub (${data.testId || 'no-id'})`);
    return jsonResponse({ success: true, status: 'sent' });
  }

  logAction('SYSTEM', 'TEST_WEBHOOK_SUCCESS_FAILED', result.error || 'Unknown error');
  return jsonResponse({ success: false, error: result.error });
}

/**
 * Handles Hub -> User success response for webhook test.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestWebhookSuccess(data) {
  logAction('SYSTEM', 'TEST_WEBHOOK_SUCCESS', `Test successful (${data.testId || 'no-id'})`);
  return jsonResponse({ success: true, status: 'ack' });
}

/**
 * Handles Hub -> User request to send a chat test message.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestChatRequest(data) {
  const webhookUrl = getConfigValue('chat_webhook_url');
  const instanceName = getInstanceName();
  const testId = data.testId || Utilities.getUuid();

  if (!webhookUrl) {
    logAction('SYSTEM', 'TEST_CHAT_REQUEST_FAILED', 'chat_webhook_url not configured');
    return jsonResponse({ success: false, error: 'Chat webhook URL not configured' });
  }

  const message = buildTestChatMessage(instanceName, testId);
  postToChat(webhookUrl, message);

  logAction('SYSTEM', 'TEST_CHAT_SENT', `Sent chat test message (${testId})`);
  return jsonResponse({ success: true, status: 'sent', testId: testId });
}

/**
 * Handles Hub -> User success response for chat test.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestChatSuccess(data) {
  logAction('SYSTEM', 'TEST_CHAT_SUCCESS', `Test successful (${data.testId || 'no-id'})`);
  return jsonResponse({ success: true, status: 'ack' });
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Sends a JSON payload to the Hub.
 *
 * @param {string} hubUrl - Hub web app URL
 * @param {Object} payload - Payload to send
 * @returns {Object} Result
 */
function sendWebhookToHub(hubUrl, payload) {
  try {
    const response = UrlFetchApp.fetch(hubUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200) {
      return { success: true, responseText: responseText };
    }

    return { success: false, error: `Hub returned HTTP ${responseCode}: ${responseText}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Builds a chat test message that the Hub can recognize.
 *
 * @param {string} instanceName - User instance name
 * @param {string} testId - Test identifier
 * @returns {string} Formatted test message
 */
function buildTestChatMessage(instanceName, testId) {
  return `@${instanceName}: [${testId}] TEST_CHAT_CONNECTION`;
}
