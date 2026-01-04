import { EventEmitter } from 'events';
import { getDb, isDatabaseConnected, schema } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';

const { terminalSessions } = schema;

/**
 * Terminal Session Manager
 * Manages persistent terminal sessions with database storage
 */
class TerminalSessionManager extends EventEmitter {
  constructor() {
    super();

    // In-memory session data (for active sessions)
    this.activeSessions = new Map();

    // Output buffer settings
    this.defaultBufferSize = 10000; // lines
    this.saveInterval = 30000; // 30 seconds

    // Start periodic save interval
    this.saveIntervalId = null;
    this.startPeriodicSave();
  }

  /**
   * Start periodic save of session buffers to database
   */
  startPeriodicSave() {
    if (this.saveIntervalId) return;

    this.saveIntervalId = setInterval(async () => {
      await this.saveAllBuffers();
    }, this.saveInterval);
  }

  /**
   * Stop periodic save
   */
  stopPeriodicSave() {
    if (this.saveIntervalId) {
      clearInterval(this.saveIntervalId);
      this.saveIntervalId = null;
    }
  }

  /**
   * Create a new session or recover existing
   * @param {string} sessionId - Session identifier
   * @param {object} options - Session options
   * @returns {Promise<object>} - Session data
   */
  async createSession(sessionId, options = {}) {
    const { cwd = process.env.HOME, shell = '/bin/bash', appId = null } = options;

    // Check if session exists in database
    const existing = await this.getSessionFromDb(sessionId);

    if (existing && existing.isActive) {
      // Recover existing session
      const session = {
        id: sessionId,
        cwd: existing.cwd,
        shell: existing.shell,
        appId: existing.appId,
        createdAt: existing.createdAt,
        outputBuffer: existing.outputBuffer || [],
        isRecovered: true,
      };

      this.activeSessions.set(sessionId, {
        ...session,
        lastActivity: new Date(),
      });

      this.emit('session-recovered', session);
      return session;
    }

    // Create new session
    const session = {
      id: sessionId,
      cwd,
      shell,
      appId,
      createdAt: new Date(),
      outputBuffer: [],
      isRecovered: false,
    };

    // Save to database
    await this.saveSessionToDb(session);

    // Store in memory
    this.activeSessions.set(sessionId, {
      ...session,
      lastActivity: new Date(),
    });

    this.emit('session-created', session);
    return session;
  }

  /**
   * Get session from database
   * @param {string} sessionId - Session ID
   * @returns {Promise<object|null>}
   */
  async getSessionFromDb(sessionId) {
    const db = getDb();
    if (!db) return null;

    try {
      const result = await db
        .select()
        .from(terminalSessions)
        .where(eq(terminalSessions.id, sessionId))
        .limit(1);

      return result[0] || null;
    } catch (error) {
      console.error('Failed to get session from DB:', error);
      return null;
    }
  }

  /**
   * Save session to database
   * @param {object} session - Session data
   * @returns {Promise<boolean>}
   */
  async saveSessionToDb(session) {
    const db = getDb();
    if (!db) return false;

    try {
      const existing = await this.getSessionFromDb(session.id);

      if (existing) {
        await db
          .update(terminalSessions)
          .set({
            lastActivity: new Date(),
            isActive: true,
            outputBuffer: session.outputBuffer,
          })
          .where(eq(terminalSessions.id, session.id));
      } else {
        await db.insert(terminalSessions).values({
          id: session.id,
          appId: session.appId,
          cwd: session.cwd,
          shell: session.shell,
          isActive: true,
          outputBuffer: session.outputBuffer || [],
          bufferSize: this.defaultBufferSize,
        });
      }

      return true;
    } catch (error) {
      console.error('Failed to save session to DB:', error);
      return false;
    }
  }

  /**
   * Append output to session buffer
   * @param {string} sessionId - Session ID
   * @param {string} data - Output data
   */
  appendOutput(sessionId, data) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Split by lines and add to buffer
    const lines = data.split(/\r?\n/);
    session.outputBuffer.push(...lines.filter(l => l.length > 0));

    // Trim buffer if too large
    if (session.outputBuffer.length > this.defaultBufferSize) {
      session.outputBuffer = session.outputBuffer.slice(-this.defaultBufferSize);
    }

    session.lastActivity = new Date();
  }

  /**
   * Get session output buffer
   * @param {string} sessionId - Session ID
   * @param {number} lastN - Number of lines to return
   * @returns {string[]}
   */
  getOutputBuffer(sessionId, lastN = 100) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return [];

    return session.outputBuffer.slice(-lastN);
  }

  /**
   * Close session
   * @param {string} sessionId - Session ID
   * @returns {Promise<boolean>}
   */
  async closeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    // Save buffer one last time
    await this.saveSessionToDb(session);

    // Mark as inactive in database
    const db = getDb();
    if (db) {
      try {
        await db
          .update(terminalSessions)
          .set({
            isActive: false,
            lastActivity: new Date(),
          })
          .where(eq(terminalSessions.id, sessionId));
      } catch (error) {
        console.error('Failed to close session in DB:', error);
      }
    }

    // Remove from memory
    this.activeSessions.delete(sessionId);

    this.emit('session-closed', { id: sessionId });
    return true;
  }

  /**
   * Get all active sessions
   * @returns {object[]}
   */
  getActiveSessions() {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get sessions for a specific app
   * @param {string} appId - Application ID
   * @returns {Promise<object[]>}
   */
  async getSessionsForApp(appId) {
    const db = getDb();
    if (!db) return [];

    try {
      return await db
        .select()
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.appId, appId),
            eq(terminalSessions.isActive, true)
          )
        )
        .orderBy(desc(terminalSessions.lastActivity));
    } catch (error) {
      console.error('Failed to get sessions for app:', error);
      return [];
    }
  }

  /**
   * Get recent sessions (for session recovery UI)
   * @param {number} limit - Number of sessions to return
   * @returns {Promise<object[]>}
   */
  async getRecentSessions(limit = 10) {
    const db = getDb();
    if (!db) return [];

    try {
      return await db
        .select()
        .from(terminalSessions)
        .orderBy(desc(terminalSessions.lastActivity))
        .limit(limit);
    } catch (error) {
      console.error('Failed to get recent sessions:', error);
      return [];
    }
  }

  /**
   * Save all active session buffers to database
   * @returns {Promise<void>}
   */
  async saveAllBuffers() {
    for (const [sessionId, session] of this.activeSessions) {
      await this.saveSessionToDb(session);
    }
  }

  /**
   * Cleanup old inactive sessions
   * @param {number} maxAgeDays - Maximum age in days
   * @returns {Promise<number>} - Number of sessions cleaned up
   */
  async cleanupOldSessions(maxAgeDays = 7) {
    const db = getDb();
    if (!db) return 0;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      const result = await db
        .delete(terminalSessions)
        .where(
          and(
            eq(terminalSessions.isActive, false),
            // lastActivity < cutoffDate
          )
        );

      return result.rowCount || 0;
    } catch (error) {
      console.error('Failed to cleanup old sessions:', error);
      return 0;
    }
  }

  /**
   * Update session activity timestamp
   * @param {string} sessionId - Session ID
   */
  touch(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Get session statistics
   * @returns {object}
   */
  getStats() {
    let totalBufferSize = 0;
    for (const session of this.activeSessions.values()) {
      totalBufferSize += session.outputBuffer.length;
    }

    return {
      activeSessions: this.activeSessions.size,
      totalBufferLines: totalBufferSize,
      databaseConnected: isDatabaseConnected(),
    };
  }
}

// Singleton instance
export const terminalSessionManager = new TerminalSessionManager();
export default TerminalSessionManager;
