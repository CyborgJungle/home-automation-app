import { createBrowserClient } from "@supabase/ssr";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseKey);
}

export type Device = {
  id: string;
  integration: "tradfri" | "evohome" | "eufy";
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
