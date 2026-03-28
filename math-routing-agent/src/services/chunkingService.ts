/**
 * Service for semantic chunking API integration
 * Calls the Python chunking API endpoint
 */

export interface ChunkMetadata {
  has_math?: boolean;
  unit_index?: number;
  sub_index?: number;
  [key: string]: any;
}

export interface Chunk {
  chunk_id: string;
  text: string;
  token_length: number;
  start_char: number;
  end_char: number;
  metadata: ChunkMetadata;
}

export interface ChunkingResponse {
  success: boolean;
  chunks?: Chunk[];
  total_chunks?: number;
  document_id?: string;
  error?: string;
}

export interface ChunkingOptions {
  document_id?: string;
  overlap_tokens?: number;
  max_chunk_tokens?: number;
  min_chunk_tokens?: number;
  similarity_threshold?: number;
}

/**
 * Chunk a document using the semantic chunking API
 * 
 * @param text - The text to chunk
 * @param options - Chunking options
 * @returns Promise with chunking response
 */
export const chunkDocument = async (
  text: string,
  options: ChunkingOptions = {}
): Promise<ChunkingResponse> => {
  try {
    // Determine API endpoint
    // In development, use localhost or relative path
    // In production, use the deployed Python API (Railway/Render) or Vercel function
    const apiUrl = import.meta.env.VITE_CHUNKING_API_URL || 
                   (import.meta.env.DEV ? 'http://localhost:5000/chunk' : '/api/chunk');
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        document_id: options.document_id,
        overlap_tokens: options.overlap_tokens ?? 64, // FIX 7: 64-token overlap per paper spec
        max_chunk_tokens: options.max_chunk_tokens ?? 512,
        min_chunk_tokens: options.min_chunk_tokens ?? 50,
        similarity_threshold: options.similarity_threshold ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data: ChunkingResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error chunking document:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * Chunk a document and return only the chunks array
 * 
 * @param text - The text to chunk
 * @param options - Chunking options
 * @returns Promise with array of chunks
 */
export const getChunks = async (
  text: string,
  options: ChunkingOptions = {}
): Promise<Chunk[]> => {
  const response = await chunkDocument(text, options);
  if (response.success && response.chunks) {
    return response.chunks;
  }
  throw new Error(response.error || 'Failed to chunk document');
};

