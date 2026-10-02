"use client";

import { useState } from "react";
import { ArrowUpRight, AlertTriangle, Building2, CalendarCheck, ChevronDown, ShieldCheck, Users } from "lucide-react";

const SENTRYOPS_ORIGIN = "https://sentryops-prototype-co845i4oz-dwights-projects-8a9a094f.vercel.app";

// Figures and decisions are a compact reproduction of the existing SentryOps
// CommandDashboard demo fixture. They are NOT current agency/production data.
const snapshot = [
  { label: "PERSONNEL", value: "164", meta: "14 vacancies · Patrol B-Shift risk", icon: Users, url: "/command/personnel" },
  { label: "CRITICAL INCIDENTS", value: "3", meta: "2 escalated · command attention", icon: AlertTriangle, url: "/command/approvals" },
  { label: "COMPLIANCE", value: "94%", meta: "Policies 94% · training 91%", icon: ShieldCheck, url: "/command/risk" },
  { label: "BUDGET UTILIZATION", value: "85%", meta: "Overtime 19% above baseline", icon: Building2, url: "/command/budget" },
] as const;

const approvals = [
  {
    label: "Use of Force Review", team: "Detention", priority: "CRITICAL",
    detail: "Demonstration record: incident review requires supervisory decision and compliance follow-up.",
  },
  {
    label: "Emergency Purchase", team: "Facilities", priority: "CRITICAL",
    detail: "Demonstration record: H2-Pod HVAC repair request · $23,500.",
  },
  {
    label: "Overtime Authorization", team: "Patrol", priority: "ACTION",
    detail: "Demonstration record: B-Shift staffing shortfall · 160 hours requested.",
  },
  {
    label: "Hiring Decision", team: "Human Resources", priority: "STANDARD",
    detail: "Demonstration record: completed background awaiting decision.",
  },
] as const;

const modules = [
  { title: "COMMAND", sub: "Executive view", href: "/command/dashboard" },
  { title: "HIRING", sub: "HR pipeline", href: "/hr/pipeline" },
  { title: "BACKGROUNDS", sub: "Investigations", href: "/bi/dashboard" },
  { title: "ORG CHART", sub: "Personnel structure", href: "/command/orgchart" },
] as const;

function fullUrl(path: string) {
  return SENTRYOPS_ORIGIN + path;
}

export default function SentryOpsCommandPreview() {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="sentryops-demo" aria-label="SentryOps prototype dashboard preview">
      <div className="sentryops-demo-header">
        <div>
          <span>SENTRYOPS / EXISTING PROTOTYPE</span>
          <strong>COMMAND DASHBOARD</strong>
          <small>Native compact preview · sample records from the original demo</small>
        </div>
        <a className="sentryops-demo-open" href={fullUrl("/command/dashboard")} target="_blank" rel="noopener noreferrer">
          OPEN FULL DEMO <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </div>

      <div className="sentryops-demo-viewport sentryops-native">
        <div className="sentryops-native-top">
          <div><span>COMMAND / EXECUTIVE</span><strong>Agency oversight</strong><small>Demonstration data · no live agency connection</small></div>
          <span className="sentryops-demo-tag">PRODUCT PREVIEW</span>
        </div>
        <div className="sentryops-native-stats">
          {snapshot.map(item => {
            const Icon = item.icon;
            return (
              <a key={item.label} href={fullUrl(item.url)} target="_blank" rel="noopener noreferrer" className="sentryops-stat">
                <div><span>{item.label}</span><Icon size={13} aria-hidden="true" /></div>
                <strong>{item.value}</strong>
                <small>{item.meta}</small>
              </a>
            );
          })}
        </div>
        <div className="sentryops-native-columns">
          <section className="sentryops-native-section">
            <header><span>DECISION QUEUE</span><a href={fullUrl("/command/approvals")} target="_blank" rel="noopener noreferrer">VIEW ALL <ArrowUpRight size={11} /></a></header>
            <div className="sentryops-approval-list">
              {approvals.map(item => (
                <div className="sentryops-approval" key={item.label}>
                  <button type="button" aria-expanded={expanded === item.label} onClick={() => setExpanded(value => value === item.label ? null : item.label)}>
                    <span className={"sentryops-tier priority-" + item.priority.toLowerCase()}>{item.priority}</span>
                    <span className="sentryops-approval-name">{item.label}<small>{item.team}</small></span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                  {expanded === item.label ? <p>{item.detail} <a href={fullUrl("/command/approvals")} target="_blank" rel="noopener noreferrer">Open decision queue ↗</a></p> : null}
                </div>
              ))}
            </div>
          </section>
          <section className="sentryops-native-section">
            <header><span>EXECUTIVE INTELLIGENCE</span><ShieldCheck size={13} aria-hidden="true" /></header>
            <div className="sentryops-signal">
              <b>STAFFING RISK</b>
              <p>Patrol B-Shift: 9 of 12 minimum positions covered in the demo scenario.</p>
            </div>
            <div className="sentryops-signal">
              <b>RESOURCE PRESSURE</b>
              <p>Overtime forecast above the modeled monthly baseline.</p>
            </div>
            <div className="sentryops-signal">
              <b>OPERATING FOCUS</b>
              <p>Review approvals, hiring progress and background-case continuity.</p>
            </div>
          </section>
        </div>
        <div className="sentryops-native-section sentryops-native-modules">
          <header><span>PROTOTYPE MODULES</span><CalendarCheck size={13} aria-hidden="true" /></header>
          <div className="sentryops-module-grid">
            {modules.map(module => <a href={fullUrl(module.href)} target="_blank" rel="noopener noreferrer" key={module.title}>
              <b>{module.title}</b><small>{module.sub}</small><ArrowUpRight size={12} aria-hidden="true" />
            </a>)}
          </div>
        </div>
      </div>
      <p className="sentryops-demo-note">
        This is an integrated preview of existing demo content, not a live agency feed. Select a tile or Open Full Demo to work inside SentryOps itself.
      </p>
    </section>
  );
}
