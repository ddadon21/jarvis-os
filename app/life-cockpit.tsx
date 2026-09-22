"use client";

import { useEffect, useState } from "react";
import { DAY_BLOCKS, DOWNTIME, emptyLifePlan, LIFE_PLAN_KEY, LifeDay, LifePlan, loadLifePlan, localDay, newLifeDay, REFLECTIONS, reflectionIndex } from "../lib/life-plan";
import styles from "./life-cockpit.module.css";

export default function LifeCockpit() {
  const [plan, setPlan] = useState<LifePlan>(emptyLifePlan);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [minutes, setMinutes] = useState(15);
  const [focusLength, setFocusLength] = useState(25);
  const [focusTitle, setFocusTitle] = useState("");
  const [reset, setReset] = useState(false);
  const [trigger, setTrigger] = useState("Scrolling");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const refresh = () => {
      try { setPlan(loadLifePlan()); setError(""); setReady(true); }
      catch { setError("Life history could not be loaded. Check browser storage and reload; your saved history has not been replaced."); setReady(false); }
      setNow(Date.now());
    };
    refresh();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = (event: StorageEvent) => { if (event.key === LIFE_PLAN_KEY || event.key === null) refresh(); };
    window.addEventListener("storage", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", sync); };
  }, []);

  function persist(next: LifePlan) {
    try { window.localStorage.setItem(LIFE_PLAN_KEY, JSON.stringify(next)); setPlan(next); setError(""); return true; }
    catch { setError("Changes could not be saved on this browser. Free storage or allow site storage, then try again."); return false; }
  }
  function changeDay(change: (day: LifeDay) => LifeDay) {
    try {
      const current = loadLifePlan();
      const key = localDay();
      persist({ ...current, days: { ...current.days, [key]: change(current.days[key] || newLifeDay()) } });
    } catch { setError("Unable to read your latest history. Reload before making changes."); }
  }
  const dayKey = now ? localDay(new Date(now)) : "";
  const day = plan.days[dayKey] || newLifeDay();
  const quote = REFLECTIONS[reflectionIndex(dayKey) % REFLECTIONS.length];
  const nextPriority = day.priorities.find(p => !p.done);
  const remaining = plan.session ? Math.max(0, Math.ceil((plan.session.endsAt - now) / 1000)) : 0;
  const completed = day.priorities.filter(p => p.done).length;
  const recent = Object.entries(plan.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);

  function startFocus(title: string, duration: number) {
    try {
      const current = loadLifePlan();
      if (current.session) { setNotice("Finish or cancel your current focus block first."); return; }
      if (persist({ ...current, session: { title, minutes: duration, endsAt: Date.now() + duration * 60_000, day: localDay() } })) { setNow(Date.now()); setNotice("Focus block started. Put the phone out of reach; return here when the timer ends."); }
    } catch { setError("Could not start focus. Reload and try again."); }
  }
  function endFocus(record: boolean) {
    try {
      const current = loadLifePlan();
      const session = current.session;
      if (!session || (record && session.endsAt > Date.now())) return;
      const target = current.days[session.day] || newLifeDay();
      if (persist({ ...current, session: null, days: record ? { ...current.days, [session.day]: { ...target, focusMinutes: target.focusMinutes + session.minutes } } : current.days })) setNotice(record ? "Focus block recorded. Take a short break and choose your next action." : "Timer cancelled. Choose a smaller next step if needed.");
    } catch { setError("Could not save the focus block. Reload and try again."); }
  }

  return <div className={styles.life} aria-label="Life daily plan">
    <header className={styles.header}><div><span className={styles.eyebrow}>LIFE / DAILY PRACTICE</span><h2>Keep your word to yourself.</h2></div><button onClick={() => setReset(!reset)} aria-expanded={reset}>I’m drifting</button></header>
    <p className={styles.subtle}>God first. Meaningful work. A cared-for body. Responsibility. Room to live.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!ready ? <p role="status">{error ? "Your saved history is protected." : "Loading your day…"}</p> : <>
      <section className={styles.quote}><span className={styles.eyebrow}>QUOTE OF THE DAY · JARVIS ORIGINAL</span><blockquote>“{quote[0]}”</blockquote><p><b>Put it into practice:</b> {quote[1]}</p><small>Scripture to read alongside it: {quote[2]}. The reflection above is not a Bible quotation.</small></section>
      {reset && <section className={styles.reset} aria-label="Reset your next ten minutes"><h3>Take back the next ten minutes.</h3><label>What pulled you off course?<select value={trigger} onChange={e => setTrigger(e.target.value)}>{["Scrolling", "Netflix", "Vaping", "Porn or sexual urge", "Boredom", "Avoiding a task"].map(t => <option key={t}>{t}</option>)}</select></label><ol><li>Stand up and move to a different space.</li><li>{trigger === "Vaping" ? "Put the disposable out of reach and choose a place where you do not vape." : trigger === "Porn or sexual urge" ? "Close the content and leave your phone outside the room." : "Close the feed or show and put the phone out of reach."}</li><li>Pause, pray if you want, and name what you actually need: rest, connection, food, or a task to start.</li><li>Do one useful five-minute action. A setback does not erase your progress.</li></ol><button disabled={!!plan.session} onClick={() => startFocus("Reset: clear my space and choose my next action", 5)}>Start a 5-minute reset</button><small>This selection is not logged. The timer does not block apps or monitor your activity.</small></section>}
      <section className={styles.card}><div className={styles.sectionHead}><h3>Today’s three priorities</h3><span>{completed}/3 kept</span></div><p className={styles.subtle}>Edit each into a finish line you can actually reach today.</p><div className={styles.priorities}>{day.priorities.map((priority, index) => <div key={index} className={styles.priority}><input type="checkbox" aria-label={`Complete priority ${index + 1}`} checked={priority.done} onChange={() => changeDay(d => ({ ...d, priorities: d.priorities.map((p, i) => i === index ? { ...p, done: !p.done } : p) }))} /><input aria-label={`Priority ${index + 1}`} maxLength={180} value={priority.title} onChange={e => { const title = e.target.value; changeDay(d => ({ ...d, priorities: d.priorities.map((p, i) => i === index ? { ...p, title } : p) })); }} /></div>)}</div><div className={styles.next}><span className={styles.eyebrow}>NEXT ACTION</span><p>{nextPriority?.title.trim() || (nextPriority ? "Give your next priority a clear finish line." : "Your three priorities are complete. Handle a small responsibility or enjoy planned rest.")}</p></div></section>
      <section className={styles.card}><div className={styles.sectionHead}><h3>One focused block</h3><span>{day.focusMinutes} min recorded today</span></div>{plan.session ? <><p>{plan.session.title}</p><div className={styles.timer} role="timer" aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`}>{Math.floor(remaining / 60).toString().padStart(2, "0")}:{(remaining % 60).toString().padStart(2, "0")}</div><div className={styles.row}><button disabled={remaining > 0} onClick={() => endFocus(true)}>{remaining > 0 ? "In progress" : "I finished — record block"}</button><button onClick={() => endFocus(false)}>Cancel timer</button></div><small>Only record time you actually spent focused. No background activity tracking.</small></> : <><label>What will you finish?<input maxLength={180} value={focusTitle} placeholder={nextPriority?.title || "Name one concrete task"} onChange={e => setFocusTitle(e.target.value)} /></label><div className={styles.row}><label>Block length<select value={focusLength} onChange={e => setFocusLength(Number(e.target.value))}><option value={10}>10 minutes</option><option value={25}>25 minutes</option><option value={50}>50 minutes</option></select></label><button disabled={!(focusTitle.trim() || nextPriority?.title.trim())} onClick={() => startFocus(focusTitle.trim() || nextPriority!.title, focusLength)}>Start focus</button></div></>}<p role="status" className={styles.notice}>{notice}</p></section>
      <details className={styles.card}><summary>Your day, with structure</summary><p className={styles.subtle}>A flexible sequence, not an hourly schedule. The three priorities are the core; use these blocks to shape the rest. These planning check-offs are separate from your existing habit history.</p>{DAY_BLOCKS.map(block => <label className={styles.block} key={block.id}><input type="checkbox" checked={!!day.blocks[block.id]} onChange={() => changeDay(d => ({ ...d, blocks: { ...d.blocks, [block.id]: !d.blocks[block.id] } }))} /><span><b>{block.label} <small>{block.time}</small></b><span>{block.action}</span></span></label>)}</details>
      <section className={styles.card}><h3>Free time? Choose deliberately.</h3><div className={styles.pills} aria-label="Available time">{[5, 15, 30, 60].map(m => <button key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m} min</button>)}</div><div className={styles.actions}>{DOWNTIME.filter(item => item.minutes === minutes).map(item => <article key={item.title}><h4>{item.title}</h4><p>{item.detail}</p><button disabled={!!plan.session} onClick={() => startFocus(item.title, item.minutes)}>Choose this</button></article>)}</div><small>Entertainment can be part of your day. Choose it on purpose and set a stopping time.</small></section>
      <details className={styles.card}><summary>Evening review & recent days</summary><p className={styles.subtle}>Review your actions honestly. Your completion count is not a measure of your worth.</p>{([['win', 'What did I follow through on?'], ['lesson', 'What pulled me away, and what will I change?'], ['tomorrow', 'What is my first action tomorrow?']] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={2} maxLength={1200} value={day[key]} onChange={e => { const value = e.target.value; changeDay(d => ({ ...d, [key]: value })); }} /></label>)}<div className={styles.history}>{recent.length ? recent.map(([date, entry]) => <div key={date}><span>{date}</span><span>{entry.priorities.filter(p => p.done).length}/3 priorities · {entry.focusMinutes} focus min</span></div>) : <p>Your history starts with your first saved action.</p>}</div></details>
      <p className={styles.storage}>Saved on this browser only. Use the same browser and Jarvis address to keep your history together; it does not sync between devices.</p>
    </>}
  </div>;
}
