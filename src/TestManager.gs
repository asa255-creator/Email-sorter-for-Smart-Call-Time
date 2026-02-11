/**
 * Smart Call Time - Test Manager
 *
 * Provides menu-driven test workflows for webhook and chat connectivity.
 *
 * Communication model:
 * - User -> Hub: Via Google Chat messages (no HTTP to Hub)
 * - Hub -> User: Via webhooks to our deployed web app URL
 * - Webhook URLs stored in Config sheet (chat_webhook_url, webhook_url)
 */

// ============================================================================
// MENU-TRIGGERED TESTS (USER SHEET)
// ============================================================================

/**
 * Tests chat connectivity: User -> Chat -> Hub -> User.
 * Posts a test message to chat, Hub sees it and sends webhook back.
 */
function testChatConnectionFromUser() {
  var ui = SpreadsheetApp.getUi();
  var webhookUrl = getConfigValue('chat_webhook_url');

  if (!webhookUrl) {
    ui.alert('Not Configured', 'Chat webhook URL not set. Configure chat_webhook_url first.', ui.ButtonSet.OK);
    return;
  }

  var instanceName = getInstanceName();
  var testId = Utilities.getUuid();
  var message = buildTestChatMessage(instanceName, testId);

  postToChat(webhookUrl, message);
  logAction('SYSTEM', 'TEST_CHAT_SENT', 'Sent chat test message (' + testId + ')');

  ui.alert('Test Sent', 'Chat test message sent. Wait for "test successful" in the Log sheet.', ui.ButtonSet.OK);
}

/**
 * Tests webhook ping: Hub -> User (one-way).
 * This test must be initiated from the Hub side (Hub Admin menu).
 */
function testWebhookPingFromUser() {
  var ui = SpreadsheetApp.getUi();

  ui.alert('Webhook Ping Test',
    'This test verifies the Hub can reach your webhook.\n\n' +
    'To run it:\n' +
    '1. Open the Hub spreadsheet\n' +
    '2. Click: Hub Admin > Test Webhook Ping\n' +
    '3. Enter your instance name\n' +
    '4. Check this sheet\'s Log for the result\n\n' +
    'The Hub sends a ping to your webhook URL.\n' +
    'Your webhook URL: ' + (getWebhookUrl() || '(not set)'),
    ui.ButtonSet.OK);
}

// ============================================================================
// INBOUND TEST HANDLERS (HUB -> USER WEBHOOK)
// ============================================================================

/**
 * Handles Hub -> User test ping.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestWebhookPing(data) {
  logAction('SYSTEM', 'TEST_WEBHOOK_PING_RECEIVED', 'Ping from Hub (' + (data.testId || 'no-id') + ')');
  return jsonResponse({ success: true, status: 'pong', testId: data.testId || '' });
}

/**
 * Handles Hub -> User success response for webhook test.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestWebhookSuccess(data) {
  logAction('SYSTEM', 'TEST_WEBHOOK_SUCCESS', 'Test successful (' + (data.testId || 'no-id') + ')');
  return jsonResponse({ success: true, status: 'ack' });
}

/**
 * Handles Hub -> User request to send a chat test message.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestChatRequest(data) {
  var webhookUrl = getConfigValue('chat_webhook_url');
  var instanceName = getInstanceName();
  var testId = data.testId || Utilities.getUuid();

  if (!webhookUrl) {
    logAction('SYSTEM', 'TEST_CHAT_REQUEST_FAILED', 'chat_webhook_url not configured');
    return jsonResponse({ success: false, error: 'Chat webhook URL not configured' });
  }

  var message = buildTestChatMessage(instanceName, testId);
  postToChat(webhookUrl, message);

  logAction('SYSTEM', 'TEST_CHAT_SENT', 'Sent chat test message (' + testId + ')');
  return jsonResponse({ success: true, status: 'sent', testId: testId });
}

/**
 * Handles Hub -> User success response for chat test.
 *
 * @param {Object} data - Webhook payload
 * @returns {TextOutput} JSON response
 */
function handleTestChatSuccess(data) {
  logAction('SYSTEM', 'TEST_CHAT_SUCCESS', 'Test successful (' + (data.testId || 'no-id') + ')');
  return jsonResponse({ success: true, status: 'ack' });
}

// ============================================================================
// SHEETS CHAT TEST (User -> Chat -> Hub -> Webhook -> User -> Chat -> Hub deletes)
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
// VIEW RECENT CHAT MESSAGES
// ============================================================================

/**
 * Extracts the space name (e.g. "spaces/AAQAULujEoo") from the chat webhook URL.
 * @returns {string|null} The space name or null
 */
function getSpaceNameFromWebhook() {
  var webhookUrl = getConfigValue('chat_webhook_url');
  if (!webhookUrl) return null;

  // Webhook URL format: https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?...
  var match = webhookUrl.match(/\/v1\/(spaces\/[^\/]+)\//);
  return match ? match[1] : null;
}

/**
 * Lists recent messages from the Google Chat space.
 * Uses the Chat API advanced service (must be enabled in appsscript.json).
 * @param {number} [count] - Number of messages to fetch (default 10, max 25)
 * @returns {Array} Array of message objects
 */
function listRecentChatMessages(count) {
  var spaceName = getSpaceNameFromWebhook();
  if (!spaceName) {
    throw new Error('Cannot determine space name from chat_webhook_url. Check Config sheet.');
  }

  var pageSize = Math.min(count || 10, 25);

  var response = Chat.Spaces.Messages.list(spaceName, {
    pageSize: pageSize,
    orderBy: 'createTime desc'
  });

  return response.messages || [];
}

/**
 * Menu action: View recent messages in the Chat space.
 * Displays the last 10 messages in a dialog so you can see what the Hub sees.
 */
function viewRecentChatMessagesFromMenu() {
  var ui = SpreadsheetApp.getUi();

  try {
    var messages = listRecentChatMessages(10);

    if (!messages || messages.length === 0) {
      ui.alert('No Messages', 'No messages found in the Chat space.', ui.ButtonSet.OK);
      return;
    }

    var lines = messages.map(function(msg, i) {
      var time = msg.createTime || '(no time)';
      var sender = '(unknown)';
      if (msg.sender && msg.sender.displayName) {
        sender = msg.sender.displayName;
      }
      var text = msg.text || msg.formattedText || '(no text)';
      // Truncate long messages for the dialog
      if (text.length > 200) {
        text = text.substring(0, 200) + '...';
      }
      return (i + 1) + '. [' + time + '] ' + sender + ':\n   ' + text;
    });

    ui.alert('Recent Chat Messages (newest first)',
      lines.join('\n\n'),
      ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('Error',
      'Could not fetch chat messages.\n\n' +
      'Error: ' + e.message + '\n\n' +
      'Make sure:\n' +
      '1. Google Chat API is enabled in your GCP project\n' +
      '2. The Chat advanced service is enabled in Apps Script\n' +
      '3. You have access to the Chat space',
      ui.ButtonSet.OK);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

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
