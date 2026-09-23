import { Mission, PILLARS } from "./life-missions";
export const LIFE_PLAN_KEY = "jarvis-life-command-v2";
const LEGACY_LIFE_PLAN_KEY = "jarvis-life-plan-v1";
export type Priority = { title: string; done: boolean };
export type LifeDay = {
  priorities: Priority[];
  blocks: Record<string, boolean>;
  win: string;
  lesson: string;
  tomorrow: string;
  focusMinutes: number;
};
export type FocusSession = { title: string; endsAt: number; minutes: number; day: string };
export type LifePlan = { version: 2; days: Record<string, LifeDay>; session: FocusSession | null; missions: Mission[]; area: string };

export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function newLifeDay(): LifeDay {
  return {
    priorities: [
      { title: "Read Scripture, pray, and choose one way to live it today", done: false },
      { title: "Finish one concrete SentryOps task or coding exercise", done: false },
      { title: "Complete my workout or planned recovery walk", done: false },
    ],
    blocks: {}, win: "", lesson: "", tomorrow: "", focusMinutes: 0,
  };
}
export function emptyLifePlan(): LifePlan { return { version: 2, days: {}, session: null, missions: [], area: "All areas" }; }
export function loadLifePlan(): LifePlan {
  const raw = window.localStorage.getItem(LIFE_PLAN_KEY) ?? window.localStorage.getItem(LEGACY_LIFE_PLAN_KEY);
  if (!raw) return emptyLifePlan();
  const parsed = JSON.parse(raw);
  if (![1, 2].includes(parsed.version) || !parsed.days || typeof parsed.days !== "object" || Array.isArray(parsed.days)) throw new Error("Unsupported Life history");
  for (const day of Object.values(parsed.days) as LifeDay[]) {
    if (!day || !Array.isArray(day.priorities) || day.priorities.length !== 3 || day.priorities.some(p => !p || typeof p.title !== "string" || typeof p.done !== "boolean") || !day.blocks || typeof day.blocks !== "object" || [day.win, day.lesson, day.tomorrow].some(x => typeof x !== "string") || !Number.isFinite(day.focusMinutes)) throw new Error("Invalid Life history");
  }
  const s = parsed.session;
  if (s && (typeof s.title !== "string" || !Number.isFinite(s.endsAt) || !Number.isFinite(s.minutes) || typeof s.day !== "string")) throw new Error("Invalid focus session");
  const missions = parsed.missions ?? [];
  if (!Array.isArray(missions) || missions.some((m: Mission) => !m || typeof m.id !== "string" || !PILLARS.some(p => p.id === m.pillar) || [m.title,m.detail,m.date,m.time,m.evidence].some(v => typeof v !== "string") || typeof m.done !== "boolean" || !Number.isFinite(m.minutes) || m.minutes <= 0)) throw new Error("Invalid mission history");
  return { version: 2, days: parsed.days, session: s || null, missions, area: typeof parsed.area === "string" ? parsed.area : "All areas" };
}
export const DAY_BLOCKS = [
  { id: "faith", label: "Start with God", time: "15 min", action: "Read a passage, pray, and write one action you will take from it." },
  { id: "build", label: "Build something useful", time: "50 min", action: "Ship one SentryOps improvement or finish one coding exercise. Name the output before you begin." },
  { id: "body", label: "Train & refuel", time: "45–60 min", action: "Follow your workout or recovery plan, eat a proper meal, and get outside." },
  { id: "learn", label: "Learn, then apply", time: "30 min", action: "Read or study, close the material, and write three things you can apply." },
  { id: "responsibility", label: "Handle a responsibility", time: "15 min", action: "Clean your space, prepare a meal, handle an overdue task, or help your mom." },
  { id: "connect", label: "Connect & enjoy life", time: "30–60 min", action: "Talk with someone, go outside, enjoy a hobby, or choose an episode with a stop time." },
  { id: "close", label: "Close the day", time: "5 min", action: "Record a win, learn from a distraction, and choose tomorrow’s first task. Protect your bedtime." },
];
export const REFLECTIONS = [
  ["Keep one promise today that tomorrow’s you can trust.", "Complete the smallest unfinished priority before opening a feed.", "James 1:22"],
  ["Put your faith into the next ordinary act of responsibility.", "Do one useful thing for someone without waiting to be asked.", "Colossians 3:23"],
  ["A strong day is built one deliberate choice at a time.", "Put your phone out of reach for one focused block.", "Proverbs 4:25–27"],
  ["You can restart the day without waiting for tomorrow.", "Stand up, change rooms, and begin a five-minute task.", "Lamentations 3:22–23"],
  ["Confidence grows when your actions become dependable.", "Finish one defined piece of work and record what you produced.", "Luke 16:10"],
  ["Make room for the person you intend to become.", "Clear your desk and remove one distraction before starting.", "Hebrews 12:1"],
  ["Work with purpose. Rest with intention.", "Choose a real stopping time for both work and entertainment.", "Mark 6:31"],
];
export function reflectionIndex(day: string) {
  return [...day].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0);
}
export const DOWNTIME = [
  { minutes: 5, title: "Reset your space", detail: "Make your bed or clear your desk. Leave the phone outside the room." },
  { minutes: 5, title: "Pray & choose", detail: "Pray honestly, then write the one useful action you will do next." },
  { minutes: 5, title: "Reach out", detail: "Check in with a friend or ask your mom what would help today." },
  { minutes: 15, title: "Walk outside", detail: "Take a phone-free walk and return to one specific task." },
  { minutes: 15, title: "Handle the loose end", detail: "Clean, prep a meal, or finish one task you keep postponing." },
  { minutes: 15, title: "Review one trade", detail: "Review an existing trade and document the setup and rule followed. No new trade needed." },
  { minutes: 30, title: "Read & retain", detail: "Read your book and write three useful takeaways in your own words." },
  { minutes: 30, title: "Practice a skill", detail: "Complete one coding exercise and explain how your solution works." },
  { minutes: 30, title: "Make time for someone", detail: "Call a friend, spend time with family, or arrange an in-person activity." },
  { minutes: 60, title: "Move SentryOps forward", detail: "Choose one demo workflow, improve it, and show the finished result." },
  { minutes: 60, title: "Get out & recharge", detail: "Take a trail walk, enjoy a hobby, or spend uninterrupted time with someone." },
];
