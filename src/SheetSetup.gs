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
 * Three columns: Setting, Value (with dropdowns where applicable), Description
 * @param {Spreadsheet} ss - The spreadsheet object
 */
function createConfigSheet(ss) {
  let sheet = ss.getSheetByName('Config');
  if (!sheet) {
    sheet = ss.insertSheet('Config');
  }

  sheet.clear();

  // Headers
  sheet.getRange('A1:C1').setValues([['Setting', 'Value', 'Description']]);
  sheet.getRange('A1:C1')
    .setFontWeight('bold')
    .setBackground('#4285f4')
    .setFontColor('white');

  // Auto-generate instance_name from user's email
  let instanceName = '';
  try {
    const email = Session.getActiveUser().getEmail();
    if (email) {
      instanceName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    }
  } catch (e) {
    instanceName = ss.getName().replace(/[^a-zA-Z0-9]/g, '_');
  }

  // Default configuration with descriptions
  const config = [
    ['chat_webhook_url', 'https://chat.googleapis.com/v1/spaces/AAQAULujEoo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=O3mPCLnQbJzrWcN-qrZGqWBlTiAJbBukWCffMZh1VuQ', 'Webhook URL for outbound notifications to Google Chat. Script posts here to notify Flow.'],
    ['instance_name', instanceName, 'Auto-generated from your email. Appears in Chat messages so Flow can identify this instance.'],
    ['rate_limit_ms', '3000', 'Milliseconds to wait between processing emails in batch mode.'],
    ['batch_size', '50', 'Maximum number of emails to queue at once.'],
    ['last_label_sync', '', 'Timestamp of last Gmail label sync.'],
    ['setup_complete', 'true', 'Whether initial setup has been completed.'],
    ['version', '1.1.0', 'Version of Smart Call Time installed.']
  ];

  sheet.getRange(2, 1, config.length, 3).setValues(config);

  // Format columns
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 500);

  // Wrap text in description column
  sheet.getRange('C:C').setWrap(true);

  // Light background for description column
  sheet.getRange(2, 3, config.length, 1).setBackground('#f8f9fa');

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

  // Headers - Context column (H) holds full email content for old emails
  const headers = [
    'Email ID',
    'Subject',
    'From',
    'Date',
    'Labels to Apply',
    'Status',
    'Processed At',
    'Context'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#fbbc04')
    .setFontColor('black');

  // Status dropdown validation - only Processing, Pending, Error
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Processing', 'Pending', 'Error'], true)
    .build();
  sheet.getRange('F2:F1000').setDataValidation(statusRule);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 7);
  sheet.setColumnWidth(8, 400); // Context column wider

  // Workflow explanation
  sheet.getRange('A1').setNote(
    'EMAIL PROCESSING QUEUE\n\n' +
    'Flow triggers on rows where Status = "Processing"\n\n' +
    'WORKFLOW:\n' +
    '1. First row has Status = "Processing" (Flow processes this)\n' +
    '2. Flow fills "Labels to Apply" column\n' +
    '3. Script applies labels and deletes the row\n' +
    '4. Next "Pending" row becomes "Processing"\n' +
    '5. This triggers Flow again for the next email\n\n' +
    'COLUMNS:\n' +
    '- Context: Full email content (for old emails only)\n' +
    '- Status: "Processing" = active, "Pending" = waiting\n' +
    '- Rows are DELETED after successful labeling'
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
    ['This system lets Google Flows automatically sort your emails.'],
    ['Flow reads labels from Labels sheet and processes emails one at a time.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['HOW IT WORKS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['1. Labels sheet: Your Gmail labels with descriptions for AI context'],
    ['2. Queue sheet: Emails waiting to be labeled (deleted after processing)'],
    ['3. Flow triggers on Status = "Processing" and fills Labels to Apply'],
    ['4. Script checks every 15 min (or 30 sec after activity)'],
    ['5. When labels found: applies them, deletes row, promotes next'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['FLOW FOR NEW EMAILS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['TRIGGER: When a new email arrives in Gmail'],
    [''],
    ['STEPS:'],
    ['1. Read "Labels" sheet to get label names + descriptions'],
    ['2. Send to AI with email details (see prompt template below)'],
    ['3. Add row to "Queue" sheet:'],
    ['   - Email ID, Subject, From, Date from trigger'],
    ['   - Labels to Apply: AI response'],
    ['   - Status: "Processing"'],
    ['   - Context: (leave empty - you have email data from trigger)'],
    [''],
    ['Script checks queue and applies labels automatically (every 15 min or 30 sec after activity).'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['FLOW FOR OLD EMAILS (QUEUE)'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['First: Run menu > Smart Call Time > Email Sorter > Queue Unlabeled Emails'],
    ['This adds old emails with full content in the Context column.'],
    [''],
    ['TRIGGER: When Queue sheet is modified'],
    ['FILTER: Status = "Processing" AND Labels to Apply is empty'],
    [''],
    ['STEPS:'],
    ['1. Read "Labels" sheet to get label names + descriptions'],
    ['2. Read the Context column (H) - contains full email content'],
    ['3. Send Context + Labels to AI'],
    ['4. Update the row: fill "Labels to Apply" column with AI response'],
    [''],
    ['Script checks every 15 minutes (or 30 seconds after activity).'],
    ['When labels are found, script applies them, deletes row, promotes next.'],
    ['This triggers Flow again for the next email.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['GOOGLE FLOWS SETUP'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['The script sends complete data to Google Chat. Flow watches and responds.'],
    [''],
    ['OLD_EMAIL_READY MESSAGE FORMAT:'],
    ['  [instance_name] OLD_EMAIL_READY'],
    ['  ===== AVAILABLE LABELS ====='],
    ['  Label1: description'],
    ['  Label2: description'],
    ['  ===== EMAIL TO CATEGORIZE ====='],
    ['  Email ID: xxx'],
    ['  Subject: xxx'],
    ['  From: xxx'],
    ['  Date: xxx'],
    ['  [full email body]'],
    ['  ===== INSTRUCTIONS ====='],
    ['  [AI instructions]'],
    [''],
    ['The message contains EVERYTHING needed - no extra reads required.'],
    [''],
    ['FLOW SETUP STEPS:'],
    [''],
    ['1. Create a Google Chat Space for notifications'],
    ['   - Go to Google Chat > Spaces > Create space'],
    ['   - Name it (e.g., "Email Sorter Alerts")'],
    [''],
    ['2. Get the webhook URL for the space'],
    ['   - In the space: Settings > Manage webhooks'],
    ['   - Create webhook, copy the URL'],
    ['   - Update chat_webhook_url in Config sheet (unhide it first)'],
    [''],
    ['3. Create a Google Flow that watches the Chat space'],
    ['   TRIGGER: "When a message is posted to Google Chat"'],
    ['   - Select your notification space'],
    [''],
    ['4. Add a FILTER condition:'],
    ['   - Message text CONTAINS "OLD_EMAIL_READY"'],
    ['   - (Optional) Also filter on your instance_name: "[john_doe]"'],
    [''],
    ['5. Pass the entire message to AI (Gemini/ChatGPT)'],
    ['   - The message already includes labels, email, and instructions'],
    ['   - AI responds with comma-separated label names'],
    [''],
    ['6. Update Queue sheet with AI response:'],
    ['   - Find row where Status = "Processing"'],
    ['   - Put AI response in "Labels to Apply" column (E)'],
    [''],
    ['Script auto-checks every 15 min and applies labels when filled in.'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['AI PROMPT TEMPLATE'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['--- PROMPT TEMPLATE ---'],
    ['You are an email categorization assistant.'],
    [''],
    ['AVAILABLE LABELS:'],
    ['{Insert label names and descriptions from Labels sheet}'],
    [''],
    ['EMAIL:'],
    ['{For new emails: use trigger data}'],
    ['{For old emails: use Context column content}'],
    [''],
    ['RULES:'],
    ['1. Select 1-3 labels that best fit'],
    ['2. ONLY use labels from AVAILABLE LABELS'],
    ['3. If nothing fits: respond NONE'],
    [''],
    ['Respond with comma-separated label names only.'],
    ['--- END TEMPLATE ---'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['SHEET COLUMNS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['LABELS SHEET:'],
    ['  A: Label Name'],
    ['  B: Label ID'],
    ['  C: Nested Path'],
    ['  D: Type'],
    ['  E: Description (editable - helps AI understand label purpose)'],
    ['  F: Last Updated'],
    [''],
    ['QUEUE SHEET:'],
    ['  A: Email ID'],
    ['  B: Subject'],
    ['  C: From'],
    ['  D: Date'],
    ['  E: Labels to Apply (Flow fills this)'],
    ['  F: Status ("Processing" or "Pending" or "Error")'],
    ['  G: Processed At'],
    ['  H: Context (full email content for old emails)'],
    [''],
    ['  - "Processing" = Flow should process this row'],
    ['  - "Pending" = Waiting in line'],
    ['  - Rows DELETED after successful labeling'],
    ['  - Error rows kept for review'],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['MENU OPTIONS'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Smart Call Time > Email Sorter:'],
    ['  - Setup / Refresh: Re-run setup'],
    ['  - Sync Labels Now: Refresh labels from Gmail'],
    ['  - Queue Unlabeled Emails: Add old emails to queue'],
    ['  - Process All Pending: Manually apply labels'],
    ['  - Clear Queue: Remove all items'],
  ];
}

