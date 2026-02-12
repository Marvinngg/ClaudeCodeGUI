import { NextResponse } from 'next/server';
import { reinitializeHub } from '@/lib/init';

/**
 * POST /api/hub/reinitialize
 * Reinitialize Hub client with updated settings
 */
export async function POST() {
  try {
    await reinitializeHub();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reinitialize Hub',
      },
      { status: 500 }
    );
  }
}
