import React, { useState, useCallback, useRef, useEffect } from "react";
import { GoogleGenAI } from "@google/genai";
import * as pdfjsLib from "pdfjs-dist";
import { Message, AppState, Role, KnowledgeSource, Source } from "./types";
import {
  decomposeQuery,
  generateIntermediateReasoning,
  synthesizeFinalAnswer,
  classifyProblemType,
  refineSolution,
  extractQuestionsFromFile,
  isMathQuestion,
} from "./services/geminiService";
import { useKnowledgeBase } from "./hooks/useKnowledgeBase";
import { RAGService } from "./services/ragService";
import ChatInput from "./components/ChatInput";
import MessageBubble from "./components/MessageBubble";
import FileUpload from "./components/FileUpload";
import {
  downloadLogs,
  getLogCount,
  saveTurnLog,
  resetSession,
} from "./services/logger";
import { PRIVACY_NOTICE } from "./lib/privacy";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5 — Mitigation experiment toggle
// ─────────────────────────────────────────────────────────────────────────────
const USE_ANCHORING = true;

const exampleQuestions = [
  {
    icon: "π",
    label: "Geometry",
    q: "What is the Pythagorean theorem?",
    color: "emerald",
  },
  {
    icon: "○",
    label: "Area & Perimeter",
    q: "How do you find the area of a circle with radius 5?",
    color: "violet",
  },
  {
    icon: "x²",
    label: "Algebra",
    q: "Solve for x: 2x² − 8x − 10 = 0",
    color: "sky",
  },
];

const cardAccents: Record<
  string,
  {
    icon: string;
    text: string;
    bg: string;
    border: string;
    hoverBorder: string;
  }
> = {
  emerald: {
    icon: "text-emerald-400",
    text: "text-emerald-400/70",
    bg: "bg-emerald-500/[0.07]",
    border: "border-emerald-500/15",
    hoverBorder: "hover:border-emerald-500/35",
  },
  violet: {
    icon: "text-violet-400",
    text: "text-violet-400/70",
    bg: "bg-violet-500/[0.07]",
    border: "border-violet-500/15",
    hoverBorder: "hover:border-violet-500/35",
  },
  sky: {
    icon: "text-sky-400",
    text: "text-sky-400/70",
    bg: "bg-sky-500/[0.07]",
    border: "border-sky-500/15",
    hoverBorder: "hover:border-sky-500/35",
  },
};

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const { searchKB } = useKnowledgeBase();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isLoading = appState === AppState.LOADING;

  const scrollToBottom = useCallback(() => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const updateLoadingText = useCallback((loadingId: number, text: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === loadingId ? { ...m, text } : m)),
    );
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 1 + FIX 5 + FIX 11 — Main agentic reasoning loop
  // ─────────────────────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      resetSession();

      const userMessage: Message = { id: Date.now(), text, role: Role.USER };
      const loadingId = Date.now() + 1;
      const loadingMessage: Message = {
        id: loadingId,
        text: "Checking question…",
        role: Role.AGENT,
        isLoading: true,
      };

      setMessages((prev) => [...prev, userMessage, loadingMessage]);
      setAppState(AppState.LOADING);

      try {
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });

        const isMath = await isMathQuestion(ai, text);
        if (!isMath) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === loadingId
                ? {
                    ...m,
                    isLoading: false,
                    text: "As a mathematics professor, my focus is on math-related topics. Please ask me a question about mathematics.",
                  }
                : m,
            ),
          );
          return;
        }

        const problemType = await classifyProblemType(ai, text);
        updateLoadingText(
          loadingId,
          "Decomposing question into reasoning steps…",
        );
        const subQueries = await decomposeQuery(ai, text);
        const totalTurns = subQueries.length;

        let accumulatedContext = "";
        const allReasoningSteps: string[] = [];
        const allSources: Source[] = [];

        for (let i = 0; i < subQueries.length; i++) {
          const subQuery = subQueries[i];
          const turnNumber = i + 1;

          updateLoadingText(
            loadingId,
            `Reasoning step ${turnNumber} of ${totalTurns}: ${subQuery.substring(0, 70)}${subQuery.length > 70 ? "…" : ""}`,
          );

          const queryForRetrieval = USE_ANCHORING
            ? `${text} ${subQuery}`
            : subQuery;
          const ragResult = await RAGService.retrieveChunks(
            queryForRetrieval,
            3,
          );
          let retrievedContext: string | null = null;
          let retrievalTier: 1 | 2 | 3 = 3;

          if (ragResult.chunks.length > 0) {
            retrievedContext = ragResult.context;
            retrievalTier = 1;
          } else {
            const kbResult = searchKB(queryForRetrieval);
            if (kbResult) {
              retrievedContext = kbResult;
              retrievalTier = 2;
            }
          }

          const {
            reasoning,
            sources: stepSources,
            groundingChunkCount,
          } = await generateIntermediateReasoning(
            ai,
            text,
            subQuery,
            retrievedContext,
            accumulatedContext,
            turnNumber,
          );

          accumulatedContext += `--- Step ${turnNumber} ---\nSub-Query: ${subQuery}\nReasoning: ${reasoning}\n\n`;
          allReasoningSteps.push(reasoning);
          allSources.push(...stepSources);

          saveTurnLog({
            subQuery,
            originalQuery: text,
            ragChunkCount: ragResult.chunks.length,
            groundingChunkCount,
            contextTokenCount: Math.ceil(accumulatedContext.length / 4),
            usedWebSearch: retrievalTier === 3,
            retrievalTier,
            similarityScore: ragResult.topSimilarityScore,
            anchoringEnabled: USE_ANCHORING,
            problemType,
          });
        }

        updateLoadingText(loadingId, "Synthesizing final answer…");
        const { answer } = await synthesizeFinalAnswer(
          ai,
          text,
          allReasoningSteps,
        );
        const uniqueSources = allSources.filter(
          (s, i, arr) => s.uri && arr.findIndex((x) => x.uri === s.uri) === i,
        );
        const knowledgeSource =
          uniqueSources.length > 0
            ? KnowledgeSource.WEB_SEARCH
            : KnowledgeSource.KNOWLEDGE_BASE;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? {
                  ...m,
                  isLoading: false,
                  text: answer,
                  sources: uniqueSources,
                  knowledgeSource,
                }
              : m,
          ),
        );
      } catch (error) {
        console.error(error);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? {
                  ...m,
                  isLoading: false,
                  text:
                    error instanceof Error
                      ? error.message
                      : "Sorry, I encountered an error. Please check your API key and try again.",
                  isError: true,
                }
              : m,
          ),
        );
      } finally {
        setAppState(AppState.IDLE);
      }
    },
    [searchKB, updateLoadingText],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 8 — Feedback handler with RAG re-indexing
  // ─────────────────────────────────────────────────────────────────────────
  const handleFeedback = useCallback(
    async (messageId: number, feedback: string) => {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1 || idx === 0) return;
      const originalMessage = messages[idx];
      const userQuestion = messages[idx - 1].text;
      setAppState(AppState.LOADING);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isRefined: true } : m)),
      );
      try {
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
        const refinedAnswer = await refineSolution(
          ai,
          userQuestion,
          originalMessage.text,
          feedback,
        );
        const refinedMessage: Message = {
          ...originalMessage,
          id: Date.now(),
          text: refinedAnswer,
          isRefined: true,
        };
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? refinedMessage : m)),
        );
        try {
          await RAGService.processDocument(
            `Q: ${userQuestion}\nA: ${refinedAnswer}`,
            `correction_${Date.now()}`,
          );
        } catch (e) {
          console.warn("Re-indexing skipped:", e);
        }
      } catch (error) {
        console.error(error);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            text:
              error instanceof Error
                ? error.message
                : "Could not refine the answer.",
            role: Role.AGENT,
            isError: true,
          },
        ]);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, isRefined: false } : m,
          ),
        );
      } finally {
        setAppState(AppState.IDLE);
      }
    },
    [messages],
  );

  const handleQuestionSelect = useCallback(
    async (q: string) => {
      await handleSendMessage(q);
    },
    [handleSendMessage],
  );

  // File upload — unchanged from original
  const parseFileContent = async (file: File): Promise<string> => {
    if (file.type === "application/pdf") {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
      let textContent = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        textContent += content.items
          .map((s) => (s as { str: string }).str)
          .join(" ");
      }
      return textContent;
    }
    return file.text();
  };

  const handleFileSelect = useCallback(async (file: File) => {
    if (
      !file ||
      (!file.type.startsWith("text/") && file.type !== "application/pdf")
    ) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          text: "Please upload a valid .txt or .pdf file.",
          role: Role.AGENT,
          isError: true,
        },
      ]);
      return;
    }
    const loadingId = Date.now() + 1;
    setMessages((prev) => [
      ...prev,
      {
        id: loadingId,
        text: `Analyzing ${file.name}…`,
        role: Role.AGENT,
        isLoading: true,
      },
    ]);
    setAppState(AppState.LOADING);
    try {
      const content = await parseFileContent(file);
      if (!content.trim())
        throw new Error("File is empty or could not be read.");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: `Processing ${file.name} through RAG pipeline…` }
            : m,
        ),
      );
      const { chunks } = await RAGService.processDocument(content, file.name);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: `Extracting questions from ${file.name}…` }
            : m,
        ),
      );
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
      const questions = await extractQuestionsFromFile(ai, content);
      const agentResponseText =
        questions.length > 0
          ? `✅ Document processed! I've stored ${chunks.length} chunks in the RAG pipeline. Found ${questions.length} question(s). Select one to begin, or ask me anything.`
          : `✅ Document processed! I've stored ${chunks.length} chunks in the RAG pipeline. Ask me anything about the document.`;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
                ...m,
                isLoading: false,
                text: agentResponseText,
                extractedQuestions:
                  questions.length > 0 ? questions : undefined,
              }
            : m,
        ),
      );
    } catch (error) {
      console.error(error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
                ...m,
                isLoading: false,
                text:
                  error instanceof Error
                    ? error.message
                    : "Could not extract questions from the file.",
                isError: true,
              }
            : m,
        ),
      );
    } finally {
      setAppState(AppState.IDLE);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen" style={{ background: "#08080f" }}>
      {/* ── Ambient background glows ───────────────────────────────────────── */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute -bottom-48 -left-32 w-[700px] h-[700px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(129,140,248,0.06) 0%, transparent 70%)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px]"
          style={{
            background:
              "radial-gradient(ellipse, rgba(16,185,129,0.025) 0%, transparent 65%)",
            filter: "blur(40px)",
          }}
        />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: "rgba(8,8,15,0.8)",
          backdropFilter: "blur(24px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <button
            onClick={() => !isLoading && setMessages([])}
            disabled={isLoading}
            className="flex items-center gap-2.5 group disabled:cursor-not-allowed"
            aria-label="Go to home"
          >
            {/* Logo mark */}
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center relative transition-all duration-200 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]"
              style={{
                background:
                  "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(129,140,248,0.1))",
                border: "1px solid rgba(16,185,129,0.25)",
                boxShadow: "0 0 16px rgba(16,185,129,0.15)",
              }}
            >
              <span className="text-[15px] font-bold logo-gradient leading-none">
                ∑
              </span>
            </div>
            <span className="text-[14px] font-semibold text-white/85 tracking-tight group-hover:text-white/100 transition-colors duration-150">
              Math Professor
            </span>
          </button>

          <button
            onClick={downloadLogs}
            className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-all duration-150 px-3 py-1.5 rounded-lg hover:bg-white/[0.05] border border-transparent hover:border-white/[0.07]"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Logs ({getLogCount()})
          </button>
        </div>
      </header>

      {/* ── Chat scroll area ────────────────────────────────────────────────── */}
      <div
        ref={chatContainerRef}
        className="flex-grow overflow-y-auto pt-14 pb-40 scroll-smooth"
      >
        <div className="max-w-3xl mx-auto px-5">
          {/* ── Hero / Empty state ──────────────────────────────────────────── */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-15rem)] text-center">
              {/* Orb */}
              <div className="hero-0 relative mb-9">
                {/* Outer glow rings */}
                <div
                  className="absolute inset-0 rounded-3xl glow-pulse"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(16,185,129,0.2) 0%, transparent 70%)",
                    filter: "blur(24px)",
                    transform: "scale(2.2)",
                  }}
                />
                <div
                  className="absolute inset-0 rounded-3xl"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(129,140,248,0.1) 0%, transparent 70%)",
                    filter: "blur(40px)",
                    transform: "scale(3)",
                  }}
                />
                {/* Icon box */}
                <div
                  className="relative w-[72px] h-[72px] rounded-2xl flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(129,140,248,0.12))",
                    border: "1px solid rgba(16,185,129,0.3)",
                    boxShadow:
                      "0 0 40px rgba(16,185,129,0.2), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  <span className="text-[34px] font-bold logo-gradient leading-none select-none">
                    ∑
                  </span>
                </div>
              </div>

              {/* Title */}
              <h1 className="hero-1 text-[28px] md:text-[34px] font-bold tracking-tight mb-2.5 heading-gradient">
                What would you like to solve?
              </h1>
              <p className="hero-2 text-white/40 text-[15px] mb-11 max-w-sm leading-relaxed">
                Ask any math question or upload a PDF for step-by-step solutions
              </p>

              {/* Example cards */}
              <div className="hero-3 w-full max-w-[520px] grid grid-cols-1 gap-2.5">
                {exampleQuestions.map(({ icon, label, q, color }) => {
                  const ac = cardAccents[color];
                  return (
                    <button
                      key={q}
                      onClick={() => handleSendMessage(q)}
                      disabled={isLoading}
                      className={`group w-full text-left px-4 py-3.5 rounded-xl border ${ac.border} ${ac.hoverBorder} transition-all duration-200 disabled:opacity-40`}
                      style={{ background: "rgba(255,255,255,0.02)" }}
                    >
                      <div className="flex items-center gap-3.5">
                        <div
                          className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold ${ac.icon} ${ac.bg}`}
                        >
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-[10px] uppercase tracking-widest font-semibold mb-0.5 ${ac.text}`}
                          >
                            {label}
                          </p>
                          <p className="text-[13.5px] text-white/60 group-hover:text-white/85 transition-colors leading-snug truncate">
                            {q}
                          </p>
                        </div>
                        <svg
                          className="flex-shrink-0 w-4 h-4 text-white/15 group-hover:text-white/35 group-hover:translate-x-0.5 transition-all"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.8}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Feature pills */}
              <div className="hero-4 mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-white/25">
                {[
                  { dot: "bg-emerald-500/60", label: "AI-Powered Reasoning" },
                  { dot: "bg-violet-500/60", label: "Step-by-Step Solutions" },
                  { dot: "bg-sky-500/60", label: "PDF & Document Support" },
                  { dot: "bg-amber-500/60", label: "Web Search Grounding" },
                ].map(({ dot, label }) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Messages ────────────────────────────────────────────────────── */}
          <div className="space-y-8 py-6">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onFeedback={handleFeedback}
                onQuestionSelect={handleQuestionSelect}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Input footer ───────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 pb-5 pt-12"
        style={{
          background:
            "linear-gradient(to top, #08080f 55%, rgba(8,8,15,0.85) 80%, transparent)",
        }}
      >
        <div className="max-w-3xl mx-auto px-5">
          {/* Input box */}
          <div
            className="rounded-2xl transition-all duration-200 focus-within:shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_8px_32px_rgba(0,0,0,0.5)]"
            style={{
              background: "rgba(15,15,24,0.95)",
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
              backdropFilter: "blur(20px)",
            }}
          >
            <ChatInput onSendMessage={handleSendMessage} disabled={isLoading}>
              <FileUpload
                onFileSelect={handleFileSelect}
                disabled={isLoading}
              />
            </ChatInput>
          </div>

          <p className="text-center text-[10px] text-white/15 mt-2.5">
            {PRIVACY_NOTICE}
          </p>
        </div>
      </div>
    </div>
  );
};

export default App;
