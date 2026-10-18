"use client";

// One live connection to Supabase shared by every tab: devices, commands,
// events, health and automations, kept current over realtime.

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createClient,
  type AgentStatus,
  type Automation,
  type Command,
  type Device,
  type FloorHeating,
  type HomeEvent,
  type IntegrationStatus,
  type Scene,
} from "@/lib/supabase";
import { isOpen } from "@/lib/devices";

// The agent writes a heartbeat every 30 s.
const AGENT_OFFLINE_AFTER_MS = 90_000;
const COMMAND_HISTORY = 40;

// Scenes in their dragged order; ones never placed go last, oldest first.
const byPosition = (a: Scene, b: Scene) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at);
const EVENT_HISTORY = 40;
const VERSION_CHECK_MS = 2 * 60_000;
// While a command is in flight, also ask for its status directly in case a
// realtime update got lost (e.g. the phone switched from Wi-Fi to 5G).
const COMMAND_POLL_MS = 2000;
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

type Toast = { id: number; text: string };

export type Home = {
  ready: boolean;
  member: boolean | null;
  userName: string | null;
  userEmail: string | null;
  devices: Device[];
  floor: FloorHeating | null;
  setFloor: (patch: Partial<Pick<FloorHeating, "enabled" | "target">>) => Promise<void>;
  commands: Command[];
  events: HomeEvent[];
  automations: Automation[];
  scenes: Scene[];
  agent: AgentStatus | null;
  agentOnline: boolean;
  statuses: IntegrationStatus[];
  toasts: Toast[];
  updateReady: boolean;
  send: (device: Device, action: string, params?: Record<string, unknown>) => Promise<void>;
  saveAutomation: (a: Partial<Automation> & Pick<Automation, "name" | "trigger" | "actions">) => Promise<string | null>;
  deleteAutomation: (id: string) => Promise<string | null>;
  setAutomationEnabled: (id: string, enabled: boolean) => Promise<void>;
  playScene: (scene: Scene) => Promise<void>;
  saveScene: (s: Partial<Scene> & Pick<Scene, "name" | "tone" | "shape" | "actions">) => Promise<string | null>;
  deleteScene: (id: string) => Promise<string | null>;
  reorderScenes: (ids: string[]) => Promise<void>;
  signOut: () => Promise<void>;
};

export const HomeContext = createContext<Home | null>(null);

export function useHome() {
  const home = useContext(HomeContext);
  if (!home) throw new Error("useHome must be used inside <HomeProvider>");
  return home;
}

const upsertById = <T extends { id: string | number }>(list: T[], row: T) => [
  row,
  ...list.filter((x) => x.id !== row.id),
];

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [member, setMember] = useState<boolean | null>(null);
  const [user, setUser] = useState<{ name: string | null; email: string | null }>({ name: null, email: null });
  const [rawDevices, setDevices] = useState<Device[]>([]);
  const [floor, setFloorState] = useState<FloorHeating | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [events, setEvents] = useState<HomeEvent[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [updateReady, setUpdateReady] = useState(false);
  const mine = useRef(new Set<number>()); // commands sent from this screen

  // The living-room zone carries the floor-heating thermostat in its state, and
  // the helper zone is marked, so tiles, sheets and the builders can show them.
  const devices = useMemo(
    () =>
      rawDevices.map((d) => {
        if (!floor) return d;
        if (d.id === floor.sensor_zone) {
          return { ...d, state: { ...d.state, floor: { enabled: floor.enabled, target: Number(floor.target), heating: floor.heating } } };
        }
        if (d.id === floor.helper_zone) return { ...d, state: { ...d.state, floor_helper: true } };
        return d;
      }),
    [rawDevices, floor],
  );


  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [{ data: isMember }, { data: auth }] = await Promise.all([
        supabase.rpc("am_i_member"),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      const meta = auth.user?.user_metadata ?? {};
      const fullName: string | undefined = meta.given_name ?? meta.full_name ?? meta.name;
      setUser({
        name: fullName?.split(" ")[0] ?? auth.user?.email?.split(/[@.+]/)[0] ?? null,
        email: auth.user?.email ?? null,
      });
      setMember(Boolean(isMember));
      if (!isMember) {
        setReady(true);
        return;
      }

      const [d, c, e, a, s, au, sc, fh] = await Promise.all([
        supabase.from("devices").select("*"),
        supabase.from("commands").select("*").order("id", { ascending: false }).limit(COMMAND_HISTORY),
        supabase.from("events").select("*").order("id", { ascending: false }).limit(EVENT_HISTORY),
        supabase.from("agent_status").select("*").maybeSingle(),
        supabase.from("integration_status").select("*"),
        supabase.from("automations").select("*").order("created_at"),
        supabase.from("scenes").select("*"),
        supabase.from("floor_heating").select("*").maybeSingle(),
      ]);
      if (cancelled) return;
      setDevices(d.data ?? []);
      setCommands(c.data ?? []);
      setEvents(e.data ?? []);
      setAgent(a.data);
      setStatuses(s.data ?? []);
      setAutomations(au.data ?? []);
      setScenes((sc.data ?? []).sort(byPosition));
      setFloorState(fh.data);
      setReady(true);
    }

    load();

    let subscribedBefore = false;
    const channel = supabase
      .channel("home")
      .on<Device>("postgres_changes", { event: "*", schema: "public", table: "devices" }, (p) => {
        if (p.eventType === "DELETE") setDevices((list) => list.filter((x) => x.id !== (p.old as Device).id));
        else setDevices((list) => upsertById(list, p.new));
      })
      .on<Command>("postgres_changes", { event: "*", schema: "public", table: "commands" }, (p) => {
        if (p.eventType === "DELETE") return;
        setCommands((list) => upsertById(list, p.new).sort((a, b) => b.id - a.id).slice(0, COMMAND_HISTORY));
      })
      .on<HomeEvent>("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, (p) => {
        setEvents((list) => [p.new, ...list].slice(0, EVENT_HISTORY));
      })
      .on<Automation>("postgres_changes", { event: "*", schema: "public", table: "automations" }, (p) => {
        if (p.eventType === "DELETE") setAutomations((list) => list.filter((x) => x.id !== (p.old as Automation).id));
        else setAutomations((list) => [...list.filter((x) => x.id !== p.new.id), p.new].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      })
      .on<FloorHeating>("postgres_changes", { event: "UPDATE", schema: "public", table: "floor_heating" }, (p) => {
        setFloorState(p.new);
      })
      .on<Scene>("postgres_changes", { event: "*", schema: "public", table: "scenes" }, (p) => {
        if (p.eventType === "DELETE") setScenes((list) => list.filter((x) => x.id !== (p.old as Scene).id));
        else setScenes((list) => [...list.filter((x) => x.id !== p.new.id), p.new].sort(byPosition));
      })
      .on<AgentStatus>("postgres_changes", { event: "*", schema: "public", table: "agent_status" }, (p) => {
        if (p.eventType !== "DELETE") setAgent(p.new);
      })
      .on<IntegrationStatus>("postgres_changes", { event: "*", schema: "public", table: "integration_status" }, (p) => {
        if (p.eventType === "DELETE") return;
        setStatuses((list) => [...list.filter((x) => x.name !== p.new.name), p.new]);
      })
      .subscribe((status) => {
        // Updates sent while the connection was down are lost, so reload
        // everything whenever it (re)connects after the first time.
        if (status === "SUBSCRIBED") {
          if (subscribedBefore) load();
          subscribedBefore = true;
        }
      });

    const tick = setInterval(() => setNow(Date.now()), 10_000);

    // iOS keeps home-screen apps frozen in the background, and phones hop
    // between networks: catch up when the app or the network comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", load);

    return () => {
      cancelled = true;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", load);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const openIds = commands
    .filter(isOpen)
    .map((c) => c.id)
    .join(",");
  useEffect(() => {
    if (!openIds) return;
    const ids = openIds.split(",").map(Number);
    const timer = setInterval(async () => {
      const { data } = await supabase.from("commands").select("*").in("id", ids);
      if (data?.length) {
        setCommands((list) => list.map((c) => data.find((x) => x.id === c.id) ?? c));
      }
    }, COMMAND_POLL_MS);
    return () => clearInterval(timer);
  }, [openIds, supabase]);

  // Tell the user when one of their taps failed.
  useEffect(() => {
    for (const c of commands) {
      if (c.status === "failed" && mine.current.delete(c.id)) {
        const device = devices.find((d) => d.id === c.device_id);
        toast(`${device?.name ?? "Device"}: ${c.error ?? "didn't respond"}`);
      } else if (c.status === "done") {
        mine.current.delete(c.id);
      }
    }
  }, [commands, devices, toast]);

  // New deploy on Vercel → reload when the app comes back to the foreground,
  // or offer a reload while it's open.
  useEffect(() => {
    if (BUILD_ID === "dev") return;
    let stale = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { version } = await res.json();
        stale = Boolean(version) && version !== BUILD_ID;
        setUpdateReady(stale);
      } catch {
        // offline; try again later
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "hidden" && stale) window.location.reload();
      if (document.visibilityState === "visible") check();
    };

    check();
    const timer = setInterval(check, VERSION_CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const send = useCallback(
    async (device: Device, action: string, params: Record<string, unknown> = {}) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("commands")
        .insert({ device_id: device.id, action, params, created_by: auth.user?.id })
        .select()
        .single();
      if (error) {
        toast(`Couldn't send: ${error.message}`);
        return;
      }
      mine.current.add(data.id);
      // Show it straight away; realtime confirms it a moment later.
      setCommands((list) => upsertById(list, data as Command).sort((a, b) => b.id - a.id));
    },
    [supabase, toast],
  );

  const saveAutomation = useCallback<Home["saveAutomation"]>(
    async (a) => {
      const row = { name: a.name.trim(), trigger: a.trigger, actions: a.actions, conditions: a.conditions ?? [], enabled: a.enabled ?? true };
      const { data, error } = a.id
        ? await supabase.from("automations").update(row).eq("id", a.id).select().single()
        : await supabase.from("automations").insert(row).select().single();
      if (error) return error.message;
      setAutomations((list) => [...list.filter((x) => x.id !== data.id), data].sort((x, y) => x.created_at.localeCompare(y.created_at)));
      return null;
    },
    [supabase],
  );

  const deleteAutomation = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("automations").delete().eq("id", id);
      if (error) return error.message;
      setAutomations((list) => list.filter((x) => x.id !== id));
      return null;
    },
    [supabase],
  );

  const setAutomationEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setAutomations((list) => list.map((x) => (x.id === id ? { ...x, enabled } : x)));
      const { error } = await supabase.from("automations").update({ enabled }).eq("id", id);
      if (error) {
        toast(`Couldn't save: ${error.message}`);
        setAutomations((list) => list.map((x) => (x.id === id ? { ...x, enabled: !enabled } : x)));
      }
    },
    [supabase, toast],
  );

  // Supabase queues the scene's commands; they show up here over realtime.
  const playScene = useCallback(
    async (scene: Scene) => {
      const { error } = await supabase.rpc("play_scene", { scene_id: scene.id });
      if (error) {
        toast(`Couldn't play ${scene.name}: ${error.message}`);
        return;
      }
      const { data } = await supabase
        .from("commands")
        .select("*")
        .eq("source", `scene:${scene.id}`)
        .order("id", { ascending: false })
        .limit(scene.actions.length || 1);
      if (data?.length) {
        setCommands((list) => {
          let next = list;
          for (const c of data) next = upsertById(next, c);
          return next.sort((a, b) => b.id - a.id).slice(0, COMMAND_HISTORY);
        });
      }
    },
    [supabase, toast],
  );

  const saveScene = useCallback<Home["saveScene"]>(
    async (s) => {
      const row = { name: s.name.trim(), tone: s.tone, shape: s.shape, actions: s.actions, kind: s.kind ?? "custom" };
      const { data, error } = s.id
        ? await supabase.from("scenes").update(row).eq("id", s.id).select().single()
        : await supabase.from("scenes").insert(row).select().single();
      if (error) return error.message;
      setScenes((list) => [...list.filter((x) => x.id !== data.id), data].sort(byPosition));
      return null;
    },
    [supabase],
  );

  const deleteScene = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("scenes").delete().eq("id", id);
      if (error) return error.message;
      setScenes((list) => list.filter((x) => x.id !== id));
      return null;
    },
    [supabase],
  );

  const reorderScenes = useCallback(
    async (ids: string[]) => {
      // Show the new order right away; the database confirms it.
      setScenes((list) => list.map((x) => ({ ...x, position: ids.indexOf(x.id) })).sort(byPosition));
      const { error } = await supabase.rpc("reorder_scenes", { ids });
      if (error) toast(`Couldn't save the order: ${error.message}`);
    },
    [supabase, toast],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [supabase, router]);

  const setFloor = useCallback<Home["setFloor"]>(
    async (patch) => {
      setFloorState((f) => (f ? { ...f, ...patch } : f));
      const { data, error } = await supabase.from("floor_heating").update(patch).eq("id", 1).select().single();
      if (error) toast(`Couldn't change the floor heating: ${error.message}`);
      else setFloorState(data);
    },
    [supabase, toast],
  );

  const agentOnline = agent?.last_seen != null && now - Date.parse(agent.last_seen) < AGENT_OFFLINE_AFTER_MS;

  const value: Home = {
    ready,
    member,
    userName: user.name,
    userEmail: user.email,
    devices,
    floor,
    setFloor,
    commands,
    events,
    automations,
    scenes,
    agent,
    agentOnline,
    statuses,
    toasts,
    updateReady,
    send,
    saveAutomation,
    deleteAutomation,
    setAutomationEnabled,
    playScene,
    saveScene,
    deleteScene,
    reorderScenes,
    signOut,
  };

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>;
}
