/**
 * Smart Call Time - Flow Integrator
 * Queue Processor Module
 *
 * Timer-based polling model:
 * - 15-min timer scans inbox for unlabeled emails, adds to Queue
 * - Posts ONE email at a time to Chat (Status = "Posted")
 * - When Hub sends labels back via webhook, applies them and posts next
 *
 * Queue Sheet Columns (8 columns):
 *   A: Email ID
 *   B: Subject
 *   C: From
 *   D: Date
 *   E: (reserved)
 *   F: Status (Queued / Posted / Error)
 *   G: Posted At
 *   H: Context (full email body for Chat message)
 *
 * Status lifecycle: Queued → Posted → (deleted after labels applied)
 *
 * Dependencies:
 *   - OutboundNotification.gs: postToChat(), buildChatMessage(),
 *                               getLabelsForNotification(), getInstanceName()
 *   - ConfigManager.gs: getConfigValue(), getChatWebhookUrl()
 *   - LabelManager.gs: applyLabelsToEmail()
 *   - Logger.gs: logAction()
 */

// ============================================================================
// MAIN TIMER ENTRY POINT
// ============================================================================

/**
 * Main 15-minute timer function.
 * 1. Scans inbox for unlabeled emails, adds new ones to Queue as "Queued"
 * 2. If no email is currently "Posted", posts the top Queued email to Chat
 *
 * Called by the 15-minute time-based trigger.
 */
function checkInboxAndPostNext() {
  // Only process emails if registered with Hub
  if (getConfigValue('hub_registered') !== 'true') {
    logAction('SYSTEM', 'TIMER_SKIP', 'Not registered with Hub — skipping inbox scan');
    return;
  }

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Queue');
  if (!sheet) return;

  // Step 1: Scan inbox for new unlabeled emails
  var added = scanInboxForNewEmails(sheet);
  if (added > 0) {
    logAction('SYSTEM', 'INBOX_SCAN', 'Added ' + added + ' new email(s) to queue');
  }

  // Step 2: If nothing is currently Posted, post the next Queued email
  if (!hasPostedRow(sheet)) {
    postNextQueuedEmail(sheet);
  }
}

// ============================================================================
// INBOX SCANNING
// ============================================================================

/**
 * Scans Gmail for unlabeled emails and adds new ones to the Queue sheet.
 * All new emails get Status = "Queued".
 *
 * @param {Sheet} sheet - The Queue sheet
 * @returns {number} Number of new emails added
 */
function scanInboxForNewEmails(sheet) {
  var batchSize = parseInt(getConfigValue('batch_size') || '50');

  try {
    var threads = GmailApp.search('has:nouserlabels', 0, batchSize);
  } catch (error) {
    logAction('SYSTEM', 'INBOX_ERROR', 'Gmail search failed: ' + error.message);
    return 0;
  }

  if (threads.length === 0) return 0;

  var existingIds = getExistingQueueIds(sheet);
  var newRows = [];

  for (var i = 0; i < threads.length; i++) {
    var message = threads[i].getMessages()[0];
    var emailId = message.getId();

    if (existingIds.has(emailId)) continue;

    var context = buildEmailContext(message);

    newRows.push([
      emailId,
      message.getSubject() || '(no subject)',
      message.getFrom(),
      message.getDate().toISOString(),
      '', // Column E (reserved)
      'Queued',
      '', // Posted At
      context
    ]);
  }

  if (newRows.length === 0) return 0;

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, 8).setValues(newRows);

  return newRows.length;
}

/**
 * Builds full email context string for Chat message.
 *
 * @param {GmailMessage} message - The Gmail message
 * @returns {string} Formatted email content
 */
function buildEmailContext(message) {
  var from = message.getFrom() || '';
  var subject = message.getSubject() || '(no subject)';
  var date = message.getDate().toISOString();
  var body = message.getPlainBody() || '';

  var maxBodyLength = 10000;
  var truncatedBody = body.length > maxBodyLength
    ? body.substring(0, maxBodyLength) + '\n... [truncated]'
    : body;

  return 'FROM: ' + from + '\nSUBJECT: ' + subject + '\nDATE: ' + date + '\n\nBODY:\n' + truncatedBody;
}

// ============================================================================
// POST TO CHAT
// ============================================================================

/**
 * Posts the next Queued email to Chat and marks it as Posted.
 * Only posts ONE email — the top Queued row.
 *
 * @param {Sheet} [sheet] - The Queue sheet (fetched if not provided)
 * @returns {boolean} True if an email was posted
 */
function postNextQueuedEmail(sheet) {
  // Check registration before posting — without this, the chain from
  // applyLabelsAndAdvanceQueue would keep posting emails even when not registered
  if (getConfigValue('hub_registered') !== 'true') {
    logAction('SYSTEM', 'POST_SKIP', 'Not registered with Hub — skipping post');
    return false;
  }

  if (!sheet) {
    sheet = SpreadsheetApp.getActive().getSheetByName('Queue');
    if (!sheet) return false;
  }

  var webhookUrl = getChatWebhookUrl();
  if (!webhookUrl) {
    logAction('SYSTEM', 'POST_SKIP', 'No chat_webhook_url configured');
    return false;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  // Find the first Queued row
  for (var i = 0; i < data.length; i++) {
    if (data[i][5] === 'Queued') {
      var rowNum = i + 2;
      var emailId = data[i][0];
      var subject = data[i][1];
      var from = data[i][2];
      var context = data[i][7];

      // Build the EMAIL_READY message
      var instanceName = getInstanceName();
      var labels = getLabelsForNotification();

      var body = '===== AVAILABLE LABELS =====\n' + labels +
        '\n\n===== EMAIL TO CATEGORIZE =====\n' +
        'Email ID: ' + emailId + '\n' +
        'Subject: ' + subject + '\n' +
        'From: ' + from + '\n\n' +
        context +
        '\n\n===== INSTRUCTIONS =====\n' +
        'Respond with the matching label(s) from AVAILABLE LABELS above, using this format:\n' +
        'user: ' + instanceName + '\n' +
        'conversation_id: ' + emailId + '\n' +
        'type: LABEL_RESPONSE\n' +
        'status: closed\n\n' +
        'Label1, Label2\n\n' +
        'Use ONLY labels from AVAILABLE LABELS above.\n' +
        'If nothing fits, respond with NONE as the body.';

      var message = buildChatMessage(instanceName, emailId, 'EMAIL_READY', 'processing', body);

      // Post to Chat
      postToChat(webhookUrl, message);

      // Mark as Posted
      sheet.getRange(rowNum, 6).setValue('Posted');
      sheet.getRange(rowNum, 7).setValue(new Date().toISOString());

      logAction(emailId, 'POSTED', 'Posted to Chat: ' + subject);
      return true;
    }
  }

  return false; // No Queued rows found
}

// ============================================================================
// LABEL APPLICATION (called by InboundWebhook when Hub sends labels)
// ============================================================================

/**
 * Applies labels to an email and removes it from the queue.
 * Called by InboundWebhook.handleApplyLabels() when Hub sends a webhook.
 *
 * After applying labels:
 * 1. Posts CONFIRM_COMPLETE to Chat (tells Hub to clean up)
 * 2. Deletes the Queue row
 * 3. Posts the next Queued email to Chat
 *
 * @param {string} emailId - The Gmail email ID
 * @param {string} labelsString - Comma-separated label names
 * @returns {Object} Result with success status
 */
function applyLabelsAndAdvanceQueue(emailId, labelsString) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Queue');

  if (!sheet) {
    return { success: false, error: 'Queue sheet not found' };
  }

  // Parse labels
  var labels = parseLabelsString(labelsString);

  // Apply labels to the email (unless NONE)
  if (labels.length > 0) {
    try {
      applyLabelsToEmail(emailId, labels);
      logAction(emailId, 'LABELED', 'Applied: ' + labels.join(', '));
    } catch (error) {
      logAction(emailId, 'LABEL_ERROR', error.message);
      return { success: false, error: 'Failed to apply labels: ' + error.message };
    }
  } else {
    logAction(emailId, 'SKIP', 'No labels to apply (NONE)');
  }

  // Post CONFIRM_COMPLETE to Chat — tells the Hub labels were applied
  var webhookUrl = getChatWebhookUrl();
  if (webhookUrl) {
    var instanceName = getInstanceName();
    var confirmMsg = buildChatMessage(instanceName, emailId, 'CONFIRM_COMPLETE', 'closed');
    postToChat(webhookUrl, confirmMsg);
    logAction(emailId, 'CONFIRM_SENT', 'Posted CONFIRM_COMPLETE to Chat');
  }

  // Delete the Queue row for this email
  deleteQueueRowByEmailId(sheet, emailId);

  // Post the next Queued email to Chat
  postNextQueuedEmail(sheet);

  return {
    success: true,
    emailId: emailId,
    labelsApplied: labels
  };
}

// ============================================================================
// QUEUE HELPERS
// ============================================================================

/**
 * Checks if there's a row with Status = "Posted" (awaiting labeling).
 *
 * @param {Sheet} sheet - The Queue sheet
 * @returns {boolean} True if a Posted row exists
 */
function hasPostedRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var statuses = sheet.getRange(2, 6, lastRow - 1, 1).getValues();
  for (var i = 0; i < statuses.length; i++) {
    if (statuses[i][0] === 'Posted') return true;
  }
  return false;
}

/**
 * Deletes the Queue row matching an email ID.
 *
 * @param {Sheet} sheet - The Queue sheet
 * @param {string} emailId - Email ID to find and delete
 * @returns {boolean} True if row was found and deleted
 */
function deleteQueueRowByEmailId(sheet, emailId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === emailId) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

/**
 * Gets existing email IDs in the queue.
 *
 * @param {Sheet} sheet - The Queue sheet
 * @returns {Set} Set of existing email IDs
 */
function getExistingQueueIds(sheet) {
  var existingIds = new Set();
  var lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0]) existingIds.add(data[i][0]);
    }
  }

  return existingIds;
}

/**
 * Parses a comma-separated string of labels.
 *
 * @param {string} labelString - Comma-separated label names
 * @returns {string[]} Array of trimmed label names
 */
function parseLabelsString(labelString) {
  if (!labelString) return [];

  return labelString
    .split(',')
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l.length > 0 && l.toUpperCase() !== 'NONE'; });
}

// ============================================================================
// MANUAL MENU ACTIONS
// ============================================================================

/**
 * Manual menu action: Scans inbox and queues emails.
 * Called via menu: Smart Call Time > Email Sorter > Scan Inbox Now
 */
function scanInboxNow() {
  var ui = SpreadsheetApp.getUi();

  if (getConfigValue('hub_registered') !== 'true') {
    ui.alert('Not Registered',
      'This instance is not registered with the Hub.\n\n' +
      'Register first via:\n  Settings > Register with Hub (via Chat)',
      ui.ButtonSet.OK);
    return;
  }

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Queue');

  if (!sheet) {
    ui.alert('Error', 'Queue sheet not found. Run setup first.', ui.ButtonSet.OK);
    return;
  }

  var added = scanInboxForNewEmails(sheet);

  if (added === 0) {
    ui.alert('No New Emails', 'No new unlabeled emails found.', ui.ButtonSet.OK);
    return;
  }

  ui.alert('Emails Queued',
    'Added ' + added + ' new email(s) to the queue.\n\n' +
    'They will be posted to Chat one at a time.',
    ui.ButtonSet.OK);

  // If nothing is currently Posted, post the first one now
  if (!hasPostedRow(sheet)) {
    postNextQueuedEmail(sheet);
  }
}

/**
 * Clears the Queue sheet (keeps header).
 * Called via menu: Smart Call Time > Email Sorter > Clear Queue
 */
function clearQueue() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var sheet = ss.getSheetByName('Queue');

  if (!sheet) return;

  var response = ui.alert('Clear Queue',
    'Are you sure you want to clear all items from the queue?',
    ui.ButtonSet.YES_NO);

  if (response === ui.Button.YES) {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
    ui.alert('Queue Cleared', 'The queue has been cleared.', ui.ButtonSet.OK);
    logAction('SYSTEM', 'CLEAR', 'Queue cleared');
  }
}
