/**
 * Inbound Webhook Handler
 *
 * Receives webhook calls from the Central Hub when AI categorizes emails.
 * This keeps the processing logic on the user's sheet, not in the Hub.
 *
 * The Hub is a "dumb pipe" - it just routes messages.
 * All business logic for applying labels lives here.
 */

/**
 * Handles POST requests from the Central Hub.
 * Called when AI provides labels for an email.
 *
 * Expected payload formats:
 * 1. Specific email: { emailId: "...", labels: "Label1, Label2" }
 * 2. Processing row: { labels: "Label1, Label2" }
 * 3. Health check: { action: "ping" }
 *
 * @param {Object} e - Event object with postData
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    // Parse incoming data
    const data = JSON.parse(e.postData.contents);

    // Handle different request types
    if (data.action === 'ping') {
      return jsonResponse({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
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
    logAction('WEBHOOK', 'ERROR', `doPost error: ${error.message}`);
    return jsonResponse({ success: false, error: error.message });
  }
}

/**
 * Handles label update requests from Hub.
 *
 * @param {Object} data - Request data with emailId and/or labels
 * @returns {TextOutput} JSON response
 */
function handleLabelUpdate(data) {
  const labels = data.labels;
  const emailId = data.emailId;

  if (!labels) {
    return jsonResponse({ success: false, error: 'No labels provided' });
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName('Queue');

    if (!sheet) {
      return jsonResponse({ success: false, error: 'Queue sheet not found' });
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({ success: false, error: 'Queue is empty' });
    }

    // Get all data
    const data_range = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    // If emailId provided, find that specific row
    if (emailId) {
      for (let i = 0; i < data_range.length; i++) {
        if (data_range[i][0] === emailId) {
          const rowNum = i + 2;

          // Update Labels to Apply column (E)
          sheet.getRange(rowNum, 5).setValue(labels);

          logAction('WEBHOOK', 'LABELS_RECEIVED', `Row ${rowNum}: ${labels}`);

          // Trigger processing of this row
          SpreadsheetApp.flush();
          checkQueueForProcessing();

          return jsonResponse({
            success: true,
            message: `Updated row ${rowNum} with labels`,
            rowNumber: rowNum,
            emailId: emailId,
            labels: labels
          });
        }
      }
      return jsonResponse({ success: false, error: `Email ID not found: ${emailId}` });
    }

    // No emailId - find first Processing row without labels
    for (let i = 0; i < data_range.length; i++) {
      const status = data_range[i][5]; // Column F - Status
      const existingLabels = data_range[i][4]; // Column E - Labels

      if (status === 'Processing' && (!existingLabels || existingLabels.toString().trim() === '')) {
        const rowNum = i + 2;

        // Update Labels to Apply column (E)
        sheet.getRange(rowNum, 5).setValue(labels);

        logAction('WEBHOOK', 'LABELS_RECEIVED', `Row ${rowNum} (first Processing): ${labels}`);

        // Trigger processing
        SpreadsheetApp.flush();
        checkQueueForProcessing();

        return jsonResponse({
          success: true,
          message: `Updated first Processing row ${rowNum} with labels`,
          rowNumber: rowNum,
          emailId: data_range[i][0],
          labels: labels
        });
      }
    }

    return jsonResponse({ success: false, error: 'No Processing row found waiting for labels' });

  } catch (error) {
    logAction('WEBHOOK', 'ERROR', `handleLabelUpdate: ${error.message}`);
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
  const instanceName = getConfig('instance_name') || 'unknown';

  return jsonResponse({
    status: 'Email Sorter Webhook Active',
    instance: instanceName,
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /': 'Receive labels from Hub',
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
