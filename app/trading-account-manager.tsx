"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Download,
  ImagePlus,
  LogOut,
  Mail,
  Maximize2,
  NotebookPen,
  Plus,
  RotateCcw,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

type AccountStage = "EVAL" | "FUNDED";
type CloudStatus = "LOCAL" | "CONNECTING" | "SYNCING" | "SYNCED" | "ERROR";

type TradingAccount = {
  id: string;
  cloudId?: string;
  firm: string;
  label: string;
  stage: AccountStage;
  startBalance: number;
  currentBalance: number;
  lossLimit: number;
  profitTarget: number;
  fundedBuffer: number;
  requiredTradingDays: number;
  cycle: number;
};

type JournalEntry = {
  pnl: number | null;
  notes: string;
  hasImage: boolean;
  imageCount?: number;
};

type TradeImageItem = {
  id: string;
  url: string;
  fileName: string;
  objectPath?: string;
  localKey?: string;
  attachmentId?: string;
  source: "LOCAL" | "CLOUD";
};

type JournalMap = Record<string, JournalEntry>;

type LocalSnapshot = {
  accounts: TradingAccount[];
  selectedId: string;
  journal: JournalMap;
};

type ParsedEntryKey = {
  clientId: string;
  cycle: number;
  stage: AccountStage;
  day: string;
  phaseKey: string;
};

export type TradingAccountView = TradingAccount & {
  tradingDays: number;
  totalPnl: number;
  remaining: number;
  targetBalance: number;
};

const ACCOUNTS_KEY = "jarvis-trading-accounts-v1";
const SELECTED_KEY = "jarvis-trading-selected-account-v1";
const JOURNAL_KEY = "jarvis-trading-journal-v1";
const IMAGE_DB = "jarvis-trading-journal-images-v1";
const IMAGE_STORE = "images";

const defaultAccount: TradingAccount = {
  id: "primary",
  firm: "Lucid Trading",
  label: "50K EVAL",
  stage: "EVAL",
  startBalance: 50000,
  currentBalance: 50000,
  lossLimit: 48000,
  profitTarget: 3000,
  fundedBuffer: 2000,
  requiredTradingDays: 150,
  cycle: 1,
};

function money(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pnlMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function phaseKey(account: TradingAccount) {
  return `${account.id}:cycle-${account.cycle}:${account.stage}`;
}

function entryKey(account: TradingAccount, day: string) {
  return `${phaseKey(account)}:${day}`;
}

function imageKey(account: TradingAccount, day: string) {
  return `${phaseKey(account)}:${day}:image`;
}

function imageItemKey(account: TradingAccount, day: string, id: string) {
  return `${imageKey(account, day)}:${id}`;
}

function parseEntryKey(key: string): ParsedEntryKey | null {
  const match = key.match(/^(.+):cycle-(\d+):(EVAL|FUNDED):(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return {
    clientId: match[1],
    cycle: Number(match[2]),
    stage: match[3] as AccountStage,
    day: match[4],
    phaseKey: `${match[1]}:cycle-${match[2]}:${match[3]}`,
  };
}

function parseNumber(value: string, fallback: number) {
  if (value.trim() === "") return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readLocalSnapshot(): LocalSnapshot {
  let accounts: TradingAccount[] = [defaultAccount];
  let selectedId = defaultAccount.id;
  let journal: JournalMap = {};

  try {
    const storedAccounts = window.localStorage.getItem(ACCOUNTS_KEY);
    const storedSelected = window.localStorage.getItem(SELECTED_KEY);
    const storedJournal = window.localStorage.getItem(JOURNAL_KEY);

    if (storedAccounts) {
      const parsed = JSON.parse(storedAccounts) as TradingAccount[];
      if (Array.isArray(parsed) && parsed.length) accounts = parsed;
    }
    if (storedSelected) selectedId = storedSelected;
    if (storedJournal) {
      const parsed = JSON.parse(storedJournal) as JournalMap;
      if (parsed && typeof parsed === "object") journal = parsed;
    }
  } catch {
    // Local cache is a fallback only. Cloud state becomes authoritative after sign-in.
  }

  if (!accounts.some((item) => item.id === selectedId)) selectedId = accounts[0]?.id ?? defaultAccount.id;
  return { accounts, selectedId, journal };
}

function openImageDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = window.indexedDB.open(IMAGE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) {
        request.result.createObjectStore(IMAGE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function putImage(key: string, blob: Blob) {
  const db = await openImageDb();
  if (!db) return false;

  return new Promise<boolean>((resolve) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).put(blob, key);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
  });
}

async function getImage(key: string) {
  const db = await openImageDb();
  if (!db) return null;

  return new Promise<Blob | null>((resolve) => {
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const request = tx.objectStore(IMAGE_STORE).get(key);
    request.onsuccess = () => {
      const result = request.result;
      db.close();
      resolve(result instanceof Blob ? result : null);
    };
    request.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}

async function listLocalImages(prefix: string) {
  const db = await openImageDb();
  if (!db) return [] as Array<{ key: string; blob: Blob }>;

  return new Promise<Array<{ key: string; blob: Blob }>>((resolve) => {
    const items: Array<{ key: string; blob: Blob }> = [];
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const request = tx.objectStore(IMAGE_STORE).openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if ((key === prefix || key.startsWith(`${prefix}:`)) && cursor.value instanceof Blob) {
        items.push({ key, blob: cursor.value });
      }
      cursor.continue();
    };

    tx.oncomplete = () => {
      db.close();
      resolve(items);
    };
    tx.onerror = () => {
      db.close();
      resolve([]);
    };
  });
}

async function removeImage(key: string) {
  const db = await openImageDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.82);
  });
}

function monthCells(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function makeAccount(index: number): TradingAccount {
  return {
    ...defaultAccount,
    id: `account-${Date.now()}-${index}`,
    label: `50K EVAL ${index}`,
  };
}

async function getPrimaryWorkspaceId(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("jarvis_workspaces")
    .select("id")
    .eq("slug", "primary")
    .maybeSingle();

  if (error) throw error;
  return typeof data?.id === "string" ? data.id : null;
}

async function loadCloudSnapshot(supabase: SupabaseClient, workspaceId: string): Promise<LocalSnapshot | null> {
  const [{ data: accountRows, error: accountError }, { data: cycleRows, error: cycleError }, { data: dayRows, error: dayError }, { data: settingRow, error: settingError }] = await Promise.all([
    supabase
      .from("trading_accounts")
      .select("id,client_id,firm,label,stage,start_balance,current_balance,loss_limit,profit_target,funded_buffer,required_trading_days,cycle_number,status")
      .eq("workspace_id", workspaceId)
      .neq("status", "ARCHIVED")
      .order("created_at", { ascending: true }),
    supabase
      .from("trading_account_cycles")
      .select("id,account_id,client_phase_key,cycle_number,stage")
      .eq("workspace_id", workspaceId),
    supabase
      .from("trading_days")
      .select("id,account_id,cycle_id,trade_date,realized_pnl,notes,screenshot_count,client_entry_key")
      .eq("workspace_id", workspaceId)
      .order("trade_date", { ascending: true }),
    supabase
      .from("jarvis_settings")
      .select("value")
      .eq("workspace_id", workspaceId)
      .eq("scope", "TRADING")
      .eq("key", "selected_account")
      .maybeSingle(),
  ]);

  if (accountError) throw accountError;
  if (cycleError) throw cycleError;
  if (dayError) throw dayError;
  if (settingError) throw settingError;
  if (!accountRows?.length) return null;

  const accounts: TradingAccount[] = accountRows.map((row) => ({
    id: String(row.client_id || row.id),
    cloudId: String(row.id),
    firm: String(row.firm ?? "Unknown Firm"),
    label: String(row.label ?? "Trading Account"),
    stage: row.stage === "FUNDED" ? "FUNDED" : "EVAL",
    startBalance: asNumber(row.start_balance),
    currentBalance: asNumber(row.current_balance),
    lossLimit: asNumber(row.loss_limit),
    profitTarget: asNumber(row.profit_target),
    fundedBuffer: asNumber(row.funded_buffer),
    requiredTradingDays: Math.max(0, Math.round(asNumber(row.required_trading_days))),
    cycle: Math.max(1, Math.round(asNumber(row.cycle_number, 1))),
  }));

  const accountClientId = new Map(accountRows.map((row) => [String(row.id), String(row.client_id || row.id)]));
  const cyclePhase = new Map(
    (cycleRows ?? []).map((row) => [
      String(row.id),
      String(row.client_phase_key || `${accountClientId.get(String(row.account_id))}:cycle-${row.cycle_number}:${row.stage}`),
    ]),
  );

  const journal: JournalMap = {};
  for (const row of dayRows ?? []) {
    const phase = row.cycle_id ? cyclePhase.get(String(row.cycle_id)) : null;
    const accountId = accountClientId.get(String(row.account_id));
    const key = row.client_entry_key || (phase && accountId ? `${phase}:${row.trade_date}` : null);
    if (!key) continue;
    journal[String(key)] = {
      pnl: row.realized_pnl == null ? null : asNumber(row.realized_pnl),
      notes: String(row.notes ?? ""),
      hasImage: asNumber(row.screenshot_count) > 0,
      imageCount: Math.max(0, Math.round(asNumber(row.screenshot_count))),
    };
  }

  const preferred = settingRow?.value && typeof settingRow.value === "object"
    ? String((settingRow.value as { clientId?: string }).clientId ?? "")
    : "";
  const selectedId = accounts.some((item) => item.id === preferred) ? preferred : accounts[0].id;

  return { accounts, selectedId, journal };
}

async function pushCloudSnapshot(
  supabase: SupabaseClient,
  workspaceId: string,
  accounts: TradingAccount[],
  journal: JournalMap,
  selectedId: string,
) {
  if (!accounts.length) return;

  const accountPayload = accounts.map((account) => ({
    workspace_id: workspaceId,
    client_id: account.id,
    firm: account.firm,
    label: account.label,
    stage: account.stage,
    status: "ACTIVE",
    start_balance: account.startBalance,
    current_balance: account.currentBalance,
    loss_limit: account.lossLimit,
    profit_target: account.profitTarget,
    funded_buffer: account.fundedBuffer,
    required_trading_days: account.requiredTradingDays,
    cycle_number: account.cycle,
    source: "JARVIS CLOUD",
    metadata: { syncedFrom: "trading-account-manager" },
  }));

  const { error: accountUpsertError } = await supabase
    .from("trading_accounts")
    .upsert(accountPayload, { onConflict: "workspace_id,client_id" });
  if (accountUpsertError) throw accountUpsertError;

  const { data: accountRows, error: accountReadError } = await supabase
    .from("trading_accounts")
    .select("id,client_id")
    .eq("workspace_id", workspaceId)
    .in("client_id", accounts.map((item) => item.id));
  if (accountReadError) throw accountReadError;

  const cloudAccountByClient = new Map((accountRows ?? []).map((row) => [String(row.client_id), String(row.id)]));

  const phases = new Map<string, { clientId: string; cycle: number; stage: AccountStage }>();
  for (const account of accounts) {
    phases.set(phaseKey(account), { clientId: account.id, cycle: account.cycle, stage: account.stage });
  }
  for (const key of Object.keys(journal)) {
    const parsed = parseEntryKey(key);
    if (parsed) phases.set(parsed.phaseKey, { clientId: parsed.clientId, cycle: parsed.cycle, stage: parsed.stage });
  }

  const cyclePayload = [...phases.entries()].flatMap(([clientPhaseKey, phase]) => {
    const account = accounts.find((item) => item.id === phase.clientId);
    const accountId = cloudAccountByClient.get(phase.clientId);
    if (!account || !accountId) return [];
    const targetBalance = phase.stage === "EVAL"
      ? account.startBalance + Math.max(0, account.profitTarget)
      : account.startBalance + Math.max(0, account.fundedBuffer);

    return [{
      workspace_id: workspaceId,
      account_id: accountId,
      client_phase_key: clientPhaseKey,
      cycle_number: phase.cycle,
      stage: phase.stage,
      start_balance: account.startBalance,
      current_balance: account.currentBalance,
      loss_limit: account.lossLimit,
      target_balance: targetBalance,
      funded_buffer: account.fundedBuffer,
      required_trading_days: account.requiredTradingDays,
      metadata: { syncedFrom: "trading-account-manager" },
    }];
  });

  if (cyclePayload.length) {
    const { error: cycleUpsertError } = await supabase
      .from("trading_account_cycles")
      .upsert(cyclePayload, { onConflict: "workspace_id,client_phase_key" });
    if (cycleUpsertError) throw cycleUpsertError;
  }

  const phaseKeys = [...phases.keys()];
  const { data: cycleRows, error: cycleReadError } = phaseKeys.length
    ? await supabase
        .from("trading_account_cycles")
        .select("id,client_phase_key")
        .eq("workspace_id", workspaceId)
        .in("client_phase_key", phaseKeys)
    : { data: [], error: null };
  if (cycleReadError) throw cycleReadError;

  const cycleByPhase = new Map((cycleRows ?? []).map((row) => [String(row.client_phase_key), String(row.id)]));

  const dayPayload = Object.entries(journal).flatMap(([key, entry]) => {
    const parsed = parseEntryKey(key);
    if (!parsed) return [];
    const accountId = cloudAccountByClient.get(parsed.clientId);
    const cycleId = cycleByPhase.get(parsed.phaseKey);
    if (!accountId || !cycleId) return [];
    return [{
      workspace_id: workspaceId,
      account_id: accountId,
      cycle_id: cycleId,
      client_entry_key: key,
      trade_date: parsed.day,
      realized_pnl: entry.pnl,
      notes: entry.notes,
      screenshot_count: Math.max(0, Math.round(entry.imageCount ?? (entry.hasImage ? 1 : 0))),
      metadata: { syncedFrom: "trading-account-manager" },
    }];
  });

  if (dayPayload.length) {
    const { error: dayUpsertError } = await supabase
      .from("trading_days")
      .upsert(dayPayload, { onConflict: "workspace_id,client_entry_key" });
    if (dayUpsertError) throw dayUpsertError;
  }

  const { error: settingError } = await supabase
    .from("jarvis_settings")
    .upsert({
      workspace_id: workspaceId,
      scope: "TRADING",
      key: "selected_account",
      value: { clientId: selectedId },
    }, { onConflict: "workspace_id,scope,key" });
  if (settingError) throw settingError;
}

async function getCloudTradingDay(supabase: SupabaseClient, workspaceId: string, key: string) {
  const { data, error } = await supabase
    .from("trading_days")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("client_entry_key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? String(data.id) : null;
}

async function getCloudImages(supabase: SupabaseClient, workspaceId: string, tradingDayId: string) {
  const { data: rows, error } = await supabase
    .from("jarvis_attachments")
    .select("id,object_path,file_name,created_at")
    .eq("workspace_id", workspaceId)
    .eq("entity_type", "trading_day")
    .eq("entity_id", tradingDayId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!rows?.length) return [] as TradeImageItem[];

  const items: TradeImageItem[] = [];
  for (const row of rows) {
    const objectPath = String(row.object_path);
    const { data, error: signedError } = await supabase.storage
      .from("jarvis-attachments")
      .createSignedUrl(objectPath, 60 * 60);
    if (signedError || !data?.signedUrl) continue;
    items.push({
      id: String(row.id),
      attachmentId: String(row.id),
      objectPath,
      fileName: String(row.file_name || "trade-image.jpg"),
      url: data.signedUrl,
      source: "CLOUD",
    });
  }
  return items;
}


async function migrateLocalImagesToCloud(
  supabase: SupabaseClient,
  workspaceId: string,
  snapshot: LocalSnapshot,
) {
  for (const [key, entry] of Object.entries(snapshot.journal)) {
    if (!entry.hasImage) continue;
    const parsed = parseEntryKey(key);
    if (!parsed) continue;
    const account = snapshot.accounts.find((item) => item.id === parsed.clientId);
    if (!account) continue;

    const localImages = await listLocalImages(`${key}:image`);
    if (!localImages.length) continue;

    const tradingDayId = await getCloudTradingDay(supabase, workspaceId, key);
    if (!tradingDayId) continue;

    const { count, error: countError } = await supabase
      .from("jarvis_attachments")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "trading_day")
      .eq("entity_id", tradingDayId);
    if (countError) throw countError;

    const alreadyStored = Math.max(0, count ?? 0);
    const safePhase = parsed.phaseKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    const pending = localImages.slice(alreadyStored);

    for (const [index, localImage] of pending.entries()) {
      const suffix = crypto.randomUUID();
      const objectPath = `${workspaceId}/trading/${account.id}/${safePhase}/${parsed.day}/migrated-${index + alreadyStored + 1}-${suffix}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("jarvis-attachments")
        .upload(objectPath, localImage.blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;

      const { error: attachmentError } = await supabase.from("jarvis_attachments").insert({
        workspace_id: workspaceId,
        domain: "TRADING",
        entity_type: "trading_day",
        entity_id: tradingDayId,
        bucket: "jarvis-attachments",
        object_path: objectPath,
        file_name: `trade-${parsed.day}-${index + alreadyStored + 1}.jpg`,
        mime_type: "image/jpeg",
        size_bytes: localImage.blob.size,
        metadata: {
          clientEntryKey: key,
          clientId: parsed.clientId,
          tradeDate: parsed.day,
          migratedFrom: "indexeddb",
          localKey: localImage.key,
        },
      });
      if (attachmentError) throw attachmentError;
    }

    const finalCount = alreadyStored + pending.length;
    if (finalCount > 0) {
      await supabase
        .from("trading_days")
        .update({ screenshot_count: finalCount })
        .eq("workspace_id", workspaceId)
        .eq("id", tradingDayId);

      for (const localImage of localImages) {
        await removeImage(localImage.key);
      }
    }
  }
}

export default function TradingAccountManager({
  onAccountChange,
}: {
  onAccountChange?: (account: TradingAccountView | null) => void;
}) {
  const [accounts, setAccounts] = useState<TradingAccount[]>([defaultAccount]);
  const [selectedId, setSelectedId] = useState(defaultAccount.id);
  const [journal, setJournal] = useState<JournalMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [draftPnl, setDraftPnl] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [imageItems, setImageItems] = useState<TradeImageItem[]>([]);
  const [activeImage, setActiveImage] = useState<TradeImageItem | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("LOCAL");
  const [cloudMessage, setCloudMessage] = useState("Local cache active");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  useEffect(() => {
    const local = readLocalSnapshot();
    setAccounts(local.accounts);
    setSelectedId(local.selectedId);
    setJournal(local.journal);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    window.dispatchEvent(new CustomEvent("jarvis-trading-account-updated"));
  }, [accounts, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SELECTED_KEY, selectedId);
    window.dispatchEvent(new CustomEvent("jarvis-trading-account-updated"));
  }, [selectedId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    window.dispatchEvent(new CustomEvent("jarvis-trading-account-updated"));
  }, [journal, hydrated]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (active) setUser(data.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      if (!session?.user) {
        setWorkspaceId(null);
        setCloudReady(false);
        setCloudStatus("LOCAL");
        setCloudMessage("Local cache active");
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !user) return;
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    async function initializeCloud() {
      setCloudStatus("CONNECTING");
      setCloudMessage("Connecting permanent memory…");

      try {
        const id = await getPrimaryWorkspaceId(supabase);
        if (cancelled) return;
        if (!id) {
          setCloudStatus("ERROR");
          setCloudMessage("Signed in, but this account does not have JARVIS workspace access.");
          return;
        }

        setWorkspaceId(id);
        const remote = await loadCloudSnapshot(supabase, id);
        if (cancelled) return;

        let activeSnapshot: LocalSnapshot | null = remote;
        if (remote) {
          setAccounts(remote.accounts);
          setSelectedId(remote.selectedId);
          setJournal(remote.journal);
        } else {
          const local = readLocalSnapshot();
          await pushCloudSnapshot(supabase, id, local.accounts, local.journal, local.selectedId);
          if (cancelled) return;
          const migrated = await loadCloudSnapshot(supabase, id);
          activeSnapshot = migrated ?? local;
          if (migrated) {
            setAccounts(migrated.accounts);
            setSelectedId(migrated.selectedId);
            setJournal(migrated.journal);
          }
        }

        if (activeSnapshot) {
          await migrateLocalImagesToCloud(supabase, id, activeSnapshot);
        }

        if (cancelled) return;
        setCloudReady(true);
        setCloudStatus("SYNCED");
        setCloudMessage("Permanent memory synced");
      } catch (error) {
        if (cancelled) return;
        setCloudStatus("ERROR");
        setCloudMessage(error instanceof Error ? error.message : "Cloud sync failed");
      }
    }

    void initializeCloud();
    return () => {
      cancelled = true;
    };
  }, [hydrated, user?.id]);

  useEffect(() => {
    if (!hydrated || !cloudReady || !workspaceId || !user) return;
    const supabase = getSupabaseBrowserClient();
    const timer = window.setTimeout(() => {
      setCloudStatus("SYNCING");
      setCloudMessage("Saving to permanent memory…");
      void pushCloudSnapshot(supabase, workspaceId, accounts, journal, selectedId)
        .then(() => {
          setCloudStatus("SYNCED");
          setCloudMessage("Permanent memory synced");
        })
        .catch((error) => {
          setCloudStatus("ERROR");
          setCloudMessage(error instanceof Error ? error.message : "Cloud sync failed");
        });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [accounts, journal, selectedId, hydrated, cloudReady, workspaceId, user?.id]);

  const account = accounts.find((item) => item.id === selectedId) ?? accounts[0] ?? null;

  useEffect(() => {
    if (!account && accounts.length) setSelectedId(accounts[0].id);
  }, [account, accounts]);

  const phasePrefix = account ? `${phaseKey(account)}:` : "";
  const phaseEntries = useMemo(() => {
    if (!account) return [] as Array<[string, JournalEntry]>;
    return Object.entries(journal).filter(([key]) => key.startsWith(phasePrefix));
  }, [account, journal, phasePrefix]);

  const totalPnl = useMemo(
    () => phaseEntries.reduce((sum, [, entry]) => sum + (entry.pnl ?? 0), 0),
    [phaseEntries],
  );
  const tradingDays = useMemo(
    () => phaseEntries.filter(([, entry]) => entry.pnl !== null || entry.notes.trim() || entry.hasImage).length,
    [phaseEntries],
  );

  const targetBalance = account
    ? account.stage === "EVAL"
      ? account.startBalance + Math.max(0, account.profitTarget)
      : account.startBalance + Math.max(0, account.fundedBuffer)
    : 0;
  const progress = account && targetBalance > account.lossLimit
    ? clamp(((account.currentBalance - account.lossLimit) / (targetBalance - account.lossLimit)) * 100)
    : 0;
  const dayProgress = account?.stage === "FUNDED" && account.requiredTradingDays > 0
    ? clamp((tradingDays / account.requiredTradingDays) * 100)
    : 0;
  const remaining = account ? Math.max(0, targetBalance - account.currentBalance) : 0;

  useEffect(() => {
    if (!account) {
      onAccountChange?.(null);
      return;
    }
    onAccountChange?.({
      ...account,
      tradingDays,
      totalPnl,
      remaining,
      targetBalance,
    });
  }, [account, onAccountChange, remaining, targetBalance, totalPnl, tradingDays]);

  useEffect(() => {
    if (!account) return;
    const current = journal[entryKey(account, selectedDay)];
    setDraftPnl(current?.pnl === null || current?.pnl === undefined ? "" : String(current.pnl));
    setDraftNotes(current?.notes ?? "");
  }, [account, journal, selectedDay]);

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];

    async function load() {
      if (!account) {
        setImageItems([]);
        return;
      }

      if (cloudReady && workspaceId && user) {
        try {
          const supabase = getSupabaseBrowserClient();
          const dayId = await getCloudTradingDay(supabase, workspaceId, entryKey(account, selectedDay));
          if (dayId) {
            const cloudImages = await getCloudImages(supabase, workspaceId, dayId);
            if (!active) return;
            if (cloudImages.length) {
              setImageItems(cloudImages);
              return;
            }
          }
        } catch {
          // Fall through to local cache.
        }
      }

      const localImages = await listLocalImages(imageKey(account, selectedDay));
      if (!active) return;
      const items = localImages.map(({ key, blob }, index) => {
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return {
          id: key,
          localKey: key,
          fileName: `trade-${selectedDay}-${index + 1}.jpg`,
          url,
          source: "LOCAL" as const,
        };
      });
      setImageItems(items);
    }

    void load();
    return () => {
      active = false;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [account, selectedDay, journal, cloudReady, workspaceId, user?.id, imageRevision]);

  function patchAccount(patch: Partial<TradingAccount>) {
    if (!account) return;
    setAccounts((current) => current.map((item) => item.id === account.id ? { ...item, ...patch } : item));
  }

  function addAccount() {
    const next = makeAccount(accounts.length + 1);
    setAccounts((current) => [...current, next]);
    setSelectedId(next.id);
    setSelectedDay(dateKey(new Date()));
    setMonthCursor(new Date());
  }

  async function archiveCloudAccount(clientId: string) {
    if (!cloudReady || !workspaceId || !user) return;
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("trading_accounts")
      .update({ status: "ARCHIVED" })
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId);
  }

  function deleteAccount() {
    if (!account || accounts.length === 1) return;
    if (!window.confirm(`Archive ${account.label}? Its cloud history will be preserved.`)) return;
    const deletingId = account.id;
    const next = accounts.filter((item) => item.id !== deletingId);
    setAccounts(next);
    setSelectedId(next[0].id);
    void archiveCloudAccount(deletingId);
  }

  async function recordCycleOutcome(target: TradingAccount, outcome: "PASSED" | "BLOWN") {
    if (!cloudReady || !workspaceId || !user) return;
    const supabase = getSupabaseBrowserClient();
    try {
      await pushCloudSnapshot(supabase, workspaceId, accounts, journal, selectedId);
      await supabase
        .from("trading_account_cycles")
        .update({ outcome, ended_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("client_phase_key", phaseKey(target));

      await supabase.from("jarvis_events").insert({
        workspace_id: workspaceId,
        domain: "TRADING",
        event_type: outcome === "PASSED" ? "trading.account_passed" : "trading.account_blown",
        source: "jarvis.trading.account-manager",
        importance: "IMPORTANT",
        summary: outcome === "PASSED"
          ? `${target.label} evaluation passed.`
          : `${target.label} cycle marked blown and reset.`,
        entity_type: "trading_account",
        entity_id: target.cloudId ?? null,
        payload: { clientId: target.id, cycle: target.cycle, stage: target.stage },
      });
    } catch {
      // The local transition still completes and will sync again when cloud recovers.
    }
  }

  function resetBlownAccount() {
    if (!account) return;
    if (!window.confirm("Reset this account as a fresh evaluation? The old calendar and cloud history stay archived under the previous cycle.")) return;
    void recordCycleOutcome(account, "BLOWN");
    patchAccount({
      stage: "EVAL",
      label: /FUNDED/i.test(account.label) ? account.label.replace(/FUNDED/gi, "EVAL") : account.label,
      currentBalance: account.startBalance,
      cycle: account.cycle + 1,
    });
    setSelectedDay(dateKey(new Date()));
    setMonthCursor(new Date());
  }

  function markPassed() {
    if (!account || account.stage !== "EVAL") return;
    if (!window.confirm("Mark this evaluation as passed and start a fresh funded calendar?")) return;
    void recordCycleOutcome(account, "PASSED");
    patchAccount({
      stage: "FUNDED",
      label: /EVAL/i.test(account.label) ? account.label.replace(/EVAL/gi, "FUNDED") : account.label,
      currentBalance: account.startBalance,
    });
    setSelectedDay(dateKey(new Date()));
    setMonthCursor(new Date());
  }

  function saveJournal() {
    if (!account) return;
    const key = entryKey(account, selectedDay);
    const previous = journal[key] ?? { pnl: null, notes: "", hasImage: false };
    const nextPnl = draftPnl.trim() === "" ? null : parseNumber(draftPnl, previous.pnl ?? 0);
    const delta = (nextPnl ?? 0) - (previous.pnl ?? 0);

    setJournal((current) => ({
      ...current,
      [key]: {
        pnl: nextPnl,
        notes: draftNotes,
        hasImage: previous.hasImage,
        imageCount: previous.imageCount ?? (previous.hasImage ? 1 : 0),
      },
    }));

    if (delta !== 0) {
      patchAccount({ currentBalance: account.currentBalance + delta });
    }
  }

  async function uploadImageToCloud(
    targetAccount: TradingAccount,
    day: string,
    blob: Blob,
    fileName: string,
    imageId: string,
  ) {
    if (!cloudReady || !workspaceId || !user) return;
    const supabase = getSupabaseBrowserClient();
    const dayKey = entryKey(targetAccount, day);
    const tradingDayId = await getCloudTradingDay(supabase, workspaceId, dayKey);
    if (!tradingDayId) throw new Error("Trading day is not ready for image upload.");

    const safePhase = phaseKey(targetAccount).replace(/[^a-zA-Z0-9_-]/g, "_");
    const objectPath = `${workspaceId}/trading/${targetAccount.id}/${safePhase}/${day}/trade-${imageId}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("jarvis-attachments")
      .upload(objectPath, blob, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;

    const { error: attachmentError } = await supabase.from("jarvis_attachments").insert({
      workspace_id: workspaceId,
      domain: "TRADING",
      entity_type: "trading_day",
      entity_id: tradingDayId,
      bucket: "jarvis-attachments",
      object_path: objectPath,
      file_name: fileName,
      mime_type: "image/jpeg",
      size_bytes: blob.size,
      metadata: { clientEntryKey: dayKey, clientId: targetAccount.id, tradeDate: day, imageId },
    });
    if (attachmentError) throw attachmentError;
  }

  async function onImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 12);
    event.target.value = "";
    if (!account || !files.length) return;

    setImageBusy(true);
    try {
      const prepared: Array<{ blob: Blob; localKey: string; fileName: string; imageId: string }> = [];
      for (const [index, file] of files.entries()) {
        const compressed = await compressImage(file);
        const imageId = crypto.randomUUID();
        const localKey = imageItemKey(account, selectedDay, imageId);
        const saved = await putImage(localKey, compressed);
        if (!saved) continue;
        prepared.push({
          blob: compressed,
          localKey,
          imageId,
          fileName: file.name?.trim() || `trade-${selectedDay}-${index + 1}.jpg`,
        });
      }
      if (!prepared.length) return;

      const key = entryKey(account, selectedDay);
      const previous = journal[key] ?? { pnl: null, notes: "", hasImage: false, imageCount: 0 };
      const previousCount = Math.max(0, previous.imageCount ?? (previous.hasImage ? 1 : 0));
      const nextCount = previousCount + prepared.length;
      const nextJournal: JournalMap = {
        ...journal,
        [key]: { ...previous, hasImage: true, imageCount: nextCount },
      };
      setJournal(nextJournal);

      if (cloudReady && workspaceId && user) {
        setCloudStatus("SYNCING");
        setCloudMessage(`Uploading ${prepared.length} trade image${prepared.length === 1 ? "" : "s"}…`);
        const supabase = getSupabaseBrowserClient();
        await pushCloudSnapshot(supabase, workspaceId, accounts, nextJournal, selectedId);

        for (const image of prepared) {
          await uploadImageToCloud(account, selectedDay, image.blob, image.fileName, image.imageId);
          await removeImage(image.localKey);
        }

        const tradingDayId = await getCloudTradingDay(supabase, workspaceId, key);
        if (tradingDayId) {
          const { count } = await supabase
            .from("jarvis_attachments")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("entity_type", "trading_day")
            .eq("entity_id", tradingDayId);
          const actualCount = Math.max(0, count ?? nextCount);
          await supabase.from("trading_days").update({ screenshot_count: actualCount }).eq("id", tradingDayId);
          setJournal((current) => ({
            ...current,
            [key]: { ...(current[key] ?? previous), hasImage: actualCount > 0, imageCount: actualCount },
          }));
        }

        setCloudStatus("SYNCED");
        setCloudMessage("Permanent memory synced");
      }

      setImageRevision((value) => value + 1);
    } catch (error) {
      setCloudStatus("ERROR");
      setCloudMessage(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setImageBusy(false);
    }
  }

  async function deleteImage(item: TradeImageItem) {
    if (!account) return;
    const key = entryKey(account, selectedDay);
    const previous = journal[key] ?? { pnl: null, notes: "", hasImage: false, imageCount: 0 };

    try {
      if (item.localKey) await removeImage(item.localKey);

      let remainingCount = Math.max(0, (previous.imageCount ?? imageItems.length) - 1);

      if (item.source === "CLOUD" && cloudReady && workspaceId && user && item.attachmentId) {
        const supabase = getSupabaseBrowserClient();
        const staleLocalImages = await listLocalImages(imageKey(account, selectedDay));
        for (const localImage of staleLocalImages) await removeImage(localImage.key);

        if (item.objectPath) {
          const { error: removeError } = await supabase.storage.from("jarvis-attachments").remove([item.objectPath]);
          if (removeError) throw removeError;
        }

        const { error: deleteError } = await supabase
          .from("jarvis_attachments")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("id", item.attachmentId);
        if (deleteError) throw deleteError;

        const tradingDayId = await getCloudTradingDay(supabase, workspaceId, key);
        if (tradingDayId) {
          const { count, error: countError } = await supabase
            .from("jarvis_attachments")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("entity_type", "trading_day")
            .eq("entity_id", tradingDayId);
          if (countError) throw countError;
          remainingCount = Math.max(0, count ?? 0);
          await supabase.from("trading_days").update({ screenshot_count: remainingCount }).eq("id", tradingDayId);
        }
      }

      const nextJournal: JournalMap = {
        ...journal,
        [key]: { ...previous, hasImage: remainingCount > 0, imageCount: remainingCount },
      };
      setJournal(nextJournal);
      if (activeImage?.id === item.id) setActiveImage(null);
      setImageRevision((value) => value + 1);
    } catch (error) {
      setCloudStatus("ERROR");
      setCloudMessage(error instanceof Error ? error.message : "Image removal failed");
    }
  }

  async function downloadTradeImage(item: TradeImageItem) {
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error("Could not fetch image");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName || `trade-${selectedDay}.jpg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch {
      window.open(item.url, "_blank", "noopener,noreferrer");
    }
  }

  async function signInToCloud(event: FormEvent) {
    event.preventDefault();
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) return;

    const supabase = getSupabaseBrowserClient();
    setCloudStatus("CONNECTING");
    setCloudMessage("Signing into permanent memory…");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setCloudStatus("ERROR");
      setCloudMessage(error.message);
      return;
    }

    setCloudMessage("Signed in. Loading permanent memory…");
  }

  async function createCloudOwner() {
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || password.length < 6) {
      setCloudStatus("ERROR");
      setCloudMessage("Enter your email and a password with at least 6 characters.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    setCloudStatus("CONNECTING");
    setCloudMessage("Creating secure JARVIS owner…");

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setCloudStatus("ERROR");
      setCloudMessage(error.message);
      return;
    }

    if (data.session) {
      setCloudMessage("Owner created. Loading permanent memory…");
    } else {
      setCloudStatus("LOCAL");
      setCloudMessage("Owner created. Confirm the email once, then return here and press SIGN IN. If confirmation opens localhost, the email can still be confirmed.");
    }
  }

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    setCloudReady(false);
    setWorkspaceId(null);
    setCloudStatus("LOCAL");
    setCloudMessage("Local cache active");
  }

  if (!account) return null;

  const cells = monthCells(monthCursor);
  const monthLabel = monthCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const selectedEntry = journal[entryKey(account, selectedDay)];
  const accountGoal = account.stage === "EVAL" ? "MLL → PASS TARGET" : "LOSS LIMIT → BUFFER TARGET";
  const cloudLabel =
    cloudStatus === "SYNCED" ? "CLOUD SYNCED" :
    cloudStatus === "SYNCING" ? "SYNCING" :
    cloudStatus === "CONNECTING" ? "CONNECTING" :
    cloudStatus === "ERROR" ? "SYNC ERROR" :
    "LOCAL ONLY";

  return (
    <section className="trading-account-system">
      <article className="trading-card trading-account-overview">
        <div className="trading-cloud-bar">
          <div className={`trading-cloud-state is-${cloudStatus.toLowerCase()}`}>
            {cloudStatus === "SYNCED" || cloudStatus === "SYNCING" ? <Cloud size={13} /> : <CloudOff size={13} />}
            <div>
              <b>{cloudLabel}</b>
              <small>{cloudMessage}</small>
            </div>
          </div>

          {user ? (
            <div className="trading-cloud-user">
              <span>{user.email ?? "JARVIS OWNER"}</span>
              <button type="button" onClick={() => void signOut()}><LogOut size={12} /> SIGN OUT</button>
            </div>
          ) : (
            <form className="trading-cloud-login" onSubmit={(event) => void signInToCloud(event)}>
              <Mail size={13} />
              <input
                type="email"
                placeholder="JARVIS CLOUD EMAIL"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                autoComplete="email"
              />
              <input
                type="password"
                placeholder="PASSWORD"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button type="submit">SIGN IN</button>
              <button type="button" onClick={() => void createCloudOwner()}>CREATE OWNER</button>
            </form>
          )}
        </div>

        <div className="trading-account-toolbar">
          <div>
            <span className="trading-account-kicker">ACCOUNT DETAILS</span>
            <strong>{account.label}</strong>
            <small>{account.firm} · {account.stage} · CYCLE {account.cycle}</small>
          </div>
          <div className="trading-account-actions">
            <select
              value={account.id}
              onChange={(event) => setSelectedId(event.target.value)}
              aria-label="Choose trading account"
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>{item.label} · {item.stage}</option>
              ))}
            </select>
            <button type="button" onClick={addAccount}><Plus size={13} /> ADD ACCOUNT</button>
            {account.stage === "EVAL" ? (
              <button type="button" className="is-pass" onClick={markPassed}><Trophy size={13} /> PASS → FUNDED</button>
            ) : null}
            <button type="button" className="is-danger" onClick={resetBlownAccount}><RotateCcw size={13} /> BLOWN / RESET</button>
            <button type="button" className="icon-only" onClick={deleteAccount} disabled={accounts.length === 1} aria-label="Archive account">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <div className="trading-account-stats">
          <div><span>START</span><b>{money(account.startBalance)}</b></div>
          <div><span>CURRENT BALANCE</span><b>{money(account.currentBalance)}</b></div>
          <div><span>LOSS LIMIT / MLL</span><b>{money(account.lossLimit)}</b></div>
          <div>
            <span>{account.stage === "EVAL" ? "PASS TARGET" : "BUFFER TARGET"}</span>
            <b>{money(targetBalance)}</b>
          </div>
          <div><span>{account.stage === "EVAL" ? "REMAINING" : "BUFFER LEFT"}</span><b>{money(remaining)}</b></div>
        </div>

        <div className="trading-account-progress">
          <div className="progress-labels">
            <span><em>MLL</em>{money(account.lossLimit)}</span>
            <strong>{accountGoal}</strong>
            <span className="align-right"><em>TARGET</em>{money(targetBalance)}</span>
          </div>
          <div className="account-progress-track" aria-label={accountGoal}>
            <span className="account-progress-danger" />
            <span className="account-progress-fill" style={{ width: `${progress}%` }} />
            <span className="account-progress-marker" style={{ left: `${progress}%` }} />
          </div>
          <div className="progress-foot">
            <span>HEADROOM <b>{money(Math.max(0, account.currentBalance - account.lossLimit))}</b></span>
            <span>BALANCE <b>{money(account.currentBalance)}</b></span>
            <span>REMAINING <b>{money(remaining)}</b></span>
          </div>
        </div>

        {account.stage === "FUNDED" ? (
          <div className="funded-days-progress">
            <div><span>PAYOUT / QUALIFYING DAYS</span><b>{tradingDays} / {account.requiredTradingDays}</b></div>
            <div className="funded-days-track"><span style={{ width: `${dayProgress}%` }} /></div>
          </div>
        ) : null}
      </article>

      <div className="trading-account-grid">
        <article className="trading-card trading-calendar-card">
          <div className="trading-card-head trading-calendar-head">
            <span><CalendarDays size={13} /> TRADING CALENDAR</span>
            <div>
              <button
                type="button"
                onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft size={14} />
              </button>
              <b>{monthLabel}</b>
              <button
                type="button"
                onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
                aria-label="Next month"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="trading-calendar-weekdays">
            {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="trading-calendar-grid">
            {cells.map((day) => {
              const key = dateKey(day);
              const entry = journal[entryKey(account, key)];
              const inMonth = day.getMonth() === monthCursor.getMonth();
              const isSelected = key === selectedDay;
              const pnl = entry?.pnl ?? null;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    "trading-calendar-day",
                    inMonth ? "" : "is-outside",
                    isSelected ? "is-selected" : "",
                    pnl !== null && pnl > 0 ? "is-win" : "",
                    pnl !== null && pnl < 0 ? "is-loss" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setSelectedDay(key)}
                >
                  <span className="day-number">{day.getDate()}</span>
                  {pnl !== null ? <strong>{pnlMoney(pnl)}</strong> : <i>—</i>}
                  {(entry?.notes.trim() || entry?.hasImage) ? (
                    <small>
                      {entry?.notes.trim() ? "NOTE" : ""}
                      {entry?.notes.trim() && entry?.hasImage ? " · " : ""}
                      {entry?.hasImage ? `IMG ×${Math.max(1, entry.imageCount ?? 1)}` : ""}
                    </small>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="calendar-summary">
            <span>PHASE P&L <b className={totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : ""}>{pnlMoney(totalPnl) || "$0.00"}</b></span>
            <span>TRACKED DAYS <b>{tradingDays}</b></span>
          </div>
        </article>

        <div className="trading-account-side">
          <article className="trading-card account-input-card">
            <div className="trading-card-head">
              <span>ACCOUNT INPUT</span>
              <b>{cloudReady ? "CLOUD SOURCE" : "LOCAL CACHE"}</b>
            </div>
            <div className="account-input-grid">
              <label><span>PROP FIRM</span><input value={account.firm} onChange={(event) => patchAccount({ firm: event.target.value })} /></label>
              <label><span>ACCOUNT NAME</span><input value={account.label} onChange={(event) => patchAccount({ label: event.target.value })} /></label>
              <label><span>STAGE</span>
                <select value={account.stage} onChange={(event) => patchAccount({ stage: event.target.value as AccountStage })}>
                  <option value="EVAL">EVAL</option>
                  <option value="FUNDED">FUNDED</option>
                </select>
              </label>
              <label><span>START BALANCE</span><input inputMode="decimal" value={account.startBalance} onChange={(event) => patchAccount({ startBalance: parseNumber(event.target.value, account.startBalance) })} /></label>
              <label><span>CURRENT BALANCE</span><input inputMode="decimal" value={account.currentBalance} onChange={(event) => patchAccount({ currentBalance: parseNumber(event.target.value, account.currentBalance) })} /></label>
              <label><span>LOSS LIMIT / MLL</span><input inputMode="decimal" value={account.lossLimit} onChange={(event) => patchAccount({ lossLimit: parseNumber(event.target.value, account.lossLimit) })} /></label>
              {account.stage === "EVAL" ? (
                <label><span>PROFIT TARGET</span><input inputMode="decimal" value={account.profitTarget} onChange={(event) => patchAccount({ profitTarget: parseNumber(event.target.value, account.profitTarget) })} /></label>
              ) : (
                <>
                  <label><span>BUFFER REQUIRED</span><input inputMode="decimal" value={account.fundedBuffer} onChange={(event) => patchAccount({ fundedBuffer: parseNumber(event.target.value, account.fundedBuffer) })} /></label>
                  <label><span>REQUIRED DAYS</span><input inputMode="numeric" value={account.requiredTradingDays} onChange={(event) => patchAccount({ requiredTradingDays: Math.max(1, Math.round(parseNumber(event.target.value, account.requiredTradingDays))) })} /></label>
                </>
              )}
            </div>
            <p className="account-input-note">
              {cloudReady
                ? "Supabase is now the permanent source of truth. Changes are cached locally for speed and synced to JARVIS memory automatically."
                : "Local cache is active. Connect JARVIS Cloud above once and this account, calendar, notes and future trade images persist across deployments and devices."}
            </p>
          </article>

          <article className="trading-card day-journal-card">
            <div className="trading-card-head">
              <span><NotebookPen size={13} /> DAY JOURNAL</span>
              <b>{new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</b>
            </div>
            <label className="journal-pnl">
              <span>DAY P&L</span>
              <input
                inputMode="decimal"
                placeholder="+350 or -125"
                value={draftPnl}
                onChange={(event) => setDraftPnl(event.target.value)}
              />
            </label>
            <label className="journal-notes">
              <span>NOTES</span>
              <textarea
                placeholder="Setup, liquidity sweep, entry reason, execution mistake, lesson..."
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.target.value)}
              />
            </label>

            <div className="journal-image-zone">
              {imageItems.length > 0 ? (
                <div className="journal-image-gallery">
                  {imageItems.map((item, index) => (
                    <div className="journal-image-tile" key={item.id}>
                      <button
                        type="button"
                        className="journal-image-open"
                        onClick={() => setActiveImage(item)}
                        aria-label={`Open trade image ${index + 1}`}
                      >
                        <img src={item.url} alt={`Trade screenshot ${index + 1} for ${selectedDay}`} />
                        <span><Maximize2 size={12} /> VIEW</span>
                      </button>
                      <div className="journal-image-tile-actions">
                        <small>TRADE IMG {index + 1}</small>
                        <button type="button" onClick={() => void downloadTradeImage(item)}><Download size={11} /> SAVE</button>
                        <button type="button" onClick={() => void deleteImage(item)}>REMOVE</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <label className="journal-image-upload">
                <ImagePlus size={18} />
                <span>{imageBusy ? "PROCESSING..." : imageItems.length ? "ADD MORE TRADE PICTURES" : "ADD TRADE PICTURES"}</span>
                <small>{cloudReady ? "Multiple images save permanently to JARVIS Cloud" : "Stored locally until JARVIS Cloud is connected"}</small>
                <input type="file" accept="image/*" multiple onChange={(event) => void onImageChange(event)} disabled={imageBusy} />
              </label>
            </div>

            <button type="button" className="journal-save" onClick={saveJournal}>SAVE DAY</button>
            {selectedEntry?.hasImage && imageItems.length === 0 ? <small className="journal-image-state">Trade images are recorded for this day and will load when storage is available.</small> : null}
          </article>
        </div>
      </div>

      {activeImage ? (
        <div className="trading-image-lightbox" role="dialog" aria-modal="true" aria-label="Trade image viewer" onClick={() => setActiveImage(null)}>
          <div className="trading-image-lightbox-inner" onClick={(event) => event.stopPropagation()}>
            <div className="trading-image-lightbox-head">
              <div>
                <span>TRADE IMAGE</span>
                <b>{selectedDay}</b>
              </div>
              <div>
                <button type="button" onClick={() => void downloadTradeImage(activeImage)}><Download size={13} /> SAVE IMAGE</button>
                <button type="button" onClick={() => setActiveImage(null)} aria-label="Close image viewer"><X size={15} /></button>
              </div>
            </div>
            <img src={activeImage.url} alt={`Expanded trade screenshot for ${selectedDay}`} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
