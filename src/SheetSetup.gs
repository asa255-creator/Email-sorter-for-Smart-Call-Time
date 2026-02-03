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

  // Headers - Description column (E) is editable for AI context
  const headers = ['Label Name', 'Label ID', 'Nested Path', 'Type', 'Description', 'Last Updated'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#34a853')
    .setFontColor('white');

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  // Make Description column wider for editing
  sheet.setColumnWidth(5, 300);

  // Add note
  sheet.getRange('A1').setNote(
    'This sheet contains all your Gmail labels.\n' +
    'Google Flows reads this sheet to get available labels.\n\n' +
    'Column E (Description) is for your use - add descriptions\n' +
    'to help the AI understand what each label is for.\n\n' +
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

  // Build instructions
  const content = buildInstructionsContent();

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
 * @returns {Array} Array of instruction rows
 */
function buildInstructionsContent() {
  return [
    ['SMART CALL TIME - EMAIL SORTER'],
    [''],
    ['This system lets Google Flows automatically sort your emails using the Labels sheet.'],
    ['Flow reads labels dynamically from this spreadsheet - no hardcoded values.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['HOW IT WORKS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['1. Labels sheet: Your Gmail labels with optional descriptions'],
    ['2. Queue sheet: Temporary processing area (rows deleted after labeling)'],
    ['3. Flow reads Labels sheet, writes to Queue, script applies labels'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['GOOGLE FLOW SETUP'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['TRIGGER: When a new email arrives in Gmail'],
    [''],
    ['FLOW STEPS:'],
    [''],
    ['Step 1: Read the "Labels" sheet from this spreadsheet'],
    ['   - Get all rows from Labels sheet'],
    ['   - This gives you Label Name and Description for each label'],
    [''],
    ['Step 2: Build the AI prompt dynamically'],
    ['   - Insert the label names (and descriptions) from Step 1 into the prompt'],
    ['   - See AI PROMPT TEMPLATE below'],
    [''],
    ['Step 3: Send to AI with email details'],
    ['   - Include sender, subject, body preview from the email trigger'],
    [''],
    ['Step 4: Add row to "Queue" sheet'],
    ['   - Email ID, Subject, From, Date'],
    ['   - Labels to Apply: AI response (comma-separated labels)'],
    ['   - Status: "Pending"'],
    [''],
    ['The script automatically applies labels and removes the row from Queue.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['AI PROMPT TEMPLATE'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Use this template in your Flow. Replace placeholders with dynamic values:'],
    [''],
    ['--- PROMPT TEMPLATE ---'],
    ['You are an email categorization assistant.'],
    [''],
    ['AVAILABLE LABELS (from Labels sheet):'],
    ['{Insert label names and descriptions from Labels sheet here}'],
    [''],
    ['EMAIL TO CATEGORIZE:'],
    ['From: {email sender from trigger}'],
    ['Subject: {email subject from trigger}'],
    ['Body: {email body preview from trigger}'],
    [''],
    ['INSTRUCTIONS:'],
    ['1. Select 1-3 labels that best fit this email'],
    ['2. ONLY use labels from the AVAILABLE LABELS list above'],
    ['3. If no labels fit, respond with: NONE'],
    [''],
    ['Respond with ONLY the label names, comma-separated. Example: Work, Clients'],
    ['--- END TEMPLATE ---'],
    [''],
    ['IMPORTANT: Your Flow must read the Labels sheet and insert those values'],
    ['into the prompt. Do NOT hardcode label names in the Flow.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['SHEET COLUMNS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['LABELS SHEET:'],
    ['  A: Label Name - The Gmail label name'],
    ['  B: Label ID - Gmail internal ID (auto-filled)'],
    ['  C: Nested Path - Full path for nested labels'],
    ['  D: Type - user or system'],
    ['  E: Description - Your description for AI context (editable)'],
    ['  F: Last Updated - Sync timestamp'],
    [''],
    ['QUEUE SHEET:'],
    ['  A: Email ID - Gmail message ID'],
    ['  B: Subject'],
    ['  C: From'],
    ['  D: Date'],
    ['  E: Labels to Apply - Comma-separated (Flow fills this)'],
    ['  F: Status - Pending/Processing/Error'],
    ['  G: Processed At'],
    [''],
    ['  Note: Rows are DELETED after labels are successfully applied.'],
    ['  Error rows remain for review.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['MENU OPTIONS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Smart Call Time > Email Sorter:'],
    ['  - Setup / Refresh: Re-run initial setup'],
    ['  - Sync Labels Now: Update Labels sheet from Gmail'],
    ['  - Queue Unread Emails: Add unread emails to Queue for processing'],
    ['  - Process All Pending: Manually process queued items'],
    ['  - Clear Queue: Remove all items from Queue'],
  ];
}

