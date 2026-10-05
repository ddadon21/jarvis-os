import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../lib/jarvis-memory.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
runInNewContext(code, { exports, require: (name) => name === 'node:crypto' ? { createHash } : { durableRead: async () => null, durableWrite: async () => true } });

test('memory ids dedupe by content regardless of spacing and case', () => {
  assert.equal(exports.memoryId('Dwight trades  MNQ'), exports.memoryId('dwight trades mnq'));
});

test('secrets and junk are never stored', () => {
  assert.equal(exports.isSafeMemory('My password is hunter2'), false);
  assert.equal(exports.isSafeMemory('card 4111111111111111'), false);
  assert.equal(exports.isSafeMemory('api_key: abc'), false);
  assert.equal(exports.isSafeMemory('ok'), false);
  assert.equal(exports.isSafeMemory('Dwight takes at most two trades per day on Lucid.'), true);
});
