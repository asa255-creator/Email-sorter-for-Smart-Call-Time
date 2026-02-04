/**
 * Smart Call Time - Flow Integrator
 * Queue Processor Module
 *
 * Handles the email processing queue:
 * - Adding unread emails to queue
 * - Processing queue items when Flow updates them
 * - Managing queue state
 */

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

/**
 * Adds all unlabeled emails to the Queue sheet for processing.
 * First email gets Status = "Processing", rest get "Pending".
 * Context column filled with full email content for Flow/AI to read.
 * Called via menu: Smart Call Time > Email Sorter > Queue Unlabeled Emails
 */
function queueUnlabeledEmails() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName('Queue');

  if (!sheet) {
    ui.alert('Error', 'Queue sheet not found. Run setup first.', ui.ButtonSet.OK);
    return;
  }

  const batchSize = parseInt(getConfigValue('batch_size') || '50');
  // Search for emails without any user labels
  const threads = GmailApp.search('has:nouserlabels', 0, batchSize);

  if (threads.length === 0) {
    ui.alert('No Emails', 'No unlabeled emails found to process.', ui.ButtonSet.OK);
    return;
  }

  // Get existing email IDs to avoid duplicates
  const existingIds = getExistingQueueIds(sheet);

  // Check if there's already a "Processing" row
  const hasProcessing = hasProcessingRow(sheet);

  // Build all rows with full context upfront
  const newRows = [];
  threads.forEach((thread, index) => {
    const message = thread.getMessages()[0];
    const emailId = message.getId();

    if (!existingIds.has(emailId)) {
      // Fetch full context for every email
      const context = buildEmailContext(message);

      newRows.push([
        emailId,
        message.getSubject() || '(no subject)',
        message.getFrom(),
        message.getDate().toISOString(),
        '', // Labels to Apply - Flow fills this
        'Pending', // All start as Pending, we'll set first to Processing after
        '', // Processed At
        context
      ]);
    }
  });

  // Set first row to Processing if no existing Processing row
  if (newRows.length > 0 && !hasProcessing) {
    newRows[0][5] = 'Processing';
  }

  if (newRows.length === 0) {
    ui.alert('Already Queued',
      'All unread emails are already in the queue.',
      ui.ButtonSet.OK);
    return;
  }

  // Append to sheet (8 columns now)
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, 8).setValues(newRows);

  ui.alert('Emails Queued',
    `Added ${newRows.length} emails to the queue.\n\n` +
    'Flow will process emails one at a time:\n' +
    '- First row has Status = "Processing"\n' +
    '- Flow reads Context column for email content\n' +
    '- After labeling, row is deleted and next becomes "Processing"',
    ui.ButtonSet.OK);

  logAction('SYSTEM', 'QUEUE', `Queued ${newRows.length} emails`);
}

/**
 * Builds full email context string for AI processing.
 * @param {GmailMessage} message - The Gmail message
 * @returns {string} Formatted email content
 */
function buildEmailContext(message) {
  const from = message.getFrom() || '';
  const subject = message.getSubject() || '(no subject)';
  const date = message.getDate().toISOString();
  const body = message.getPlainBody() || '';

  // Truncate body if too long (Sheets cell limit is ~50k chars)
  const maxBodyLength = 10000;
  const truncatedBody = body.length > maxBodyLength
    ? body.substring(0, maxBodyLength) + '\n... [truncated]'
    : body;

  return `FROM: ${from}\nSUBJECT: ${subject}\nDATE: ${date}\n\nBODY:\n${truncatedBody}`;
}

/**
 * Checks if there's already a row with Status = "Processing".
 * @param {Sheet} sheet - The Queue sheet
 * @returns {boolean} True if a Processing row exists
 */
function hasProcessingRow(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  const statuses = sheet.getRange(2, 6, lastRow - 1, 1).getValues();
  return statuses.some(row => row[0] === 'Processing');
}

/**
 * Gets existing email IDs in the queue.
 * @param {Sheet} sheet - The Queue sheet
 * @returns {Set} Set of existing email IDs
 */
function getExistingQueueIds(sheet) {
  const existingIds = new Set();
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    data.forEach(row => {
      if (row[0]) existingIds.add(row[0]);
    });
  }

  return existingIds;
}

// ============================================================================
// QUEUE PROCESSING
// ============================================================================

/**
 * Processes a single queue row when the "Labels to Apply" column is updated.
 * Only processes rows with Status = "Processing".
 * Deletes the row after success and promotes next Pending to Processing.
 * Called by the onEdit trigger.
 * @param {number} rowNumber - The row number that was edited
 * @returns {boolean} True if row was deleted
 */
function processQueueRow(rowNumber) {
  // Skip header row
  if (rowNumber <= 1) return false;

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue');
  if (!sheet) return false;

  // Read the row (8 columns now)
  const row = sheet.getRange(rowNumber, 1, 1, 8).getValues()[0];
  const emailId = row[0];
  const labelsToApply = row[4]; // Column E
  const status = row[5]; // Column F

  // Only process if:
  // - We have labels to apply
  // - Status is "Processing"
  if (!labelsToApply || labelsToApply.trim() === '' || status !== 'Processing') {
    return false;
  }

  // Parse labels (comma-separated)
  const labels = parseLabelsString(labelsToApply);

  // Handle NONE or empty - delete row and promote next
  if (labels.length === 0) {
    logAction(emailId, 'SKIP', 'No labels to apply');
    sheet.deleteRow(rowNumber);
    promoteNextPending();
    return true;
  }

  try {
    // Apply labels
    const result = applyLabelsToEmail(emailId, labels);

    // Success - delete the row from queue
    sheet.deleteRow(rowNumber);

    // Promote next Pending row to Processing (triggers Flow again)
    promoteNextPending();

    return true;

  } catch (error) {
    // Handle error - keep row for review, but still promote next
    sheet.getRange(rowNumber, 6).setValue('Error');
    sheet.getRange(rowNumber, 7).setValue(new Date().toISOString());
    logAction(emailId, 'ERROR', error.message);

    // Still promote next pending so queue keeps moving
    promoteNextPending();

    return false;
  }
}

/**
 * Promotes the first "Pending" row to "Processing".
 * Context is already populated - just change the status.
 * This triggers the Flow to process the next email.
 */
function promoteNextPending() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // No data rows

  // Find first Pending row (start from row 2)
  const statuses = sheet.getRange(2, 6, lastRow - 1, 1).getValues();

  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i][0] === 'Pending') {
      // Change to Processing - this edit triggers Flow
      sheet.getRange(i + 2, 6).setValue('Processing');
      logAction('SYSTEM', 'PROMOTE', `Row ${i + 2} promoted to Processing`);
      return;
    }
  }

  // No more Pending rows - queue is complete
  logAction('SYSTEM', 'COMPLETE', 'Queue processing complete');
}

/**
 * Processes all items in the queue that have labels filled in.
 * Processes from bottom to top to handle row deletions correctly.
 * Called via menu: Smart Call Time > Email Sorter > Process All Pending
 */
function processAllPending() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const rateLimit = parseInt(getConfigValue('rate_limit_ms') || '3000');
  let processed = 0;

  // Process from bottom to top so row deletions don't affect indexes
  for (let rowNum = lastRow; rowNum >= 2; rowNum--) {
    const row = sheet.getRange(rowNum, 1, 1, 8).getValues()[0];
    const labelsToApply = row[4];
    const status = row[5];

    // Process rows with labels that aren't errors
    if (labelsToApply && labelsToApply.trim() !== '' && status !== 'Error') {
      // Temporarily set to Processing so processQueueRow will handle it
      sheet.getRange(rowNum, 6).setValue('Processing');
      processQueueRow(rowNum);
      processed++;

      // Rate limiting
      Utilities.sleep(rateLimit);
    }
  }

  logAction('SYSTEM', 'BATCH', `Processed ${processed} items`);
}

/**
 * Clears the Queue sheet (keeps header).
 * Called via menu: Smart Call Time > Email Sorter > Clear Queue
 */
function clearQueue() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName('Queue');

  if (!sheet) return;

  const response = ui.alert('Clear Queue',
    'Are you sure you want to clear all items from the queue?',
    ui.ButtonSet.YES_NO);

  if (response === ui.Button.YES) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 8).clear();
    }
    ui.alert('Queue Cleared', 'The queue has been cleared.', ui.ButtonSet.OK);
    logAction('SYSTEM', 'CLEAR', 'Queue cleared');
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parses a comma-separated string of labels.
 * @param {string} labelString - Comma-separated label names
 * @returns {string[]} Array of trimmed label names
 */
function parseLabelsString(labelString) {
  if (!labelString) return [];

  return labelString
    .split(',')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.toUpperCase() !== 'NONE');
}
