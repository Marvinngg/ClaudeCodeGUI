import { NextResponse } from 'next/server';
import { getCachedPrompts } from '@/lib/db';

/**
 * GET /api/hub/prompts/installed
 * Get all installed prompts from local cache
 */
export async function GET() {
  try {
    const installed = getCachedPrompts();
    return NextResponse.json(installed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch installed prompts' },
      { status: 500 }
    );
  }
}
