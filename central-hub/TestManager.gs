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
// RETRY PENDING REGISTRATION WEBHOOKS
// ============================================================================

/**
 * Manually retries sending registration_confirmed webhooks to all pending users.
 * Run this from the script editor or via Hub Admin menu to debug stuck registrations.
 *
 * For each pending user:
 *   1. Reads their webhook URL from the Registry
 *   2. Sends the registration_confirmed payload
 *   3. Logs the full request/response details to HubLog
 *
 * Does NOT require a UI — safe to run from Apps Script editor's Run button.
 * Check HubLog sheet for detailed results after running.
 */
function retryPendingRegistrationWebhooks() {
  logHub('RETRY_PENDING_START', '=== Retrying pending registration webhooks ===');

  // Read ALL users from Registry (including pending)
  var sheet = getOrCreateRegistrySheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    logHub('RETRY_PENDING_END', 'Registry is empty — nothing to retry');
    Logger.log('Registry is empty — nothing to retry');
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var pendingUsers = [];

  for (var i = 0; i < data.length; i++) {
    var user = {
      row: i + 2,
      email: data[i][0],
      instanceName: data[i][1],
      sheetId: data[i][2],
      webhookUrl: data[i][3],
      status: data[i][4],
      registeredAt: data[i][5]
    };

    if (user.status === 'pending') {
      pendingUsers.push(user);
    }
  }

  logHub('RETRY_PENDING_FOUND', 'Found ' + pendingUsers.length + ' pending user(s) out of ' + data.length + ' total');
  Logger.log('Found ' + pendingUsers.length + ' pending user(s)');

  if (pendingUsers.length === 0) {
    logHub('RETRY_PENDING_END', 'No pending users — nothing to retry');
    Logger.log('No pending users — nothing to retry');
    return;
  }

  // Process each pending user
  for (var j = 0; j < pendingUsers.length; j++) {
    var user = pendingUsers[j];
    var logPrefix = '[' + (j + 1) + '/' + pendingUsers.length + '] ' + user.instanceName;

    logHub('RETRY_PENDING_USER', logPrefix + ' — email=' + user.email + ' webhookUrl=' + user.webhookUrl);
    Logger.log(logPrefix + ' — webhookUrl=' + user.webhookUrl);

    // Validate webhook URL
    if (!user.webhookUrl) {
      logHub('RETRY_PENDING_SKIP', logPrefix + ' — NO WEBHOOK URL in Registry');
      Logger.log(logPrefix + ' — SKIPPED: no webhook URL');
      continue;
    }

    // Build the exact same payload that handleChatRegistration sends
    var payload = {
      action: 'registration_confirmed',
      instanceName: user.instanceName,
      email: user.email,
      conversationId: 'register',
      message: 'Registration successful. Post CONFIRMED to chat to complete verification.',
      timestamp: new Date().toISOString()
    };

    logHub('RETRY_PENDING_SENDING', logPrefix + ' — POST ' + user.webhookUrl + ' payload=' + JSON.stringify(payload));

    try {
      var response = UrlFetchApp.fetch(user.webhookUrl, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        followRedirects: true
      });

      var responseCode = response.getResponseCode();
      var responseBody = response.getContentText();
      var responseHeaders = JSON.stringify(response.getHeaders());

      // Truncate response body for logging (in case it's a huge HTML error page)
      var bodyPreview = responseBody.length > 500
        ? responseBody.substring(0, 500) + '... [truncated, total ' + responseBody.length + ' chars]'
        : responseBody;

      logHub('RETRY_PENDING_RESPONSE', logPrefix +
        ' — HTTP ' + responseCode +
        ' | body=' + bodyPreview);

      Logger.log(logPrefix + ' — HTTP ' + responseCode);
      Logger.log('  Response body: ' + bodyPreview);

      if (responseCode === 200) {
        logHub('RETRY_PENDING_SUCCESS', logPrefix + ' — Webhook delivered successfully');

        // Ensure there is a pending request for the CONFIRMED flow
        var existingPending = getPendingRequestByEmailId(user.instanceName, 'register');
        if (!existingPending) {
          createPendingRequest(user.instanceName, 'register', {
            type: 'registration',
            messageNames: [],
            startedAt: new Date().toISOString(),
            retriedAt: new Date().toISOString()
          });
          logHub('RETRY_PENDING_CREATED', logPrefix + ' — Created pending request for CONFIRMED flow');
        } else {
          logHub('RETRY_PENDING_EXISTS', logPrefix + ' — Pending request already exists');
        }
      } else {
        logHub('RETRY_PENDING_FAILED', logPrefix + ' — HTTP ' + responseCode + ' (not 200)');
      }

    } catch (error) {
      logHub('RETRY_PENDING_ERROR', logPrefix + ' — Exception: ' + error.message);
      Logger.log(logPrefix + ' — ERROR: ' + error.message);
    }
  }

  logHub('RETRY_PENDING_END', '=== Retry complete ===');
  Logger.log('=== Retry complete. Check HubLog sheet for full details. ===');
}

/**
 * Shows a diagnostic report of all users in the Registry (all statuses).
 * Run from the script editor to see full details in the execution log.
 */
function diagnosePendingUsers() {
  logHub('DIAGNOSE_START', '=== Diagnosing all Registry users ===');

  var sheet = getOrCreateRegistrySheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    Logger.log('Registry is empty');
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (var i = 0; i < data.length; i++) {
    var email = data[i][0];
    var instanceName = data[i][1];
    var sheetId = data[i][2];
    var webhookUrl = data[i][3];
    var status = data[i][4];
    var registeredAt = data[i][5];

    var report = 'Row ' + (i + 2) + ': ' + instanceName +
      '\n  email      = ' + email +
      '\n  status     = ' + status +
      '\n  webhookUrl = ' + webhookUrl +
      '\n  sheetId    = ' + sheetId +
      '\n  registered = ' + registeredAt;

    Logger.log(report);
    logHub('DIAGNOSE_USER', instanceName + ' | status=' + status + ' | webhook=' + webhookUrl);

    // Test if webhook URL is reachable (GET only, non-destructive)
    if (webhookUrl) {
      try {
        var testResp = UrlFetchApp.fetch(webhookUrl, {
          method: 'GET',
          muteHttpExceptions: true,
          followRedirects: true
        });
        var code = testResp.getResponseCode();
        var body = testResp.getContentText();
        var bodyPreview = body.length > 200 ? body.substring(0, 200) + '...' : body;

        Logger.log('  GET test: HTTP ' + code + ' | ' + bodyPreview);
        logHub('DIAGNOSE_GET', instanceName + ' | HTTP ' + code + ' | ' + bodyPreview);
      } catch (err) {
        Logger.log('  GET test: ERROR — ' + err.message);
        logHub('DIAGNOSE_GET_ERROR', instanceName + ' | ' + err.message);
      }
    } else {
      Logger.log('  GET test: SKIPPED (no URL)');
    }

    // Check for pending request
    var pending = getPendingRequestByEmailId(instanceName, 'register');
    if (pending) {
      Logger.log('  Pending request: YES (created ' + pending.createdAt + ', type=' + (pending.metadata.type || 'unknown') + ')');
      logHub('DIAGNOSE_PENDING', instanceName + ' | pending request exists, type=' + (pending.metadata.type || 'unknown'));
    } else {
      Logger.log('  Pending request: NONE');
    }
  }

  logHub('DIAGNOSE_END', '=== Diagnosis complete ===');
  Logger.log('=== Done. Check HubLog sheet for persistent log. ===');
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
