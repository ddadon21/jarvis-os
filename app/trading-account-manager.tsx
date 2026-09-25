"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  NotebookPen,
  Plus,
  RotateCcw,
  Trash2,
  Trophy,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

type AccountStage = "EVAL" | "FUNDED";

type TradingAccount = {
  id: string;
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
};

type JournalMap = Record<string, JournalEntry>;

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

function parseNumber(value: string, fallback: number) {
  if (value.trim() === "") return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    try {
      const storedAccounts = window.localStorage.getItem(ACCOUNTS_KEY);
      const storedSelected = window.localStorage.getItem(SELECTED_KEY);
      const storedJournal = window.localStorage.getItem(JOURNAL_KEY);
      if (storedAccounts) {
        const parsed = JSON.parse(storedAccounts) as TradingAccount[];
        if (Array.isArray(parsed) && parsed.length) setAccounts(parsed);
      }
      if (storedSelected) setSelectedId(storedSelected);
      if (storedJournal) {
        const parsed = JSON.parse(storedJournal) as JournalMap;
        if (parsed && typeof parsed === "object") setJournal(parsed);
      }
    } catch {
      // Keep the safe local defaults when stored data is unavailable.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }, [accounts, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SELECTED_KEY, selectedId);
  }, [selectedId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
  }, [journal, hydrated]);

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
    let objectUrl: string | null = null;

    async function load() {
      if (!account) {
        setImageUrl(null);
        return;
      }
      const blob = await getImage(imageKey(account, selectedDay));
      if (!active) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } else {
        setImageUrl(null);
      }
    }

    void load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [account, selectedDay, journal]);

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

  function deleteAccount() {
    if (!account || accounts.length === 1) return;
    if (!window.confirm(`Delete ${account.label}? Its local account setup will be removed.`)) return;
    const next = accounts.filter((item) => item.id !== account.id);
    setAccounts(next);
    setSelectedId(next[0].id);
  }

  function resetBlownAccount() {
    if (!account) return;
    if (!window.confirm("Reset this account as a fresh evaluation? The old calendar stays archived under the previous cycle.")) return;
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
      },
    }));

    if (delta !== 0) {
      patchAccount({ currentBalance: account.currentBalance + delta });
    }
  }

  async function onImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!account || !file) return;

    setImageBusy(true);
    try {
      const compressed = await compressImage(file);
      const saved = await putImage(imageKey(account, selectedDay), compressed);
      if (!saved) return;
      const key = entryKey(account, selectedDay);
      const previous = journal[key] ?? { pnl: null, notes: "", hasImage: false };
      setJournal((current) => ({
        ...current,
        [key]: { ...previous, hasImage: true },
      }));
    } finally {
      setImageBusy(false);
    }
  }

  async function deleteImage() {
    if (!account) return;
    await removeImage(imageKey(account, selectedDay));
    const key = entryKey(account, selectedDay);
    const previous = journal[key] ?? { pnl: null, notes: "", hasImage: false };
    setJournal((current) => ({
      ...current,
      [key]: { ...previous, hasImage: false },
    }));
    setImageUrl(null);
  }

  if (!account) return null;

  const cells = monthCells(monthCursor);
  const monthLabel = monthCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const selectedEntry = journal[entryKey(account, selectedDay)];
  const accountGoal = account.stage === "EVAL" ? "MLL → PASS TARGET" : "LOSS LIMIT → BUFFER TARGET";

  return (
    <section className="trading-account-system">
      <article className="trading-card trading-account-overview">
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
            <button type="button" className="icon-only" onClick={deleteAccount} disabled={accounts.length === 1} aria-label="Delete account">
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
                    <small>{entry?.notes.trim() ? "NOTE" : ""}{entry?.notes.trim() && entry?.hasImage ? " · " : ""}{entry?.hasImage ? "IMG" : ""}</small>
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
              <b>LIVE SOURCE</b>
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
            <p className="account-input-note">This is the selected account source of truth. Changes update the progress tracker, account context, funded-day tracker and calendar immediately.</p>
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
              {imageUrl ? (
                <div className="journal-image-preview">
                  <img src={imageUrl} alt={`Trade screenshot for ${selectedDay}`} />
                  <button type="button" onClick={() => void deleteImage()}>REMOVE IMAGE</button>
                </div>
              ) : (
                <label className="journal-image-upload">
                  <ImagePlus size={18} />
                  <span>{imageBusy ? "PROCESSING..." : "ADD TRADE PICTURE"}</span>
                  <small>Stored locally in Jarvis on this device</small>
                  <input type="file" accept="image/*" onChange={(event) => void onImageChange(event)} disabled={imageBusy} />
                </label>
              )}
            </div>

            <button type="button" className="journal-save" onClick={saveJournal}>SAVE DAY</button>
            {selectedEntry?.hasImage && !imageUrl ? <small className="journal-image-state">Image is stored for this day.</small> : null}
          </article>
        </div>
      </div>
    </section>
  );
}
