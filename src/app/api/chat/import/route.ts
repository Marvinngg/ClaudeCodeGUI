
import { NextRequest, NextResponse } from 'next/server';
import { createSession, addMessage } from '@/lib/db';
import { nanoid } from 'nanoid';

export async function POST(req: NextRequest) {
  try {
    const { title, content, description } = await req.json();

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    let messages = [];
    try {
      messages = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON content' }, { status: 400 });
    }

    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: 'Content must be an array of messages' }, { status: 400 });
    }

    // Create a new session
    const session = createSession(title || 'Imported Conversation');

    // Add messages to the session
    for (const msg of messages) {
      if (msg.role && msg.content) {
        addMessage(session.id, msg.role, msg.content, msg.token_usage);
      }
    }

    return NextResponse.json({ success: true, sessionId: session.id });
  } catch (error) {
    console.error('Error importing conversation:', error);
    return NextResponse.json({ error: 'Failed to import conversation' }, { status: 500 });
  }
}
