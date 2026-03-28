/**
 * RAG Service — Retrieval-Augmented Generation pipeline.
 *
 * Implements semantic chunking with sentence-boundary-aware splitting,
 * proper TF-IDF retrieval (sublinear TF, IDF weighting, L2 normalisation,
 * vocabulary capped at 10 000 terms, cosine similarity threshold 0.15),
 * and a localStorage-backed vector store.
 */

import { chunkDocument, Chunk } from './chunkingService';

export interface StoredChunk extends Chunk {
  documentName?: string;
  uploadedAt?: number;
}

export interface RAGResult {
  chunks: StoredChunk[];
  context: string;
  totalChunks: number;
  topSimilarityScore: number; // Highest cosine similarity among returned chunks
}

// ---------------------------------------------------------------------------
// Vector store — persists chunks to localStorage
// ---------------------------------------------------------------------------
class VectorStore {
  private static readonly STORAGE_KEY = 'math_rag_chunks';

  static storeChunks(chunks: Chunk[], documentName: string): void {
    const storedChunks: StoredChunk[] = chunks.map(chunk => ({
      ...chunk,
      documentName,
      uploadedAt: Date.now(),
    }));

    const existing = VectorStore.getChunks();
    const allChunks = [...existing, ...storedChunks];
    localStorage.setItem(VectorStore.STORAGE_KEY, JSON.stringify(allChunks));
    console.log(`✅ Stored ${storedChunks.length} chunks from "${documentName}"`);
  }

  static getChunks(): StoredChunk[] {
    try {
      const stored = localStorage.getItem(VectorStore.STORAGE_KEY);
      return stored ? (JSON.parse(stored) as StoredChunk[]) : [];
    } catch {
      return [];
    }
  }

  static clearChunks(): void {
    localStorage.removeItem(VectorStore.STORAGE_KEY);
    console.log('✅ Cleared all chunks from vector store');
  }

  static getChunkCount(): number {
    return VectorStore.getChunks().length;
  }
}

// ---------------------------------------------------------------------------
// FIX 2 — Proper TF-IDF service
//
// Key properties matching paper claims:
//   • Vocabulary capped at MAX_VOCAB_SIZE (10 000) most-frequent terms
//   • Sublinear TF scaling:  tf  = 1 + log(count)
//   • IDF formula:           idf = log((1 + N) / (1 + df)) + 1
//   • Vectors are L2-normalised → cosine similarity = dot product
//   • Minimum similarity threshold: SIMILARITY_THRESHOLD (0.15)
//   • Top-K = 3 by default
// ---------------------------------------------------------------------------
class TFIDFService {
  static readonly MAX_VOCAB_SIZE = 10_000;
  static readonly SIMILARITY_THRESHOLD = 0.15;

  /** Tokenise text: lowercase, strip non-alphanumeric, filter short tokens */
  static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * Build a vocabulary from a list of document strings.
   * Returns the top MAX_VOCAB_SIZE terms by document frequency,
   * their per-document frequency counts, and the total document count.
   */
  static buildVocab(documents: string[]): {
    vocab: Map<string, number>;
    docFreqs: Map<string, number>;
    totalDocs: number;
  } {
    const rawDocFreqs = new Map<string, number>();

    for (const doc of documents) {
      const terms = new Set(TFIDFService.tokenize(doc));
      for (const term of terms) {
        rawDocFreqs.set(term, (rawDocFreqs.get(term) ?? 0) + 1);
      }
    }

    // Keep only the most frequent terms, capped at MAX_VOCAB_SIZE
    const sorted = [...rawDocFreqs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TFIDFService.MAX_VOCAB_SIZE);

    const vocab = new Map<string, number>();
    const docFreqs = new Map<string, number>();
    sorted.forEach(([term, freq], idx) => {
      vocab.set(term, idx);
      docFreqs.set(term, freq);
    });

    return { vocab, docFreqs, totalDocs: documents.length };
  }

  /**
   * Convert text to a TF-IDF vector of length |vocab|, then L2-normalise it.
   * Because both query and chunk vectors are L2-normalised, their dot product
   * equals their cosine similarity.
   */
  static vectorize(
    text: string,
    vocab: Map<string, number>,
    docFreqs: Map<string, number>,
    totalDocs: number
  ): number[] {
    const vector = new Array<number>(vocab.size).fill(0);

    // Count raw term frequencies
    const terms = TFIDFService.tokenize(text);
    const termCounts = new Map<string, number>();
    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }

    // Apply sublinear TF scaling and IDF weighting
    for (const [term, count] of termCounts) {
      const idx = vocab.get(term);
      if (idx !== undefined) {
        const tf = 1 + Math.log(count); // sublinear TF
        const df = docFreqs.get(term) ?? 0;
        const idf = Math.log((1 + totalDocs) / (1 + df)) + 1;
        vector[idx] = tf * idf;
      }
    }

    // L2 normalisation
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * Dot product of two L2-normalised vectors = cosine similarity.
   * Vectors must have the same length (guaranteed because both use the same
   * vocabulary built from the same chunk corpus at retrieval time).
   */
  static dotProduct(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length || vec1.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < vec1.length; i++) {
      dot += vec1[i] * vec2[i];
    }
    return dot;
  }
}

// ---------------------------------------------------------------------------
// RAGService — public interface
// ---------------------------------------------------------------------------
export class RAGService {
  /**
   * Chunk a document using semantic chunking with sentence-boundary-aware
   * splitting (handled by the Python API) and store chunks.
   * Overlap is 64 tokens as per paper specification.
   */
  static async processDocument(
    text: string,
    documentName: string
  ): Promise<{ chunks: Chunk[]; stored: boolean }> {
    try {
      console.log(`📄 Processing document: ${documentName}`);

      const chunkingResponse = await chunkDocument(text, {
        document_id: `doc_${Date.now()}`,
        overlap_tokens: 64, // FIX 7: changed from 150 to 64 (paper specification)
        max_chunk_tokens: 512,
      });

      if (!chunkingResponse.success || !chunkingResponse.chunks) {
        throw new Error(chunkingResponse.error || 'Failed to chunk document');
      }

      const chunks = chunkingResponse.chunks;
      console.log(`✅ Created ${chunks.length} chunks`);

      // Store chunks (no pre-computed embeddings — TF-IDF is computed on-the-fly
      // at retrieval time from the full chunk corpus so IDF weights are always
      // consistent across documents)
      VectorStore.storeChunks(chunks, documentName);

      return { chunks, stored: true };
    } catch (error) {
      console.error('Error processing document:', error);
      throw error;
    }
  }

  /**
   * Retrieve the top-K most relevant chunks for a query using TF-IDF cosine
   * similarity.  Only chunks with similarity >= SIMILARITY_THRESHOLD (0.15)
   * are returned.
   *
   * The vocabulary is rebuilt from all stored chunks on every call so that
   * IDF weights remain correct as the corpus grows.
   */
  static async retrieveChunks(
    query: string,
    topK: number = 3
  ): Promise<RAGResult> {
    const allChunks = VectorStore.getChunks();

    if (allChunks.length === 0) {
      return { chunks: [], context: '', totalChunks: 0, topSimilarityScore: 0 };
    }

    // Build TF-IDF vocabulary from all stored chunk texts
    const chunkTexts = allChunks.map(c => c.text);
    const { vocab, docFreqs, totalDocs } = TFIDFService.buildVocab(chunkTexts);

    if (vocab.size === 0) {
      return { chunks: [], context: '', totalChunks: allChunks.length, topSimilarityScore: 0 };
    }

    // Vectorise query
    const queryVec = TFIDFService.vectorize(query, vocab, docFreqs, totalDocs);

    // Vectorise each chunk and compute cosine similarity
    const scored = allChunks.map(chunk => {
      const chunkVec = TFIDFService.vectorize(chunk.text, vocab, docFreqs, totalDocs);
      const similarity = TFIDFService.dotProduct(queryVec, chunkVec);
      return { chunk, similarity };
    });

    // Filter by threshold, sort descending, take top-K
    const filtered = scored
      .filter(item => item.similarity >= TFIDFService.SIMILARITY_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    const topChunks = filtered.map(item => item.chunk);
    const topSimilarityScore = filtered.length > 0 ? filtered[0].similarity : 0;

    const context = topChunks
      .map((chunk, index) => `[Chunk ${index + 1}]\n${chunk.text}`)
      .join('\n\n');

    console.log(
      `🔍 TF-IDF: Retrieved ${topChunks.length} chunks (threshold 0.15) from ${allChunks.length} total`
    );

    return {
      chunks: topChunks,
      context,
      totalChunks: allChunks.length,
      topSimilarityScore,
    };
  }

  static getStats(): { totalChunks: number; documents: string[] } {
    const chunks = VectorStore.getChunks();
    const documents = [
      ...new Set(
        chunks.map(c => c.documentName).filter((d): d is string => Boolean(d))
      ),
    ];
    return { totalChunks: chunks.length, documents };
  }

  static clearStore(): void {
    VectorStore.clearChunks();
  }
}
