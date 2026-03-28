import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';
import { Message, AppState, Role, KnowledgeSource, Source } from './types';
import {
  decomposeQuery,
  generateIntermediateReasoning,
  synthesizeFinalAnswer,
  classifyProblemType,
  refineSolution,
  extractQuestionsFromFile,
  isMathQuestion,
} from './services/geminiService';
import { useKnowledgeBase } from './hooks/useKnowledgeBase';
import { RAGService } from './services/ragService';
import ChatInput from './components/ChatInput';
import MessageBubble from './components/MessageBubble';
import FileUpload from './components/FileUpload';
import { MathIcon } from './constants';
import { downloadLogs, getLogCount, saveTurnLog, resetSession } from './services/logger';
import { PRIVACY_NOTICE } from './lib/privacy';

// Configure PDF.js worker to use the same CDN as the library.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5 — Mitigation experiment toggle
// Set USE_ANCHORING = true  to prepend the original query to every sub-query
// before it hits the retrieval cascade (anchored condition).
// Set USE_ANCHORING = false to send bare sub-queries to retrieval (baseline).
// This flag is logged in every TurnLog so sessions can be separated in analysis.
// ─────────────────────────────────────────────────────────────────────────────
const USE_ANCHORING = true;

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const { searchKB } = useKnowledgeBase();
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Helper to update just the text of the loading bubble while keeping isLoading true
  const updateLoadingText = useCallback(
    (loadingId: number, text: string) => {
      setMessages(prev =>
        prev.map(m => (m.id === loadingId ? { ...m, text } : m))
      );
    },
    []
  );

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 1 + FIX 5 + FIX 11 — Main agentic reasoning loop
  // ─────────────────────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // FIX 11: Each new user question starts a fresh session
      resetSession();

      const userMessage: Message = { id: Date.now(), text, role: Role.USER };
      const loadingId = Date.now() + 1;
      const loadingMessage: Message = {
        id: loadingId,
        text: 'Checking question...',
        role: Role.AGENT,
        isLoading: true,
      };

      setMessages(prev => [...prev, userMessage, loadingMessage]);
      setAppState(AppState.LOADING);

      try {
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });

        // ── Step 1: Guardrail check ──────────────────────────────────────
        const isMath = await isMathQuestion(ai, text);
        if (!isMath) {
          setMessages(prev =>
            prev.map(m =>
              m.id === loadingId
                ? {
                    ...m,
                    isLoading: false,
                    text: 'As a mathematics professor, my focus is on math-related topics. Please ask me a question about mathematics.',
                  }
                : m
            )
          );
          return;
        }

        // ── Step 2: Classify problem type (for logging) ──────────────────
        const problemType = await classifyProblemType(ai, text);

        // ── Step 3: Decompose query into sub-queries ─────────────────────
        updateLoadingText(loadingId, 'Decomposing question into reasoning steps...');
        const subQueries = await decomposeQuery(ai, text);
        const totalTurns = subQueries.length;

        // ── Step 4: Agentic reasoning loop ──────────────────────────────
        let accumulatedContext = '';
        const allReasoningSteps: string[] = [];
        const allSources: Source[] = [];

        for (let i = 0; i < subQueries.length; i++) {
          const subQuery = subQueries[i];
          const turnNumber = i + 1;

          updateLoadingText(
            loadingId,
            `Reasoning step ${turnNumber} of ${totalTurns}: ${subQuery.substring(0, 70)}${subQuery.length > 70 ? '…' : ''}`
          );

          // FIX 5: Anchor sub-query to original question before retrieval
          const queryForRetrieval = USE_ANCHORING
            ? `${text} ${subQuery}`
            : subQuery;

          // Three-tier retrieval cascade
          const ragResult = await RAGService.retrieveChunks(queryForRetrieval, 3);
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
            // Tier 3: no retrieved context → generateIntermediateReasoning
            // will enable Google Search grounding automatically
          }

          // Generate one intermediate reasoning step
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
            turnNumber
          );

          // Accumulate context for the next turn (monotonically growing window)
          accumulatedContext +=
            `--- Step ${turnNumber} ---\n` +
            `Sub-Query: ${subQuery}\n` +
            `Reasoning: ${reasoning}\n\n`;

          allReasoningSteps.push(reasoning);
          allSources.push(...stepSources);

          // Log this turn with all required fields (FIX 3)
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

        // ── Step 5: Synthesize final answer ──────────────────────────────
        updateLoadingText(loadingId, 'Synthesizing final answer…');
        const { answer } = await synthesizeFinalAnswer(ai, text, allReasoningSteps);

        // Deduplicate sources by URI
        const uniqueSources = allSources.filter(
          (s, i, arr) => s.uri && arr.findIndex(x => x.uri === s.uri) === i
        );

        const knowledgeSource =
          uniqueSources.length > 0
            ? KnowledgeSource.WEB_SEARCH
            : KnowledgeSource.KNOWLEDGE_BASE;

        setMessages(prev =>
          prev.map(m =>
            m.id === loadingId
              ? {
                  ...m,
                  isLoading: false,
                  text: answer,
                  sources: uniqueSources,
                  knowledgeSource,
                }
              : m
          )
        );
      } catch (error) {
        console.error(error);
        setMessages(prev =>
          prev.map(m =>
            m.id === loadingId
              ? {
                  ...m,
                  isLoading: false,
                  text:
                    error instanceof Error
                      ? error.message
                      : 'Sorry, I encountered an error. Please check your API key and try again.',
                  isError: true,
                }
              : m
          )
        );
      } finally {
        setAppState(AppState.IDLE);
      }
    },
    [searchKB, updateLoadingText]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 8 — Feedback handler with RAG re-indexing
  // ─────────────────────────────────────────────────────────────────────────
  const handleFeedback = useCallback(
    async (messageId: number, feedback: string) => {
      const originalMessageIndex = messages.findIndex(m => m.id === messageId);
      if (originalMessageIndex === -1 || originalMessageIndex === 0) return;

      const originalMessage = messages[originalMessageIndex];
      const userQuestion = messages[originalMessageIndex - 1].text;

      setAppState(AppState.LOADING);
      setMessages(prev =>
        prev.map(m => (m.id === messageId ? { ...m, isRefined: true } : m))
      );

      try {
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
        const refinedAnswer = await refineSolution(
          ai,
          userQuestion,
          originalMessage.text,
          feedback
        );

        const refinedMessage: Message = {
          ...originalMessage,
          id: Date.now(),
          text: refinedAnswer,
          isRefined: true,
        };
        setMessages(prev =>
          prev.map(m => (m.id === messageId ? refinedMessage : m))
        );

        // FIX 8: Re-index the corrected Q&A pair into the RAG vector store
        // so future similar questions can retrieve this correction.
        // Wrapped in try/catch — re-indexing failure must never affect the UI.
        try {
          const correctionDoc = `Q: ${userQuestion}\nA: ${refinedAnswer}`;
          await RAGService.processDocument(correctionDoc, `correction_${Date.now()}`);
          console.log('✅ Correction re-indexed into RAG store');
        } catch (reindexError) {
          console.warn('Re-indexing skipped (chunking API unavailable):', reindexError);
        }
      } catch (error) {
        console.error(error);
        const errorMessage: Message = {
          id: Date.now() + 1,
          text:
            error instanceof Error
              ? error.message
              : 'Sorry, I could not refine the answer. Please try again.',
          role: Role.AGENT,
          isError: true,
        };
        setMessages(prev => [...prev, errorMessage]);
        setMessages(prev =>
          prev.map(m => (m.id === messageId ? { ...m, isRefined: false } : m))
        );
      } finally {
        setAppState(AppState.IDLE);
      }
    },
    [messages]
  );

  const handleQuestionSelect = useCallback(
    async (question: string) => {
      await handleSendMessage(question);
    },
    [handleSendMessage]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // File upload — unchanged from original
  // ─────────────────────────────────────────────────────────────────────────
  const parseFileContent = async (file: File): Promise<string> => {
    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
      let textContent = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        textContent += content.items.map(s => (s as { str: string }).str).join(' ');
      }
      return textContent;
    } else {
      return file.text();
    }
  };

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file || (!file.type.startsWith('text/') && file.type !== 'application/pdf')) {
      const errorMessage: Message = {
        id: Date.now(),
        text: 'Please upload a valid .txt or .pdf file.',
        role: Role.AGENT,
        isError: true,
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    const loadingId = Date.now() + 1;
    const loadingMessage: Message = {
      id: loadingId,
      text: `Analyzing ${file.name}…`,
      role: Role.AGENT,
      isLoading: true,
    };
    setMessages(prev => [...prev, loadingMessage]);
    setAppState(AppState.LOADING);

    try {
      const content = await parseFileContent(file);
      if (!content.trim()) throw new Error('File is empty or could not be read.');

      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId
            ? { ...m, text: `Processing ${file.name} through RAG pipeline…` }
            : m
        )
      );

      const { chunks } = await RAGService.processDocument(content, file.name);
      console.log(`✅ RAG Pipeline: Stored ${chunks.length} chunks from ${file.name}`);

      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId
            ? { ...m, text: `Extracting questions from ${file.name}…` }
            : m
        )
      );

      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
      const questions = await extractQuestionsFromFile(ai, content);

      let agentResponseText: string;
      let questionsForMessage: string[] | undefined;

      if (questions.length > 0) {
        agentResponseText = `✅ Document processed! I've stored ${chunks.length} chunks in the RAG pipeline. Found ${questions.length} question(s). Select one to begin, or ask me anything about the document.`;
        questionsForMessage = questions;
      } else {
        agentResponseText = `✅ Document processed! I've stored ${chunks.length} chunks in the RAG pipeline. I couldn't find specific questions, but you can ask me anything about the document's content.`;
      }

      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId
            ? {
                ...m,
                isLoading: false,
                text: agentResponseText,
                extractedQuestions: questionsForMessage,
              }
            : m
        )
      );
    } catch (error) {
      console.error(error);
      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId
            ? {
                ...m,
                isLoading: false,
                text:
                  error instanceof Error
                    ? error.message
                    : 'Could not extract questions from the file. The file might be empty or in an unsupported format.',
                isError: true,
              }
            : m
        )
      );
    } finally {
      setAppState(AppState.IDLE);
    }
  }, []);

  const exampleQuestions = [
    'What is the Pythagorean theorem?',
    'How do you find the area of a circle with radius 5?',
    'Solve for x: 2x² − 8x − 10 = 0',
  ];

  return (
    <div className="flex flex-col h-screen font-sans text-gray-100 relative z-10">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 p-4 glass-strong shadow-2xl">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-center gradient-text mb-1">
            🧮 Math Professor AI
          </h1>
          <p className="text-center text-sm text-gray-400">
            Your AI-Powered Mathematics Companion
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-col flex-grow w-full h-full max-w-6xl mx-auto pt-28 pb-40 px-4">
        <main ref={chatContainerRef} className="flex-grow overflow-y-auto space-y-6 scroll-smooth">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="mb-8 relative">
                <div className="absolute inset-0 blur-3xl opacity-30 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 rounded-full"></div>
                <div className="relative w-24 h-24 md:w-32 md:h-32 mx-auto text-blue-400 glow-blue rounded-full p-6 glass">
                  <MathIcon />
                </div>
              </div>

              <h2 className="text-3xl md:text-5xl font-bold mb-3 text-white">
                How can I help you today?
              </h2>
              <p className="max-w-2xl mb-12 text-gray-400 text-lg">
                Ask any math question or upload a document with problems to get started
              </p>

              <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-4">
                {exampleQuestions.map((q, index) => (
                  <button
                    key={q}
                    onClick={() => handleSendMessage(q)}
                    className="group text-left p-6 glass rounded-2xl hover:glass-strong card-hover border-2 border-transparent hover:border-blue-500/50 transition-all duration-300"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">💡</span>
                      <span className="text-gray-300 group-hover:text-white transition-colors flex-1">
                        {q}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-sm">Ask this question</span>
                      <svg
                        className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
                <div className="text-center p-6 glass rounded-2xl">
                  <div className="text-3xl mb-3">🤖</div>
                  <h3 className="font-semibold text-white mb-2">AI-Powered</h3>
                  <p className="text-sm text-gray-400">Advanced Gemini AI for accurate solutions</p>
                </div>
                <div className="text-center p-6 glass rounded-2xl">
                  <div className="text-3xl mb-3">📚</div>
                  <h3 className="font-semibold text-white mb-2">Step-by-Step</h3>
                  <p className="text-sm text-gray-400">
                    Detailed explanations for every problem
                  </p>
                </div>
                <div className="text-center p-6 glass rounded-2xl">
                  <div className="text-3xl mb-3">📄</div>
                  <h3 className="font-semibold text-white mb-2">Document Upload</h3>
                  <p className="text-sm text-gray-400">Extract questions from PDF & TXT files</p>
                </div>
              </div>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onFeedback={handleFeedback}
              onQuestionSelect={handleQuestionSelect}
            />
          ))}
        </main>

        {/* Input Area */}
        <footer className="fixed bottom-8 left-0 right-0 z-50">
          <div className="max-w-6xl mx-auto px-4">
            <div className="glass-strong rounded-3xl shadow-2xl glow-blue border-2 border-white/10 overflow-hidden">
              <ChatInput
                onSendMessage={handleSendMessage}
                disabled={appState === AppState.LOADING}
              >
                <FileUpload
                  onFileSelect={handleFileSelect}
                  disabled={appState === AppState.LOADING}
                />
              </ChatInput>
            </div>
          </div>
        </footer>
      </div>

      {/* FIX 10 — Privacy notice */}
      <div
        style={{
          position: 'fixed',
          bottom: '6px',
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: '11px',
          color: '#6b7280',
          zIndex: 9998,
          pointerEvents: 'none',
        }}
      >
        {PRIVACY_NOTICE}
      </div>

      {/* Export logs button */}
      <button
        onClick={downloadLogs}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: '#4F46E5',
          color: '#fff',
          padding: '10px 16px',
          borderRadius: '12px',
          fontSize: '13px',
          fontWeight: 'bold',
          zIndex: 9999,
          border: 'none',
          boxShadow: '0 4px 12px rgba(79,70,229,0.4)',
          cursor: 'pointer',
        }}
      >
        📊 Export Logs ({getLogCount()})
      </button>
    </div>
  );
};

export default App;
