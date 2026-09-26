"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "jarvis-trading-rules-v1";

const RULES = [
  "Mark out 4H and 1D zones",
  "Identify trend",
  "Wait for price to hit HTF zone",
  "Wait for someone to lose",
  "Wait for confirmation back in my direction",
  "Look for entry",
] as const;

type RuleHistory = Record<string, boolean[]>;

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function loadHistory(): RuleHistory {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RuleHistory;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default function DwightTradingRules() {
  const day = useMemo(() => localDay(), []);
  const [checks, setChecks] = useState<boolean[]>(() => RULES.map(() => false));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const history = loadHistory();
    const saved = Array.isArray(history[day]) ? history[day] : [];
    setChecks(RULES.map((_, index) => saved[index] === true));
    setReady(true);
  }, [day]);

  function toggle(index: number) {
    const next = checks.map((value, current) => current === index ? !value : value);
    setChecks(next);
    const history = loadHistory();
    history[day] = next;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    window.dispatchEvent(new Event("jarvis-trading-account-updated"));
  }

  const complete = checks.filter(Boolean).length;

  return (
    <div className="dwight-rules">
      <div className="dwight-rules-header"><span>RULES</span><b aria-label={`${ready ? complete : 0} of ${RULES.length} rules checked`}>{ready ? complete : 0}/{RULES.length}</b></div>
      {RULES.map((rule, index) => (
        <label className="dwight-rule-row" key={rule}>
          <input
            type="checkbox"
            checked={checks[index] ?? false}
            onChange={() => toggle(index)}
            aria-label={`Rule ${index + 1}: ${rule}`}
          />
          <span className="dwight-rule-box" aria-hidden="true">{checks[index] ? <Check size={9} /> : null}</span>
          <span className="dwight-rule-copy"><b>{String(index + 1).padStart(2, "0")}</b>{rule}</span>
        </label>
      ))}
    </div>
  );
}
