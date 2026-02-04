/**
 * Inbound Chat Handler
 *
 * This module handles incoming messages from Google Chat and updates the Queue sheet.
 * It can be called by Google Flows or deployed as a Chat app.
 *
 * DEPLOYMENT OPTIONS:
 *
 * 1. Flow-triggered (NO webhook needed):
 *    - Flow watches Chat space for AI responses
 *    - Flow extracts email ID and labels from message
 *    - Flow calls updateQueueWithLabels() directly via Apps Script connector
 *
 * 2. Chat App (requires deployment):
 *    - Deploy this as a Google Chat app
 *    - Messages sent to the app trigger onMessage()
 *    - Parses AI response and updates sheet
 *
 * 3. Web App webhook (requires deployment):
 *    - Deploy as web app with doPost()
 *    - Configure Chat space to send webhooks here
 */

// ============================================================================
// FLOW-CALLABLE FUNCTIONS (No deployment needed)
// ============================================================================

/**
 * Updates the Queue sheet with labels for a specific email.
 * Called by Google Flow after AI categorizes an email.
 *
 * @param {string} emailId - The email ID to update
 * @param {string} labels - Comma-separated labels from AI
 * @param {string} spreadsheetId - (Optional) Target spreadsheet ID
 * @returns {Object} Result with success status and message
 */
function updateQueueWithLabels(emailId, labels, spreadsheetId) {
  try {
    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActive();

    const sheet = ss.getSheetByName('Queue');
    if (!sheet) {
      return { success: false, error: 'Queue sheet not found' };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: 'Queue is empty' };
    }

    // Find the row with this email ID
    const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === emailId) {
        const rowNum = i + 2;
        // Update Labels to Apply column (E)
        sheet.getRange(rowNum, 5).setValue(labels);

        return {
          success: true,
          message: `Updated row ${rowNum} with labels: ${labels}`,
          rowNumber: rowNum
        };
      }
    }

    return { success: false, error: `Email ID not found: ${emailId}` };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Updates the first "Processing" row with labels.
 * Use this when Flow doesn't know the specific email ID.
 *
 * @param {string} labels - Comma-separated labels from AI
 * @param {string} spreadsheetId - (Optional) Target spreadsheet ID
 * @returns {Object} Result with success status and message
 */
function updateProcessingRowWithLabels(labels, spreadsheetId) {
  try {
    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActive();

    const sheet = ss.getSheetByName('Queue');
    if (!sheet) {
      return { success: false, error: 'Queue sheet not found' };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: 'Queue is empty' };
    }

    // Find first Processing row without labels
    const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    for (let i = 0; i < data.length; i++) {
      const status = data[i][5]; // Column F
      const existingLabels = data[i][4]; // Column E

      if (status === 'Processing' && (!existingLabels || existingLabels.trim() === '')) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, 5).setValue(labels);

        return {
          success: true,
          message: `Updated row ${rowNum} with labels: ${labels}`,
          rowNumber: rowNum,
          emailId: data[i][0]
        };
      }
    }

    return { success: false, error: 'No Processing row found waiting for labels' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Adds a new email to the queue (for real-time new email processing).
 * Called by Flow when a new email arrives.
 *
 * @param {Object} emailData - Email data from Flow
 * @param {string} emailData.id - Email ID
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.from - Sender
 * @param {string} emailData.date - Date ISO string
 * @param {string} emailData.labels - Labels from AI (already categorized)
 * @param {string} emailData.context - (Optional) Email body/context
 * @param {string} spreadsheetId - (Optional) Target spreadsheet ID
 * @returns {Object} Result with success status
 */
function addNewEmailToQueue(emailData, spreadsheetId) {
  try {
    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActive();

    const sheet = ss.getSheetByName('Queue');
    if (!sheet) {
      return { success: false, error: 'Queue sheet not found' };
    }

    // Add row with Status = "Processing" and labels already filled
    const newRow = [
      emailData.id || '',
      emailData.subject || '(no subject)',
      emailData.from || '',
      emailData.date || new Date().toISOString(),
      emailData.labels || '',           // Labels already filled by AI
      'Processing',                      // Status
      '',                                // Processed At
      emailData.context || ''            // Context (optional)
    ];

    sheet.appendRow(newRow);

    return {
      success: true,
      message: `Added new email to queue: ${emailData.subject}`,
      emailId: emailData.id
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// CHAT APP FUNCTIONS (Requires deployment as Chat app)
// ============================================================================

/**
 * Handles incoming messages when deployed as a Google Chat app.
 * @param {Object} event - Chat event
 * @returns {Object} Response message
 */
function onMessage(event) {
  const message = event.message.text;
  const spaceName = event.space.name;

  // Parse the AI response to extract labels
  // Expected format: "Label1, Label2, Label3" or "NONE"
  const labels = message.trim();

  // Update the Processing row
  const result = updateProcessingRowWithLabels(labels);

  if (result.success) {
    return {
      text: `✅ Applied labels to email: ${labels}`
    };
  } else {
    return {
      text: `❌ Error: ${result.error}`
    };
  }
}

/**
 * Handles app added to space event.
 */
function onAddToSpace(event) {
  return {
    text: 'Thanks for adding me! I will update the Queue sheet when you send label responses.'
  };
}

// ============================================================================
// WEB APP FUNCTIONS (Requires deployment as web app)
// ============================================================================

/**
 * Handles POST requests when deployed as a web app.
 * Can receive webhooks from external services.
 *
 * @param {Object} e - Event object with postData
 * @returns {Object} JSON response
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Handle different payload formats
    if (data.emailId && data.labels) {
      // Direct update format
      const result = updateQueueWithLabels(data.emailId, data.labels, data.spreadsheetId);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.labels && !data.emailId) {
      // Update first Processing row
      const result = updateProcessingRowWithLabels(data.labels, data.spreadsheetId);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: 'Invalid payload format'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handles GET requests (for testing).
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'Inbound Chat Handler is running',
    endpoints: {
      'POST /': 'Update queue with labels',
      'payload': '{ emailId: "...", labels: "..." } or { labels: "..." }'
    }
  })).setMimeType(ContentService.MimeType.JSON);
}
