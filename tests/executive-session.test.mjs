import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function loadExecutiveModule() {
  const source = readFileSync(new URL('../lib/executive-session.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const decisionSource = readFileSync(new URL('../lib/executive-decision.ts', import.meta.url), 'utf8');
  const decisionCode = ts.transpileModule(decisionSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const decisionExports = {};
  runInNewContext(decisionCode, { exports: decisionExports });

  runInNewContext(code, {
    exports,
    TextEncoder,
    AbortSignal,
    crypto: globalThis.crypto,
    require(name) {
      if (name === '@ai-sdk/anthropic') return { anthropic: () => ({}) };
      if (name === '@ai-sdk/openai') return { openai: () => ({}) };
      if (name === 'ai') return { generateText: async () => { throw new Error('real provider must not run in unit tests'); } };
      if (name === './jarvis-models') return { JARVIS_MODELS: { gptExecutive: 'gpt-6-astra', claudeDeep: 'claude-opus-5' } };
      if (name === './hjv-constitution') return {
        HJV_CONSTITUTION_SYSTEM: 'test constitution',
        HJV_CONSTITUTION_VERSION: '1.0',
        HJV_EXECUTIVE_AGREEMENT_VERSION: '1.0',
        HJV_EXECUTIVE_SOP_VERSION: '1.0',
        HJV_EXECUTIVE_SESSION: { maxModelExchanges: 3, defaultMode: 'RECOMMENDATION_ONLY' },
      };
      if (name === './executive-decision') return decisionExports;
      if (name === './jarvis-runtime') return {
        appendRuntimeEvent: async () => {},
        createRuntimeEvent: input => ({ id: 'event', type: input.type, domain: 'CORE', source: input.source, importance: input.importance, occurredAt: input.occurredAt, receivedAt: input.occurredAt, summary: input.summary }),
      };
      throw new Error('Unexpected require: ' + name);
    },
  });
  return { exports, source };
}

function ok(text, brain, role, model) {
  return {
    ok: true,
    text,
    call: { brain, role, model, finishReason: 'stop', inputTokens: 10, outputTokens: 10, totalTokens: 20 },
  };
}

function fail(message, brain, role, model) {
  return {
    ok: false,
    error: message,
    call: { brain, role, model, finishReason: 'error', inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function queuedRunner(queue) {
  return async input => {
    const next = queue.shift();
    assert.ok(next, 'unexpected extra model call');
    return typeof next === 'function' ? next(input) : next;
  };
}

const noAudit = async () => {};

test('A: reviewer REJECT cannot be overwritten by lead APPROVE', async () => {
  const { exports } = loadExecutiveModule();
  const result = await exports.runExecutiveSession(
    { objective: 'Decide whether to ship this architecture', preferredLead: 'GPT' },
    {
      isConfigured: () => true,
      persistAudit: noAudit,
      runModel: queuedRunner([
        ok('proposal', 'GPT', 'LEAD', 'gpt-6-astra'),
        ok('review\nREVIEW: REJECT', 'CLAUDE', 'REVIEWER', 'claude-opus-5'),
        ok('reconcile\nDECISION: APPROVE', 'GPT', 'RECONCILER', 'gpt-6-astra'),
      ]),
    },
  );
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.decision, 'ESCALATE_DWIGHT');
  assert.equal(result.independentReview, true);
  assert.equal(result.reviewer, 'CLAUDE');
});

test('B: only the final DECISION line is parsed', async () => {
  const { exports } = loadExecutiveModule();
  const result = await exports.runExecutiveSession(
    { objective: 'Decide whether to ship this architecture', preferredLead: 'GPT' },
    {
      isConfigured: () => true,
      persistAudit: noAudit,
      runModel: queuedRunner([
        ok('proposal', 'GPT', 'LEAD', 'gpt-6-astra'),
        ok('review\nREVIEW: PASS', 'CLAUDE', 'REVIEWER', 'claude-opus-5'),
        ok('Template: DECISION: APPROVE | REJECT\nReasoning\nDECISION: REJECT', 'GPT', 'RECONCILER', 'gpt-6-astra'),
      ]),
    },
  );
  assert.equal(result.decision, 'REJECT');
});

test('C: malformed decision wording escalates instead of normalizing to APPROVE', async () => {
  const { exports } = loadExecutiveModule();
  const result = await exports.runExecutiveSession(
    { objective: 'Decide whether to ship this architecture', preferredLead: 'GPT' },
    {
      isConfigured: () => true,
      persistAudit: noAudit,
      runModel: queuedRunner([
        ok('proposal', 'GPT', 'LEAD', 'gpt-6-astra'),
        ok('review\nREVIEW: PASS_WITH_CONDITIONS', 'CLAUDE', 'REVIEWER', 'claude-opus-5'),
        ok('Decision: Approve with conditions', 'GPT', 'RECONCILER', 'gpt-6-astra'),
      ]),
    },
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.decision, 'ESCALATE_DWIGHT');
});

test('D: lead failure plus peer fallback is degraded and has no reviewer', async () => {
  const { exports } = loadExecutiveModule();
  const result = await exports.runExecutiveSession(
    { objective: 'Decide whether to ship this architecture', preferredLead: 'GPT' },
    {
      isConfigured: () => true,
      persistAudit: noAudit,
      runModel: queuedRunner([
        fail('GPT outage', 'GPT', 'LEAD', 'gpt-6-astra'),
        ok('Claude fallback proposal', 'CLAUDE', 'LEAD', 'claude-opus-5'),
      ]),
    },
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.lead, 'CLAUDE');
  assert.equal(result.reviewer, null);
  assert.equal(result.independentReview, false);
  assert.equal(result.decision, 'ESCALATE_DWIGHT');
});

test('E: reviewer call failure is degraded and does not claim independent review', async () => {
  const { exports } = loadExecutiveModule();
  const result = await exports.runExecutiveSession(
    { objective: 'Decide whether to ship this architecture', preferredLead: 'GPT' },
    {
      isConfigured: () => true,
      persistAudit: noAudit,
      runModel: queuedRunner([
        ok('proposal', 'GPT', 'LEAD', 'gpt-6-astra'),
        fail('Claude outage', 'CLAUDE', 'REVIEWER', 'claude-opus-5'),
      ]),
    },
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.reviewer, null);
  assert.equal(result.independentReview, false);
  assert.equal(result.decision, 'ESCALATE_DWIGHT');
});

test('F: no proposal produced is FAILED', async () => {
  const { exports } = loadExecutiveModule();
  const result = await exports.runExecutiveSession(
    { objective: 'Decide whether to ship this architecture', preferredLead: 'GPT' },
    {
      isConfigured: brain => brain === 'CLAUDE',
      persistAudit: noAudit,
      runModel: queuedRunner([
        fail('Claude outage', 'CLAUDE', 'LEAD', 'claude-opus-5'),
      ]),
    },
  );
  assert.equal(result.status, 'FAILED');
  assert.equal(result.proposal, null);
  assert.equal(result.reviewer, null);
  assert.equal(result.independentReview, false);
  assert.equal(result.decision, 'ESCALATE_DWIGHT');
});

test('executive model calls expose no tools', () => {
  const { source } = loadExecutiveModule();
  assert.equal(/\btools\s*:/.test(source), false);
});

test('Constitution document version matches runtime version', () => {
  const doc = readFileSync(new URL('../docs/company/constitution.md', import.meta.url), 'utf8');
  const policy = readFileSync(new URL('../lib/hjv-constitution.ts', import.meta.url), 'utf8');
  const docVersion = doc.match(/\*\*Version:\*\*\s*([^\s]+)/)?.[1];
  const codeVersion = policy.match(/HJV_CONSTITUTION_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert.equal(docVersion, codeVersion);
});
