/**
 * @ai-guide-component HeartbeatCommand
 * @ai-guide-description Connection status monitoring command
 * @ai-guide-responsibilities
 * - Responds to periodic status check requests from the extension
 * - Verifies that the native host is alive and responsive
 * - Maintains persistent connection between extension and native host
 * - Helps detect when the host process becomes unresponsive
 * - Provides simple diagnostics about host process status
 */

// commands/heartbeat.js
const BaseCommand = require('./base-command');
const { logDebug } = require('../utils/logger');

/**
 * Command for handling heartbeat messages to keep connection alive
 */
class HeartbeatCommand extends BaseCommand {
    /**
     * Execute the heartbeat command
     * @param {Object} params Command parameters
     */
    async execute(params) {
        logDebug('Received heartbeat');
        
        // Send simple heartbeat response to confirm host is alive
        this.sendSuccess({ type: 'heartbeat', alive: true });
        
        return { success: true, type: 'heartbeat', alive: true };
    }
}

module.exports = HeartbeatCommand;
