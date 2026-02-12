/**
 * Central Hub - Email Labeling Queue
 *
 * Manages the "EmailLabelingQueue" sheet on the Hub.
 * Google Flow writes rows here after Gemini assigns labels.
 * TimerProcessor reads rows to dispatch webhooks and clean up Chat messages.
 *
 * Sheet columns:
 *   A: Email ID
 *   B: Instance Name (user)
 *   C: Assigned Label(s)
 *   D: Chat Message Name (for cleanup/deletion)
 *   E: Status (new / dispatched / completed)
 *   F: Created At
 *   G: Dispatched At
 *
 * Lifecycle: new → dispatched → completed → (deleted after 24h)
 *
 * Dependencies:
 *   - HubMain.gs: logHub()
 */

var LABELING_SHEET_NAME = 'EmailLabelingQueue';

// ============================================================================
// SHEET SETUP
// ============================================================================

/**
 * Gets or creates the EmailLabelingQueue sheet.
 *
 * @returns {Sheet} The EmailLabelingQueue sheet
 */
function getOrCreateLabelingSheet() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(LABELING_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(LABELING_SHEET_NAME);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'Email ID', 'Instance Name', 'Assigned Labels', 'Chat Message Name',
      'Status', 'Created At', 'Dispatched At'
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }

  return sheet;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Adds a labeling result to the queue.
 * Called by Google Flow after Gemini assigns labels.
 *
 * @param {string} emailId - The Gmail email ID
 * @param {string} instanceName - User instance name
 * @param {string} labels - Comma-separated assigned labels
 * @param {string} chatMessageName - Chat message name for later cleanup
 * @returns {Object} Result with success status
 */
function addLabelingResult(emailId, instanceName, labels, chatMessageName) {
  try {
    var sheet = getOrCreateLabelingSheet();

    sheet.appendRow([
      emailId,
      instanceName,
      labels,
      chatMessageName || '',
      'new',
      new Date().toISOString(),
      ''
    ]);

    logHub('LABELING_ADDED', instanceName + '/' + emailId + ': ' + labels);

    return { success: true };

  } catch (error) {
    logHub('LABELING_ADD_ERROR', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Gets all rows with Status = "new" (ready to dispatch to users).
 *
 * @returns {Array} Array of result objects with row numbers
 */
function getPendingLabelResults() {
  var sheet = getOrCreateLabelingSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var results = [];

  for (var i = 0; i < data.length; i++) {
    if (data[i][4] === 'new') {
      results.push({
        row: i + 2,
        emailId: data[i][0],
        instanceName: data[i][1],
        labels: data[i][2],
        chatMessageName: data[i][3],
        status: data[i][4],
        createdAt: data[i][5]
      });
    }
  }

  return results;
}

/**
 * Gets all rows with Status = "dispatched" (waiting for user confirmation).
 *
 * @returns {Array} Array of result objects with row numbers
 */
function getDispatchedLabelResults() {
  var sheet = getOrCreateLabelingSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var results = [];

  for (var i = 0; i < data.length; i++) {
    if (data[i][4] === 'dispatched') {
      results.push({
        row: i + 2,
        emailId: data[i][0],
        instanceName: data[i][1],
        labels: data[i][2],
        chatMessageName: data[i][3],
        status: data[i][4],
        createdAt: data[i][5],
        dispatchedAt: data[i][6]
      });
    }
  }

  return results;
}

/**
 * Finds a labeling result by email ID and instance name.
 * Used when CONFIRM_COMPLETE arrives to look up the Chat Message Name.
 *
 * @param {string} instanceName - User instance name
 * @param {string} emailId - The email ID
 * @returns {Object|null} Result object or null
 */
function findLabelingResult(instanceName, emailId) {
  var sheet = getOrCreateLabelingSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) return null;

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === emailId && data[i][1] === instanceName) {
      return {
        row: i + 2,
        emailId: data[i][0],
        instanceName: data[i][1],
        labels: data[i][2],
        chatMessageName: data[i][3],
        status: data[i][4],
        createdAt: data[i][5],
        dispatchedAt: data[i][6]
      };
    }
  }

  return null;
}

/**
 * Marks a labeling result as dispatched (webhook sent to user).
 *
 * @param {number} row - Row number in the sheet
 */
function markLabelingDispatched(row) {
  var sheet = getOrCreateLabelingSheet();
  sheet.getRange(row, 5).setValue('dispatched');
  sheet.getRange(row, 7).setValue(new Date().toISOString());
}

/**
 * Marks a labeling result as completed (user confirmed, Chat cleaned up).
 *
 * @param {number} row - Row number in the sheet
 */
function markLabelingCompleted(row) {
  var sheet = getOrCreateLabelingSheet();
  sheet.getRange(row, 5).setValue('completed');
}

/**
 * Cleans up old completed entries (older than 24 hours).
 * Called at the end of each timer cycle.
 */
function cleanupOldLabelingEntries() {
  var sheet = getOrCreateLabelingSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
  var rowsToDelete = [];

  for (var i = 0; i < data.length; i++) {
    if (data[i][4] === 'completed') {
      var createdAt = new Date(data[i][5]);
      if (createdAt < cutoffTime) {
        rowsToDelete.push(i + 2);
      }
    }
  }

  // Delete from bottom to top to maintain row indices
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var j = 0; j < rowsToDelete.length; j++) {
    sheet.deleteRow(rowsToDelete[j]);
  }

  if (rowsToDelete.length > 0) {
    logHub('LABELING_CLEANUP', 'Removed ' + rowsToDelete.length + ' old completed entries');
  }
}
