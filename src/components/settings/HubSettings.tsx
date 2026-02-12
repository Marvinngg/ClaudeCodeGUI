"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  FloppyDiskIcon,
  Wifi01Icon,
  WifiDisconnected01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
// Hub reinitialization is now handled via API route

interface HubSettingsData {
  hub_url: string;
  hub_user_id: string;
  hub_sync_interval: string; // seconds as string
}

interface HealthStatus {
  connected: boolean;
  version?: string;
  checking: boolean;
}

interface SyncStatus {
  lastSyncTime: Date | null;
  syncing: boolean;
  error: string | null;
}

export function HubSettings() {
  const [settings, setSettings] = useState<HubSettingsData>({
    hub_url: "",
    hub_user_id: "",
    hub_sync_interval: "300",
  });
  const [originalSettings, setOriginalSettings] = useState<HubSettingsData>({
    hub_url: "",
    hub_user_id: "",
    hub_sync_interval: "300",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [health, setHealth] = useState<HealthStatus>({
    connected: false,
    checking: false,
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSyncTime: null,
    syncing: false,
    error: null,
  });

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        const s = data.settings || {};
        const loaded: HubSettingsData = {
          hub_url: s.hub_url || "",
          hub_user_id: s.hub_user_id || "",
          hub_sync_interval: s.hub_sync_interval || "300",
        };
        setSettings(loaded);
        setOriginalSettings(loaded);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const hasChanges =
    JSON.stringify(settings) !== JSON.stringify(originalSettings);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            hub_url: settings.hub_url,
            hub_user_id: settings.hub_user_id,
            hub_sync_interval: settings.hub_sync_interval,
          },
        }),
      });
      if (res.ok) {
        setOriginalSettings({ ...settings });
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);

        // Immediately apply new Hub configuration via API
        await fetch('/api/hub/reinitialize', { method: 'POST' });

        // Trigger an immediate sync if Hub is configured
        if (settings.hub_url) {
          handleManualSync();
        }
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleManualSync = async () => {
    if (!settings.hub_url) return;

    setSyncStatus((prev) => ({ ...prev, syncing: true, error: null }));
    try {
      const res = await fetch('/api/hub/sync', {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success) {
        setSyncStatus({
          lastSyncTime: new Date(data.lastSyncTime),
          syncing: false,
          error: null,
        });
        // Update health status
        setHealth((prev) => ({ ...prev, connected: true }));
      } else {
        setSyncStatus({
          lastSyncTime: null,
          syncing: false,
          error: data.error || "Sync failed - check Hub URL",
        });
        setHealth((prev) => ({ ...prev, connected: false }));
      }
    } catch (error) {
      setSyncStatus({
        lastSyncTime: null,
        syncing: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const checkConnection = useCallback(async () => {
    if (!settings.hub_url) return;
    setHealth((prev) => ({ ...prev, checking: true }));
    try {
      const res = await fetch(
        `${settings.hub_url.replace(/\/+$/, "")}/api/health`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json();
        setHealth({
          connected: true,
          version: data.version,
          checking: false,
        });
      } else {
        setHealth({ connected: false, checking: false });
      }
    } catch {
      setHealth({ connected: false, checking: false });
    }
  }, [settings.hub_url]);

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">CodePilot Hub</h3>
          {health.connected ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-green-600 dark:text-green-400 border-green-500/30"
            >
              <HugeiconsIcon
                icon={Wifi01Icon}
                className="h-2.5 w-2.5 mr-0.5"
              />
              Connected{health.version ? ` v${health.version}` : ""}
            </Badge>
          ) : settings.hub_url ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground border-border"
            >
              <HugeiconsIcon
                icon={WifiDisconnected01Icon}
                className="h-2.5 w-2.5 mr-0.5"
              />
              Disconnected
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect to a CodePilot Hub for shared API providers, MCP configs, and
          usage tracking across your team.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <HugeiconsIcon
            icon={Loading02Icon}
            className="h-4 w-4 animate-spin"
          />
          <p className="text-sm">Loading Hub settings...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Hub URL */}
          <div className="space-y-1.5">
            <Label htmlFor="hub-url" className="text-xs">
              Hub URL
            </Label>
            <div className="flex gap-2">
              <Input
                id="hub-url"
                value={settings.hub_url}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, hub_url: e.target.value }))
                }
                placeholder="http://10.0.0.1:3100"
                className="text-sm font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={checkConnection}
                disabled={!settings.hub_url || health.checking}
                className="shrink-0"
              >
                {health.checking ? (
                  <HugeiconsIcon
                    icon={Loading02Icon}
                    className="h-3.5 w-3.5 animate-spin"
                  />
                ) : (
                  "Test"
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The HTTP address of your CodePilot Hub server on the headscale
              network.
            </p>
          </div>

          {/* User ID */}
          <div className="space-y-1.5">
            <Label htmlFor="hub-user-id" className="text-xs">
              User Identifier
            </Label>
            <Input
              id="hub-user-id"
              value={settings.hub_user_id}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  hub_user_id: e.target.value,
                }))
              }
              placeholder="alice"
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Your name or identifier for usage tracking. Shown in the Hub admin
              dashboard.
            </p>
          </div>

          {/* Sync Interval */}
          <div className="space-y-1.5">
            <Label htmlFor="hub-sync-interval" className="text-xs">
              Sync Interval (seconds)
            </Label>
            <Input
              id="hub-sync-interval"
              type="number"
              min="30"
              max="3600"
              value={settings.hub_sync_interval}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  hub_sync_interval: e.target.value,
                }))
              }
              className="text-sm w-32"
            />
            <p className="text-[11px] text-muted-foreground">
              How often to pull shared configuration from the Hub. Default: 300s
              (5 min).
            </p>
          </div>

          {/* Sync Status */}
          {settings.hub_url && (
            <div className="rounded-md bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium">Sync Status</p>
                  {syncStatus.lastSyncTime ? (
                    <p className="text-[11px] text-muted-foreground">
                      Last synced:{" "}
                      {syncStatus.lastSyncTime.toLocaleTimeString()}
                    </p>
                  ) : syncStatus.error ? (
                    <p className="text-[11px] text-destructive">
                      {syncStatus.error}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Not synced yet
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualSync}
                  disabled={syncStatus.syncing}
                  className="gap-1.5"
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    className={`h-3.5 w-3.5 ${
                      syncStatus.syncing ? "animate-spin" : ""
                    }`}
                  />
                  {syncStatus.syncing ? "Syncing..." : "Sync Now"}
                </Button>
              </div>
            </div>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="gap-2"
              size="sm"
            >
              {saving ? (
                <HugeiconsIcon
                  icon={Loading02Icon}
                  className="h-3.5 w-3.5 animate-spin"
                />
              ) : (
                <HugeiconsIcon
                  icon={FloppyDiskIcon}
                  className="h-3.5 w-3.5"
                />
              )}
              {saving ? "Saving..." : "Save Hub Settings"}
            </Button>
            {saveSuccess && (
              <span className="text-xs text-green-600 dark:text-green-400">
                Settings saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
