import { NextRequest, NextResponse } from 'next/server';
import { getConversations, createOrUpdateConversation, createSession, addMessage } from '@/lib/db';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/conversations - 获取所有总结
export async function GET() {
  try {
    const conversations = getConversations();
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('[conversations] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch conversations' },
      { status: 500 }
    );
  }
}

// POST /api/conversations - 创建或更新总结
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, name, description, content, tags, raw_messages, source, working_directory } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: 'name and content are required' },
        { status: 400 }
      );
    }

    let finalSessionId = session_id;

    // ✅ 如果没有提供 session_id（从 Hub 安装时），创建一个真实的聊天会话
    if (!finalSessionId) {
      const newSession = createSession(
        name,
        '', // model - 空字符串
        '', // system_prompt - 空字符串
        working_directory || '', // working_directory
        'code' // mode
      );
      finalSessionId = newSession.id;

      // ✅ 如果有原始消息，导入到 messages 表
      if (raw_messages) {
        try {
          const messages = JSON.parse(raw_messages);
          if (Array.isArray(messages)) {
            for (const msg of messages) {
              if (msg.role && msg.content) {
                addMessage(finalSessionId, msg.role, msg.content);
              }
            }
          }
        } catch (parseError) {
          console.error('[conversations] Failed to parse raw_messages:', parseError);
        }
      }
    }

    const conversation = createOrUpdateConversation({
      id: nanoid(),
      session_id: finalSessionId,
      name,
      description: description || '',
      content,
      tags: tags || [],
      raw_messages: raw_messages || null,
      source: source || 'local',
    });

    return NextResponse.json({ conversation, session_id: finalSessionId }, { status: 201 });
  } catch (error) {
    console.error('[conversations] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create conversation' },
      { status: 500 }
    );
  }
}
