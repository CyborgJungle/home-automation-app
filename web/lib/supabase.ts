import { createBrowserClient } from "@supabase/ssr";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseKey);
}

export type Device = {
  id: string;
  integration: "tradfri" | "evohome" | "eufy" | "brel" | "bravia" | "sonos" | "apple";
  kind: string;
  name: string;
  room: string | null;
  online: boolean;
  state: Record<string, unknown>;
  updated_at: string;
};

export type Command = {
  id: number;
  device_id: string;
  action: string;
  params: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
  source: string; // "app" or "automation:<id>"
  created_at: string;
  completed_at: string | null;
};

export type HomeEvent = {
  id: number;
  device_id: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
};

export type AgentStatus = {
  version: string | null;
  started_at: string | null;
  last_seen: string | null;
};

export type IntegrationStatus = {
  name: Device["integration"];
  ok: boolean;
  error: string | null;
  updated_at: string;
};

export type AutomationTrigger =
  | { type: "time"; at: string; days: number[] }
  | { type: "device"; device_id: string; key: string; op: "eq" | "ne" | "lt" | "gt"; value: unknown; option?: string }
  | { type: "event"; event: string; device_id?: string };

export type AutomationAction = {
  device_id: string;
  action: string;
  params: Record<string, unknown>;
  // Set instead of a device action when an automation plays a scene.
  scene_id?: string;
  // Which builder choice made this action, so it can be edited again.
  option?: string;
  value?: number | null;
  // For options picked from a list, like an app or a Sonos favourite.
  choice?: string | null;
};

export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: unknown[];
  actions: AutomationAction[];
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export const SCENE_SHAPES = ["house", "flower", "circle", "star", "squircle", "cloud"] as const;
export type SceneShape = (typeof SCENE_SHAPES)[number];

export type SceneAction = Pick<AutomationAction, "device_id" | "action" | "params" | "option" | "value" | "choice">;

export type Scene = {
  id: string;
  name: string;
  tone: string;
  shape: SceneShape;
  actions: SceneAction[];
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};
