/**
 * Email Sorter for Smart Call Time
 *
 * This Google Apps Script integrates Gmail with Google Chat and Google Flows
 * to automatically sort emails into labels using AI-powered categorization.
 *
 * Setup Instructions:
 * 1. Create a new Google Apps Script project
 * 2. Copy this code into Code.gs
 * 3. Enable the Google Chat API in your project (Resources > Advanced Google Services)
 * 4. Run onboardingSetup() to create the Chat spaces
 * 5. Deploy as a Chat app (Publish > Deploy from manifest)
 * 6. Configure Google Flows using the instructions posted to the visible Chat space
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

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

  // Property keys for storing space IDs and processing state
  PROPS: {
    AUTOMATED_SPACE_ID: 'automatedSpaceId',
    INSTRUCTIONS_SPACE_ID: 'instructionsSpaceId',
    PROCESSING_STATE: 'processingState',
    PROCESSED_EMAIL_IDS: 'processedEmailIds'
  }
};

// ============================================================================
// ONBOARDING & SETUP
// ============================================================================

/**
 * Main onboarding function - creates both Chat spaces and posts instructions.
 * Run this once to set up the system.
 */
function onboardingSetup() {
  const props = PropertiesService.getScriptProperties();

  console.log('Starting onboarding setup...');

  // Create the automated (hidden) space for machine-to-machine communication
  const automatedSpace = createChatSpace(
    'Email Sorter - Automated',
    'Automated messaging space for email sorting system. This space handles label requests and applications.',
    true // hidden/muted
  );

  if (automatedSpace) {
    props.setProperty(CONFIG.PROPS.AUTOMATED_SPACE_ID, automatedSpace.name);
    console.log('Created automated space: ' + automatedSpace.name);
  }

  // Create the visible space for instructions and recommendations
  const instructionsSpace = createChatSpace(
    'Email Sorter - Instructions & Recommendations',
    'Setup instructions and label recommendations for the email sorting system.',
    false // visible
  );

  if (instructionsSpace) {
    props.setProperty(CONFIG.PROPS.INSTRUCTIONS_SPACE_ID, instructionsSpace.name);
    console.log('Created instructions space: ' + instructionsSpace.name);

    // Post setup instructions to the visible space
    postSetupInstructions(instructionsSpace.name);
  }

  console.log('Onboarding setup complete!');
  console.log('Automated Space ID: ' + props.getProperty(CONFIG.PROPS.AUTOMATED_SPACE_ID));
  console.log('Instructions Space ID: ' + props.getProperty(CONFIG.PROPS.INSTRUCTIONS_SPACE_ID));

  return {
    automatedSpaceId: props.getProperty(CONFIG.PROPS.AUTOMATED_SPACE_ID),
    instructionsSpaceId: props.getProperty(CONFIG.PROPS.INSTRUCTIONS_SPACE_ID)
  };
}

/**
 * Creates a Google Chat space with the specified settings.
 * @param {string} displayName - The name of the space
 * @param {string} description - Description of the space
 * @param {boolean} muted - Whether to create as a muted/hidden space
 * @returns {Object} The created space object
 */
function createChatSpace(displayName, description, muted) {
  try {
    const space = Chat.Spaces.create({
      spaceType: 'SPACE',
      displayName: displayName,
      spaceDetails: {
        description: description
      },
      // For muted spaces, we set it as a space that doesn't generate notifications
      // Note: Full notification control may require additional user settings
    });

    return space;
  } catch (error) {
    console.error('Error creating Chat space: ' + error.message);
    console.log('Make sure the Google Chat API is enabled in Advanced Google Services');
    return null;
  }
}

/**
 * Posts the setup instructions to the instructions Chat space.
 * @param {string} spaceId - The space ID to post to
 */
function postSetupInstructions(spaceId) {
  const instructions = `
*Email Sorter Setup Instructions*

This system integrates Google Flows with Gmail to automatically sort your emails using AI-powered categorization.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*STEP 1: Deploy this Apps Script as a Chat App*

1. In Apps Script, go to Deploy > New deployment
2. Select type: "Add-on" or use Chat API directly
3. Configure the Chat app to respond to messages in the automated space

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*STEP 2: Create Google Flow for NEW EMAILS*

Trigger: When a new email arrives in Gmail

Flow Steps:
1. Get the email ID from the trigger
2. Send a Chat message to the automated space:
   \`REQUEST_LABELS|{emailId}\`
3. Wait for response (contains available labels)
4. Use AI/logic to determine which labels apply based on email content
5. Send a Chat message:
   \`APPLY_LABELS|{emailId}|label1,label2,label3\`
   (If recommending a new label, send: \`RECOMMEND_LABEL|{suggestedLabelName}|{reason}\`)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*STEP 3: Create Google Flow for OLD EMAIL PROCESSING*

Trigger: When a Chat message is received with format \`PROCESS_EMAIL|{emailId}\`

Flow Steps:
1. Parse the email ID from the message
2. Fetch the email content using the Gmail connector
3. Use AI/logic to determine which labels apply
4. Send a Chat message:
   \`APPLY_LABELS|{emailId}|label1,label2,label3\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*MESSAGE FORMAT REFERENCE*

Messages FROM this script:
• \`REQUEST_LABELS|{emailId}\` - Flow should respond with label selection
• \`LABELS_LIST|{emailId}|label1,label2,label3,...\` - Available labels
• \`PROCESS_EMAIL|{emailId}\` - Requesting Flow to process an old email

Messages TO this script:
• \`APPLY_LABELS|{emailId}|label1,label2\` - Apply these labels to email
• \`RECOMMEND_LABEL|{labelName}|{reason}\` - Suggest a new label (posted here for review)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*PROMPT TEMPLATE FOR AI LABEL SELECTION*

Copy this prompt for use in your Google Flow AI step:

\`\`\`
You are an email categorization assistant. Given the following email and list of available labels, select the most appropriate labels to apply.

Available Labels:
{labels_list}

Email Details:
From: {sender}
Subject: {subject}
Body Preview: {body_preview}

Instructions:
1. Select 1-3 labels that best categorize this email
2. Only use labels from the provided list
3. If no labels fit well, respond with "NONE"
4. If you think a new label should be created, note it separately

Respond in this exact format:
LABELS: label1, label2
RECOMMEND_NEW: (optional) suggested_label_name - reason
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*RUNNING THE ONE-TIME CLEANUP*

To process all existing unread emails:
1. Run the \`processUnreadEmails()\` function from Apps Script
2. Progress will be logged to the console
3. Emails will be sent to the Flow one at a time with rate limiting
4. Run \`clearProcessingData()\` if you need to restart

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Setup complete! Label recommendations from the Flow will appear in this space.
`;

  sendChatMessage(spaceId, instructions);
}

// ============================================================================
// CHAT MESSAGE HANDLING
// ============================================================================

/**
 * Handles incoming Chat messages. This is the main entry point for Chat app events.
 * Deploy this function as the Chat app's message handler.
 * @param {Object} event - The Chat event object
 * @returns {Object} Response to send back to Chat
 */
function onMessage(event) {
  const message = event.message.text;
  const spaceId = event.space.name;

  console.log('Received message: ' + message);
  console.log('From space: ' + spaceId);

  // Parse the message format: COMMAND|param1|param2|...
  const parts = message.split('|').map(p => p.trim());
  const command = parts[0].toUpperCase();

  switch (command) {
    case 'REQUEST_LABELS':
      return handleRequestLabels(spaceId, parts[1]);

    case 'APPLY_LABELS':
      return handleApplyLabels(parts[1], parts[2]);

    case 'RECOMMEND_LABEL':
      return handleRecommendLabel(parts[1], parts[2]);

    default:
      return createTextResponse('Unknown command. Valid commands: REQUEST_LABELS, APPLY_LABELS, RECOMMEND_LABEL');
  }
}

/**
 * Handles a request for available labels.
 * @param {string} spaceId - The space to respond to
 * @param {string} emailId - The email ID this request is for
 * @returns {Object} Chat response with label list
 */
function handleRequestLabels(spaceId, emailId) {
  const labels = getUserLabels();
  const labelList = labels.join(',');

  const response = `LABELS_LIST|${emailId}|${labelList}`;

  console.log('Responding with labels: ' + response);

  return createTextResponse(response);
}

/**
 * Handles applying labels to an email.
 * @param {string} emailId - The Gmail message ID
 * @param {string} labelString - Comma-separated list of labels to apply
 * @returns {Object} Chat response confirming the action
 */
function handleApplyLabels(emailId, labelString) {
  if (!emailId || !labelString) {
    return createTextResponse('ERROR|Missing emailId or labels');
  }

  const labelsToApply = labelString.split(',').map(l => l.trim()).filter(l => l.length > 0);

  if (labelsToApply.length === 0 || (labelsToApply.length === 1 && labelsToApply[0].toUpperCase() === 'NONE')) {
    return createTextResponse(`SUCCESS|${emailId}|No labels to apply`);
  }

  try {
    const thread = GmailApp.getMessageById(emailId).getThread();

    // Get all user labels and create a map for quick lookup
    const allLabels = GmailApp.getUserLabels();
    const labelMap = {};
    allLabels.forEach(label => {
      labelMap[label.getName().toLowerCase()] = label;
    });

    // Apply each label
    const appliedLabels = [];
    const notFoundLabels = [];

    labelsToApply.forEach(labelName => {
      const label = labelMap[labelName.toLowerCase()];
      if (label) {
        thread.addLabel(label);
        appliedLabels.push(labelName);
      } else {
        notFoundLabels.push(labelName);
      }
    });

    let response = `SUCCESS|${emailId}|Applied: ${appliedLabels.join(', ')}`;
    if (notFoundLabels.length > 0) {
      response += `|Not found: ${notFoundLabels.join(', ')}`;
    }

    console.log(response);
    return createTextResponse(response);

  } catch (error) {
    console.error('Error applying labels: ' + error.message);
    return createTextResponse(`ERROR|${emailId}|${error.message}`);
  }
}

/**
 * Handles a label recommendation by posting it to the instructions space.
 * @param {string} labelName - The suggested label name
 * @param {string} reason - The reason for the suggestion
 * @returns {Object} Chat response confirming the recommendation was logged
 */
function handleRecommendLabel(labelName, reason) {
  const props = PropertiesService.getScriptProperties();
  const instructionsSpaceId = props.getProperty(CONFIG.PROPS.INSTRUCTIONS_SPACE_ID);

  if (!instructionsSpaceId) {
    return createTextResponse('ERROR|Instructions space not configured. Run onboardingSetup() first.');
  }

  const recommendation = `
*Label Recommendation*

Suggested Label: \`${labelName}\`
Reason: ${reason || 'No reason provided'}

To create this label:
1. Go to Gmail
2. Click "More" in the left sidebar
3. Click "Create new label"
4. Enter: ${labelName}
`;

  sendChatMessage(instructionsSpaceId, recommendation);

  return createTextResponse(`RECOMMENDATION_LOGGED|${labelName}`);
}

/**
 * Creates a simple text response for Chat.
 * @param {string} text - The text to respond with
 * @returns {Object} Chat response object
 */
function createTextResponse(text) {
  return {
    text: text
  };
}

/**
 * Sends a message to a Chat space.
 * @param {string} spaceId - The space to send to
 * @param {string} text - The message text
 */
function sendChatMessage(spaceId, text) {
  try {
    Chat.Spaces.Messages.create(
      { text: text },
      spaceId
    );
  } catch (error) {
    console.error('Error sending Chat message: ' + error.message);
  }
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
 * Processes all unread emails by sending them to the Flow one at a time.
 * This is a one-time cleanup function with rate limiting.
 */
function processUnreadEmails() {
  const props = PropertiesService.getScriptProperties();
  const automatedSpaceId = props.getProperty(CONFIG.PROPS.AUTOMATED_SPACE_ID);

  if (!automatedSpaceId) {
    console.error('Automated space not configured. Run onboardingSetup() first.');
    return;
  }

  console.log('Starting unread email processing...');
  console.log('Rate limit: ' + CONFIG.RATE_LIMIT_MS + 'ms between emails');

  // Get all unread emails
  const threads = GmailApp.search('is:unread', 0, CONFIG.BATCH_SIZE);
  console.log('Found ' + threads.length + ' unread threads to process');

  if (threads.length === 0) {
    console.log('No unread emails to process.');
    postStatusUpdate('No unread emails found to process.');
    return;
  }

  // Initialize processing state
  const state = {
    totalThreads: threads.length,
    processed: 0,
    errors: []
  };
  props.setProperty(CONFIG.PROPS.PROCESSING_STATE, JSON.stringify(state));

  // Process each thread
  threads.forEach((thread, index) => {
    try {
      const messages = thread.getMessages();
      const firstMessage = messages[0];
      const emailId = firstMessage.getId();

      console.log(`Processing ${index + 1}/${threads.length}: ${emailId}`);

      // Send message to Flow to process this email
      const message = `PROCESS_EMAIL|${emailId}`;
      sendChatMessage(automatedSpaceId, message);

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
  const summary = `
Unread Email Processing Complete!

Total threads: ${state.totalThreads}
Successfully sent: ${state.processed}
Errors: ${state.errors.length}
${state.errors.length > 0 ? '\nError details:\n' + state.errors.map(e => `- ${e.threadId}: ${e.error}`).join('\n') : ''}
`;

  console.log(summary);
  postStatusUpdate(summary);

  // Clear processing data after successful completion
  clearProcessingData();
}

/**
 * Clears all processing state data. Run this if you need to restart processing
 * or if there was an error and you want to try again.
 */
function clearProcessingData() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(CONFIG.PROPS.PROCESSING_STATE);
  props.deleteProperty(CONFIG.PROPS.PROCESSED_EMAIL_IDS);
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

/**
 * Posts a status update to the instructions space.
 * @param {string} message - The status message
 */
function postStatusUpdate(message) {
  const props = PropertiesService.getScriptProperties();
  const instructionsSpaceId = props.getProperty(CONFIG.PROPS.INSTRUCTIONS_SPACE_ID);

  if (instructionsSpaceId) {
    sendChatMessage(instructionsSpaceId, `*Status Update*\n\n${message}`);
  }
}

// ============================================================================
// WEBHOOK HANDLER (Alternative to Chat App)
// ============================================================================

/**
 * If you prefer to use webhooks instead of a Chat app, deploy this as a web app
 * and configure your Flow to POST to the web app URL.
 *
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
        const applyResult = applyLabelsToEmail(emailId, labels);
        result = { success: true, emailId: emailId, result: applyResult };
        break;

      default:
        result = { success: false, error: 'Unknown command' };
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
 * Helper function for webhook to apply labels.
 * @param {string} emailId - The email ID
 * @param {string[]} labels - Array of label names
 * @returns {Object} Result object
 */
function applyLabelsToEmail(emailId, labels) {
  const thread = GmailApp.getMessageById(emailId).getThread();
  const allLabels = GmailApp.getUserLabels();
  const labelMap = {};
  allLabels.forEach(label => {
    labelMap[label.getName().toLowerCase()] = label;
  });

  const applied = [];
  const notFound = [];

  labels.forEach(labelName => {
    const label = labelMap[labelName.toLowerCase()];
    if (label) {
      thread.addLabel(label);
      applied.push(labelName);
    } else {
      notFound.push(labelName);
    }
  });

  return { applied: applied, notFound: notFound };
}

// ============================================================================
// UTILITY & DEBUG FUNCTIONS
// ============================================================================

/**
 * Displays the current configuration - useful for debugging.
 */
function showConfiguration() {
  const props = PropertiesService.getScriptProperties();

  console.log('=== Email Sorter Configuration ===');
  console.log('');
  console.log('Rate Limit: ' + CONFIG.RATE_LIMIT_MS + 'ms');
  console.log('Batch Size: ' + CONFIG.BATCH_SIZE);
  console.log('');
  console.log('Automated Space ID: ' + (props.getProperty(CONFIG.PROPS.AUTOMATED_SPACE_ID) || 'Not configured'));
  console.log('Instructions Space ID: ' + (props.getProperty(CONFIG.PROPS.INSTRUCTIONS_SPACE_ID) || 'Not configured'));
  console.log('');
  console.log('Excluded System Labels:');
  CONFIG.SYSTEM_LABELS.forEach(label => console.log('  - ' + label));
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
 * Test function to verify Chat API access.
 */
function testChatAccess() {
  try {
    // Try to list spaces to verify Chat API access
    const spaces = Chat.Spaces.list();
    console.log('Chat API access: OK');
    console.log('Spaces found: ' + (spaces.spaces ? spaces.spaces.length : 0));
    return true;
  } catch (error) {
    console.error('Chat API access error: ' + error.message);
    console.log('Make sure to enable the Chat API in Advanced Google Services');
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
  const chatOk = testChatAccess();

  console.log('');
  console.log('=== Test Results ===');
  console.log('Gmail: ' + (gmailOk ? 'PASS' : 'FAIL'));
  console.log('Chat: ' + (chatOk ? 'PASS' : 'FAIL'));

  if (gmailOk && chatOk) {
    console.log('');
    console.log('All tests passed! You can now run onboardingSetup()');
  }
}

/**
 * Resets everything - clears all stored properties.
 * WARNING: This will require you to run onboardingSetup() again.
 */
function factoryReset() {
  const props = PropertiesService.getScriptProperties();
  props.deleteAllProperties();
  console.log('All properties cleared. Run onboardingSetup() to reconfigure.');
}
