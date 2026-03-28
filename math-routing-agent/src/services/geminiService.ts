import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { Source } from '../types';

const SYSTEM_INSTRUCTION = `You are a world-class mathematics professor. Your goal is to help students by providing clear, concise, and simplified step-by-step solutions to their math problems.
Imagine you are explaining this to a high school student who is finding the topic difficult.
Focus exclusively on educational content related to mathematics.
Politely decline any request that is not related to math, explaining that your purpose is to assist with mathematics.
When providing a solution, break it down into logical, easy-to-follow steps.
If a concept is complex, explain it in simpler terms before using it in the solution.`;

const DECOMPOSITION_INSTRUCTION = `You are a mathematical reasoning planner. Given a complex math question, decompose it into a sequence of 2 to 5 focused sub-questions that together build toward the complete solution. Each sub-question should address one specific mathematical concept or calculation step required to solve the original problem. Return ONLY a valid JSON array of strings with no other text, no markdown, no code blocks. Example output: ["What is the derivative of x^2?", "How do we apply the chain rule here?", "What is the final simplified form?"]`;

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff on 503 / rate-limit errors
// ---------------------------------------------------------------------------
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      const msg = error instanceof Error ? error.message : String(error);
      const isRetryable =
        msg.includes('503') ||
        msg.includes('overloaded') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('rate limit');

      if (!isRetryable || attempt === maxRetries - 1) throw error;

      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

function formatErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('503') || msg.includes('overloaded'))
    return "🔄 The AI service is currently experiencing high demand. I've tried multiple times but it's still busy. Please try again in a few moments.";
  if (msg.includes('429') || msg.includes('rate limit'))
    return '⏱️ Rate limit reached. Please wait a moment before trying again.';
  if (msg.includes('API key'))
    return '🔑 There seems to be an issue with the API key. Please check your configuration.';
  if (msg.includes('network') || msg.includes('fetch'))
    return '🌐 Network connection issue. Please check your internet connection and try again.';
  return '❌ An unexpected error occurred. Please try again or check your API key.';
}

// ---------------------------------------------------------------------------
// Input guardrail — gemini-2.5-flash (unchanged)
// ---------------------------------------------------------------------------
export const isMathQuestion = async (
  ai: GoogleGenAI,
  question: string
): Promise<boolean> => {
  const prompt = `Is the following user query a mathematical question or directly related to a mathematical concept? Answer with only "yes" or "no".\n\nQuery: "${question}"`;

  try {
    const response = await retryWithBackoff(() =>
      ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt })
    );
    return (response.text || '').trim().toLowerCase().includes('yes');
  } catch (error) {
    console.error('Guardrail check failed:', error);
    return true; // Fail open
  }
};

// ---------------------------------------------------------------------------
// FIX 1 — Query decomposition into sub-queries
// ---------------------------------------------------------------------------
export const decomposeQuery = async (
  ai: GoogleGenAI,
  question: string
): Promise<string[]> => {
  try {
    const response = await retryWithBackoff(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: `Decompose this math question into focused sub-questions: "${question}"`,
        config: {
          systemInstruction: DECOMPOSITION_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      })
    );

    const text = (response.text || '').trim();
    const parsed: unknown = JSON.parse(text);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      typeof parsed[0] === 'string'
    ) {
      return (parsed as string[]).slice(0, 5); // Cap at 5 sub-queries
    }
    return [question];
  } catch (error) {
    console.warn('Query decomposition failed, falling back to single query:', error);
    return [question];
  }
};

// ---------------------------------------------------------------------------
// FIX 1 — Intermediate reasoning for one sub-query turn
// Receives ALL prior accumulated context → monotonically growing window
// ---------------------------------------------------------------------------
export const generateIntermediateReasoning = async (
  ai: GoogleGenAI,
  originalQuery: string,
  subQuery: string,
  retrievedContext: string | null,
  accumulatedContext: string,
  turnNumber: number
): Promise<{ reasoning: string; sources: Source[]; groundingChunkCount: number }> => {
  const priorSection = accumulatedContext
    ? `Prior Reasoning Steps Completed:\n${accumulatedContext}\n\n`
    : '';

  const contextSection = retrievedContext
    ? `Relevant Context Retrieved:\n${retrievedContext}\n\n`
    : 'No relevant context found in knowledge base for this step — use your mathematical knowledge.\n\n';

  const prompt = `You are solving a complex mathematics problem step by step. Your task is to address ONE specific sub-question using the context provided. Do NOT provide a complete final answer — just work through this particular step clearly.

Original Question: "${originalQuery}"

${priorSection}Current Sub-Question (Step ${turnNumber}): "${subQuery}"

${contextSection}Provide a focused intermediate reasoning step addressing the current sub-question. If prior steps have been completed, build upon them. Show your work clearly.`;

  try {
    const response: GenerateContentResponse = await retryWithBackoff(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          // Enable Tier 3 Google Search only when no retrieved context was found
          tools: retrievedContext ? [] : [{ googleSearch: {} }],
        },
      })
    );

    const reasoning = response.text || '';
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

    let sources: Source[] = [];
    if (groundingMetadata?.groundingChunks) {
      sources = (
        groundingMetadata.groundingChunks as Array<{
          web?: { uri?: string; title?: string };
        }>
      )
        .map(chunk => ({
          uri: chunk.web?.uri || '',
          title: chunk.web?.title || 'Untitled',
        }))
        .filter(s => s.uri !== '');
    }

    return {
      reasoning,
      sources,
      groundingChunkCount: sources.length,
    };
  } catch (error: unknown) {
    console.error('Error generating intermediate reasoning:', error);
    throw new Error(formatErrorMessage(error));
  }
};

// ---------------------------------------------------------------------------
// FIX 1 — Final synthesis across all intermediate reasoning steps
// ---------------------------------------------------------------------------
export const synthesizeFinalAnswer = async (
  ai: GoogleGenAI,
  originalQuery: string,
  allReasoningSteps: string[]
): Promise<{ answer: string; sources: Source[] }> => {
  const stepsText = allReasoningSteps
    .map((step, i) => `Step ${i + 1}:\n${step}`)
    .join('\n\n---\n\n');

  const prompt = `You are a world-class mathematics professor. A complex problem has been analyzed through ${allReasoningSteps.length} reasoning step(s). Synthesize all intermediate reasoning into a clear, complete, final answer.

Original Problem: "${originalQuery}"

Intermediate Reasoning Steps:
${stepsText}

Provide the final, complete solution to the original problem. Organize it clearly with numbered steps. Make it suitable for a student who needs to understand each part.`;

  try {
    const response: GenerateContentResponse = await retryWithBackoff(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
        config: { systemInstruction: SYSTEM_INSTRUCTION },
      })
    );

    return { answer: response.text || '', sources: [] };
  } catch (error: unknown) {
    console.error('Error synthesizing final answer:', error);
    throw new Error(formatErrorMessage(error));
  }
};

// ---------------------------------------------------------------------------
// FIX 3 — Problem type classifier (gemini-2.5-flash, for logging)
// ---------------------------------------------------------------------------
export const classifyProblemType = async (
  ai: GoogleGenAI,
  question: string
): Promise<string> => {
  const prompt = `Classify the following math problem into exactly one of these categories: algebra, calculus, geometry, statistics, other. Reply with only the single category word in lowercase.\n\nProblem: "${question}"`;

  try {
    const response = await retryWithBackoff(() =>
      ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt })
    );
    const result = (response.text || 'other').trim().toLowerCase();
    const valid = ['algebra', 'calculus', 'geometry', 'statistics', 'other'];
    return valid.includes(result) ? result : 'other';
  } catch {
    return 'other'; // Silent fail — logging must never block the UX
  }
};

// ---------------------------------------------------------------------------
// Refinement — unchanged from original
// ---------------------------------------------------------------------------
export const refineSolution = async (
  ai: GoogleGenAI,
  originalQuestion: string,
  originalAnswer: string,
  feedback: string
): Promise<string> => {
  const prompt = `A student was given the following question and answer, and then provided feedback. Refine the original answer based on the feedback.

Original Question: "${originalQuestion}"

Original Answer:
"${originalAnswer}"

Student Feedback: "${feedback}"

Provide a new, refined, step-by-step solution that incorporates the feedback. If the feedback suggests the answer is wrong, provide the correct solution.`;

  try {
    const response = await retryWithBackoff(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
        config: { systemInstruction: SYSTEM_INSTRUCTION },
      })
    );
    return response.text || '';
  } catch (error: unknown) {
    console.error('Error refining solution:', error);
    throw new Error(formatErrorMessage(error));
  }
};

// ---------------------------------------------------------------------------
// File question extraction — unchanged from original
// ---------------------------------------------------------------------------
export const extractQuestionsFromFile = async (
  ai: GoogleGenAI,
  fileContent: string
): Promise<string[]> => {
  const prompt = `From the following text, identify and extract all the mathematical questions. Present them as a JSON array of strings. If no questions are found, return an empty array. Text: """${fileContent}"""`;

  try {
    const response = await retryWithBackoff(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      })
    );

    const jsonString = (response.text || '').trim();
    const result: unknown = JSON.parse(jsonString);
    if (
      result &&
      typeof result === 'object' &&
      'questions' in result &&
      Array.isArray((result as { questions: unknown }).questions)
    ) {
      return (result as { questions: string[] }).questions;
    }
    return [];
  } catch (error: unknown) {
    console.error('Error extracting questions:', error);
    throw new Error(formatErrorMessage(error));
  }
};
