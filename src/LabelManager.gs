/**
 * Smart Call Time - Flow Integrator
 * Label Manager Module
 *
 * Handles Gmail label operations:
 * - Fetching labels from Gmail
 * - Syncing labels to the spreadsheet
 * - Applying labels to emails
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * System labels to exclude from user label lists.
 */
const SYSTEM_LABELS = [
  'INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT',
  'SENT', 'DRAFT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
  'CHAT', 'OPENED', 'SNOOZED'
];

// ============================================================================
// LABEL FETCHING
// ============================================================================

/**
 * Gets all user-created labels from Gmail.
 * Excludes system labels and hidden labels (starting with _).
 * @returns {Object[]} Array of label objects with name, id, nestedPath, type
 */
function getGmailLabels() {
  const allLabels = GmailApp.getUserLabels();
  const userLabels = [];

  allLabels.forEach(label => {
    const name = label.getName();

    // Skip system labels and hidden labels
    if (SYSTEM_LABELS.includes(name.toUpperCase()) || name.startsWith('_')) {
      return;
    }

    // Check if nested (contains /)
    const isNested = name.includes('/');

    userLabels.push({
      name: name,
      id: name, // Gmail uses name as ID for user labels
      nestedPath: isNested ? name : '',
      type: isNested ? 'Nested' : 'Top-level'
    });
  });

  // Sort alphabetically
  userLabels.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  return userLabels;
}

/**
 * Gets a label object by name (case-insensitive).
 * @param {string} labelName - The label name to find
 * @returns {GmailLabel|null} The Gmail label object or null
 */
function getLabelByName(labelName) {
  const allLabels = GmailApp.getUserLabels();
  const lowerName = labelName.toLowerCase();

  for (const label of allLabels) {
    if (label.getName().toLowerCase() === lowerName) {
      return label;
    }
  }

  return null;
}

// ============================================================================
// LABEL SYNCING
// ============================================================================

/**
 * Syncs Gmail labels to the Labels sheet.
 * Called manually or during setup.
 */
function syncLabelsToSheet() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Labels');

  if (!sheet) {
    console.error('Labels sheet not found. Run setup first.');
    return;
  }

  const labels = getGmailLabels();
  const now = new Date().toISOString();

  // Clear existing data (keep header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 5).clear();
  }

  // Prepare data rows
  const data = labels.map(label => [
    label.name,
    label.id,
    label.nestedPath,
    label.type,
    now
  ]);

  // Write to sheet
  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, 5).setValues(data);
  }

  sheet.autoResizeColumns(1, 5);

  // Update config
  setConfigValue('last_label_sync', now);

  // Update instructions with new labels
  updateInstructionsLabels(labels);

  logAction('SYSTEM', 'SYNC', `Synced ${labels.length} labels`);

  return labels;
}

/**
 * Gets labels from the Labels sheet (faster than Gmail API).
 * @returns {Object[]} Array of label objects
 */
function getLabelsFromSheet() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Labels');

  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  return data.map(row => ({
    name: row[0],
    id: row[1],
    nestedPath: row[2],
    type: row[3]
  }));
}

// ============================================================================
// LABEL APPLICATION
// ============================================================================

/**
 * Applies labels to an email thread.
 * @param {string} emailId - The Gmail message ID
 * @param {string[]} labelNames - Array of label names to apply
 * @returns {Object} Result with applied and notFound arrays
 */
function applyLabelsToEmail(emailId, labelNames) {
  // Get the message
  const message = GmailApp.getMessageById(emailId);
  if (!message) {
    throw new Error('Email not found: ' + emailId);
  }

  const thread = message.getThread();

  // Build label map for quick lookup
  const allLabels = GmailApp.getUserLabels();
  const labelMap = {};
  allLabels.forEach(label => {
    labelMap[label.getName().toLowerCase()] = label;
  });

  const applied = [];
  const notFound = [];

  // Apply each label
  labelNames.forEach(labelName => {
    // Skip empty or NONE
    if (!labelName || labelName.trim() === '' || labelName.toUpperCase() === 'NONE') {
      return;
    }

    const label = labelMap[labelName.toLowerCase()];
    if (label) {
      thread.addLabel(label);
      applied.push(labelName);
    } else {
      notFound.push(labelName);
    }
  });

  // Log the action
  if (applied.length > 0) {
    logAction(emailId, 'APPLY', applied.join(', '), 'Success');
  }
  if (notFound.length > 0) {
    logAction(emailId, 'WARN', `Labels not found: ${notFound.join(', ')}`);
  }

  return { applied, notFound };
}

/**
 * Removes labels from an email thread.
 * @param {string} emailId - The Gmail message ID
 * @param {string[]} labelNames - Array of label names to remove
 * @returns {Object} Result with removed and notFound arrays
 */
function removeLabelsFromEmail(emailId, labelNames) {
  const message = GmailApp.getMessageById(emailId);
  if (!message) {
    throw new Error('Email not found: ' + emailId);
  }

  const thread = message.getThread();

  const allLabels = GmailApp.getUserLabels();
  const labelMap = {};
  allLabels.forEach(label => {
    labelMap[label.getName().toLowerCase()] = label;
  });

  const removed = [];
  const notFound = [];

  labelNames.forEach(labelName => {
    if (!labelName || labelName.trim() === '') return;

    const label = labelMap[labelName.toLowerCase()];
    if (label) {
      thread.removeLabel(label);
      removed.push(labelName);
    } else {
      notFound.push(labelName);
    }
  });

  if (removed.length > 0) {
    logAction(emailId, 'REMOVE', removed.join(', '), 'Success');
  }

  return { removed, notFound };
}
