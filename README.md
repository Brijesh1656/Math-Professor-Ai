# 🧮 Math Professor AI

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.3.1-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2.2-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7.1.12-646CFF.svg)](https://vitejs.dev/)
[![Google Gemini](https://img.shields.io/badge/Google-Gemini%202.5-4285F4.svg)](https://deepmind.google/technologies/gemini/)
[![Python](https://img.shields.io/badge/Python-Flask-green.svg)](https://flask.palletsprojects.com/)

**An agentic multi-turn RAG system that solves mathematics problems step-by-step using Google Gemini 2.5 and a three-tier retrieval cascade.**

[Live Demo](https://math-professor-agent-k6h4.vercel.app) · [Report Bug](https://github.com/Brijesh1656/Math-Professor-Ai/issues) · [Request Feature](https://github.com/Brijesh1656/Math-Professor-Ai/issues)

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [How It Works](#-how-it-works)
- [Key Features](#-key-features)
- [Technology Stack](#-technology-stack)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Environment Variables](#-environment-variables)
- [Usage Guide](#-usage-guide)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**Math Professor AI** is a research-grade mathematics tutoring system. Rather than answering in a single pass, it decomposes each question into sub-questions, reasons through them one by one, and synthesizes a final answer — an approach known as **agentic multi-turn RAG**.

Every reasoning turn is logged with 14 metadata fields (retrieval tier, TF-IDF similarity score, accumulated context size, problem type, and more) for research analysis of how retrieval quality changes across agentic turns.

---

## ⚙️ How It Works

Every user question goes through a **5-step agentic pipeline**:

```
User Question
     │
     ▼
1. Guardrail Check (Gemini 2.5 Flash)
   └─ Non-math? → Reject with message
     │
     ▼
2. Problem Classification (Gemini 2.5 Flash)
   └─ algebra / calculus / geometry / statistics / other
     │
     ▼
3. Query Decomposition (Gemini 2.5 Pro)
   └─ Break into 2–5 focused sub-questions (JSON schema enforced)
     │
     ▼
4. Agentic Reasoning Loop  ◄─────────────────────────────────┐
   │                                                          │
   ├─ Three-Tier Retrieval Cascade:                          │
   │   Tier 1: TF-IDF cosine similarity (threshold 0.15)     │
   │   Tier 2: Keyword knowledge base (30 entries)           │
   │   Tier 3: Google Search grounding (auto-fallback)       │
   │                                                          │
   ├─ Generate Intermediate Reasoning (Gemini 2.5 Pro)       │
   │   └─ Receives: sub-query + retrieved context +          │
   │      ALL prior reasoning steps (growing context)        │
   │                                                          │
   ├─ Log TurnLog (14 fields → localStorage + Supabase)      │
   │                                                          │
   └─ next sub-question ─────────────────────────────────────┘
     │
     ▼
5. Final Synthesis (Gemini 2.5 Pro)
   └─ Combines all intermediate reasoning into a complete answer
```

---

## ✨ Key Features

### 🤖 Agentic Multi-Turn Reasoning

- **Query decomposition**: Gemini 2.5 Pro breaks complex questions into 2–5 focused sub-questions using a dedicated mathematical reasoning planner
- **Per-turn retrieval**: Each sub-question runs independently through the full three-tier retrieval cascade
- **Growing context window**: Every reasoning step's output is appended to an `accumulatedContext` string passed to all subsequent steps — the model always sees all prior work
- **Turn-aware anchoring**: When enabled (`USE_ANCHORING = true`), the original question is prepended to every sub-query before retrieval to prevent context drift

### 🔍 Three-Tier Retrieval Cascade

| Tier | Method | Trigger |
|------|--------|---------|
| **1** | TF-IDF cosine similarity on uploaded document chunks | Similarity ≥ 0.15, returns top-3 |
| **2** | Keyword substring match against 30 built-in KB entries | Tier 1 returns 0 results |
| **3** | Google Search grounding via Gemini API | Tiers 1 and 2 both miss |

The TF-IDF implementation uses sublinear TF scaling (`1 + log(tf)`), IDF weighting (`log((1+N)/(1+df)) + 1`), L2 normalisation, and a vocabulary capped at 10,000 terms. Vocabulary is rebuilt from all stored chunks at every retrieval call so IDF weights stay consistent as the corpus grows.

### 📊 Research Logging

Every reasoning turn is logged with 14 fields:

| Field | Description |
|-------|-------------|
| `sessionId` | Resets on every new user question |
| `turnNumber` | Position within the sub-query sequence |
| `subQuery` | The decomposed sub-question text |
| `originalQuery` | The user's full original question |
| `ragChunkCount` | Chunks retrieved from TF-IDF (Tier 1) |
| `groundingChunkCount` | Chunks from Google Search (Tier 3) |
| `contextTokenCount` | Approximate size of accumulated context |
| `usedWebSearch` | Whether Tier 3 fired |
| `retrievalTier` | Which tier actually provided context |
| `similarityScore` | Top TF-IDF cosine similarity score |
| `anchoringEnabled` | Whether turn-aware anchoring was active |
| `wasCorrect` | Set by thumbs-up/down feedback |
| `problemType` | algebra / calculus / geometry / statistics / other |
| `timestamp` | ISO 8601 UTC |

Logs are stored in browser `localStorage` and sent fire-and-forget to a Supabase database via a Flask `/log-turn` endpoint. Raw IPs are never stored — a SHA-256 hash is used instead.

### 📄 Document Processing

- Upload PDF or TXT files — they are semantically chunked (Python + spaCy) and indexed into the TF-IDF vector store
- AI extracts math questions from the document; click any to solve it
- After a feedback correction, the refined Q&A is re-indexed into the vector store for future retrieval

### 🔄 Human-in-the-Loop Feedback

- **Thumbs up** → marks last turn as `wasCorrect = true`
- **Thumbs down** → opens correction input → `wasCorrect = false` → Gemini 2.5 Pro refines the answer → corrected Q&A is re-indexed into the RAG store

### 🛡️ Privacy

A permanent footer notice informs users that anonymous session metadata is collected for research. Conversation content is never stored server-side.

---

## 🛠️ Technology Stack

### Frontend

| Library | Version | Purpose |
|---------|---------|---------|
| React | 18.3.1 | UI framework |
| TypeScript | 5.2.2 | Type safety |
| Vite | 7.1.12 | Build tool and dev server |
| Tailwind CSS | 3.4.4 | Utility-first styling |
| `@google/genai` | ^1.28.0 | Gemini API SDK |
| `pdfjs-dist` | 4.5.136 | PDF text extraction |
| `marked` | ^16.4.1 | Markdown rendering |
| `concurrently` | ^8.2.2 | Run React + Python API in parallel |

### Backend (Python Flask)

| Library | Purpose |
|---------|---------|
| Flask | HTTP API for semantic chunking and turn logging |
| flask-cors | Cross-origin request support |
| spaCy | Sentence boundary detection for chunking |
| sentence-transformers | Semantic similarity for chunk splitting |
| tiktoken | Token counting |
| supabase-py | Server-side Supabase logging |

### Infrastructure

| Service | Purpose |
|---------|---------|
| Supabase | PostgreSQL database for research turn logs |
| Vercel | Frontend hosting |
| GitHub | Source code |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      React Frontend                          │
│  App.tsx — 5-step agentic pipeline orchestration            │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  geminiService │  │  ragService  │  │  logger + privacy │  │
│  │  (4 AI fns)   │  │  (TF-IDF)    │  │  (14-field log)   │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└──────────────────────────────┬───────────────────────────────┘
                               │
           ┌───────────────────┼──────────────────────┐
           ▼                   ▼                      ▼
  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
  │  Google Gemini  │  │  Flask API   │  │    Supabase DB   │
  │  2.5 Pro/Flash  │  │  /chunk      │  │  rag_logs table  │
  │  + Google Search│  │  /log-turn   │  │  (SHA-256 IP)    │
  └─────────────────┘  └──────────────┘  └──────────────────┘
```

---

## 📥 Installation

### Prerequisites

- **Node.js** v18+ — [Download](https://nodejs.org/)
- **Python** 3.9+ (for the Flask chunking API)
- **Google Gemini API key** — [Get free key](https://aistudio.google.com/app/apikey)

### 1. Clone

```bash
git clone https://github.com/Brijesh1656/Math-Professor-Ai.git
cd Math-Professor-Ai
```

### 2. Install frontend dependencies

```bash
cd math-routing-agent
npm install
```

### 3. Install Python dependencies (optional — needed for document upload)

```bash
cd ../rag_pipeline
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### 4. Configure environment variables

```bash
# math-routing-agent/.env
VITE_API_KEY=your_google_gemini_api_key_here

# Optional — enables document chunking
VITE_CHUNKING_API_URL=http://localhost:5000/chunk
```

> **Never commit `.env` to version control.** It is listed in `.gitignore`.

### 5. Start the dev server

```bash
# React only (no document upload)
cd math-routing-agent
npm run start

# React + Python chunking API together
npm run dev
```

App runs at **http://localhost:5173**

### 6. Run smoke tests

```bash
cd math-routing-agent
npx tsx scripts/test-full-pipeline.ts
```

Verifies: decomposition ≥ 2 sub-queries, valid classification, non-empty reasoning, TurnLog field completeness, final synthesis, and `/log-turn` endpoint reachability.

---

## 🔑 Environment Variables

| Variable | Where | Required | Description |
|----------|-------|----------|-------------|
| `VITE_API_KEY` | `math-routing-agent/.env` | **Yes** | Google Gemini API key |
| `VITE_CHUNKING_API_URL` | `math-routing-agent/.env` | No | URL to Flask `/chunk` endpoint. Also used to derive `/log-turn` URL. |
| `SUPABASE_URL` | Flask server env | No | Supabase project URL. Without this, server-side logging is disabled (HTTP 503 is silently ignored). |
| `SUPABASE_SERVICE_KEY` | Flask server env | No | Supabase service role key (not anon key). |

---

## 📚 Usage Guide

### Asking Questions

Type any math question and press Enter. The system will:
1. Validate it is math-related
2. Decompose it into sub-questions
3. Show live progress: *"Reasoning step 2 of 4: How do we apply the chain rule here?"*
4. Display a complete synthesized answer

**Example questions:**
- `Solve the system: 2x + 3y = 12 and x − y = 1`
- `Find the derivative of f(x) = x³ sin(x) using the product rule`
- `A circle has radius 5 cm. Find its area and arc length for a 60° angle`

### Uploading Documents

1. Click the upload icon (☁️) in the input area
2. Select a `.pdf` or `.txt` file
3. The system chunks, indexes, and extracts questions automatically
4. Click any extracted question to solve it, or ask anything about the document

### Feedback

- **👍 Helpful** — marks the answer as correct in logs
- **👎 Not Helpful** — opens a text box; submit a correction to get a refined answer and re-index the correction into the RAG store

### Exporting Logs

Click **📊 Export Logs** (bottom right) to download all session turn logs as a JSON file for offline analysis.

---

## 📁 Project Structure

```
Math-Professor-Ai/
├── math-routing-agent/          # React + TypeScript frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatInput.tsx         # Message input
│   │   │   ├── MessageBubble.tsx     # Chat message + TypingIndicator
│   │   │   ├── FileUpload.tsx        # File upload button
│   │   │   ├── ExtractedQuestions.tsx # Clickable question list
│   │   │   ├── Feedback.tsx          # Thumbs up/down + correction UI
│   │   │   └── SourcePill.tsx        # Web source citation badge
│   │   ├── services/
│   │   │   ├── geminiService.ts      # All Gemini AI functions
│   │   │   ├── ragService.ts         # TF-IDF vector store + retrieval
│   │   │   ├── chunkingService.ts    # Flask chunking API client
│   │   │   └── logger.ts             # 14-field TurnLog + Supabase send
│   │   ├── hooks/
│   │   │   └── useKnowledgeBase.ts   # 30-entry keyword KB (Tier 2)
│   │   ├── lib/
│   │   │   └── privacy.ts            # Privacy notice text
│   │   ├── App.tsx                   # 5-step agentic pipeline
│   │   ├── types.ts                  # TypeScript types
│   │   ├── constants.tsx             # SVG icons
│   │   ├── index.css                 # Glassmorphism + animations
│   │   └── index.tsx                 # Entry point
│   ├── scripts/
│   │   └── test-full-pipeline.ts     # End-to-end smoke test
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   └── .env                          # Git-ignored — add your API key here
│
├── rag_pipeline/                # Python Flask backend
│   ├── semantic_chunker.py          # Sentence-aware semantic chunking
│   ├── api_server.py                # /chunk and /log-turn endpoints
│   ├── requirements.txt             # Python dependencies
│   └── requirements_api.txt
│
├── supabase/
│   └── schema.sql                   # rag_logs table + RLS policies
│
├── AUDIT_REPORT.md              # Full pre/post-fix technical audit
├── .gitignore
└── README.md
```

---

## 🔧 API Reference

### Gemini Service Functions (`geminiService.ts`)

#### `isMathQuestion(ai, question)` → `Promise<boolean>`
Validates mathematical relevance using Gemini 2.5 Flash. Fails open (returns `true`) on API error.

#### `classifyProblemType(ai, question)` → `Promise<string>`
Returns one of: `algebra`, `calculus`, `geometry`, `statistics`, `other`.
Model: Gemini 2.5 Flash.

#### `decomposeQuery(ai, question)` → `Promise<string[]>`
Returns 2–5 focused sub-questions. Uses JSON schema enforcement (`responseMimeType: 'application/json'`). Falls back to `[question]` on parse failure.
Model: Gemini 2.5 Pro.

#### `generateIntermediateReasoning(ai, originalQuery, subQuery, retrievedContext, accumulatedContext, turnNumber)` → `Promise<{reasoning, sources, groundingChunkCount}>`
Generates one reasoning step. Includes all prior context. Enables Google Search grounding automatically when `retrievedContext` is null.
Model: Gemini 2.5 Pro.

#### `synthesizeFinalAnswer(ai, originalQuery, allReasoningSteps)` → `Promise<{answer, sources}>`
Combines all intermediate reasoning into a final answer.
Model: Gemini 2.5 Pro.

#### `refineSolution(ai, originalQuestion, originalAnswer, feedback)` → `Promise<string>`
Refines an answer based on user correction feedback.
Model: Gemini 2.5 Pro.

#### `extractQuestionsFromFile(ai, fileContent)` → `Promise<string[]>`
Extracts math questions from document text using structured JSON output.
Model: Gemini 2.5 Flash.

---

### Flask API Endpoints (`api_server.py`)

#### `POST /chunk`
Semantically chunks a document using spaCy + sentence-transformers.

```json
Request:  { "text": "...", "overlap_tokens": 64, "max_chunk_tokens": 512 }
Response: { "success": true, "chunks": [...], "total_chunks": 12 }
```

#### `POST /log-turn`
Inserts a TurnLog row into Supabase. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` on the server.

- SHA-256 hashes the caller IP before storing
- Rate limits: max 5 sessions per IP per 24h, max 8 turns per session
- Returns HTTP 503 if Supabase is not configured (silently ignored by frontend)

#### `GET /health`
Returns `{ "status": "healthy", "chunking_available": bool, "supabase_available": bool }`

---

## 🚀 Deployment

### Frontend — Vercel (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Brijesh1656/Math-Professor-Ai)

Set environment variable in Vercel dashboard:
- `VITE_API_KEY` = your Google Gemini API key

### Backend (Flask) — Railway / Render / Fly.io

```bash
cd rag_pipeline
pip install -r requirements_api.txt
python api_server.py
```

Set environment variables on the server:
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SERVICE_KEY` = your Supabase service role key
- `PORT` = port to listen on (default 5000)

Then set `VITE_CHUNKING_API_URL=https://your-api.railway.app/chunk` in the frontend env.

### Supabase Database

Run the SQL in `supabase/schema.sql` in your Supabase project's SQL editor. This creates the `rag_logs` table with Row Level Security — only the service role can insert, public reads are blocked.

---

## 🐛 Troubleshooting

### API Key Error
```
🔑 There seems to be an issue with the API key
```
- Check `VITE_API_KEY` is set in `math-routing-agent/.env`
- Restart the dev server after editing `.env`

### Document Upload Not Working
The chunking API is optional. If `VITE_CHUNKING_API_URL` is not set, document upload is disabled but all Q&A features work normally.

### Server-Side Logging Not Working (HTTP 503)
Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` on the Flask server. Without these the endpoint returns 503, which the frontend silently ignores — local localStorage logging still works.

### Build Errors
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👨‍💻 Author

**Brijesh**
- GitHub: [@Brijesh1656](https://github.com/Brijesh1656)

---

<div align="center">

**⭐ If this project helped you, please give it a star! ⭐**

Made with ❤️ for students and researchers

</div>
