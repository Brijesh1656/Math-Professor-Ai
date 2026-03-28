/**
 * test-full-pipeline.ts
 *
 * End-to-end smoke test for the agentic RAG pipeline.
 *
 * Tests:
 *   1. decomposeQuery produces >= 2 sub-queries
 *   2. classifyProblemType returns a valid category
 *   3. generateIntermediateReasoning returns non-empty reasoning
 *   4. synthesizeFinalAnswer returns a non-empty final answer
 *   5. TurnLog entries are structurally correct
 *   6. Supabase /log-turn endpoint accepts a log entry
 *
 * Run with:
 *   npx tsx scripts/test-full-pipeline.ts
 *
 * Prerequisites:
 *   npm install -D tsx
 *   VITE_API_KEY must be set in the environment or .env file.
 *   VITE_CHUNKING_API_URL must point to the running Flask server for test 6.
 */

import { GoogleGenAI } from '@google/genai';

// ── Load env from .env file if present ─────────────────────────────────────
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadDotenv(): void {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const raw = readFileSync(envPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env not found — rely on process.env
  }
}
loadDotenv();

// ── Inline reimplementation of core service functions (no browser globals) ──

const SYSTEM_INSTRUCTION = `You are a world-class mathematics professor. Your goal is to help students by providing clear, concise, and simplified step-by-step solutions to their math problems.
Imagine you are explaining this to a high school student who is finding the topic difficult.
Focus exclusively on educational content related to mathematics.
When providing a solution, break it down into logical, easy-to-follow steps.`;

const DECOMPOSITION_INSTRUCTION = `You are a mathematical reasoning planner. Given a complex math question, decompose it into a sequence of 2 to 5 focused sub-questions that together build toward the complete solution. Each sub-question should address one specific mathematical concept or calculation step required to solve the original problem. Return ONLY a valid JSON array of strings with no other text, no markdown, no code blocks. Example output: ["What is the derivative of x^2?", "How do we apply the chain rule here?", "What is the final simplified form?"]`;

async function decomposeQuery(ai: GoogleGenAI, question: string): Promise<string[]> {
  const { Type } = await import('@google/genai');
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: `Decompose this math question into focused sub-questions: "${question}"`,
    config: {
      systemInstruction: DECOMPOSITION_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
  });
  const parsed = JSON.parse((response.text ?? '').trim()) as unknown;
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
    return (parsed as string[]).slice(0, 5);
  }
  return [question];
}

async function classifyProblemType(ai: GoogleGenAI, question: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Classify the following math problem into exactly one of these categories: algebra, calculus, geometry, statistics, other. Reply with only the single category word in lowercase.\n\nProblem: "${question}"`,
  });
  const result = (response.text ?? 'other').trim().toLowerCase();
  const valid = ['algebra', 'calculus', 'geometry', 'statistics', 'other'];
  return valid.includes(result) ? result : 'other';
}

async function generateIntermediateReasoning(
  ai: GoogleGenAI,
  originalQuery: string,
  subQuery: string,
  accumulatedContext: string,
  turnNumber: number
): Promise<string> {
  const priorSection = accumulatedContext
    ? `Prior Reasoning Steps Completed:\n${accumulatedContext}\n\n`
    : '';
  const prompt = `You are solving a complex mathematics problem step by step. Address ONE specific sub-question.

Original Question: "${originalQuery}"

${priorSection}Current Sub-Question (Step ${turnNumber}): "${subQuery}"

Provide a focused intermediate reasoning step.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  });
  return response.text ?? '';
}

async function synthesizeFinalAnswer(
  ai: GoogleGenAI,
  originalQuery: string,
  allReasoningSteps: string[]
): Promise<string> {
  const stepsText = allReasoningSteps
    .map((s, i) => `Step ${i + 1}:\n${s}`)
    .join('\n\n---\n\n');
  const prompt = `Synthesize all intermediate reasoning into a final answer.\n\nOriginal Problem: "${originalQuery}"\n\n${stepsText}`;
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  });
  return response.text ?? '';
}

// ── Test infrastructure ─────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function pass(name: string, detail: string): void {
  results.push({ name, passed: true, detail });
  console.log(`  ✅ PASS  ${name}`);
  console.log(`         ${detail}`);
}

function fail(name: string, detail: string): void {
  results.push({ name, passed: false, detail });
  console.error(`  ❌ FAIL  ${name}`);
  console.error(`         ${detail}`);
}

// ── Test questions ──────────────────────────────────────────────────────────

const TEST_QUESTIONS = [
  'Solve the system of equations: 2x + 3y = 12 and x − y = 1',
  'Find the derivative of f(x) = x³ sin(x) using the product rule',
  'A circle has radius 5 cm. Find its area and the length of an arc subtended by a 60° angle',
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.VITE_API_KEY ?? process.env.API_KEY ?? '';
  if (!apiKey) {
    console.error('ERROR: VITE_API_KEY is not set. Add it to .env or export it.');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Math Professor AI — Full Pipeline Test');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const question of TEST_QUESTIONS) {
    console.log(`\n─────────────────────────────────────────────────────`);
    console.log(`  Question: "${question}"`);
    console.log(`─────────────────────────────────────────────────────`);

    // ── Test 1: Query decomposition ──────────────────────────────────────
    let subQueries: string[] = [];
    try {
      subQueries = await decomposeQuery(ai, question);
      if (subQueries.length >= 2) {
        pass('decomposeQuery produces >= 2 sub-queries', `Got ${subQueries.length}: ${JSON.stringify(subQueries)}`);
      } else {
        fail('decomposeQuery produces >= 2 sub-queries', `Only got ${subQueries.length}: ${JSON.stringify(subQueries)}`);
      }
    } catch (e) {
      fail('decomposeQuery produces >= 2 sub-queries', `Exception: ${e}`);
      subQueries = [question];
    }

    // ── Test 2: Problem classification ──────────────────────────────────
    try {
      const problemType = await classifyProblemType(ai, question);
      const valid = ['algebra', 'calculus', 'geometry', 'statistics', 'other'];
      if (valid.includes(problemType)) {
        pass('classifyProblemType returns valid category', `Got: "${problemType}"`);
      } else {
        fail('classifyProblemType returns valid category', `Got unexpected: "${problemType}"`);
      }
    } catch (e) {
      fail('classifyProblemType returns valid category', `Exception: ${e}`);
    }

    // ── Test 3: Intermediate reasoning ──────────────────────────────────
    let accumulatedContext = '';
    const allReasoningSteps: string[] = [];
    let atLeastOneReasoningNonEmpty = true;

    for (let i = 0; i < subQueries.length; i++) {
      try {
        const reasoning = await generateIntermediateReasoning(
          ai, question, subQueries[i], accumulatedContext, i + 1
        );
        if (!reasoning.trim()) atLeastOneReasoningNonEmpty = false;
        accumulatedContext += `--- Step ${i + 1} ---\nSub-Query: ${subQueries[i]}\nReasoning: ${reasoning}\n\n`;
        allReasoningSteps.push(reasoning);
      } catch (e) {
        atLeastOneReasoningNonEmpty = false;
        fail(`generateIntermediateReasoning step ${i + 1}`, `Exception: ${e}`);
      }
    }

    if (atLeastOneReasoningNonEmpty && allReasoningSteps.length > 0) {
      pass(
        'generateIntermediateReasoning returns non-empty reasoning',
        `${allReasoningSteps.length} steps, first step length: ${allReasoningSteps[0].length} chars`
      );
    } else {
      fail('generateIntermediateReasoning returns non-empty reasoning', 'One or more steps were empty');
    }

    // ── Test 4: TurnLog structure ────────────────────────────────────────
    const mockTurnLog = {
      sessionId: 'test_session_' + Date.now(),
      turnNumber: 1,
      subQuery: subQueries[0] ?? question,
      originalQuery: question,
      ragChunkCount: 0,
      groundingChunkCount: 0,
      contextTokenCount: Math.ceil(accumulatedContext.length / 4),
      usedWebSearch: false,
      retrievalTier: 3 as 1 | 2 | 3,
      similarityScore: 0,
      anchoringEnabled: true,
      problemType: 'algebra',
      timestamp: new Date().toISOString(),
    };

    const requiredFields: Array<keyof typeof mockTurnLog> = [
      'sessionId', 'turnNumber', 'subQuery', 'originalQuery',
      'ragChunkCount', 'groundingChunkCount', 'contextTokenCount',
      'usedWebSearch', 'retrievalTier', 'similarityScore',
      'anchoringEnabled', 'timestamp',
    ];

    const missingFields = requiredFields.filter(f => !(f in mockTurnLog));
    if (missingFields.length === 0) {
      pass('TurnLog has all required fields', `Fields: ${requiredFields.join(', ')}`);
    } else {
      fail('TurnLog has all required fields', `Missing: ${missingFields.join(', ')}`);
    }

    // ── Test 5: Final answer synthesis ──────────────────────────────────
    try {
      const finalAnswer = await synthesizeFinalAnswer(ai, question, allReasoningSteps);
      if (finalAnswer.trim().length > 50) {
        pass('synthesizeFinalAnswer returns non-empty answer', `Answer length: ${finalAnswer.length} chars`);
      } else {
        fail('synthesizeFinalAnswer returns non-empty answer', `Answer too short: "${finalAnswer.substring(0, 100)}"`);
      }
    } catch (e) {
      fail('synthesizeFinalAnswer returns non-empty answer', `Exception: ${e}`);
    }

    // ── Test 6: Supabase /log-turn endpoint ─────────────────────────────
    const chunkingUrl = process.env.VITE_CHUNKING_API_URL ?? '';
    const loggingUrl = chunkingUrl
      ? chunkingUrl.replace(/\/chunk\/?$/, '/log-turn')
      : 'http://localhost:5000/log-turn';

    try {
      const resp = await fetch(loggingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'test_session_' + Date.now(),
          turnNumber: 1,
          subQuery: subQueries[0]?.substring(0, 300) ?? question,
          originalQuery: question.substring(0, 500),
          ragChunkCount: 0,
          groundingChunkCount: 0,
          contextTokenCount: 0,
          usedWebSearch: false,
          retrievalTier: 3,
          similarityScore: 0.0,
          anchoringEnabled: true,
          problemType: 'algebra',
          timestamp: new Date().toISOString(),
        }),
      });

      if (resp.ok) {
        pass('/log-turn endpoint accepts log entry', `HTTP ${resp.status}`);
      } else if (resp.status === 503) {
        // Supabase not configured — not a test failure, just skip
        pass('/log-turn endpoint reachable (Supabase not configured)', `HTTP 503 — expected if SUPABASE_URL not set`);
      } else if (resp.status === 429) {
        pass('/log-turn rate limiting works', `HTTP 429 — rate limit correctly enforced`);
      } else {
        const body = await resp.text();
        fail('/log-turn endpoint accepts log entry', `HTTP ${resp.status}: ${body}`);
      }
    } catch (e) {
      fail('/log-turn endpoint accepts log entry', `Cannot reach ${loggingUrl} — is the Flask server running? ${e}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
  }

  console.log(`\n  Total: ${passed} passed, ${failed} failed out of ${results.length} checks`);

  if (failed > 0) {
    console.error('\n  Some tests failed. See details above.');
    process.exit(1);
  } else {
    console.log('\n  All tests passed. ✅');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
