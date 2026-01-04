import { eq, and, desc, asc, isNull } from 'drizzle-orm';
import { getDb, isDatabaseConnected, schema } from '../index.js';

const { applications, appRuns, appTags, tags } = schema;

/**
 * Applications Repository
 * Handles all database operations for applications
 */
class ApplicationsRepository {
  /**
   * Get all applications (non-archived by default)
   * @param {object} options - Query options
   * @returns {Promise<object[]>}
   */
  async getAll(options = {}) {
    const db = getDb();
    if (!db) return [];

    const { includeArchived = false, favoritesFirst = true } = options;

    try {
      let query = db.select().from(applications);

      if (!includeArchived) {
        query = query.where(eq(applications.isArchived, false));
      }

      if (favoritesFirst) {
        query = query.orderBy(desc(applications.isFavorite), asc(applications.name));
      } else {
        query = query.orderBy(asc(applications.name));
      }

      return await query;
    } catch (error) {
      console.error('Failed to get applications:', error);
      return [];
    }
  }

  /**
   * Get application by ID
   * @param {string} id - Application UUID
   * @returns {Promise<object|null>}
   */
  async getById(id) {
    const db = getDb();
    if (!db) return null;

    try {
      const result = await db
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .limit(1);

      return result[0] || null;
    } catch (error) {
      console.error('Failed to get application by ID:', error);
      return null;
    }
  }

  /**
   * Get application by path
   * @param {string} path - Application path
   * @returns {Promise<object|null>}
   */
  async getByPath(path) {
    const db = getDb();
    if (!db) return null;

    try {
      const result = await db
        .select()
        .from(applications)
        .where(eq(applications.path, path))
        .limit(1);

      return result[0] || null;
    } catch (error) {
      console.error('Failed to get application by path:', error);
      return null;
    }
  }

  /**
   * Create or update an application (upsert by path)
   * @param {object} appData - Application data
   * @returns {Promise<object|null>}
   */
  async upsert(appData) {
    const db = getDb();
    if (!db) return null;

    try {
      const existing = await this.getByPath(appData.path);

      if (existing) {
        // Update existing
        const updated = await db
          .update(applications)
          .set({
            ...appData,
            updatedAt: new Date(),
            lastScannedAt: new Date(),
          })
          .where(eq(applications.path, appData.path))
          .returning();

        return updated[0];
      } else {
        // Insert new
        const inserted = await db
          .insert(applications)
          .values({
            ...appData,
            lastScannedAt: new Date(),
          })
          .returning();

        return inserted[0];
      }
    } catch (error) {
      console.error('Failed to upsert application:', error);
      return null;
    }
  }

  /**
   * Update application preferences
   * @param {string} id - Application UUID
   * @param {object} preferences - Preference updates
   * @returns {Promise<object|null>}
   */
  async updatePreferences(id, preferences) {
    const db = getDb();
    if (!db) return null;

    const allowedFields = ['isFavorite', 'isArchived', 'customPort', 'displayOrder'];
    const updates = {};

    for (const [key, value] of Object.entries(preferences)) {
      if (allowedFields.includes(key)) {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return null;
    }

    try {
      const result = await db
        .update(applications)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(applications.id, id))
        .returning();

      return result[0] || null;
    } catch (error) {
      console.error('Failed to update preferences:', error);
      return null;
    }
  }

  /**
   * Toggle favorite status
   * @param {string} id - Application UUID
   * @returns {Promise<boolean>}
   */
  async toggleFavorite(id) {
    const db = getDb();
    if (!db) return false;

    try {
      const app = await this.getById(id);
      if (!app) return false;

      await db
        .update(applications)
        .set({
          isFavorite: !app.isFavorite,
          updatedAt: new Date(),
        })
        .where(eq(applications.id, id));

      return true;
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      return false;
    }
  }

  /**
   * Toggle archive status
   * @param {string} id - Application UUID
   * @returns {Promise<boolean>}
   */
  async toggleArchive(id) {
    const db = getDb();
    if (!db) return false;

    try {
      const app = await this.getById(id);
      if (!app) return false;

      await db
        .update(applications)
        .set({
          isArchived: !app.isArchived,
          updatedAt: new Date(),
        })
        .where(eq(applications.id, id));

      return true;
    } catch (error) {
      console.error('Failed to toggle archive:', error);
      return false;
    }
  }

  /**
   * Record app start
   * @param {string} appId - Application UUID
   * @param {number} pid - Process ID
   * @param {number} port - Port number
   * @returns {Promise<object|null>}
   */
  async recordStart(appId, pid, port) {
    const db = getDb();
    if (!db) return null;

    try {
      // Update app's last started timestamp
      await db
        .update(applications)
        .set({ lastStartedAt: new Date() })
        .where(eq(applications.id, appId));

      // Create run record
      const run = await db
        .insert(appRuns)
        .values({
          appId,
          status: 'running',
          pid,
          port,
        })
        .returning();

      return run[0];
    } catch (error) {
      console.error('Failed to record app start:', error);
      return null;
    }
  }

  /**
   * Record app stop
   * @param {string} appId - Application UUID
   * @param {number} exitCode - Exit code
   * @returns {Promise<boolean>}
   */
  async recordStop(appId, exitCode = 0) {
    const db = getDb();
    if (!db) return false;

    try {
      // Find the active run for this app
      const activeRuns = await db
        .select()
        .from(appRuns)
        .where(
          and(
            eq(appRuns.appId, appId),
            eq(appRuns.status, 'running'),
            isNull(appRuns.stoppedAt)
          )
        )
        .limit(1);

      if (activeRuns.length > 0) {
        await db
          .update(appRuns)
          .set({
            status: exitCode === 0 ? 'stopped' : 'error',
            stoppedAt: new Date(),
            exitCode,
          })
          .where(eq(appRuns.id, activeRuns[0].id));
      }

      return true;
    } catch (error) {
      console.error('Failed to record app stop:', error);
      return false;
    }
  }

  /**
   * Get app run history
   * @param {string} appId - Application UUID
   * @param {number} limit - Number of records to return
   * @returns {Promise<object[]>}
   */
  async getRunHistory(appId, limit = 10) {
    const db = getDb();
    if (!db) return [];

    try {
      return await db
        .select()
        .from(appRuns)
        .where(eq(appRuns.appId, appId))
        .orderBy(desc(appRuns.startedAt))
        .limit(limit);
    } catch (error) {
      console.error('Failed to get run history:', error);
      return [];
    }
  }

  /**
   * Delete application (soft delete by archiving)
   * @param {string} id - Application UUID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const db = getDb();
    if (!db) return false;

    try {
      await db
        .update(applications)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(eq(applications.id, id));

      return true;
    } catch (error) {
      console.error('Failed to delete application:', error);
      return false;
    }
  }

  /**
   * Permanently delete application
   * @param {string} id - Application UUID
   * @returns {Promise<boolean>}
   */
  async permanentDelete(id) {
    const db = getDb();
    if (!db) return false;

    try {
      await db.delete(applications).where(eq(applications.id, id));
      return true;
    } catch (error) {
      console.error('Failed to permanently delete application:', error);
      return false;
    }
  }

  /**
   * Sync applications with filesystem scan results
   * @param {object[]} scannedApps - Apps from filesystem scan
   * @returns {Promise<object[]>} - Synced applications
   */
  async syncWithScan(scannedApps) {
    const db = getDb();
    if (!db) return scannedApps;

    try {
      const results = [];

      for (const app of scannedApps) {
        const synced = await this.upsert({
          name: app.name,
          path: app.path,
          type: app.type,
          framework: app.detectedFramework,
          startCommand: app.startCommand,
          defaultPort: app.port,
          packageJson: app.packageJson || null,
          detectedScripts: app.scripts || null,
        });

        if (synced) {
          // Merge DB data with scan data
          results.push({
            ...app,
            id: synced.id,
            isFavorite: synced.isFavorite,
            isArchived: synced.isArchived,
            customPort: synced.customPort,
            aiAnalysis: synced.aiAnalysis,
          });
        } else {
          results.push(app);
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to sync with scan:', error);
      return scannedApps;
    }
  }
}

// Export singleton instance
export const applicationsRepository = new ApplicationsRepository();
export default ApplicationsRepository;
