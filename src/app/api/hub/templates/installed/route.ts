import { NextResponse } from 'next/server';
import { getCachedTemplates } from '@/lib/db';

/**
 * GET /api/hub/templates/installed
 * Get all installed templates from local cache
 */
export async function GET() {
  try {
    const installed = getCachedTemplates();
    return NextResponse.json(installed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch installed templates' },
      { status: 500 }
    );
  }
}
