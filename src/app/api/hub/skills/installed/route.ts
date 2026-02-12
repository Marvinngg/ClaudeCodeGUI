import { NextResponse } from 'next/server';
import { getCachedSkills } from '@/lib/db';

/**
 * GET /api/hub/skills/installed
 * Get all installed skills from local cache
 */
export async function GET() {
  try {
    const installed = getCachedSkills();
    return NextResponse.json(installed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch installed skills' },
      { status: 500 }
    );
  }
}
