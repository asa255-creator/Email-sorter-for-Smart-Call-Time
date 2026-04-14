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
  var message = buildChatMessage(instanceName, testId, 'SHEETS_CHAT_TEST', 'processing');
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
  var message = buildChatMessage(instanceName, conversationId, 'SHEETS_CHAT_TEST', 'processing');
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
  var message = buildChatMessage(instanceName, conversationId, 'CONFIRMED', 'closed');
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
// INBOX SCAN DIAGNOSTICS
// ============================================================================

/**
 * Diagnoses why the inbox scan finds no emails.
 * Run directly from the Apps Script editor (no menu needed).
 * All output goes to the execution log — nothing touches the spreadsheet.
 */
function diagnoseScan() {
  var ss = SpreadsheetApp.getActive();

  // ── 1. Config ─────────────────────────────────────────────────────────────
  var batchSize = parseInt(getConfigValue('batch_size') || '50');
  var fetchSize = Math.min(batchSize * 4, 200);
  var noneLabel = (getConfigValue('none_label') || 'Needs Review').toLowerCase();
  var connMode  = getConfigValue('connection_mode') || 'chat_hub';

  console.log('=== DIAGNOSE SCAN ===');
  console.log('connection_mode: ' + connMode);
  console.log('batch_size: ' + batchSize + '  fetch_size: ' + fetchSize);
  console.log('none_label: "' + noneLabel + '"');

  // ── 2. Labels sheet ───────────────────────────────────────────────────────
  var processedLabelNames = new Set();
  var labelsSheet = ss.getSheetByName('Labels');
  if (labelsSheet && labelsSheet.getLastRow() > 1) {
    labelsSheet.getRange(2, 1, labelsSheet.getLastRow() - 1, 1).getValues()
      .forEach(function(row) { if (row[0]) processedLabelNames.add(row[0].toString().toLowerCase()); });
  }
  console.log('Configured labels (' + processedLabelNames.size + '): ' +
    Array.from(processedLabelNames).join(', '));

  // ── 3. Queue ──────────────────────────────────────────────────────────────
  var queueSheet = ss.getSheetByName('Queue');
  var existingIds = queueSheet ? getExistingQueueIds(queueSheet) : new Set();
  console.log('Email IDs already in Queue: ' + existingIds.size);

  // ── 4. Gmail search ───────────────────────────────────────────────────────
  var allThreads = [];
  try {
    allThreads = GmailApp.search('in:inbox newer_than:7d', 0, fetchSize);
  } catch (e) {
    console.log('SEARCH ERROR: ' + e.message);
    return;
  }
  console.log('Gmail returned ' + allThreads.length + ' thread(s) for "in:inbox newer_than:7d"');

  if (allThreads.length === 0) {
    console.log('STOP: 0 threads returned. No inbox emails newer than 7 days, or quota hit.');
    return;
  }

  // ── 5. Thread-by-thread inspection ───────────────────────────────────────
  var wouldQueue = 0, skippedLabel = 0, skippedQueue = 0;

  for (var i = 0; i < allThreads.length && i < 30; i++) {
    var thread     = allThreads[i];
    var message    = thread.getMessages()[0];
    var emailId    = message.getId();
    var subject    = (message.getSubject() || '(no subject)').substring(0, 60);
    var labelNames = thread.getLabels().map(function(l) { return l.getName(); });

    var matchedLabel = null;
    for (var k = 0; k < labelNames.length; k++) {
      var ln = labelNames[k].toLowerCase();
      if (processedLabelNames.has(ln) || ln === noneLabel) { matchedLabel = labelNames[k]; break; }
    }

    var verdict;
    if (existingIds.has(emailId))  { verdict = 'SKIP - already in queue'; skippedQueue++; }
    else if (matchedLabel)          { verdict = 'SKIP - label "' + matchedLabel + '"'; skippedLabel++; }
    else                            { verdict = 'WOULD QUEUE'; wouldQueue++; }

    console.log('[' + (i + 1) + '] ' + verdict +
      ' | subject: "' + subject + '"' +
      ' | getLabels(): [' + labelNames.join(', ') + ']');
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  console.log('--- SUMMARY ---');
  console.log('Total threads from Gmail: ' + allThreads.length);
  console.log('Would queue:   ' + wouldQueue);
  console.log('Skipped (label): ' + skippedLabel);
  console.log('Skipped (queue): ' + skippedQueue);
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
  return buildChatMessage(instanceName, testId, 'TEST_CHAT_CONNECTION', 'processing');
}
