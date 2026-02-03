/**
 * Smart Call Time - Flow Integrator
 * Sheet Setup Module
 *
 * Handles creation and initialization of all spreadsheet sheets.
 * Each function creates a specific sheet with proper headers, formatting, and validation.
 */

// ============================================================================
// SHEET CREATION FUNCTIONS
// ============================================================================

/**
 * Creates the Config sheet with default settings.
 * @param {Spreadsheet} ss - The spreadsheet object
 */
function createConfigSheet(ss) {
  let sheet = ss.getSheetByName('Config');
  if (!sheet) {
    sheet = ss.insertSheet('Config');
  }

  sheet.clear();

  // Headers
  sheet.getRange('A1:B1').setValues([['Setting', 'Value']]);
  sheet.getRange('A1:B1')
    .setFontWeight('bold')
    .setBackground('#4285f4')
    .setFontColor('white');

  // Default configuration
  const config = [
    ['rate_limit_ms', '3000'],
    ['batch_size', '50'],
    ['last_label_sync', ''],
    ['setup_complete', 'true'],
    ['version', '1.0.0']
  ];

  sheet.getRange(2, 1, config.length, 2).setValues(config);
  sheet.autoResizeColumns(1, 2);

  // Hide config sheet from regular users
  sheet.hideSheet();
}

/**
 * Creates the Labels sheet for storing Gmail label information.
 * @param {Spreadsheet} ss - The spreadsheet object
 */
function createLabelsSheet(ss) {
  let sheet = ss.getSheetByName('Labels');
  if (!sheet) {
    sheet = ss.insertSheet('Labels');
  }

  sheet.clear();

  // Headers
  const headers = ['Label Name', 'Label ID', 'Nested Path', 'Type', 'Last Updated'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#34a853')
    .setFontColor('white');

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  // Add note
  sheet.getRange('A1').setNote(
    'This sheet contains all your Gmail labels.\n' +
    'Google Flows can read this sheet to get available labels.\n\n' +
    'Refresh via: Smart Call Time > Email Sorter > Sync Labels Now'
  );
}

/**
 * Creates the Queue sheet for email processing.
 * @param {Spreadsheet} ss - The spreadsheet object
 */
function createQueueSheet(ss) {
  let sheet = ss.getSheetByName('Queue');
  if (!sheet) {
    sheet = ss.insertSheet('Queue');
  }

  sheet.clear();

  // Headers
  const headers = [
    'Email ID',
    'Subject',
    'From',
    'Date',
    'Labels to Apply',
    'Status',
    'Processed At'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#fbbc04')
    .setFontColor('black');

  // Status dropdown validation
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pending', 'Processing', 'Complete', 'Error', 'Skipped'], true)
    .build();
  sheet.getRange('F2:F1000').setDataValidation(statusRule);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  // Workflow explanation
  sheet.getRange('A1').setNote(
    'EMAIL PROCESSING WORKFLOW:\n\n' +
    '1. Run "Queue Unread Emails" to add emails here\n' +
    '2. Google Flow reads rows where Status = "Pending"\n' +
    '3. Flow determines labels and writes to "Labels to Apply" column\n' +
    '4. Script automatically applies labels and sets Status = "Complete"\n\n' +
    'Columns:\n' +
    '- Email ID: Unique Gmail message ID\n' +
    '- Labels to Apply: Comma-separated label names (filled by Flow)\n' +
    '- Status: Pending → Processing → Complete/Error/Skipped'
  );
}

/**
 * Creates the Log sheet for processing history.
 * @param {Spreadsheet} ss - The spreadsheet object
 */
function createLogSheet(ss) {
  let sheet = ss.getSheetByName('Log');
  if (!sheet) {
    sheet = ss.insertSheet('Log');
  }

  sheet.clear();

  // Headers
  const headers = ['Timestamp', 'Email ID', 'Action', 'Details', 'Result', 'Notes'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#ea4335')
    .setFontColor('white');

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Creates the Instructions sheet with setup guide and prompts.
 * @param {Spreadsheet} ss - The spreadsheet object
 */
function createInstructionsSheet(ss) {
  let sheet = ss.getSheetByName('Instructions');
  if (!sheet) {
    sheet = ss.insertSheet('Instructions');
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(1);
  }

  sheet.clear();

  // Get web app URL
  let webAppUrl = '[Deploy as web app first]';
  try {
    webAppUrl = ScriptApp.getService().getUrl() || webAppUrl;
  } catch (e) {}

  // Get labels for prompt
  const labels = getGmailLabels();
  const labelList = labels.map(l => l.name).join(', ');

  // Build instructions
  const content = buildInstructionsContent(webAppUrl, labelList);

  // Write content
  sheet.getRange(1, 1, content.length, 1).setValues(content);

  // Formatting
  sheet.getRange('A1').setFontSize(16).setFontWeight('bold');
  sheet.setColumnWidth(1, 800);

  // Highlight section headers
  const data = sheet.getDataRange().getValues();
  data.forEach((row, index) => {
    if (row[0] && row[0].toString().startsWith('═══')) {
      sheet.getRange(index + 1, 1).setBackground('#e8f0fe').setFontWeight('bold');
      if (index + 2 <= data.length) {
        sheet.getRange(index + 2, 1).setBackground('#e8f0fe').setFontWeight('bold');
      }
    }
  });
}

/**
 * Builds the instructions content array.
 * @param {string} webAppUrl - The web app URL
 * @param {string} labelList - Comma-separated label names
 * @returns {Array} Array of instruction rows
 */
function buildInstructionsContent(webAppUrl, labelList) {
  return [
    ['SMART CALL TIME - EMAIL SORTER SETUP'],
    [''],
    ['This sheet-based system lets Google Flows automatically sort your emails into labels.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['STEP 1: DEPLOY AS WEB APP'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['1. Go to Deploy > New deployment'],
    ['2. Click "Select type" > Web app'],
    ['3. Execute as: Me (your email)'],
    ['4. Who has access: Anyone'],
    ['5. Click Deploy and authorize'],
    [''],
    ['YOUR WEB APP URL:'],
    [webAppUrl],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['STEP 2: GOOGLE FLOW FOR NEW EMAILS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Trigger: When a new email arrives in Gmail'],
    [''],
    ['Actions:'],
    ['1. Read the "Labels" sheet from this spreadsheet to get available labels'],
    ['2. Use AI to select appropriate labels (see prompt below)'],
    ['3. POST to web app to apply labels:'],
    ['   URL: ' + webAppUrl],
    ['   Body: {"command":"APPLY_LABELS","emailId":"{id}","labels":["Label1","Label2"]}'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['STEP 3: GOOGLE FLOW FOR OLD EMAILS (QUEUE)'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Trigger: When a row is added/modified in "Queue" sheet'],
    ['Filter: Status column = "Pending"'],
    [''],
    ['Actions:'],
    ['1. Get Email ID from the row'],
    ['2. Use Gmail connector to fetch email details'],
    ['3. Use AI to select labels'],
    ['4. Update the row: Set "Labels to Apply" column with comma-separated labels'],
    ['   (The script will automatically apply labels when you update this column)'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['AI PROMPT FOR LABEL SELECTION'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Copy this prompt into your Google Flow AI step:'],
    [''],
    ['--- COPY FROM HERE ---'],
    ['You are an email categorization assistant. Select the most appropriate labels.'],
    [''],
    ['AVAILABLE LABELS:'],
    [labelList || '(No labels found - create labels in Gmail first)'],
    [''],
    ['EMAIL:'],
    ['From: {sender}'],
    ['Subject: {subject}'],
    ['Body: {body_preview}'],
    [''],
    ['RULES:'],
    ['1. Select 1-3 labels that best fit this email'],
    ['2. ONLY use labels from the AVAILABLE LABELS list'],
    ['3. If nothing fits, respond with: NONE'],
    [''],
    ['RESPOND WITH ONLY the label names, comma-separated.'],
    ['Example: Work, Important'],
    ['--- COPY TO HERE ---'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['API REFERENCE'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['GET ' + webAppUrl],
    ['  Returns current labels and API status'],
    [''],
    ['POST ' + webAppUrl],
    ['  Command: GET_LABELS'],
    ['  Body: {"command":"GET_LABELS"}'],
    ['  Returns: {"success":true,"labels":[{"name":"Work","id":"..."},...]}}'],
    [''],
    ['POST ' + webAppUrl],
    ['  Command: APPLY_LABELS'],
    ['  Body: {"command":"APPLY_LABELS","emailId":"abc123","labels":["Work","Personal"]}'],
    ['  Returns: {"success":true,"applied":["Work","Personal"],"notFound":[]}'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['PROCESSING OLD EMAILS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['1. Menu: Smart Call Time > Email Sorter > Queue Unread Emails'],
    ['2. This adds unread emails to the Queue sheet with Status = Pending'],
    ['3. Your Google Flow processes each row and fills "Labels to Apply"'],
    ['4. Labels are automatically applied when the column is updated'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['SYNCING LABELS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Labels are synced automatically during setup.'],
    ['To refresh: Menu > Smart Call Time > Email Sorter > Sync Labels Now'],
    [''],
    ['The Labels sheet always reflects your current Gmail labels.'],
  ];
}

/**
 * Updates the Instructions sheet with current labels.
 * @param {Object[]} labels - Array of label objects
 */
function updateInstructionsLabels(labels) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Instructions');

  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === 'AVAILABLE LABELS:') {
      const labelList = labels.map(l => l.name).join(', ') || '(No labels found)';
      sheet.getRange(i + 2, 1).setValue(labelList);
      break;
    }
  }
}
