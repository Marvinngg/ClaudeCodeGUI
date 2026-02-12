/**
 * Application initialization logic
 * Handles Hub client configuration and sync on app startup
 */

import { hubClient } from './hub-client';

let initialized = false;

/**
 * Initialize Hub client from saved settings
 */
export async function initializeHub() {
  // Prevent duplicate initialization
  if (initialized) return;

  try {
    // Fetch saved Hub settings from SQLite
    const res = await fetch('/api/settings/app');
    if (!res.ok) return;

    const data = await res.json();
    const settings = data.settings || {};

    const hubUrl = settings.hub_url?.trim();
    const hubUserId = settings.hub_user_id?.trim();
    const hubSyncInterval = settings.hub_sync_interval?.trim();

    // Only initialize if Hub URL is configured
    if (!hubUrl) {
      console.log('[Hub] No Hub URL configured, skipping initialization');
      return;
    }

    // Configure Hub client
    hubClient.configure({
      url: hubUrl,
      userId: hubUserId || 'anonymous',
      syncInterval: parseInt(hubSyncInterval || '300', 10),
    });

    console.log('[Hub] Configured with URL:', hubUrl);

    // Start periodic sync
    hubClient.startSync((data) => {
      console.log('[Hub] Synced configuration from Hub:', {
        providers: data.providers.length,
        mcpServers: data.mcpServers.length,
        systemPrompts: data.systemPrompts.length,
      });
    });

    console.log('[Hub] Background sync started');
    initialized = true;
  } catch (error) {
    console.error('[Hub] Initialization failed:', error);
  }
}

/**
 * Reinitialize Hub client (call after settings change)
 */
export async function reinitializeHub() {
  // Stop existing sync
  hubClient.stopSync();
  initialized = false;

  // Reinitialize with new settings
  await initializeHub();
}
