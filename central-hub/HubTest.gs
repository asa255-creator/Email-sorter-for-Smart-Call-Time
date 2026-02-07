/**
 * Central Hub - Test Functions
 *
 * Test utilities for verifying Chat message create/delete functionality.
 * Run these from the Apps Script editor to verify setup.
 *
 * Dependencies:
 *   - HubConfig.gs: getHubConfig()
 *   - ChatManager.gs: deleteChatMessages()
 *   - HubMain.gs: logHub()
 */

// ============================================================================
// TEST FUNCTIONS - Run from Apps Script Editor
// ============================================================================

/**
 * MAIN TEST: Creates a test message and then deletes it.
 * Run this to verify the full create/delete cycle works.
 *
 * Steps:
 * 1. Open Apps Script editor
 * 2. Select "testCreateAndDeleteMessage" from dropdown
 * 3. Click Run
 * 4. Check execution log for results
 */
function testCreateAndDeleteMessage() {
  console.log('=== Starting Create/Delete Test ===');

  // Step 1: Create test message
  console.log('Step 1: Creating test message...');
  const createResult = testCreateMessage();

  if (!createResult.success) {
    console.error('FAILED: Could not create message:', createResult.error);
    return { success: false, step: 'create', error: createResult.error };
  }

  console.log('Created message:', createResult.messageName);

  // Wait a moment to ensure message is fully created
  Utilities.sleep(2000);

  // Step 2: Delete the message
  console.log('Step 2: Deleting test message...');
  const deleteResult = testDeleteMessage(createResult.messageName);

  if (!deleteResult.success) {
    console.error('FAILED: Could not delete message:', deleteResult.error);
    return { success: false, step: 'delete', error: deleteResult.error };
  }

  console.log('=== Test Passed! ===');
  console.log('Message was created and deleted successfully.');

  return {
    success: true,
    message: 'Create/delete cycle completed successfully',
    messageName: createResult.messageName
  };
}

/**
 * Creates a test message in the Chat space.
 * Returns the message name for later deletion.
 *
 * @returns {Object} Result with messageName
 */
function testCreateMessage() {
  const spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    return {
      success: false,
      error: 'Chat space ID not configured. Add the app to a Chat space first.'
    };
  }

  try {
    const testMessage = `🧪 TEST MESSAGE - ${new Date().toISOString()}\n\nThis is a test message to verify Chat API integration.\nIt will be deleted automatically.`;

    const message = Chat.Spaces.Messages.create(
      { text: testMessage },
      spaceId
    );

    logHub('TEST_CREATE', `Created: ${message.name}`);

    return {
      success: true,
      messageName: message.name,
      spaceId: spaceId
    };

  } catch (error) {
    logHub('TEST_CREATE_ERROR', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Deletes a specific message by name.
 *
 * @param {string} messageName - The message name to delete
 * @returns {Object} Result
 */
function testDeleteMessage(messageName) {
  if (!messageName) {
    return { success: false, error: 'No message name provided' };
  }

  try {
    Chat.Spaces.Messages.remove(messageName);
    logHub('TEST_DELETE', `Deleted: ${messageName}`);

    return { success: true, messageName: messageName };

  } catch (error) {
    logHub('TEST_DELETE_ERROR', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Lists recent messages in the Chat space (for debugging).
 * Useful to see what messages exist.
 *
 * @param {number} limit - Max messages to list (default 10)
 * @returns {Object[]} Array of message summaries
 */
function testListMessages(limit) {
  const spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    console.error('Chat space ID not configured');
    return [];
  }

  try {
    const response = Chat.Spaces.Messages.list(spaceId, {
      pageSize: limit || 10
    });

    const messages = response.messages || [];

    console.log(`Found ${messages.length} messages:`);
    messages.forEach((msg, i) => {
      const text = (msg.text || '').substring(0, 50);
      console.log(`${i + 1}. ${msg.name}: "${text}..."`);
    });

    return messages.map(msg => ({
      name: msg.name,
      text: (msg.text || '').substring(0, 100),
      createTime: msg.createTime
    }));

  } catch (error) {
    console.error('List error:', error.message);
    return [];
  }
}

/**
 * Deletes ALL messages in the Chat space (cleanup utility).
 * USE WITH CAUTION - this clears the entire conversation.
 *
 * @param {boolean} confirm - Must pass true to confirm
 * @returns {Object} Result with count
 */
function testDeleteAllMessages(confirm) {
  if (confirm !== true) {
    console.warn('Pass true to confirm deletion of all messages');
    return { success: false, error: 'Confirmation required' };
  }

  const spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    return { success: false, error: 'Chat space not configured' };
  }

  try {
    let deleted = 0;
    let hasMore = true;

    while (hasMore) {
      const response = Chat.Spaces.Messages.list(spaceId, { pageSize: 50 });
      const messages = response.messages || [];

      if (messages.length === 0) {
        hasMore = false;
        break;
      }

      for (const msg of messages) {
        try {
          Chat.Spaces.Messages.remove(msg.name);
          deleted++;
        } catch (e) {
          // Skip messages we can't delete
          console.warn(`Could not delete ${msg.name}: ${e.message}`);
        }
      }

      // Small delay between batches
      Utilities.sleep(500);
    }

    console.log(`Deleted ${deleted} messages`);
    logHub('TEST_CLEANUP', `Deleted ${deleted} messages`);

    return { success: true, deleted: deleted };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

/**
 * Verifies the Hub is properly configured for Chat operations.
 * Run this first to check all prerequisites.
 */
function testVerifySetup() {
  console.log('=== Hub Setup Verification ===\n');

  const checks = [];

  // Check 1: Chat space configured
  const spaceId = getHubConfig('chat_space_id');
  checks.push({
    name: 'Chat Space ID',
    passed: !!spaceId,
    value: spaceId || 'NOT SET',
    fix: 'Add the app to a Chat space'
  });

  // Check 2: Chat API accessible
  let chatApiOk = false;
  try {
    if (spaceId) {
      Chat.Spaces.get(spaceId);
      chatApiOk = true;
    }
  } catch (e) {
    chatApiOk = false;
  }
  checks.push({
    name: 'Chat API Access',
    passed: chatApiOk,
    value: chatApiOk ? 'OK' : 'FAILED',
    fix: 'Enable Chat API in Cloud Console and add OAuth scopes'
  });

  // Print results
  let allPassed = true;
  for (const check of checks) {
    const status = check.passed ? '✓' : '✗';
    console.log(`${status} ${check.name}: ${check.value}`);
    if (!check.passed) {
      console.log(`  → Fix: ${check.fix}`);
      allPassed = false;
    }
  }

  console.log('\n' + (allPassed ? '=== All checks passed! ===' : '=== Some checks failed ==='));

  return { success: allPassed, checks: checks };
}
