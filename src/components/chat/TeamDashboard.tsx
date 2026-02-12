'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
}

interface TeamTask {
  id: string;
  subject: string;
  description?: string;
  status: string;
  owner?: string;
  blockedBy?: string[];
}

interface TeamInfo {
  name: string;
  description?: string;
  members: TeamMember[];
  tasks: TeamTask[];
  recentMessages: Array<{ from: string; summary: string; timestamp?: string }>;
}

interface TeamDashboardProps {
  isTeamsMode: boolean;
}

function getStatusIcon(state: string) {
  switch (state) {
    case 'active': return '●';
    case 'idle': return '◐';
    case 'stopped': return '○';
    default: return '●';
  }
}

function getStatusColor(state: string) {
  switch (state) {
    case 'active': return 'text-green-500';
    case 'idle': return 'text-yellow-500';
    case 'stopped': return 'text-zinc-400';
    default: return 'text-zinc-400';
  }
}

function getTaskStatusIcon(status: string) {
  switch (status) {
    case 'completed': return '✅';
    case 'in_progress': return '🔄';
    case 'pending': return '⏳';
    case 'deleted': return '🗑️';
    default: return '▣';
  }
}

function getTaskStatusStyle(status: string) {
  switch (status) {
    case 'completed': return 'text-green-500';
    case 'in_progress': return 'text-blue-500';
    case 'pending': return 'text-zinc-400';
    default: return 'text-zinc-400';
  }
}

export function TeamDashboard({ isTeamsMode }: TeamDashboardProps) {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  // Track previous team data to infer member status changes
  const prevTeamsRef = useRef<TeamInfo[]>([]);

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-teams');
      if (res.ok) {
        const data = await res.json();
        const newTeams = data.teams || [];
        prevTeamsRef.current = teams;
        setTeams(newTeams);
      }
    } catch {
      // silent — API may not exist yet or no teams directory
    }
  }, [teams]);

  // Poll for team state every 4 seconds while in teams mode
  // This is independent of the SSE stream lifecycle — it persists across
  // conversation switches and stream start/stop cycles.
  useEffect(() => {
    if (!isTeamsMode) {
      setTeams([]);
      return;
    }

    // Initial fetch
    fetchTeams();

    const interval = setInterval(fetchTeams, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeamsMode]);

  // Don't render if not in teams mode or no teams exist on disk
  if (!isTeamsMode || teams.length === 0) return null;

  const team = teams[0]; // Show the first/active team
  const completedTasks = team.tasks.filter(t => t.status === 'completed').length;
  const totalTasks = team.tasks.length;

  // Infer member status from task ownership:
  // - If a member owns an in_progress task → active
  // - If a member owns only completed/pending tasks → idle
  // - Otherwise → active (default for new members)
  const getMemberState = (member: TeamMember): string => {
    const ownedTasks = team.tasks.filter(t => t.owner === member.name);
    if (ownedTasks.length === 0) return 'active';
    const hasInProgress = ownedTasks.some(t => t.status === 'in_progress');
    if (hasInProgress) return 'active';
    const allCompleted = ownedTasks.every(t => t.status === 'completed');
    if (allCompleted) return 'idle';
    return 'active';
  };

  return (
    <div className={cn(
      "border-b border-orange-500/20 bg-orange-500/[0.03] transition-all",
      collapsed ? "" : "pb-1"
    )}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-orange-500/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-orange-500 text-sm">🟠</span>
          <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 truncate">
            Team: {team.name}
          </span>
          <span className="text-[10px] text-muted-foreground">
            [{team.members.length} agent{team.members.length !== 1 ? 's' : ''}]
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalTasks > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {completedTasks}/{totalTasks} tasks
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {collapsed ? '▸' : '▾'}
          </span>
        </div>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 pb-2 space-y-2">
          {/* Members */}
          <div className="space-y-0.5">
            {team.members.map((member) => {
              const state = getMemberState(member);
              return (
                <div
                  key={member.agentId || member.name}
                  className="flex items-center justify-between text-xs py-0.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn("text-[10px]", getStatusColor(state))}>
                      {getStatusIcon(state)}
                    </span>
                    <span className="font-mono text-foreground/80 truncate">
                      {member.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {state}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {member.agentType}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tasks */}
          {team.tasks.length > 0 && (
            <>
              <div className="h-px bg-border/30" />
              <div className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">
                  Tasks: {completedTasks}/{totalTasks} completed
                </div>
                {team.tasks.slice(0, 10).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 text-xs py-0.5"
                  >
                    <span className="text-[10px] shrink-0">
                      {getTaskStatusIcon(task.status)}
                    </span>
                    <span className={cn(
                      "truncate flex-1",
                      task.status === 'completed' ? "text-muted-foreground line-through" : "text-foreground/80"
                    )}>
                      #{task.id} {task.subject}
                    </span>
                    <span className={cn("text-[10px] shrink-0", getTaskStatusStyle(task.status))}>
                      {task.status}
                    </span>
                    {task.owner && (
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        @{task.owner}
                      </span>
                    )}
                  </div>
                ))}
                {team.tasks.length > 10 && (
                  <div className="text-[10px] text-muted-foreground/50 pl-5">
                    ... and {team.tasks.length - 10} more
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
