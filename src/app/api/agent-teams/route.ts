import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
}

interface TeamTask {
  id: string;
  subject: string;
  description: string;
  status: string;
  owner?: string;
  blockedBy?: string[];
}

interface TeamInfo {
  name: string;
  description: string;
  members: TeamMember[];
  tasks: TeamTask[];
}

/**
 * 读取 ~/.claude/teams/ 目录下的所有团队配置
 */
function getTeams(): TeamInfo[] {
  const teamsDir = path.join(os.homedir(), '.claude', 'teams');

  if (!fs.existsSync(teamsDir)) {
    return [];
  }

  const teams: TeamInfo[] = [];

  try {
    const teamDirs = fs.readdirSync(teamsDir);

    for (const teamName of teamDirs) {
      const teamPath = path.join(teamsDir, teamName);
      const configPath = path.join(teamPath, 'config.json');

      // 跳过非目录项
      if (!fs.statSync(teamPath).isDirectory()) continue;

      // 跳过没有 config.json 的目录
      if (!fs.existsSync(configPath)) continue;

      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        // 读取团队的任务列表
        const tasksDir = path.join(os.homedir(), '.claude', 'tasks', teamName);
        const tasks: TeamTask[] = [];

        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));

          for (const taskFile of taskFiles) {
            try {
              const taskContent = fs.readFileSync(path.join(tasksDir, taskFile), 'utf-8');
              const task = JSON.parse(taskContent);
              tasks.push({
                id: task.id || taskFile.replace('.json', ''),
                subject: task.subject || '',
                description: task.description || '',
                status: task.status || 'pending',
                owner: task.owner,
                blockedBy: task.blockedBy || [],
              });
            } catch {
              // 跳过损坏的任务文件
            }
          }
        }

        teams.push({
          name: config.name || teamName,
          description: config.description || '',
          members: config.members || [],
          tasks,
        });
      } catch (err) {
        console.error(`[agent-teams] Failed to read team ${teamName}:`, err);
      }
    }
  } catch (err) {
    console.error('[agent-teams] Failed to read teams directory:', err);
  }

  return teams;
}

export async function GET(request: NextRequest) {
  try {
    const teams = getTeams();

    return NextResponse.json({ teams }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get teams';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
