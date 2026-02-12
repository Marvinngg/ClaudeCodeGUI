import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { getSetting } from '@/lib/db';

/**
 * POST /api/hub/sync
 * Manually trigger Hub configuration sync
 */
export async function POST() {
  try {
    // Read Hub configuration from database
    const hubUrl = getSetting('hub_url');
    const hubUserId = getSetting('hub_user_id');
    const hubSyncInterval = getSetting('hub_sync_interval');

    if (!hubUrl) {
      return NextResponse.json(
        {
          success: false,
          error: 'Hub URL not configured',
        },
        { status: 400 }
      );
    }

    // Configure hubClient before syncing
    hubClient.configure({
      url: hubUrl,
      userId: hubUserId || 'anonymous',
      syncInterval: parseInt(hubSyncInterval || '300', 10),
    });

    const data = await hubClient.syncConfig();

    if (data) {
      return NextResponse.json({
        success: true,
        lastSyncTime: new Date().toISOString(),
        data,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Sync failed - check Hub URL and connection',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
