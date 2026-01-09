/**
 * Notarization script for macOS builds
 * This will be used when building for macOS to notarize the app
 */

import { notarize } from '@electron/notarize';

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  // Validate required credentials
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('ℹ️  Skipping notarization: APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set');
    console.log('   To enable notarization, set these environment variables:');
    console.log('   - APPLE_ID: Your Apple ID email');
    console.log('   - APPLE_APP_SPECIFIC_PASSWORD: App-specific password from appleid.apple.com');
    console.log('   - APPLE_TEAM_ID: Your Apple Developer Team ID (optional but recommended)');
    return;
  }

  // Warn if TEAM_ID is missing
  if (!process.env.APPLE_TEAM_ID) {
    console.warn('⚠️  APPLE_TEAM_ID not set. Notarization may fail if you belong to multiple teams.');
  }

  console.log(`🔐 Notarizing ${appName}...`);

  try {
    await notarize({
      appPath: `${appOutDir}/${appName}.app`,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });

    console.log('✅ Notarization complete');
  } catch (error) {
    console.error('❌ Notarization failed:', error.message);
    console.error('   Please check your credentials and try again.');
    throw error;
  }
}
