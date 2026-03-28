import { createClient } from '@supabase/supabase-js';

export interface TurnLog {
  sessionId: string;
  turnNumber: number;
  subQuery: string;
  originalQuery: string;
  ragChunkCount: number;
  groundingChunkCount: number;
  contextTokenCount: number;
  usedWebSearch: boolean;
  retrievalTier: 1 | 2 | 3;
  similarityScore: number;
  anchoringEnabled: boolean;
  wasCorrect?: boolean;
  problemType?: string;
  timestamp: string;
}

const STORAGE_KEY = 'rag_research_logs';

let _sessionId: string = generateId();
let _turnNumber: number = 0;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function resetSession(): void {
  _sessionId = generateId();
  _turnNumber = 0;
}

export function saveTurnLog(
  entry: Omit<TurnLog, 'sessionId' | 'turnNumber' | 'timestamp'>
): void {
  _turnNumber += 1;

  const log: TurnLog = {
    ...entry,
    sessionId: _sessionId,
    turnNumber: _turnNumber,
    timestamp: new Date().toISOString(),
  };

  // Persist to localStorage
  try {
    const existing: TurnLog[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '[]'
    );
    existing.push(log);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // Intentional no-op
  }

  // Fire-and-forget direct Supabase insert
  if (supabase) {
    supabase.from('rag_logs').insert({
      session_id: log.sessionId,
      turn_number: log.turnNumber,
      sub_query: log.subQuery,
      original_query: log.originalQuery,
      rag_chunk_count: log.ragChunkCount,
      grounding_chunk_count: log.groundingChunkCount,
      context_token_count: log.contextTokenCount,
      used_web_search: log.usedWebSearch,
      retrieval_tier: log.retrievalTier,
      similarity_score: log.similarityScore,
      anchoring_enabled: log.anchoringEnabled,
      was_correct: log.wasCorrect ?? null,
      problem_type: log.problemType ?? 'other',
      ip_hash: 'anonymous',
      timestamp: log.timestamp,
    }).then(() => {
      if (import.meta.env.DEV) {
        console.log(`[RAG Logger] Turn ${log.turnNumber} logged to Supabase ✓ session: ${log.sessionId}`);
      }
    }).catch(() => {});
  }
}

export function markLastTurnCorrect(correct: boolean): void {
  try {
    const existing: TurnLog[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '[]'
    );
    for (let i = existing.length - 1; i >= 0; i--) {
      if (existing[i].sessionId === _sessionId) {
        existing[i].wasCorrect = correct;
        break;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // Intentional no-op
  }
}

export function getLogCount(): number {
  try {
    const existing: TurnLog[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '[]'
    );
    return existing.length;
  } catch {
    return 0;
  }
}

export function downloadLogs(): void {
  try {
    const existing: TurnLog[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '[]'
    );
    const blob = new Blob([JSON.stringify(existing, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag_logs_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // Intentional no-op
  }
}

export function clearLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Intentional no-op
  }
}
