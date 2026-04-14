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
 * Runs the inbox scan logic step-by-step and writes a detailed report to
 * the Log sheet so we can see exactly what threads are found, what labels
 * each carries, and why each is included or skipped.
 *
 * Menu: Smart Call Time > Testing > Diagnose Inbox Scan
 */
function diagnoseScan() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();

  // ── 1. Report config ──────────────────────────────────────────────────────
  var batchSize   = parseInt(getConfigValue('batch_size') || '50');
  var fetchSize   = Math.min(batchSize * 4, 200);
  var noneLabel   = (getConfigValue('none_label') || 'Needs Review').toLowerCase();
  var connMode    = getConfigValue('connection_mode') || 'chat_hub';

  logAction('DIAG', 'CONFIG',
    'connection_mode=' + connMode +
    ' | batch_size=' + batchSize +
    ' | fetch_size=' + fetchSize +
    ' | none_label=' + noneLabel);

  // ── 2. Report configured labels (from Labels sheet) ───────────────────────
  var processedLabelNames = new Set();
  var labelsSheet = ss.getSheetByName('Labels');
  if (labelsSheet && labelsSheet.getLastRow() > 1) {
    var labelRows = labelsSheet.getRange(2, 1, labelsSheet.getLastRow() - 1, 1).getValues();
    labelRows.forEach(function(row) {
      if (row[0]) processedLabelNames.add(row[0].toString().toLowerCase());
    });
  }
  logAction('DIAG', 'CONFIGURED_LABELS',
    processedLabelNames.size + ' label(s): ' +
    Array.from(processedLabelNames).join(', '));

  // ── 3. Report Queue state ─────────────────────────────────────────────────
  var queueSheet = ss.getSheetByName('Queue');
  var existingIds = queueSheet ? getExistingQueueIds(queueSheet) : new Set();
  logAction('DIAG', 'QUEUE_IDS', existingIds.size + ' email ID(s) already in Queue');

  // ── 4. Run Gmail search ───────────────────────────────────────────────────
  var allThreads = [];
  try {
    allThreads = GmailApp.search('in:inbox newer_than:7d', 0, fetchSize);
  } catch (e) {
    logAction('DIAG', 'SEARCH_ERROR', e.message);
    ui.alert('Diagnose Scan', 'Gmail search failed — check Log sheet.', ui.ButtonSet.OK);
    return;
  }
  logAction('DIAG', 'SEARCH_RESULT',
    'Gmail returned ' + allThreads.length + ' thread(s) for "in:inbox newer_than:7d"');

  if (allThreads.length === 0) {
    logAction('DIAG', 'CONCLUSION', 'STOP: Gmail search returned 0 threads. ' +
      'No emails in inbox newer than 7 days, or Gmail search quota hit.');
    ui.alert('Diagnose Scan',
      'Gmail search returned 0 threads.\n\n' +
      'Either there are genuinely no inbox emails newer than 7 days, ' +
      'or Gmail is rate-limiting the search.\n\nCheck the Log sheet.',
      ui.ButtonSet.OK);
    return;
  }

  // ── 5. Inspect each thread ────────────────────────────────────────────────
  var wouldQueue = 0;
  var skippedLabel = 0;
  var skippedQueue = 0;

  for (var i = 0; i < allThreads.length && i < 30; i++) {
    var thread    = allThreads[i];
    var message   = thread.getMessages()[0];
    var emailId   = message.getId();
    var subject   = (message.getSubject() || '(no subject)').substring(0, 60);
    var rawLabels = thread.getLabels();
    var labelNames = rawLabels.map(function(l) { return l.getName(); });

    var matchedLabel = null;
    for (var k = 0; k < labelNames.length; k++) {
      var ln = labelNames[k].toLowerCase();
      if (processedLabelNames.has(ln) || ln === noneLabel) {
        matchedLabel = labelNames[k];
        break;
      }
    }

    var inQueue = existingIds.has(emailId);

    var verdict;
    if (inQueue) {
      verdict = 'SKIP(already_in_queue)';
      skippedQueue++;
    } else if (matchedLabel) {
      verdict = 'SKIP(label="' + matchedLabel + '")';
      skippedLabel++;
    } else {
      verdict = 'WOULD_QUEUE';
      wouldQueue++;
    }

    logAction('DIAG', verdict,
      'Thread ' + (i + 1) + ': "' + subject + '" | ' +
      'getLabels()=[' + labelNames.join(', ') + '] | id=' + emailId);
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  var summary =
    'Threads found by Gmail: ' + allThreads.length + '\n' +
    'Inspected (first 30): ' + Math.min(allThreads.length, 30) + '\n' +
    '  Would queue:          ' + wouldQueue + '\n' +
    '  Skipped (label match):' + skippedLabel + '\n' +
    '  Skipped (in queue):   ' + skippedQueue;

  logAction('DIAG', 'SUMMARY', summary.replace(/\n/g, ' | '));

  ui.alert('Diagnose Scan — Results', summary + '\n\nFull details written to the Log sheet.', ui.ButtonSet.OK);
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
