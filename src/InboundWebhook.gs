/**
 * Inbound Webhook Handler
 *
 * Receives webhook calls from the Central Hub.
 * The Hub sends webhooks TO this instance for:
 * - Label updates (AI categorized an email)
 * - Registration confirmations
 * - Test messages
 *
 * This instance does NOT send HTTP requests to the Hub.
 * All communication TO the Hub goes through Google Chat messages.
 * Webhook URLs are stored in the Config sheet (chat_webhook_url, webhook_url).
 */

/**
 * Handles POST requests from the Central Hub.
 *
 * @param {Object} e - Event object with postData
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    // Parse incoming data
    var data = JSON.parse(e.postData.contents);

    // Handle different request types
    if (data.action === 'ping') {
      return jsonResponse({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
    }

    if (data.action === 'registration_confirmed') {
      return handleRegistrationConfirmed(data);
    }

    if (data.action === 'test_webhook_ping') {
      return handleTestWebhookPing(data);
    }

    if (data.action === 'test_webhook_success') {
      return handleTestWebhookSuccess(data);
    }

    if (data.action === 'test_chat_request') {
      return handleTestChatRequest(data);
    }

    if (data.action === 'test_chat_success') {
      return handleTestChatSuccess(data);
    }

    if (data.action === 'test_sheets_chat_start') {
      return handleTestSheetsChatStart(data);
    }

    if (data.action === 'test_sheets_chat_confirm') {
      return handleTestSheetsChatConfirm(data);
    }

    if (data.action === 'test_sheets_chat_complete') {
      return handleTestSheetsChatComplete(data);
    }

    if (data.action === 'update_labels') {
      return handleLabelUpdate(data);
    }

    // Legacy format support (direct labels payload)
    if (data.labels) {
      return handleLabelUpdate(data);
    }

    return jsonResponse({ success: false, error: 'Unknown action or missing labels' });

  } catch (error) {
    logAction('WEBHOOK', 'ERROR', 'doPost error: ' + error.message);
    return jsonResponse({ success: false, error: error.message });
  }
}

/**
 * Handles registration confirmation from Hub.
 * Hub sends this after processing our REGISTER chat message.
 *
 * @param {Object} data - Confirmation data
 * @returns {TextOutput} JSON response
 */
function handleRegistrationConfirmed(data) {
  var instanceName = data.instanceName || 'unknown';
  var email = data.email || '';

  logAction('CONFIG', 'REGISTRATION_CONFIRMED',
    'Hub confirmed registration for ' + instanceName + ' (' + email + ')');

  // Store confirmation status
  setConfigValue('hub_registered', 'true');
  setConfigValue('hub_registered_at', new Date().toISOString());

  return jsonResponse({
    success: true,
    status: 'registration_acknowledged',
    instanceName: instanceName
  });
}

/**
 * Handles label update requests from Hub.
 *
 * @param {Object} data - Request data with emailId and/or labels
 * @returns {TextOutput} JSON response
 */
function handleLabelUpdate(data) {
  var labels = data.labels;
  var emailId = data.emailId;

  if (!labels) {
    return jsonResponse({ success: false, error: 'No labels provided' });
  }

  try {
    var ss = SpreadsheetApp.getActive();
    var sheet = ss.getSheetByName('Queue');

    if (!sheet) {
      return jsonResponse({ success: false, error: 'Queue sheet not found' });
    }

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({ success: false, error: 'Queue is empty' });
    }

    // Get all data
    var data_range = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    // If emailId provided, find that specific row
    if (emailId) {
      for (var i = 0; i < data_range.length; i++) {
        if (data_range[i][0] === emailId) {
          var rowNum = i + 2;

          // Update Labels to Apply column (E)
          sheet.getRange(rowNum, 5).setValue(labels);

          logAction('WEBHOOK', 'LABELS_RECEIVED', 'Row ' + rowNum + ': ' + labels);

          // Trigger processing of this row
          SpreadsheetApp.flush();
          checkQueueForProcessing();

          return jsonResponse({
            success: true,
            message: 'Updated row ' + rowNum + ' with labels',
            rowNumber: rowNum,
            emailId: emailId,
            labels: labels
          });
        }
      }
      return jsonResponse({ success: false, error: 'Email ID not found: ' + emailId });
    }

    // No emailId - find first Processing row without labels
    for (var j = 0; j < data_range.length; j++) {
      var status = data_range[j][5]; // Column F - Status
      var existingLabels = data_range[j][4]; // Column E - Labels

      if (status === 'Processing' && (!existingLabels || existingLabels.toString().trim() === '')) {
        var rowNum2 = j + 2;

        // Update Labels to Apply column (E)
        sheet.getRange(rowNum2, 5).setValue(labels);

        logAction('WEBHOOK', 'LABELS_RECEIVED', 'Row ' + rowNum2 + ' (first Processing): ' + labels);

        // Trigger processing
        SpreadsheetApp.flush();
        checkQueueForProcessing();

        return jsonResponse({
          success: true,
          message: 'Updated first Processing row ' + rowNum2 + ' with labels',
          rowNumber: rowNum2,
          emailId: data_range[j][0],
          labels: labels
        });
      }
    }

    return jsonResponse({ success: false, error: 'No Processing row found waiting for labels' });

  } catch (error) {
    logAction('WEBHOOK', 'ERROR', 'handleLabelUpdate: ' + error.message);
    return jsonResponse({ success: false, error: error.message });
  }
}

/**
 * Handles GET requests (for testing/status check).
 *
 * @param {Object} e - Event object
 * @returns {TextOutput} JSON response
 */
function doGet(e) {
  var instanceName = getConfig('instance_name') || 'unknown';

  return jsonResponse({
    status: 'Email Sorter Webhook Active',
    instance: instanceName,
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /': 'Receive webhooks from Hub',
      'GET /': 'Status check (this response)'
    }
  });
}

/**
 * Creates a JSON response.
 *
 * @param {Object} data - Response data
 * @returns {TextOutput} JSON text output
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
