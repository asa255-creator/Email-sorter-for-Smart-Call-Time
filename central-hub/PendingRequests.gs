/**
 * Central Hub - Pending Requests Manager
 *
 * Tracks which users have pending requests waiting for AI response.
 * Used when AI response doesn't include the target instance name.
 */

// ============================================================================
// PENDING REQUEST MANAGEMENT
// ============================================================================

/**
 * Creates a pending request for a user.
 * Called when a user sends an email to be categorized.
 *
 * @param {string} instanceName - User's instance name
 * @param {string} emailId - Email ID being processed
 * @param {Object} metadata - Optional additional data
 * @returns {Object} Created request with requestId
 */
function createPendingRequest(instanceName, emailId, metadata) {
  const sheet = getOrCreatePendingSheet();

  const requestId = Utilities.getUuid();
  const createdAt = new Date().toISOString();

  sheet.appendRow([
    requestId,
    instanceName,
    emailId || '',
    'pending',
    createdAt,
    JSON.stringify(metadata || {})
  ]);

  logHub('PENDING_CREATED', `${instanceName}: ${emailId}`);

  return {
    requestId: requestId,
    instanceName: instanceName,
    emailId: emailId,
    createdAt: createdAt
  };
}

/**
 * Gets the oldest pending request.
 * Used for FIFO processing when AI response doesn't specify target.
 *
 * @returns {Object|null} Oldest pending request or null
 */
function getOldestPendingRequest() {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  // Find first pending request (already in chronological order)
  for (let i = 0; i < data.length; i++) {
    if (data[i][3] === 'pending') {
      return {
        row: i + 2,
        requestId: data[i][0],
        instanceName: data[i][1],
        emailId: data[i][2],
        status: data[i][3],
        createdAt: data[i][4],
        metadata: JSON.parse(data[i][5] || '{}')
      };
    }
  }

  return null;
}

/**
 * Gets a pending request for a specific user.
 *
 * @param {string} instanceName - User's instance name
 * @returns {Object|null} Pending request or null
 */
function getPendingRequestForUser(instanceName) {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === instanceName && data[i][3] === 'pending') {
      return {
        row: i + 2,
        requestId: data[i][0],
        instanceName: data[i][1],
        emailId: data[i][2],
        status: data[i][3],
        createdAt: data[i][4],
        metadata: JSON.parse(data[i][5] || '{}')
      };
    }
  }

  return null;
}

/**
 * Gets a pending request by instance name and email ID.
 * Used for cleanup when user confirms completion.
 *
 * @param {string} instanceName - User's instance name
 * @param {string} emailId - Email ID that was processed
 * @returns {Object|null} Pending request with messageNames or null
 */
function getPendingRequestByEmailId(instanceName, emailId) {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === instanceName && data[i][2] === emailId) {
      const metadata = JSON.parse(data[i][5] || '{}');
      return {
        row: i + 2,
        requestId: data[i][0],
        instanceName: data[i][1],
        emailId: data[i][2],
        status: data[i][3],
        createdAt: data[i][4],
        metadata: metadata,
        messageNames: metadata.messageNames || []
      };
    }
  }

  return null;
}

/**
 * Appends a message name to an existing pending request.
 * Used to track AI response messages for later cleanup.
 *
 * @param {string} instanceName - User's instance name
 * @param {string} messageName - Chat message name to add
 * @returns {boolean} True if found and updated
 */
function appendMessageToPending(instanceName, messageName) {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  // Find the most recent pending request for this instance
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][1] === instanceName && data[i][3] === 'pending') {
      const metadata = JSON.parse(data[i][5] || '{}');
      metadata.messageNames = metadata.messageNames || [];
      metadata.messageNames.push(messageName);

      sheet.getRange(i + 2, 6).setValue(JSON.stringify(metadata));
      logHub('MESSAGE_TRACKED', `${instanceName}: +${messageName}`);
      return true;
    }
  }

  return false;
}

/**
 * Removes a pending request from the sheet.
 * Called after cleanup is complete.
 *
 * @param {string} instanceName - User's instance name
 * @param {string} emailId - Email ID that was processed
 * @returns {boolean} True if found and removed
 */
function removePendingRequest(instanceName, emailId) {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === instanceName && data[i][2] === emailId) {
      sheet.deleteRow(i + 2);
      logHub('PENDING_REMOVED', `${instanceName}/${emailId}`);
      return true;
    }
  }

  return false;
}

/**
 * Marks a pending request as completed.
 *
 * @param {string} requestId - Request ID
 * @returns {boolean} True if found and updated
 */
function completePendingRequest(requestId) {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === requestId) {
      sheet.getRange(i + 2, 4).setValue('completed');
      logHub('PENDING_COMPLETED', requestId);
      return true;
    }
  }

  return false;
}

/**
 * Marks a pending request as failed.
 *
 * @param {string} requestId - Request ID
 * @param {string} reason - Failure reason
 * @returns {boolean} True if found and updated
 */
function failPendingRequest(requestId, reason) {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === requestId) {
      sheet.getRange(i + 2, 4).setValue('failed');

      // Update metadata with failure reason
      const metadata = JSON.parse(data[i][5] || '{}');
      metadata.failureReason = reason;
      metadata.failedAt = new Date().toISOString();
      sheet.getRange(i + 2, 6).setValue(JSON.stringify(metadata));

      logHub('PENDING_FAILED', `${requestId}: ${reason}`);
      return true;
    }
  }

  return false;
}

/**
 * Cleans up old completed/failed requests.
 * Keeps requests for 24 hours for debugging.
 */
function cleanupPendingRequests() {
  const sheet = getOrCreatePendingSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  const rowsToDelete = [];

  for (let i = 0; i < data.length; i++) {
    const status = data[i][3];
    const createdAt = new Date(data[i][4]);

    if ((status === 'completed' || status === 'failed') && createdAt < cutoffTime) {
      rowsToDelete.push(i + 2);
    }
  }

  // Delete from bottom to top to maintain row indices
  rowsToDelete.sort((a, b) => b - a);
  for (const row of rowsToDelete) {
    sheet.deleteRow(row);
  }

  if (rowsToDelete.length > 0) {
    logHub('PENDING_CLEANUP', `Removed ${rowsToDelete.length} old requests`);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets or creates the Pending sheet.
 *
 * @returns {Sheet} The Pending sheet
 */
function getOrCreatePendingSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName('Pending');

  if (!sheet) {
    sheet = ss.insertSheet('Pending');
    sheet.getRange(1, 1, 1, 6).setValues([[
      'Request ID', 'Instance Name', 'Email ID', 'Status', 'Created At', 'Metadata'
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }

  return sheet;
}
