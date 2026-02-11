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
// SHEETS CHAT TEST (User → Chat → Hub → Webhook → User → Chat → Hub deletes)
// ============================================================================

/**
 * Tests the full Sheets-Chat-Webhook round-trip:
 * 1. User sends chat: @instanceName:[testId] SHEETS_CHAT_TEST
 * 2. Hub sees chat, sends webhook to User with test_sheets_chat_confirm
 * 3. User receives webhook, sends chat: @instanceName:[testId] CONFIRMED
 * 4. Hub sees CONFIRMED, deletes both chat messages, sends completion webhook
 */
function testSheetsChatFromUser() {
  var ui = SpreadsheetApp.getUi();
  var webhookUrl = getConfigValue('chat_webhook_url');

  if (!webhookUrl) {
    ui.alert('Not Configured', 'Chat webhook URL not set. Configure chat_webhook_url first.', ui.ButtonSet.OK);
    return;
  }

  var instanceName = getInstanceName();
  var testId = Utilities.getUuid();

  // Send test message using consistent format
  var message = buildChatMessage(instanceName, testId, 'SHEETS_CHAT_TEST');
  postToChat(webhookUrl, message);

  // Store the testId so the webhook handler can use it
  setConfigValue('pending_sheets_chat_test_id', testId);

  logAction('SYSTEM', 'SHEETS_CHAT_TEST_SENT', 'Sent SHEETS_CHAT_TEST [' + testId + ']');

  ui.alert('Test Sent',
    'Sheets Chat test message sent.\n\n' +
    'Flow:\n' +
    '1. Chat message sent to space\n' +
    '2. Hub will detect it and send webhook back here\n' +
    '3. This sheet will auto-reply CONFIRMED in chat\n' +
    '4. Hub will delete both messages\n\n' +
    'Check Log sheet for progress.',
    ui.ButtonSet.OK);
}

/**
 * Handles Hub-initiated Sheets Chat test.
 * Hub sends webhook telling User to start by posting SHEETS_CHAT_TEST to chat.
 *
 * @param {Object} data - Webhook payload with conversationId
 * @returns {TextOutput} JSON response
 */
function handleTestSheetsChatStart(data) {
  var webhookUrl = getConfigValue('chat_webhook_url');
  var instanceName = getInstanceName();
  var conversationId = data.conversationId || Utilities.getUuid();

  logAction('SYSTEM', 'SHEETS_CHAT_TEST_START', 'Hub initiated test [' + conversationId + ']');

  if (!webhookUrl) {
    logAction('SYSTEM', 'SHEETS_CHAT_TEST_START_FAILED', 'chat_webhook_url not configured');
    return jsonResponse({ success: false, error: 'Chat webhook URL not configured' });
  }

  // Send SHEETS_CHAT_TEST message to chat using consistent format
  var message = buildChatMessage(instanceName, conversationId, 'SHEETS_CHAT_TEST');
  postToChat(webhookUrl, message);

  // Store the conversation ID for tracking
  setConfigValue('pending_sheets_chat_test_id', conversationId);

  logAction('SYSTEM', 'SHEETS_CHAT_TEST_SENT', 'Sent SHEETS_CHAT_TEST [' + conversationId + ']');

  return jsonResponse({ success: true, status: 'test_chat_sent', conversationId: conversationId });
}

/**
 * Handles Hub webhook asking User to confirm the Sheets Chat test.
 * Sends CONFIRMED message back to chat using consistent format.
 *
 * @param {Object} data - Webhook payload with conversationId
 * @returns {TextOutput} JSON response
 */
function handleTestSheetsChatConfirm(data) {
  var webhookUrl = getConfigValue('chat_webhook_url');
  var instanceName = getInstanceName();
  var conversationId = data.conversationId || '';

  logAction('SYSTEM', 'SHEETS_CHAT_CONFIRM_RECEIVED', 'Hub asked for confirmation [' + conversationId + ']');

  if (!webhookUrl) {
    logAction('SYSTEM', 'SHEETS_CHAT_CONFIRM_FAILED', 'chat_webhook_url not configured');
    return jsonResponse({ success: false, error: 'Chat webhook URL not configured' });
  }

  // Send CONFIRMED reply using consistent format
  var message = buildChatMessage(instanceName, conversationId, 'CONFIRMED');
  postToChat(webhookUrl, message);

  logAction('SYSTEM', 'SHEETS_CHAT_CONFIRMED_SENT', 'Sent CONFIRMED [' + conversationId + ']');

  return jsonResponse({ success: true, status: 'confirmed_sent', conversationId: conversationId });
}

/**
 * Handles the final completion webhook from Hub after messages are deleted.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestSheetsChatComplete(data) {
  var conversationId = data.conversationId || '';
  var deleted = data.messagesDeleted || 0;

  logAction('SYSTEM', 'SHEETS_CHAT_TEST_COMPLETE',
    'Test complete [' + conversationId + ']. ' + deleted + ' chat messages deleted by Hub.');

  // Clean up stored test ID
  deleteConfigValue('pending_sheets_chat_test_id');

  return jsonResponse({ success: true, status: 'complete' });
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
 * Uses the consistent message format.
 *
 * @param {string} instanceName - User instance name
 * @param {string} testId - Test identifier
 * @returns {string} Formatted test message
 */
function buildTestChatMessage(instanceName, testId) {
  return buildChatMessage(instanceName, testId, 'TEST_CHAT_CONNECTION');
}
