/**
 * Email Sorter for Smart Call Time
 *
 * This Google Apps Script integrates Gmail with Google Chat and Google Flows
 * to automatically sort emails into labels using AI-powered categorization.
 *
 * SETUP INSTRUCTIONS:
 * 1. Create TWO Google Chat spaces manually:
 *    - "Email Sorter - Automated" (you can mute notifications for this one)
 *    - "Email Sorter - Instructions" (keep notifications on for label recommendations)
 *
 * 2. Add an incoming webhook to EACH space:
 *    - Click the space name > Apps & integrations > Add webhooks
 *    - Name it "Email Sorter Bot"
 *    - Copy the webhook URL
 *
 * 3. Run configureWebhooks() and paste the URLs when prompted
 *    OR manually edit WEBHOOK_URLS below
 *
 * 4. Run postSetupInstructions() to post the Flow setup guide to your instructions space
 *
 * 5. Deploy this script as a web app:
 *    - Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    - Copy the web app URL for use in Google Flows
 */

// ============================================================================
// CONFIGURATION - EDIT THESE VALUES
// ============================================================================

/**
 * PASTE YOUR WEBHOOK URLs HERE after creating the Chat spaces
 *
 * To get webhook URLs:
 * 1. Open Google Chat
 * 2. Create or open a space
 * 3. Click the space name at the top
 * 4. Click "Apps & integrations"
 * 5. Click "Add webhooks"
 * 6. Enter a name like "Email Sorter Bot" and click Save
 * 7. Copy the webhook URL
 */
const WEBHOOK_URLS = {
  // Paste your automated space webhook URL here (for machine-to-machine messages)
  // You can mute notifications for this space in Chat settings
  AUTOMATED: '',

  // Paste your instructions space webhook URL here (for setup instructions and label recommendations)
  // Keep notifications on so you see label recommendations
  INSTRUCTIONS: ''
};

const CONFIG = {
  // Rate limiting for processing old emails (milliseconds between each email)
  RATE_LIMIT_MS: 3000, // 3 seconds between emails

  // Batch size for processing unread emails
  BATCH_SIZE: 50,

  // System labels to exclude from the label list
  SYSTEM_LABELS: [
    'INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT',
    'SENT', 'DRAFT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
    'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
    'CHAT', 'OPENED', 'SNOOZED'
  ],

  // Property keys for storing processing state
  PROPS: {
    PROCESSING_STATE: 'processingState',
    AUTOMATED_WEBHOOK: 'automatedWebhook',
    INSTRUCTIONS_WEBHOOK: 'instructionsWebhook'
  }
};

// ============================================================================
// WEBHOOK CONFIGURATION
// ============================================================================

/**
 * Interactive function to configure webhook URLs.
 * Run this and check the logs, then update WEBHOOK_URLS above.
 */
function configureWebhooks() {
  const ui = SpreadsheetApp.getUi ? SpreadsheetApp.getUi() : null;

  console.log('=== WEBHOOK CONFIGURATION ===');
  console.log('');
  console.log('To configure webhooks, please edit the WEBHOOK_URLS object at the top of Code.gs');
  console.log('');
  console.log('Steps to get webhook URLs:');
  console.log('1. Open Google Chat (chat.google.com)');
  console.log('2. Create a new space or open an existing one');
  console.log('3. Click the space name at the top');
  console.log('4. Click "Apps & integrations"');
  console.log('5. Click "Add webhooks"');
  console.log('6. Enter a name like "Email Sorter Bot"');
  console.log('7. Click Save and copy the webhook URL');
  console.log('');
  console.log('You need TWO spaces:');
  console.log('- AUTOMATED: For machine messages (you can mute this space)');
  console.log('- INSTRUCTIONS: For setup guide and label recommendations');
  console.log('');

  // Check current configuration
  const automatedConfigured = WEBHOOK_URLS.AUTOMATED && WEBHOOK_URLS.AUTOMATED.length > 0;
  const instructionsConfigured = WEBHOOK_URLS.INSTRUCTIONS && WEBHOOK_URLS.INSTRUCTIONS.length > 0;

  console.log('Current status:');
  console.log('- Automated webhook: ' + (automatedConfigured ? 'CONFIGURED' : 'NOT SET'));
  console.log('- Instructions webhook: ' + (instructionsConfigured ? 'CONFIGURED' : 'NOT SET'));

  if (automatedConfigured && instructionsConfigured) {
    console.log('');
    console.log('Both webhooks are configured! You can now:');
    console.log('1. Run testWebhooks() to verify they work');
    console.log('2. Run postSetupInstructions() to post the Flow setup guide');
  }
}

/**
 * Tests that both webhooks are working by sending a test message.
 */
function testWebhooks() {
  console.log('Testing webhooks...');

  if (!WEBHOOK_URLS.AUTOMATED) {
    console.error('ERROR: Automated webhook URL not configured');
    return false;
  }

  if (!WEBHOOK_URLS.INSTRUCTIONS) {
    console.error('ERROR: Instructions webhook URL not configured');
    return false;
  }

  // Test automated webhook
  try {
    sendWebhookMessage(WEBHOOK_URLS.AUTOMATED, 'Test message from Email Sorter - Automated channel working!');
    console.log('Automated webhook: OK');
  } catch (error) {
    console.error('Automated webhook FAILED: ' + error.message);
    return false;
  }

  // Test instructions webhook
  try {
    sendWebhookMessage(WEBHOOK_URLS.INSTRUCTIONS, 'Test message from Email Sorter - Instructions channel working!');
    console.log('Instructions webhook: OK');
  } catch (error) {
    console.error('Instructions webhook FAILED: ' + error.message);
    return false;
  }

  console.log('');
  console.log('All webhooks working! You can now run postSetupInstructions()');
  return true;
}

/**
 * Sends a message to a Chat space via webhook.
 * @param {string} webhookUrl - The webhook URL
 * @param {string} text - The message text
 */
function sendWebhookMessage(webhookUrl, text) {
  const payload = {
    text: text
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(webhookUrl, options);

  if (response.getResponseCode() !== 200) {
    throw new Error('Webhook returned status ' + response.getResponseCode());
  }
}

// ============================================================================
// SETUP INSTRUCTIONS
// ============================================================================

/**
 * Posts the setup instructions to the instructions Chat space.
 * Run this after configuring webhooks.
 */
function postSetupInstructions() {
  if (!WEBHOOK_URLS.INSTRUCTIONS) {
    console.error('ERROR: Instructions webhook URL not configured. Run configureWebhooks() first.');
    return;
  }

  // Get the web app URL if deployed
  let webAppUrl = '[YOUR_WEB_APP_URL]';
  try {
    webAppUrl = ScriptApp.getService().getUrl() || '[Deploy as web app to get URL]';
  } catch (e) {
    // Not deployed yet
  }

  // Get current labels to include in the instructions
  const labels = getUserLabels();
  const labelListForPrompt = labels.join(', ');

  const instructions = `*Email Sorter Setup Instructions*

This system integrates Google Flows with Gmail to automatically sort your emails using AI-powered categorization.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*YOUR CURRENT LABELS*
${labels.length > 0 ? labels.map(l => '• ' + l).join('\n') : '(No user labels found)'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*WEB APP URL (for Flows)*
${webAppUrl}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*FLOW 1: NEW EMAIL PROCESSING*

Trigger: When a new email arrives in Gmail

Steps:
1. HTTP Request to get labels:
   POST ${webAppUrl}
   Body: {"command": "REQUEST_LABELS", "emailId": "{emailId}"}

2. Parse response to get label list

3. Use AI to select labels (see prompt below)

4. HTTP Request to apply labels:
   POST ${webAppUrl}
   Body: {"command": "APPLY_LABELS", "emailId": "{emailId}", "labels": ["Label1", "Label2"]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*FLOW 2: OLD EMAIL CLEANUP*
(Triggered by this script)

Trigger: When a message is received in the Automated Chat space containing "PROCESS_EMAIL"

Steps:
1. Parse the email ID from the message (format: PROCESS_EMAIL|{emailId})

2. Use Gmail connector to get email details

3. Use AI to select labels (see prompt below)

4. HTTP Request to apply labels:
   POST ${webAppUrl}
   Body: {"command": "APPLY_LABELS", "emailId": "{emailId}", "labels": ["Label1", "Label2"]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*AI PROMPT FOR LABEL SELECTION*
(Copy this into your Flow's AI step)

\`\`\`
You are an email categorization assistant. Given the following email and list of available labels, select the most appropriate labels to apply.

Available Labels:
${labelListForPrompt}

Email Details:
From: {sender}
Subject: {subject}
Body Preview: {body_preview}

Instructions:
1. Select 1-3 labels that best categorize this email
2. ONLY use labels from the provided list above
3. If no labels fit well, respond with just: NONE
4. If you think a new label should be created, note it after your selection

Respond in this exact format (labels on one line, comma-separated):
LABELS: label1, label2
RECOMMEND_NEW: suggested_label_name (optional)
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*MESSAGE FORMATS*

Request labels:
POST Body: {"command": "REQUEST_LABELS", "emailId": "abc123"}
Response: {"success": true, "emailId": "abc123", "labels": ["Work", "Personal", ...]}

Apply labels:
POST Body: {"command": "APPLY_LABELS", "emailId": "abc123", "labels": ["Work", "Important"]}
Response: {"success": true, "emailId": "abc123", "result": {"applied": ["Work", "Important"], "notFound": []}}

Recommend label (optional - posts to this channel):
POST Body: {"command": "RECOMMEND_LABEL", "labelName": "Invoices", "reason": "Many invoice-related emails"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*RUNNING OLD EMAIL CLEANUP*

1. Make sure Flow 2 is active and listening
2. In Apps Script, run: processUnreadEmails()
3. The script will send emails one-by-one to the automated channel
4. Flow 2 will process each and apply labels

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Setup complete! Label recommendations will appear in this channel.
`;

  sendWebhookMessage(WEBHOOK_URLS.INSTRUCTIONS, instructions);
  console.log('Setup instructions posted to the instructions channel!');
  console.log('Check your Google Chat space to see them.');
}

// ============================================================================
// WEB APP HANDLERS (Called by Google Flows)
// ============================================================================

/**
 * Handles GET requests - returns basic info.
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'Email Sorter API is running. Use POST requests to interact.',
    commands: ['REQUEST_LABELS', 'APPLY_LABELS', 'RECOMMEND_LABEL']
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles POST requests from Google Flows.
 * @param {Object} e - The HTTP request event
 * @returns {Object} JSON response
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const command = data.command;
    const emailId = data.emailId;
    const labels = data.labels;

    let result;

    switch (command) {
      case 'REQUEST_LABELS':
        const labelList = getUserLabels();
        result = { success: true, emailId: emailId, labels: labelList };
        break;

      case 'APPLY_LABELS':
        if (!emailId || !labels || !Array.isArray(labels)) {
          result = { success: false, error: 'Missing emailId or labels array' };
        } else {
          const applyResult = applyLabelsToEmail(emailId, labels);
          result = { success: true, emailId: emailId, result: applyResult };
        }
        break;

      case 'RECOMMEND_LABEL':
        const labelName = data.labelName;
        const reason = data.reason;
        postLabelRecommendation(labelName, reason);
        result = { success: true, message: 'Recommendation posted' };
        break;

      default:
        result = { success: false, error: 'Unknown command. Valid: REQUEST_LABELS, APPLY_LABELS, RECOMMEND_LABEL' };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Posts a label recommendation to the instructions channel.
 * @param {string} labelName - The suggested label name
 * @param {string} reason - Why this label is suggested
 */
function postLabelRecommendation(labelName, reason) {
  if (!WEBHOOK_URLS.INSTRUCTIONS) {
    console.error('Instructions webhook not configured');
    return;
  }

  const message = `*Label Recommendation*

Suggested Label: \`${labelName}\`
Reason: ${reason || 'No reason provided'}

To create this label in Gmail:
1. Open Gmail
2. In the left sidebar, click "More"
3. Click "Create new label"
4. Enter: ${labelName}
5. Click Create

Then re-run postSetupInstructions() to update the AI prompt with the new label.`;

  sendWebhookMessage(WEBHOOK_URLS.INSTRUCTIONS, message);
}

// ============================================================================
// GMAIL LABEL UTILITIES
// ============================================================================

/**
 * Gets all user-created labels, excluding system labels.
 * @returns {string[]} Array of label names
 */
function getUserLabels() {
  const allLabels = GmailApp.getUserLabels();
  const userLabels = [];

  allLabels.forEach(label => {
    const name = label.getName();
    // Exclude system labels and labels starting with underscore (hidden/internal)
    if (!CONFIG.SYSTEM_LABELS.includes(name.toUpperCase()) && !name.startsWith('_')) {
      userLabels.push(name);
    }
  });

  // Sort alphabetically for consistent ordering
  userLabels.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return userLabels;
}

/**
 * Applies labels to an email.
 * @param {string} emailId - The Gmail message ID
 * @param {string[]} labels - Array of label names to apply
 * @returns {Object} Result with applied and notFound arrays
 */
function applyLabelsToEmail(emailId, labels) {
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

  const applied = [];
  const notFound = [];

  labels.forEach(labelName => {
    if (!labelName || labelName.toUpperCase() === 'NONE') {
      return; // Skip empty or NONE
    }

    const label = labelMap[labelName.toLowerCase()];
    if (label) {
      thread.addLabel(label);
      applied.push(labelName);
    } else {
      notFound.push(labelName);
    }
  });

  console.log(`Applied labels to ${emailId}: ${applied.join(', ')}`);
  if (notFound.length > 0) {
    console.log(`Labels not found: ${notFound.join(', ')}`);
  }

  return { applied: applied, notFound: notFound };
}

/**
 * Lists all available labels - useful for debugging.
 */
function listAllLabels() {
  const labels = getUserLabels();
  console.log('Available user labels (' + labels.length + '):');
  labels.forEach(label => console.log('  - ' + label));
  return labels;
}

// ============================================================================
// UNREAD EMAIL PROCESSING (ONE-TIME CLEANUP)
// ============================================================================

/**
 * Processes all unread emails by sending them to the automated Chat space.
 * Google Flow should be listening for PROCESS_EMAIL messages.
 * This is a one-time cleanup function with rate limiting.
 */
function processUnreadEmails() {
  if (!WEBHOOK_URLS.AUTOMATED) {
    console.error('ERROR: Automated webhook URL not configured. Run configureWebhooks() first.');
    return;
  }

  console.log('Starting unread email processing...');
  console.log('Rate limit: ' + CONFIG.RATE_LIMIT_MS + 'ms between emails');

  // Get all unread emails
  const threads = GmailApp.search('is:unread', 0, CONFIG.BATCH_SIZE);
  console.log('Found ' + threads.length + ' unread threads to process');

  if (threads.length === 0) {
    console.log('No unread emails to process.');
    sendWebhookMessage(WEBHOOK_URLS.INSTRUCTIONS, '*Status Update*\n\nNo unread emails found to process.');
    return;
  }

  // Initialize processing state
  const props = PropertiesService.getScriptProperties();
  const state = {
    totalThreads: threads.length,
    processed: 0,
    errors: []
  };
  props.setProperty(CONFIG.PROPS.PROCESSING_STATE, JSON.stringify(state));

  // Notify start
  sendWebhookMessage(WEBHOOK_URLS.INSTRUCTIONS, `*Status Update*\n\nStarting to process ${threads.length} unread email threads...`);

  // Process each thread
  threads.forEach((thread, index) => {
    try {
      const messages = thread.getMessages();
      const firstMessage = messages[0];
      const emailId = firstMessage.getId();

      console.log(`Processing ${index + 1}/${threads.length}: ${emailId}`);

      // Send message to automated channel for Flow to process
      const message = `PROCESS_EMAIL|${emailId}`;
      sendWebhookMessage(WEBHOOK_URLS.AUTOMATED, message);

      state.processed++;
      props.setProperty(CONFIG.PROPS.PROCESSING_STATE, JSON.stringify(state));

      // Rate limiting - wait before processing next email
      if (index < threads.length - 1) {
        Utilities.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (error) {
      console.error('Error processing thread: ' + error.message);
      state.errors.push({ threadId: thread.getId(), error: error.message });
      props.setProperty(CONFIG.PROPS.PROCESSING_STATE, JSON.stringify(state));
    }
  });

  // Processing complete
  const summary = `*Unread Email Processing Complete!*

Total threads: ${state.totalThreads}
Successfully sent: ${state.processed}
Errors: ${state.errors.length}
${state.errors.length > 0 ? '\nError details:\n' + state.errors.map(e => '- ' + e.threadId + ': ' + e.error).join('\n') : ''}`;

  console.log(summary);
  sendWebhookMessage(WEBHOOK_URLS.INSTRUCTIONS, summary);

  // Clear processing data after successful completion
  clearProcessingData();
}

/**
 * Clears all processing state data. Run this if you need to restart processing.
 */
function clearProcessingData() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(CONFIG.PROPS.PROCESSING_STATE);
  console.log('Processing data cleared. You can now run processUnreadEmails() again.');
}

/**
 * Gets the current processing state - useful for debugging.
 */
function getProcessingState() {
  const props = PropertiesService.getScriptProperties();
  const stateJson = props.getProperty(CONFIG.PROPS.PROCESSING_STATE);
  if (stateJson) {
    const state = JSON.parse(stateJson);
    console.log('Current processing state:');
    console.log(JSON.stringify(state, null, 2));
    return state;
  } else {
    console.log('No processing state found.');
    return null;
  }
}

// ============================================================================
// UTILITY & DEBUG FUNCTIONS
// ============================================================================

/**
 * Displays the current configuration - useful for debugging.
 */
function showConfiguration() {
  console.log('=== Email Sorter Configuration ===');
  console.log('');
  console.log('Webhooks:');
  console.log('- Automated: ' + (WEBHOOK_URLS.AUTOMATED ? 'CONFIGURED' : 'NOT SET'));
  console.log('- Instructions: ' + (WEBHOOK_URLS.INSTRUCTIONS ? 'CONFIGURED' : 'NOT SET'));
  console.log('');
  console.log('Rate Limit: ' + CONFIG.RATE_LIMIT_MS + 'ms');
  console.log('Batch Size: ' + CONFIG.BATCH_SIZE);
  console.log('');
  console.log('Excluded System Labels:');
  CONFIG.SYSTEM_LABELS.forEach(label => console.log('  - ' + label));
  console.log('');
  console.log('User Labels (' + getUserLabels().length + '):');
  getUserLabels().forEach(label => console.log('  - ' + label));
}

/**
 * Test function to verify Gmail access.
 */
function testGmailAccess() {
  try {
    const threads = GmailApp.search('is:unread', 0, 1);
    console.log('Gmail access: OK');
    console.log('Unread threads found: ' + threads.length);

    const labels = getUserLabels();
    console.log('User labels found: ' + labels.length);

    return true;
  } catch (error) {
    console.error('Gmail access error: ' + error.message);
    return false;
  }
}

/**
 * Runs all tests to verify the setup.
 */
function runAllTests() {
  console.log('Running all tests...');
  console.log('');

  const gmailOk = testGmailAccess();
  console.log('');

  const webhooksConfigured = WEBHOOK_URLS.AUTOMATED && WEBHOOK_URLS.INSTRUCTIONS;
  let webhooksOk = false;

  if (webhooksConfigured) {
    webhooksOk = testWebhooks();
  } else {
    console.log('Webhooks: NOT CONFIGURED - run configureWebhooks() first');
  }

  console.log('');
  console.log('=== Test Results ===');
  console.log('Gmail: ' + (gmailOk ? 'PASS' : 'FAIL'));
  console.log('Webhooks: ' + (webhooksOk ? 'PASS' : (webhooksConfigured ? 'FAIL' : 'NOT CONFIGURED')));

  if (gmailOk && webhooksOk) {
    console.log('');
    console.log('All tests passed! You can now:');
    console.log('1. Run postSetupInstructions() to post the Flow setup guide');
    console.log('2. Deploy as web app for the Flow to call');
  }
}

/**
 * Resets everything - clears all stored properties.
 */
function factoryReset() {
  const props = PropertiesService.getScriptProperties();
  props.deleteAllProperties();
  console.log('All properties cleared.');
  console.log('Remember: You still need to update WEBHOOK_URLS in the code.');
}
