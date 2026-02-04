/**
 * Smart Call Time - Flow Integrator
 * Inbound Direct Sheet Module
 *
 * Handles inbound label data when Flow writes directly to the Queue sheet.
 * Used when inbound_method = 'direct_sheet_edit'
 *
 * In this mode:
 * - Flow reads the Queue sheet
 * - Flow processes email and determines labels
 * - Flow writes labels directly to "Labels to Apply" column
 * - Script's time-based trigger detects the change and applies labels
 */

// ============================================================================
// DIRECT SHEET INBOUND HANDLER
// ============================================================================

/**
 * Checks the Queue sheet for rows that have labels filled in.
 * Called by the time-based trigger (checkQueueForProcessing).
 * This is the main entry point for direct_sheet_edit inbound method.
 * @returns {boolean} True if any rows were processed
 */
function directSheet_checkForLabels() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue');
  if (!sheet) return false;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false; // No data rows

  // Find rows with Status = "Processing" AND Labels to Apply is filled
  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  for (let i = 0; i < data.length; i++) {
    const labelsToApply = data[i][4]; // Column E
    const status = data[i][5]; // Column F

    if (status === 'Processing' && labelsToApply && labelsToApply.trim() !== '') {
      // Found a row ready to process
      const rowNum = i + 2;
      return { found: true, rowNumber: rowNum };
    }
  }

  return { found: false, rowNumber: null };
}

/**
 * Validates that the inbound method is direct_sheet_edit.
 * @returns {boolean} True if direct sheet edit is the configured method
 */
function directSheet_isEnabled() {
  const inboundMethod = getConfigValue('inbound_method') || 'direct_sheet_edit';
  return inboundMethod === 'direct_sheet_edit';
}
