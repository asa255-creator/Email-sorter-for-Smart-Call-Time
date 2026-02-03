/**
 * Smart Call Time - Flow Integrator
 * Logger Module
 *
 * Handles logging actions to the Log sheet for audit and debugging.
 */

// ============================================================================
// LOGGING FUNCTIONS
// ============================================================================

/**
 * Adds an entry to the Log sheet.
 * @param {string} emailId - The email ID (or 'SYSTEM' for system actions)
 * @param {string} action - The action performed (APPLY, REMOVE, SYNC, ERROR, etc.)
 * @param {string} details - Details about the action
 * @param {string} result - Optional result status
 * @param {string} notes - Optional additional notes
 */
function logAction(emailId, action, details, result = '', notes = '') {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Log');

  if (!sheet) return;

  const timestamp = new Date().toISOString();
  const lastRow = sheet.getLastRow();

  sheet.getRange(lastRow + 1, 1, 1, 6).setValues([
    [timestamp, emailId, action, details, result, notes]
  ]);
}

/**
 * Logs an error with full details.
 * @param {string} emailId - The email ID (or 'SYSTEM')
 * @param {Error} error - The error object
 * @param {string} context - Context where the error occurred
 */
function logError(emailId, error, context) {
  logAction(
    emailId,
    'ERROR',
    context,
    error.message,
    error.stack ? error.stack.substring(0, 200) : ''
  );
}

/**
 * Gets recent log entries.
 * @param {number} count - Number of entries to retrieve (default 50)
 * @returns {Object[]} Array of log entry objects
 */
function getRecentLogs(count = 50) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Log');

  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const startRow = Math.max(2, lastRow - count + 1);
  const numRows = lastRow - startRow + 1;

  const data = sheet.getRange(startRow, 1, numRows, 6).getValues();

  return data.map(row => ({
    timestamp: row[0],
    emailId: row[1],
    action: row[2],
    details: row[3],
    result: row[4],
    notes: row[5]
  })).reverse(); // Most recent first
}

/**
 * Clears old log entries, keeping only the most recent.
 * @param {number} keepCount - Number of entries to keep (default 1000)
 */
function pruneOldLogs(keepCount = 1000) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Log');

  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  const rowsToDelete = lastRow - 1 - keepCount;

  if (rowsToDelete > 0) {
    sheet.deleteRows(2, rowsToDelete);
    logAction('SYSTEM', 'PRUNE', `Deleted ${rowsToDelete} old log entries`);
  }
}

/**
 * Gets log entries for a specific email.
 * @param {string} emailId - The email ID to search for
 * @returns {Object[]} Array of log entries for that email
 */
function getLogsForEmail(emailId) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Log');

  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  return data
    .filter(row => row[1] === emailId)
    .map(row => ({
      timestamp: row[0],
      action: row[2],
      details: row[3],
      result: row[4],
      notes: row[5]
    }));
}
