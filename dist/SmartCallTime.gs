/**
 * ============================================================================
 * SMART CALL TIME - FLOW INTEGRATOR
 * ============================================================================
 *
 * A Google Workspace integration platform for Google Flows.
 * Works with: Google Sheets, Google Docs, or Standalone Scripts
 *
 * INSTALLATION:
 * 1. Create a new Google Sheet (or Doc, or standalone Apps Script)
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code
 * 4. Paste this entire file
 * 5. Save and refresh your document
 * 6. Use the "Smart Call Time" menu to set up
 *
 * For Sheets: Creates Labels, Queue, Config, Log, and Instructions sheets
 * For Docs: Creates a sidebar interface
 * For Standalone: Run functions directly or deploy as web app
 *
 * Version: 1.0.0
 * ============================================================================
 */

// ============================================================================
// MODULE: CORE - Container Detection & Utilities
// ============================================================================

const Core = (function() {

  /**
   * Detects what type of container this script is running in.
   * @returns {string} 'sheets', 'docs', 'slides', 'forms', or 'standalone'
   */
  function getContainerType() {
    try {
      SpreadsheetApp.getActive();
      return 'sheets';
    } catch (e) {}

    try {
      DocumentApp.getActive();
      return 'docs';
    } catch (e) {}

    try {
      SlidesApp.getActive();
      return 'slides';
    } catch (e) {}

    try {
      FormApp.getActive();
      return 'forms';
    } catch (e) {}

    return 'standalone';
  }

  /**
   * Gets the UI object for the current container.
   * @returns {Ui|null} The UI object or null if not available
   */
  function getUi() {
    const type = getContainerType();

    switch (type) {
      case 'sheets':
        return SpreadsheetApp.getUi();
      case 'docs':
        return DocumentApp.getUi();
      case 'slides':
        return SlidesApp.getUi();
      case 'forms':
        return FormApp.getUi();
      default:
        return null;
    }
  }

  /**
   * Gets the active spreadsheet (creates one if in standalone mode).
   * @returns {Spreadsheet|null}
   */
  function getSpreadsheet() {
    const type = getContainerType();

    if (type === 'sheets') {
      return SpreadsheetApp.getActive();
    }

    // For other containers, try to get linked spreadsheet from properties
    const props = PropertiesService.getScriptProperties();
    const linkedSheetId = props.getProperty('linkedSpreadsheetId');

    if (linkedSheetId) {
      try {
        return SpreadsheetApp.openById(linkedSheetId);
      } catch (e) {
        // Spreadsheet no longer accessible
        props.deleteProperty('linkedSpreadsheetId');
      }
    }

    return null;
  }

  /**
   * Links a spreadsheet to this script (for non-Sheets containers).
   * @param {string} spreadsheetId - The spreadsheet ID to link
   */
  function linkSpreadsheet(spreadsheetId) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('linkedSpreadsheetId', spreadsheetId);
  }

  /**
   * Shows an alert dialog.
   */
  function alert(title, message) {
    const ui = getUi();
    if (ui) {
      ui.alert(title, message, ui.ButtonSet.OK);
    } else {
      console.log(`${title}: ${message}`);
    }
  }

  /**
   * Shows a confirmation dialog.
   * @returns {boolean} True if user clicked Yes
   */
  function confirm(title, message) {
    const ui = getUi();
    if (ui) {
      return ui.alert(title, message, ui.ButtonSet.YES_NO) === ui.Button.YES;
    }
    return true; // Default to yes in standalone
  }

  return {
    getContainerType,
    getUi,
    getSpreadsheet,
    linkSpreadsheet,
    alert,
    confirm
  };
})();

// ============================================================================
// MODULE: CONFIG - Configuration Management
// ============================================================================

const Config = (function() {

  const DEFAULTS = {
    rate_limit_ms: '3000',
    batch_size: '50',
    version: '1.0.0'
  };

  /**
   * Gets a config value.
   */
  function get(key) {
    const ss = Core.getSpreadsheet();
    if (!ss) {
      // Fallback to script properties
      return PropertiesService.getScriptProperties().getProperty(key) || DEFAULTS[key];
    }

    const sheet = ss.getSheetByName('Config');
    if (!sheet) return DEFAULTS[key];

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) return data[i][1];
    }

    return DEFAULTS[key];
  }

  /**
   * Sets a config value.
   */
  function set(key, value) {
    const ss = Core.getSpreadsheet();
    if (!ss) {
      PropertiesService.getScriptProperties().setProperty(key, value);
      return;
    }

    const sheet = ss.getSheetByName('Config');
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }

    // Key not found, add it
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, 1, 2).setValues([[key, value]]);
  }

  /**
   * Gets all config values.
   */
  function getAll() {
    const ss = Core.getSpreadsheet();
    if (!ss) {
      const props = PropertiesService.getScriptProperties().getProperties();
      return { ...DEFAULTS, ...props };
    }

    const sheet = ss.getSheetByName('Config');
    if (!sheet) return DEFAULTS;

    const data = sheet.getDataRange().getValues();
    const config = { ...DEFAULTS };

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) config[data[i][0]] = data[i][1];
    }

    return config;
  }

  return { get, set, getAll, DEFAULTS };
})();

// ============================================================================
// MODULE: LOGGER - Logging Functions
// ============================================================================

const Logger_ = (function() {

  /**
   * Logs an action to the Log sheet.
   */
  function log(emailId, action, details, result = '', notes = '') {
    const ss = Core.getSpreadsheet();
    if (!ss) {
      console.log(`[${action}] ${emailId}: ${details} - ${result}`);
      return;
    }

    const sheet = ss.getSheetByName('Log');
    if (!sheet) return;

    const timestamp = new Date().toISOString();
    const lastRow = sheet.getLastRow();

    sheet.getRange(lastRow + 1, 1, 1, 6).setValues([
      [timestamp, emailId, action, details, result, notes]
    ]);
  }

  /**
   * Logs an error.
   */
  function error(emailId, err, context) {
    log(emailId, 'ERROR', context, err.message, err.stack ? err.stack.substring(0, 200) : '');
  }

  /**
   * Gets recent log entries.
   */
  function getRecent(count = 50) {
    const ss = Core.getSpreadsheet();
    if (!ss) return [];

    const sheet = ss.getSheetByName('Log');
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    const startRow = Math.max(2, lastRow - count + 1);
    const numRows = lastRow - startRow + 1;

    return sheet.getRange(startRow, 1, numRows, 6).getValues()
      .map(row => ({
        timestamp: row[0],
        emailId: row[1],
        action: row[2],
        details: row[3],
        result: row[4],
        notes: row[5]
      }))
      .reverse();
  }

  return { log, error, getRecent };
})();

// ============================================================================
// MODULE: SHEETS - Sheet Creation & Management
// ============================================================================

const Sheets = (function() {

  /**
   * Creates all required sheets.
   */
  function createAll(ss) {
    createConfigSheet(ss);
    createLabelsSheet(ss);
    createQueueSheet(ss);
    createLogSheet(ss);
    createInstructionsSheet(ss);
  }

  function createConfigSheet(ss) {
    let sheet = ss.getSheetByName('Config');
    if (!sheet) sheet = ss.insertSheet('Config');

    sheet.clear();
    sheet.getRange('A1:B1').setValues([['Setting', 'Value']]);
    sheet.getRange('A1:B1').setFontWeight('bold').setBackground('#4285f4').setFontColor('white');

    const config = Object.entries(Config.DEFAULTS).map(([k, v]) => [k, v]);
    config.push(['last_label_sync', ''], ['setup_complete', 'true']);

    sheet.getRange(2, 1, config.length, 2).setValues(config);
    sheet.autoResizeColumns(1, 2);
    sheet.hideSheet();
  }

  function createLabelsSheet(ss) {
    let sheet = ss.getSheetByName('Labels');
    if (!sheet) sheet = ss.insertSheet('Labels');

    sheet.clear();
    const headers = ['Label Name', 'Label ID', 'Nested Path', 'Type', 'Last Updated'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#34a853').setFontColor('white');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);

    sheet.getRange('A1').setNote(
      'Gmail labels synced from your account.\n' +
      'Google Flows reads this sheet.\n\n' +
      'Refresh: Smart Call Time > Email Sorter > Sync Labels'
    );
  }

  function createQueueSheet(ss) {
    let sheet = ss.getSheetByName('Queue');
    if (!sheet) sheet = ss.insertSheet('Queue');

    sheet.clear();
    const headers = ['Email ID', 'Subject', 'From', 'Date', 'Labels to Apply', 'Status', 'Processed At'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fbbc04').setFontColor('black');

    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Pending', 'Processing', 'Complete', 'Error', 'Skipped'], true)
      .build();
    sheet.getRange('F2:F1000').setDataValidation(statusRule);

    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);

    sheet.getRange('A1').setNote(
      'EMAIL QUEUE WORKFLOW:\n\n' +
      '1. Run "Queue Unread Emails"\n' +
      '2. Flow reads Pending rows\n' +
      '3. Flow writes to "Labels to Apply"\n' +
      '4. Script auto-applies labels'
    );
  }

  function createLogSheet(ss) {
    let sheet = ss.getSheetByName('Log');
    if (!sheet) sheet = ss.insertSheet('Log');

    sheet.clear();
    const headers = ['Timestamp', 'Email ID', 'Action', 'Details', 'Result', 'Notes'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#ea4335').setFontColor('white');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }

  function createInstructionsSheet(ss) {
    let sheet = ss.getSheetByName('Instructions');
    if (!sheet) {
      sheet = ss.insertSheet('Instructions');
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(1);
    }

    sheet.clear();

    let webAppUrl = '[Deploy as web app first]';
    try { webAppUrl = ScriptApp.getService().getUrl() || webAppUrl; } catch (e) {}

    const labels = Labels.getFromGmail();
    const labelList = labels.map(l => l.name).join(', ');

    const content = buildInstructionsContent(webAppUrl, labelList);
    sheet.getRange(1, 1, content.length, 1).setValues(content.map(r => [r]));

    sheet.getRange('A1').setFontSize(16).setFontWeight('bold');
    sheet.setColumnWidth(1, 800);

    // Highlight section headers
    const data = sheet.getDataRange().getValues();
    data.forEach((row, i) => {
      if (row[0] && row[0].toString().startsWith('═══')) {
        sheet.getRange(i + 1, 1).setBackground('#e8f0fe').setFontWeight('bold');
        if (i + 2 <= data.length) {
          sheet.getRange(i + 2, 1).setBackground('#e8f0fe').setFontWeight('bold');
        }
      }
    });
  }

  function buildInstructionsContent(webAppUrl, labelList) {
    return [
      'SMART CALL TIME - EMAIL SORTER SETUP',
      '',
      'This system lets Google Flows automatically sort your emails.',
      '',
      '═══════════════════════════════════════════════════════════════',
      'STEP 1: DEPLOY AS WEB APP',
      '',
      '1. Extensions > Apps Script > Deploy > New deployment',
      '2. Select type: Web app',
      '3. Execute as: Me | Who has access: Anyone',
      '4. Deploy and copy the URL',
      '',
      'YOUR WEB APP URL:',
      webAppUrl,
      '',
      '═══════════════════════════════════════════════════════════════',
      'STEP 2: GOOGLE FLOW FOR NEW EMAILS',
      '',
      'Trigger: When a new email arrives',
      '',
      '1. Read "Labels" sheet for available labels',
      '2. Use AI to select labels (prompt below)',
      '3. POST to apply:',
      '   ' + webAppUrl,
      '   {"command":"APPLY_LABELS","emailId":"{id}","labels":["Label1"]}',
      '',
      '═══════════════════════════════════════════════════════════════',
      'STEP 3: GOOGLE FLOW FOR QUEUE (OLD EMAILS)',
      '',
      'Trigger: When "Queue" sheet row added/modified, Status="Pending"',
      '',
      '1. Get Email ID from row',
      '2. Fetch email via Gmail connector',
      '3. Use AI to select labels',
      '4. Update "Labels to Apply" column (script auto-applies)',
      '',
      '═══════════════════════════════════════════════════════════════',
      'AI PROMPT FOR LABEL SELECTION',
      '',
      '--- COPY FROM HERE ---',
      'You are an email categorization assistant.',
      '',
      'AVAILABLE LABELS:',
      labelList || '(No labels - create labels in Gmail first)',
      '',
      'EMAIL:',
      'From: {sender}',
      'Subject: {subject}',
      'Body: {body_preview}',
      '',
      'RULES:',
      '1. Select 1-3 labels that fit',
      '2. ONLY use labels from the list',
      '3. If nothing fits: NONE',
      '',
      'RESPOND WITH ONLY label names, comma-separated.',
      '--- COPY TO HERE ---',
      '',
      '═══════════════════════════════════════════════════════════════',
      'API REFERENCE',
      '',
      'GET  - Returns status and labels',
      'POST {"command":"GET_LABELS"} - Get all labels',
      'POST {"command":"APPLY_LABELS","emailId":"x","labels":["A"]} - Apply',
      'POST {"command":"REMOVE_LABELS","emailId":"x","labels":["A"]} - Remove',
      'POST {"command":"SYNC_LABELS"} - Sync labels from Gmail',
      '',
      '═══════════════════════════════════════════════════════════════',
      'MENU OPTIONS',
      '',
      'Smart Call Time > Email Sorter > Setup - Initial setup',
      'Smart Call Time > Email Sorter > Sync Labels - Refresh labels',
      'Smart Call Time > Email Sorter > Queue Unread - Add emails to queue',
      'Smart Call Time > Email Sorter > Process Pending - Process queue',
    ];
  }

  /**
   * Updates the Instructions sheet with new labels.
   */
  function updateInstructionsLabels(labels) {
    const ss = Core.getSpreadsheet();
    if (!ss) return;

    const sheet = ss.getSheetByName('Instructions');
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === 'AVAILABLE LABELS:') {
        const labelList = labels.map(l => l.name).join(', ') || '(No labels)';
        sheet.getRange(i + 2, 1).setValue(labelList);
        break;
      }
    }
  }

  return { createAll, updateInstructionsLabels };
})();

// ============================================================================
// MODULE: LABELS - Gmail Label Management
// ============================================================================

const Labels = (function() {

  const SYSTEM_LABELS = [
    'INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT',
    'SENT', 'DRAFT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
    'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
    'CHAT', 'OPENED', 'SNOOZED'
  ];

  /**
   * Gets all user labels from Gmail.
   */
  function getFromGmail() {
    const allLabels = GmailApp.getUserLabels();
    const userLabels = [];

    allLabels.forEach(label => {
      const name = label.getName();
      if (SYSTEM_LABELS.includes(name.toUpperCase()) || name.startsWith('_')) return;

      const isNested = name.includes('/');
      userLabels.push({
        name: name,
        id: name,
        nestedPath: isNested ? name : '',
        type: isNested ? 'Nested' : 'Top-level'
      });
    });

    return userLabels.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  /**
   * Syncs labels to the spreadsheet.
   */
  function syncToSheet() {
    const ss = Core.getSpreadsheet();
    if (!ss) {
      Core.alert('Error', 'No spreadsheet linked. Run setup first.');
      return [];
    }

    const sheet = ss.getSheetByName('Labels');
    if (!sheet) {
      Core.alert('Error', 'Labels sheet not found. Run setup first.');
      return [];
    }

    const labels = getFromGmail();
    const now = new Date().toISOString();

    // Clear existing data
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 5).clear();

    // Write new data
    if (labels.length > 0) {
      const data = labels.map(l => [l.name, l.id, l.nestedPath, l.type, now]);
      sheet.getRange(2, 1, data.length, 5).setValues(data);
    }

    sheet.autoResizeColumns(1, 5);
    Config.set('last_label_sync', now);

    Sheets.updateInstructionsLabels(labels);
    Logger_.log('SYSTEM', 'SYNC', `Synced ${labels.length} labels`);

    return labels;
  }

  /**
   * Gets labels from the spreadsheet.
   */
  function getFromSheet() {
    const ss = Core.getSpreadsheet();
    if (!ss) return [];

    const sheet = ss.getSheetByName('Labels');
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    return sheet.getRange(2, 1, lastRow - 1, 4).getValues()
      .map(row => ({ name: row[0], id: row[1], nestedPath: row[2], type: row[3] }));
  }

  /**
   * Applies labels to an email.
   */
  function applyToEmail(emailId, labelNames) {
    const message = GmailApp.getMessageById(emailId);
    if (!message) throw new Error('Email not found: ' + emailId);

    const thread = message.getThread();
    const allLabels = GmailApp.getUserLabels();
    const labelMap = {};
    allLabels.forEach(l => { labelMap[l.getName().toLowerCase()] = l; });

    const applied = [];
    const notFound = [];

    labelNames.forEach(name => {
      if (!name || name.trim() === '' || name.toUpperCase() === 'NONE') return;

      const label = labelMap[name.toLowerCase()];
      if (label) {
        thread.addLabel(label);
        applied.push(name);
      } else {
        notFound.push(name);
      }
    });

    if (applied.length > 0) Logger_.log(emailId, 'APPLY', applied.join(', '), 'Success');
    if (notFound.length > 0) Logger_.log(emailId, 'WARN', `Not found: ${notFound.join(', ')}`);

    return { applied, notFound };
  }

  /**
   * Removes labels from an email.
   */
  function removeFromEmail(emailId, labelNames) {
    const message = GmailApp.getMessageById(emailId);
    if (!message) throw new Error('Email not found: ' + emailId);

    const thread = message.getThread();
    const allLabels = GmailApp.getUserLabels();
    const labelMap = {};
    allLabels.forEach(l => { labelMap[l.getName().toLowerCase()] = l; });

    const removed = [];
    const notFound = [];

    labelNames.forEach(name => {
      if (!name || name.trim() === '') return;

      const label = labelMap[name.toLowerCase()];
      if (label) {
        thread.removeLabel(label);
        removed.push(name);
      } else {
        notFound.push(name);
      }
    });

    if (removed.length > 0) Logger_.log(emailId, 'REMOVE', removed.join(', '), 'Success');

    return { removed, notFound };
  }

  return { getFromGmail, syncToSheet, getFromSheet, applyToEmail, removeFromEmail };
})();

// ============================================================================
// MODULE: QUEUE - Email Queue Processing
// ============================================================================

const Queue = (function() {

  /**
   * Adds unread emails to the queue.
   */
  function addUnreadEmails() {
    const ss = Core.getSpreadsheet();
    if (!ss) {
      Core.alert('Error', 'No spreadsheet linked. Run setup first.');
      return;
    }

    const sheet = ss.getSheetByName('Queue');
    if (!sheet) {
      Core.alert('Error', 'Queue sheet not found. Run setup first.');
      return;
    }

    const batchSize = parseInt(Config.get('batch_size') || '50');
    const threads = GmailApp.search('is:unread', 0, batchSize);

    if (threads.length === 0) {
      Core.alert('No Emails', 'No unread emails found.');
      return;
    }

    // Get existing IDs
    const existingIds = new Set();
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(row => {
        if (row[0]) existingIds.add(row[0]);
      });
    }

    // Build new rows
    const newRows = [];
    threads.forEach(thread => {
      const msg = thread.getMessages()[0];
      const id = msg.getId();

      if (!existingIds.has(id)) {
        newRows.push([
          id,
          msg.getSubject() || '(no subject)',
          msg.getFrom(),
          msg.getDate().toISOString(),
          '',
          'Pending',
          ''
        ]);
      }
    });

    if (newRows.length === 0) {
      Core.alert('Already Queued', 'All unread emails are already in the queue.');
      return;
    }

    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 7).setValues(newRows);

    Core.alert('Emails Queued',
      `Added ${newRows.length} emails.\n\n` +
      'Your Flow should process them and fill "Labels to Apply".');

    Logger_.log('SYSTEM', 'QUEUE', `Queued ${newRows.length} emails`);
  }

  /**
   * Processes a single queue row.
   */
  function processRow(rowNumber) {
    if (rowNumber <= 1) return;

    const ss = Core.getSpreadsheet();
    if (!ss) return;

    const sheet = ss.getSheetByName('Queue');
    if (!sheet) return;

    const row = sheet.getRange(rowNumber, 1, 1, 7).getValues()[0];
    const emailId = row[0];
    const labelsToApply = row[4];
    const status = row[5];

    if (!labelsToApply || labelsToApply.trim() === '' || status !== 'Pending') return;

    const labels = labelsToApply.split(',').map(l => l.trim())
      .filter(l => l.length > 0 && l.toUpperCase() !== 'NONE');

    if (labels.length === 0) {
      sheet.getRange(rowNumber, 6).setValue('Skipped');
      sheet.getRange(rowNumber, 7).setValue(new Date().toISOString());
      Logger_.log(emailId, 'SKIP', 'No labels to apply');
      return;
    }

    sheet.getRange(rowNumber, 6).setValue('Processing');

    try {
      Labels.applyToEmail(emailId, labels);
      sheet.getRange(rowNumber, 6).setValue('Complete');
      sheet.getRange(rowNumber, 7).setValue(new Date().toISOString());
    } catch (error) {
      sheet.getRange(rowNumber, 6).setValue('Error');
      sheet.getRange(rowNumber, 7).setValue(new Date().toISOString());
      Logger_.error(emailId, error, 'processRow');
    }
  }

  /**
   * Processes all pending items.
   */
  function processAllPending() {
    const ss = Core.getSpreadsheet();
    if (!ss) return;

    const sheet = ss.getSheetByName('Queue');
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const rateLimit = parseInt(Config.get('rate_limit_ms') || '3000');
    let processed = 0;

    data.forEach((row, i) => {
      if (row[4] && row[4].trim() !== '' && row[5] === 'Pending') {
        processRow(i + 2);
        processed++;
        if (processed < data.length) Utilities.sleep(rateLimit);
      }
    });

    Logger_.log('SYSTEM', 'BATCH', `Processed ${processed} items`);
  }

  /**
   * Clears the queue.
   */
  function clear() {
    if (!Core.confirm('Clear Queue', 'Are you sure you want to clear all items?')) return;

    const ss = Core.getSpreadsheet();
    if (!ss) return;

    const sheet = ss.getSheetByName('Queue');
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 7).clear();

    Core.alert('Queue Cleared', 'The queue has been cleared.');
    Logger_.log('SYSTEM', 'CLEAR', 'Queue cleared');
  }

  return { addUnreadEmails, processRow, processAllPending, clear };
})();

// ============================================================================
// MODULE: API - Web App Handlers
// ============================================================================

const API = (function() {

  function handleGet(e) {
    const labels = Labels.getFromGmail();

    return {
      status: 'ok',
      message: 'Smart Call Time - Email Sorter API',
      version: Config.get('version'),
      labels: labels.map(l => ({ name: l.name, id: l.id })),
      commands: ['GET_LABELS', 'APPLY_LABELS', 'REMOVE_LABELS', 'SYNC_LABELS']
    };
  }

  function handlePost(e) {
    try {
      const data = JSON.parse(e.postData.contents);
      const command = data.command;

      switch (command) {
        case 'GET_LABELS':
          const labels = Labels.getFromGmail();
          return { success: true, labels: labels.map(l => ({ name: l.name, id: l.id, type: l.type })) };

        case 'APPLY_LABELS':
          if (!data.emailId) return { success: false, error: 'Missing emailId' };
          if (!data.labels || !Array.isArray(data.labels)) return { success: false, error: 'Missing labels array' };
          const applyResult = Labels.applyToEmail(data.emailId, data.labels);
          return { success: true, emailId: data.emailId, applied: applyResult.applied, notFound: applyResult.notFound };

        case 'REMOVE_LABELS':
          if (!data.emailId) return { success: false, error: 'Missing emailId' };
          if (!data.labels || !Array.isArray(data.labels)) return { success: false, error: 'Missing labels array' };
          const removeResult = Labels.removeFromEmail(data.emailId, data.labels);
          return { success: true, emailId: data.emailId, removed: removeResult.removed, notFound: removeResult.notFound };

        case 'SYNC_LABELS':
          const synced = Labels.syncToSheet();
          return { success: true, message: 'Labels synced', count: synced.length };

        default:
          return { success: false, error: 'Unknown command: ' + command };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  function jsonResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return { handleGet, handlePost, jsonResponse };
})();

// ============================================================================
// GLOBAL FUNCTIONS - Entry Points
// ============================================================================

/**
 * Menu setup - runs when document opens.
 */
function onOpen() {
  const ui = Core.getUi();
  if (!ui) return;

  ui.createMenu('Smart Call Time')
    .addSubMenu(ui.createMenu('Email Sorter')
      .addItem('Setup / Refresh', 'emailSorterSetup')
      .addSeparator()
      .addItem('Sync Labels Now', 'syncLabelsToSheet')
      .addItem('Queue Unread Emails', 'queueUnreadEmails')
      .addItem('Process All Pending', 'processAllPending')
      .addSeparator()
      .addItem('Clear Queue', 'clearQueue'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Settings')
      .addItem('Show Configuration', 'showConfig')
      .addItem('View Web App URL', 'showWebAppUrl'))
    .addToUi();
}

/**
 * Edit trigger - auto-processes queue when Flow updates labels.
 */
function onEditTrigger(e) {
  if (!e || !e.source) return;

  const sheet = e.source.getActiveSheet();
  if (sheet.getName() === 'Queue') {
    Queue.processRow(e.range.getRow());
  }
}

/**
 * Sets up the edit trigger.
 */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'onEditTrigger') ScriptApp.deleteTrigger(t);
  });

  const ss = Core.getSpreadsheet();
  if (ss) {
    ScriptApp.newTrigger('onEditTrigger').forSpreadsheet(ss).onEdit().create();
  }
}

/**
 * Main setup function.
 */
function emailSorterSetup() {
  const type = Core.getContainerType();

  if (type !== 'sheets') {
    Core.alert('Setup',
      'This script works best with Google Sheets.\n\n' +
      'Please create a new Google Sheet, then:\n' +
      '1. Extensions > Apps Script\n' +
      '2. Paste this code\n' +
      '3. Run Setup from the menu');
    return;
  }

  const ss = Core.getSpreadsheet();
  Core.alert('Setup', 'Creating sheets and syncing labels...');

  Sheets.createAll(ss);
  Labels.syncToSheet();
  setupTriggers();

  const instructionsSheet = ss.getSheetByName('Instructions');
  if (instructionsSheet) ss.setActiveSheet(instructionsSheet);

  Core.alert('Setup Complete!',
    '1. Review the Instructions sheet\n' +
    '2. Deploy as web app\n' +
    '3. Configure your Google Flows');
}

// Menu action functions
function syncLabelsToSheet() { Labels.syncToSheet(); Core.alert('Labels Synced', 'Gmail labels have been synced.'); }
function queueUnreadEmails() { Queue.addUnreadEmails(); }
function processAllPending() { Queue.processAllPending(); Core.alert('Done', 'All pending items processed.'); }
function clearQueue() { Queue.clear(); }

function showConfig() {
  const config = Config.getAll();
  Core.alert('Configuration', Object.entries(config).map(([k, v]) => `${k}: ${v}`).join('\n'));
}

function showWebAppUrl() {
  try {
    const url = ScriptApp.getService().getUrl();
    Core.alert('Web App URL', url || 'Not deployed yet');
  } catch (e) {
    Core.alert('Not Deployed', 'Deploy as web app first:\nDeploy > New deployment');
  }
}

// Web App handlers
function doGet(e) { return API.jsonResponse(API.handleGet(e)); }
function doPost(e) { return API.jsonResponse(API.handlePost(e)); }
