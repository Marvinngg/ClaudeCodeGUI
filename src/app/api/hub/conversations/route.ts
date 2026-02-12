import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { getSetting } from '@/lib/db';

async function ensureHubConfigured() {
    const hubUrl = getSetting('hub_url');
    if (!hubUrl) {
        throw new Error('Hub URL not configured');
    }

    // Update client config if needed (it might have been updated in settings)
    const userId = getSetting('hub_user_id') || 'anonymous';
    const syncInterval = parseInt(getSetting('hub_sync_interval') || '300', 10);

    hubClient.configure({
        url: hubUrl,
        userId,
        syncInterval
    });
}

export async function GET() {
    try {
        await ensureHubConfigured();
        const conversations = await hubClient.fetchConversations();
        return NextResponse.json(conversations);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch conversations' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        await ensureHubConfigured();
        const body = await request.json();

        // Validate required fields
        if (!body.title || !body.content) {
            return NextResponse.json(
                { error: 'Missing required fields: title and content' },
                { status: 400 }
            );
        }

        const conversation = await hubClient.publishConversation({
            title: body.title,
            content: typeof body.content === 'string' ? body.content : JSON.stringify(body.content),
            description: body.description,
            tags: body.tags,
            raw_messages: body.raw_messages || null, // ✅ 传递原始对话
        });

        return NextResponse.json(conversation);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to publish conversation' },
            { status: 500 }
        );
    }
}
