/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * lib/member-cache.ts
 *
 * Client-side cache singleton for Iron Ledger.
 *
 * Priorities:
 *   - members  → ALL rows cached (critical for instant scanner lookups)
 *   - trainers → ALL rows cached (tiny table)
 *   - attendance_logs → last 50 only (display), on-demand for charts
 *   - ledger_entries → NOT cached (always fetched with date filters)
 *
 * Two device roles:
 *   HOST  (bridge detected)  → processes scans from cache, pushes to Supabase
 *   VIEWER (no bridge)       → reads from cache, receives Realtime updates
 */

import { supabase, isDummy, dbService, simulatedMembers, simulatedTrainers, simulatedLogs } from "./supabase";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CachedMember = {
  id: string;
  serial_number?: string | null;
  name: string;
  phone?: string | null;
  gender?: string | null;
  trainer_name?: string | null;
  gym_fees?: number;
  admission_fee?: number;
  trainer_fees?: number;
  amount_paid?: number;
  package_type?: string;
  trainer_package_type?: string;
  has_cardio?: boolean;
  trainer_commission?: number;
  package_start_date?: string | null;
  payment_date?: string | null;
  payment_status?: string | null;
  fingerprint_template?: string | null;
  zk_id?: string | null;
  last_visit?: string | null;
  is_premium?: boolean;
  created_at?: string;
  photo_url?: string | null;
  [key: string]: any;
};

export type CachedTrainer = {
  id: string;
  name: string;
  phone?: string;
  hire_date?: string;
  [key: string]: any;
};

export type CachedAttendanceLog = {
  id: string;
  member_id?: string | null;
  status: "granted" | "denied";
  notes?: string;
  timestamp: string;
  members?: { name?: string | null; phone?: string | null; photo_url?: string | null } | null;
  [key: string]: any;
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** Full refresh interval — safety net. Realtime handles most updates. */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** How many recent attendance logs to keep in memory as a buffer. */
const MAX_CACHED_LOGS = 1000;

const LOG_PREFIX = "[MemberCache]";

// ─── Internal State ──────────────────────────────────────────────────────────

let members: Map<string, CachedMember> = new Map();
let trainers: Map<string, CachedTrainer> = new Map();

/** zk_id OR fingerprint_template → member.id for instant scanner lookups */
let scannerIndex: Map<string, string> = new Map();
let numericScannerIndex: Map<number, string> = new Map();

let recentLogs: CachedAttendanceLog[] = [];

let lastFullSync = 0;
let version = 0;
let initialized = false;
let initializing: Promise<void> | null = null;

/** Listeners for React's useSyncExternalStore */
const listeners = new Set<() => void>();

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

// ─── Notify ──────────────────────────────────────────────────────────────────

function bump() {
  version++;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function rebuildScannerIndex() {
  scannerIndex.clear();
  numericScannerIndex.clear();

  members.forEach((m, id) => {
    // 1. Index zk_id (hardware device user ID)
    const zkStr = m.zk_id != null ? String(m.zk_id).trim() : "";
    if (zkStr) {
      if (!scannerIndex.has(zkStr)) {
        scannerIndex.set(zkStr, id);
      }
      if (/^\d+$/.test(zkStr)) {
        const num = Number.parseInt(zkStr, 10);
        if (!numericScannerIndex.has(num)) {
          numericScannerIndex.set(num, id);
        }
      }
    }

    // 2. Index fingerprint_template (biometric template identifier)
    const fpStr = m.fingerprint_template != null ? String(m.fingerprint_template).trim() : "";
    if (fpStr) {
      if (!scannerIndex.has(fpStr)) {
        scannerIndex.set(fpStr, id);
      }
      if (/^\d+$/.test(fpStr)) {
        const num = Number.parseInt(fpStr, 10);
        if (!numericScannerIndex.has(num)) {
          numericScannerIndex.set(num, id);
        }
      }
    }
  });
}

// ─── Supabase Loaders ────────────────────────────────────────────────────────

async function loadMembers() {
  if (isDummy) {
    members.clear();
    simulatedMembers.forEach((m: any) => members.set(m.id, m as CachedMember));
    rebuildScannerIndex();
    console.log(`${LOG_PREFIX} loaded ${members.size} members (dummy mode)`);
    return;
  }
  const { data, error } = await supabase.from("members").select("*");
  if (error) {
    console.error(`${LOG_PREFIX} failed to load members`, error);
    return;
  }
  members.clear();
  (data || []).forEach((m: any) => members.set(m.id, m as CachedMember));
  rebuildScannerIndex();
  console.log(`${LOG_PREFIX} loaded ${members.size} members`);
}

async function loadTrainers() {
  if (isDummy) {
    trainers.clear();
    simulatedTrainers.forEach((t: any) => trainers.set(t.id, t as CachedTrainer));
    console.log(`${LOG_PREFIX} loaded ${trainers.size} trainers (dummy mode)`);
    return;
  }
  const { data, error } = await supabase.from("trainers").select("*");
  if (error) {
    console.error(`${LOG_PREFIX} failed to load trainers`, error);
    return;
  }
  trainers.clear();
  (data || []).forEach((t: any) => trainers.set(t.id, t as CachedTrainer));
  console.log(`${LOG_PREFIX} loaded ${trainers.size} trainers`);
}

async function loadRecentLogs() {
  if (isDummy) {
    recentLogs = simulatedLogs.map(log => {
      if (!log.members?.name && log.member_id) {
        const m = members.get(log.member_id);
        if (m) {
          return { ...log, members: { name: m.name, phone: m.phone, photo_url: m.photo_url } };
        }
      }
      return log;
    }).reverse().slice(0, MAX_CACHED_LOGS);
    console.log(`${LOG_PREFIX} loaded ${recentLogs.length} logs (dummy mode)`);
    return;
  }
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from("attendance_logs")
    .select("*, members(name, phone, photo_url)")
    .gte("timestamp", twentyFourHoursAgo)
    .order("timestamp", { ascending: false })
    .limit(MAX_CACHED_LOGS);

  if (error) {
    console.error(`${LOG_PREFIX} failed to load recent logs`, error);
    return;
  }
  const raw = (data || []) as CachedAttendanceLog[];
  // Enrich logs whose PostgREST join didn't return member data
  recentLogs = raw.map(log => {
    if (!log.members?.name && log.member_id) {
      const m = members.get(log.member_id);
      if (m) {
        return { ...log, members: { name: m.name, phone: m.phone, photo_url: m.photo_url } };
      }
    }
    return log;
  });
  console.log(`${LOG_PREFIX} loaded ${recentLogs.length} logs from the last 24 hours`);
}

// ─── Realtime Subscription ──────────────────────────────────────────────────

function setupRealtime() {
  if (isDummy || realtimeChannel) return;

  realtimeChannel = supabase
    .channel("iron_ledger_cache_sync")
    // Members: any change
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "members" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as any)?.id;
          if (oldId) {
            members.delete(oldId);
            rebuildScannerIndex();
            console.log(`${LOG_PREFIX} realtime: member deleted`, oldId);
          }
        } else {
          const row = payload.new as CachedMember;
          if (row?.id) {
            const existing = members.get(row.id);
            const merged = existing ? { ...existing, ...row } : row;
            members.set(row.id, merged);
            rebuildScannerIndex();
            console.log(
              `${LOG_PREFIX} realtime: member ${payload.eventType}`,
              merged.name
            );
          }
        }
        bump();
      }
    )
    // Trainers: any change
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "trainers" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as any)?.id;
          if (oldId) trainers.delete(oldId);
        } else {
          const row = payload.new as CachedTrainer;
          if (row?.id) {
            const existing = trainers.get(row.id);
            const merged = existing ? { ...existing, ...row } : row;
            trainers.set(row.id, merged);
          }
        }
        bump();
      }
    )
    // Attendance logs: inserts only (append-only table)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "attendance_logs" },
      (payload) => {
        const row = payload.new as CachedAttendanceLog;
        if (!row?.id) return;

        // Skip if we already have this log (host pushed it locally)
        if (recentLogs.some((l) => l.id === row.id)) return;

        // Enrich with member data from cache if available
        if (row.member_id) {
          const m = members.get(row.member_id);
          if (m) {
            row.members = {
              name: m.name,
              phone: m.phone,
              photo_url: m.photo_url,
            };
          }
        }

        recentLogs.unshift(row);
        if (recentLogs.length > MAX_CACHED_LOGS) recentLogs.pop();
        console.log(`${LOG_PREFIX} realtime: new attendance log`, row.id);
        bump();
      }
    )
    .subscribe((status) => {
      console.log(`${LOG_PREFIX} realtime subscription:`, status);
    });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const memberCache = {
  // ── Initialization ──────────────────────────────────────────────────────

  /**
   * Must be called once before any reads.
   * Safe to call multiple times (deduplicates).
   */
  async initialize(): Promise<void> {
    if (isDummy) {
      // Load in-memory defaults for dummy mode (no persistence)
      // so edits persist across refreshes even without Supabase
      await dbService.loadSettingsAndPackages();
      initialized = true;
      return;
    }

    if (initialized) return;
    if (initializing) return initializing;

    initializing = (async () => {
      console.log(`${LOG_PREFIX} initializing cache...`);
      const start = Date.now();

      // Load members + settings in parallel first (logs enrichment needs the members Map)
      await Promise.all([loadMembers(), loadTrainers(), dbService.loadSettingsAndPackages()]);
      // Load logs second so enrichment can look up member names from the populated Map
      await loadRecentLogs();

      lastFullSync = Date.now();
      initialized = true;
      initializing = null;
      bump();

      setupRealtime();

      console.log(
        `${LOG_PREFIX} cache ready in ${Date.now() - start}ms ` +
          `(${members.size} members, ${trainers.size} trainers, ${recentLogs.length} logs)`
      );
    })();

    return initializing;
  },

  /** Whether the cache has completed its initial load. */
  isReady(): boolean {
    return isDummy || initialized;
  },

  // ── Reads (instant, zero-network) ───────────────────────────────────────

  getAllMembers(): CachedMember[] {
    return Array.from(members.values());
  },

  getMemberById(id: string): CachedMember | null {
    return members.get(id) ?? null;
  },

  /**
   * Instant scanner lookup: checks zk_id first, then fingerprint_template.
   * Excludes serial_number (which is member admission serial number, not a scanner ID).
   * This is the hot path — must be O(1).
   */
  getMemberByScannerId(identifier: string): CachedMember | null {
    if (!identifier) return null;
    const str = String(identifier).trim();
    if (!str) return null;

    // Priority 1: Exact string match on zk_id or fingerprint_template (O(1))
    const exactId = scannerIndex.get(str);
    if (exactId) {
      const found = members.get(exactId);
      if (found) return found;
    }

    // Priority 2: Numeric equivalence match (e.g. "5" vs "005" vs "0005") (O(1))
    if (/^\d+$/.test(str)) {
      const num = Number.parseInt(str, 10);
      const numId = numericScannerIndex.get(num);
      if (numId) {
        const found = members.get(numId);
        if (found) return found;
      }
    }

    return null;
  },

  getAllTrainers(): CachedTrainer[] {
    return Array.from(trainers.values());
  },

  getTrainerById(id: string): CachedTrainer | null {
    return trainers.get(id) ?? null;
  },

  getRecentLogs(limit: number = 10): CachedAttendanceLog[] {
    return recentLogs.slice(0, limit);
  },

  getMemberCount(): number {
    return members.size;
  },

  getTrainerCount(): number {
    return trainers.size;
  },

  // ── Cache Mutations (update local state) ────────────────────────────────

  /**
   * Insert or update a member in the cache.
   * Does NOT touch Supabase — caller is responsible for that.
   */
  upsertMember(member: Partial<CachedMember> & { id: string }) {
    const existing = members.get(member.id);
    const merged = existing
      ? { ...existing, ...member }
      : (member as CachedMember);
    members.set(member.id, merged);
    rebuildScannerIndex();
    bump();
  },

  /**
   * Remove a member from the cache.
   */
  removeMember(id: string) {
    members.delete(id);
    rebuildScannerIndex();
    bump();
  },

  /**
   * Insert or update a trainer in the cache.
   */
  upsertTrainer(trainer: Partial<CachedTrainer> & { id: string }) {
    const existing = trainers.get(trainer.id);
    const merged = existing
      ? { ...existing, ...trainer }
      : (trainer as CachedTrainer);
    trainers.set(trainer.id, merged);
    bump();
  },

  /**
   * Remove a trainer from the cache.
   */
  removeTrainer(id: string) {
    trainers.delete(id);
    bump();
  },

  /**
   * Prepend an attendance log to the recent list.
   * Deduplicates by id.
   */
  appendLog(log: CachedAttendanceLog) {
    // Skip duplicates
    if (recentLogs.some((l) => l.id === log.id)) return;

    // Enrich with member data from cache
    if (log.member_id && !log.members) {
      const m = members.get(log.member_id);
      if (m) {
        log.members = {
          name: m.name,
          phone: m.phone,
          photo_url: m.photo_url,
        };
      }
    }

    recentLogs.unshift(log);
    if (recentLogs.length > MAX_CACHED_LOGS) recentLogs.pop();
    bump();
  },

  // ── Refresh Controls ────────────────────────────────────────────────────

  /** True if cache is older than CACHE_TTL_MS. */
  needsRefresh(): boolean {
    if (!initialized) return true;
    return Date.now() - lastFullSync > CACHE_TTL_MS;
  },

  /** Re-fetch everything from Supabase. Call sparingly. */
  async forceRefresh(): Promise<void> {
    if (isDummy) return;

    console.log(`${LOG_PREFIX} force-refreshing cache...`);
    await Promise.all([loadMembers(), loadTrainers()]);
    await loadRecentLogs();
    lastFullSync = Date.now();
    bump();
  },

  // ── React Integration (useSyncExternalStore pattern) ────────────────────

  /**
   * Subscribe to cache changes. Returns an unsubscribe function.
   * Compatible with React's useSyncExternalStore.
   */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Returns a monotonically increasing version number.
   * Changes whenever cache state is mutated.
   */
  getVersion(): number {
    return version;
  },

  /**
   * Snapshot getter for useSyncExternalStore.
   * Returns the version — React will re-render when it changes.
   */
  getSnapshot(): number {
    return version;
  },

  // ── Cleanup ─────────────────────────────────────────────────────────────

  /**
   * Tear down Realtime subscription and clear state.
   * Usually only needed in tests or hot-reload scenarios.
   */
  destroy() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    members.clear();
    trainers.clear();
    scannerIndex.clear();
    numericScannerIndex.clear();
    recentLogs = [];
    initialized = false;
    initializing = null;
    lastFullSync = 0;
    version = 0;
    listeners.clear();
  },
};
