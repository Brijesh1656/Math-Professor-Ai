
export interface TurnLog {
  sessionId: string;
  turnNumber: number;
  subQuery: string;              // The actual decomposed sub-query text (not the original question)
  originalQuery: string;         // The original user question
  ragChunkCount: number;         // Number of chunks retrieved from TF-IDF vector store
  groundingChunkCount: number;   // Number of web search grounding chunks from Gemini metadata
  contextTokenCount: number;     // Approximate token count of accumulated context at this turn
  usedWebSearch: boolean;        // Whether Tier 3 (Google Search) fired for this turn
  retrievalTier: 1 | 2 | 3;     // Which retrieval tier actually provided context
  similarityScore: number;       // Top TF-IDF cosine similarity score (0 if web search or no RAG)
  anchoringEnabled: boolean;     // Whether turn-aware keyword anchoring (Fix 5) was active
  wasCorrect?: boolean;          // Set by markLastTurnCorrect() from human feedback
  problemType?: string;          // algebra / calculus / geometry / statistics / other
  timestamp: string;
}

const STORAGE_KEY = 'rag_research_logs';

let _sessionId: string = generateId();
let _turnNumber: number = 0;

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

  // Persist to localStorage — silent fail so logging never breaks the UI
  try {
    const existing: TurnLog[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '[]'
    );
    existing.push(log);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // Intentional no-op
  }

  // Fire-and-forget server-side logging to Supabase via Flask endpoint
  sendLogToServer(log).catch(() => {});
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

// Derive the logging API URL from the chunking API URL env var so no extra
// env variable is needed.
function getLoggingApiUrl(): string {
  const chunkingUrl = (import.meta.env.VITE_CHUNKING_API_URL as string) || '';
  if (chunkingUrl) {
    return chunkingUrl.replace(/\/chunk\/?$/, '/log-turn');
  }
  return import.meta.env.DEV
    ? 'http://localhost:5000/log-turn'
    : '/api/log-turn';
}

async function sendLogToServer(log: TurnLog): Promise<void> {
  const url = getLoggingApiUrl();
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(log),
  });
}

