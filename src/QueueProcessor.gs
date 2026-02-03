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
 * Adds all unread emails to the Queue sheet for processing.
 * Called via menu: Smart Call Time > Email Sorter > Queue Unread Emails
 */
function queueUnreadEmails() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName('Queue');

  if (!sheet) {
    ui.alert('Error', 'Queue sheet not found. Run setup first.', ui.ButtonSet.OK);
    return;
  }

  const batchSize = parseInt(getConfigValue('batch_size') || '50');
  const threads = GmailApp.search('is:unread', 0, batchSize);

  if (threads.length === 0) {
    ui.alert('No Emails', 'No unread emails found to process.', ui.ButtonSet.OK);
    return;
  }

  // Get existing email IDs to avoid duplicates
  const existingIds = getExistingQueueIds(sheet);

  // Build new rows
  const newRows = [];
  threads.forEach(thread => {
    const message = thread.getMessages()[0];
    const emailId = message.getId();

    if (!existingIds.has(emailId)) {
      newRows.push([
        emailId,
        message.getSubject() || '(no subject)',
        message.getFrom(),
        message.getDate().toISOString(),
        '', // Labels to Apply - Flow fills this
        'Pending',
        '' // Processed At
      ]);
    }
  });

  if (newRows.length === 0) {
    ui.alert('Already Queued',
      'All unread emails are already in the queue.',
      ui.ButtonSet.OK);
    return;
  }

  // Append to sheet
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, 7).setValues(newRows);

  ui.alert('Emails Queued',
    `Added ${newRows.length} emails to the queue.\n\n` +
    'Your Google Flow should now:\n' +
    '1. Read rows where Status = "Pending"\n' +
    '2. Process each email and determine labels\n' +
    '3. Write labels to the "Labels to Apply" column\n\n' +
    'Labels will be automatically applied when updated.',
    ui.ButtonSet.OK);

  logAction('SYSTEM', 'QUEUE', `Queued ${newRows.length} emails`);
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
 * Called by the onEdit trigger.
 * @param {number} rowNumber - The row number that was edited
 */
function processQueueRow(rowNumber) {
  // Skip header row
  if (rowNumber <= 1) return;

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue');
  if (!sheet) return;

  // Read the row
  const row = sheet.getRange(rowNumber, 1, 1, 7).getValues()[0];
  const emailId = row[0];
  const labelsToApply = row[4]; // Column E
  const status = row[5]; // Column F

  // Only process if:
  // - We have labels to apply
  // - Status is still "Pending"
  if (!labelsToApply || labelsToApply.trim() === '' || status !== 'Pending') {
    return;
  }

  // Parse labels (comma-separated)
  const labels = parseLabelsString(labelsToApply);

  // Handle NONE or empty
  if (labels.length === 0) {
    sheet.getRange(rowNumber, 6).setValue('Skipped');
    sheet.getRange(rowNumber, 7).setValue(new Date().toISOString());
    logAction(emailId, 'SKIP', 'No labels to apply');
    return;
  }

  // Set status to Processing
  sheet.getRange(rowNumber, 6).setValue('Processing');

  try {
    // Apply labels
    const result = applyLabelsToEmail(emailId, labels);

    // Update status
    sheet.getRange(rowNumber, 6).setValue('Complete');
    sheet.getRange(rowNumber, 7).setValue(new Date().toISOString());

  } catch (error) {
    // Handle error
    sheet.getRange(rowNumber, 6).setValue('Error');
    sheet.getRange(rowNumber, 7).setValue(new Date().toISOString());
    logAction(emailId, 'ERROR', error.message);
  }
}

/**
 * Processes all pending items in the queue.
 * Called via menu: Smart Call Time > Email Sorter > Process All Pending
 */
function processAllPending() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const rateLimit = parseInt(getConfigValue('rate_limit_ms') || '3000');

  let processed = 0;

  data.forEach((row, index) => {
    const labelsToApply = row[4];
    const status = row[5];

    // Only process Pending rows with labels
    if (labelsToApply && labelsToApply.trim() !== '' && status === 'Pending') {
      processQueueRow(index + 2);
      processed++;

      // Rate limiting
      if (processed < data.length) {
        Utilities.sleep(rateLimit);
      }
    }
  });

  logAction('SYSTEM', 'BATCH', `Processed ${processed} pending items`);
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
      sheet.getRange(2, 1, lastRow - 1, 7).clear();
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
