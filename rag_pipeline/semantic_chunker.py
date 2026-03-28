"""
Semantic Chunking Module for RAG Pipeline

This module implements semantic chunking for mathematical documents, grouping text
by mathematical concepts, sentence boundaries, and logical topic shifts. It uses
a combination of NLP techniques and semantic similarity to create coherent, 
self-contained chunks with small overlaps for continuity.

Author: Math Professor AI RAG System
"""

import re
import logging
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from collections import deque

try:
    import spacy
    from spacy.lang.en import English
except ImportError:
    spacy = None
    English = None

try:
    import tiktoken
except ImportError:
    tiktoken = None

try:
    from sentence_transformers import SentenceTransformer
    import numpy as np
except ImportError:
    SentenceTransformer = None
    np = None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class Chunk:
    """Represents a single chunk with metadata for FAISS integration."""
    chunk_id: str
    text: str
    token_length: int
    start_char: int
    end_char: int
    metadata: Optional[Dict] = None

    def to_dict(self) -> Dict:
        """Convert chunk to dictionary for serialization."""
        return {
            'chunk_id': self.chunk_id,
            'text': self.text,
            'token_length': self.token_length,
            'start_char': self.start_char,
            'end_char': self.end_char,
            'metadata': self.metadata or {}
        }


class SemanticChunker:
    """
    Semantic chunker for mathematical documents.
    
    Uses semantic similarity, sentence boundaries, and mathematical concept
    detection to create meaningful chunks with controlled overlaps.
    """
    
    def __init__(
        self,
        model_name: str = "all-MiniLM-L6-v2",
        overlap_tokens: int = 64,  # FIX 7: changed from 150 to 64 (paper specification)
        min_chunk_tokens: int = 50,
        max_chunk_tokens: int = 512,
        similarity_threshold: float = 0.7,
        use_spacy: bool = True,
        use_llm_boundary: bool = False
    ):
        """
        Initialize the semantic chunker.
        
        Args:
            model_name: Sentence transformer model for semantic similarity
            overlap_tokens: Number of tokens to overlap between chunks (~150)
            min_chunk_tokens: Minimum tokens per chunk
            max_chunk_tokens: Maximum tokens per chunk
            similarity_threshold: Threshold for semantic similarity (0-1)
            use_spacy: Whether to use spaCy for sentence segmentation
            use_llm_boundary: Whether to use LLM for boundary detection (future)
        """
        self.overlap_tokens = overlap_tokens
        self.min_chunk_tokens = min_chunk_tokens
        self.max_chunk_tokens = max_chunk_tokens
        self.similarity_threshold = similarity_threshold
        
        # Initialize tokenizer
        try:
            self.tokenizer = tiktoken.get_encoding("cl100k_base")
            logger.info("Using tiktoken for token counting")
        except Exception as e:
            logger.warning(f"tiktoken not available: {e}. Using fallback tokenizer.")
            self.tokenizer = None
        
        # Initialize spaCy
        self.nlp = None
        if use_spacy and spacy:
            try:
                self.nlp = spacy.load("en_core_web_sm")
                logger.info("spaCy model loaded successfully")
            except OSError:
                logger.warning("spaCy model 'en_core_web_sm' not found. Install with: python -m spacy download en_core_web_sm")
                try:
                    # Fallback to basic English
                    if English:
                        self.nlp = English()
                        self.nlp.add_pipe("sentencizer")
                        logger.info("Using basic spaCy English model")
                except Exception as e:
                    logger.warning(f"Could not initialize spaCy: {e}")
        
        # Initialize sentence transformer for semantic similarity
        self.semantic_model = None
        if SentenceTransformer:
            try:
                self.semantic_model = SentenceTransformer(model_name)
                logger.info(f"Sentence transformer model '{model_name}' loaded")
            except Exception as e:
                logger.warning(f"Could not load sentence transformer: {e}")
        
        # Mathematical patterns for concept detection
        self.math_patterns = [
            r'\b(theorem|lemma|corollary|proof|definition|proposition)\b',
            r'\b(solve|calculate|compute|derive|prove|show)\b',
            r'\b(equation|formula|expression|function|variable)\b',
            r'[=<>≤≥≠≈]',  # Mathematical operators
            r'\b(integral|derivative|limit|sum|product)\b',
            r'\b(matrix|vector|scalar|tensor)\b',
            r'[∫∑∏√∞]',  # Mathematical symbols
            r'\b(example|problem|solution|step)\b',
        ]
        self.math_regex = re.compile('|'.join(self.math_patterns), re.IGNORECASE)
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text using tiktoken or fallback method."""
        if self.tokenizer:
            try:
                return len(self.tokenizer.encode(text))
            except Exception:
                pass
        
        # Fallback: approximate token count (1 token ≈ 4 characters)
        return len(text) // 4
    
    def split_into_sentences(self, text: str) -> List[Tuple[str, int, int]]:
        """
        Split text into sentences with character positions.
        
        Returns:
            List of (sentence, start_char, end_char) tuples
        """
        sentences = []
        
        if self.nlp:
            try:
                doc = self.nlp(text)
                for sent in doc.sents:
                    start = sent.start_char
                    end = sent.end_char
                    sentences.append((sent.text.strip(), start, end))
                return sentences
            except Exception as e:
                logger.warning(f"spaCy sentence splitting failed: {e}")
        
        # Fallback: simple sentence splitting
        sentence_endings = re.compile(r'([.!?]+\s+|\.\s+[A-Z])')
        parts = sentence_endings.split(text)
        
        current_pos = 0
        for i in range(0, len(parts) - 1, 2):
            if i + 1 < len(parts):
                sentence = parts[i] + parts[i + 1]
            else:
                sentence = parts[i]
            
            if sentence.strip():
                start = current_pos
                end = current_pos + len(sentence)
                sentences.append((sentence.strip(), start, end))
                current_pos = end
        
        return sentences
    
    def detect_mathematical_concepts(self, text: str) -> bool:
        """Detect if text contains mathematical concepts."""
        return bool(self.math_regex.search(text))
    
    def compute_semantic_similarity(self, text1: str, text2: str) -> float:
        """
        Compute semantic similarity between two text segments.
        
        Returns:
            Similarity score between 0 and 1
        """
        if not self.semantic_model:
            # Fallback: simple word overlap
            words1 = set(text1.lower().split())
            words2 = set(text2.lower().split())
            if not words1 or not words2:
                return 0.0
            intersection = words1.intersection(words2)
            union = words1.union(words2)
            return len(intersection) / len(union) if union else 0.0
        
        try:
            embeddings = self.semantic_model.encode([text1, text2])
            # Cosine similarity
            dot_product = np.dot(embeddings[0], embeddings[1])
            norm1 = np.linalg.norm(embeddings[0])
            norm2 = np.linalg.norm(embeddings[1])
            similarity = dot_product / (norm1 * norm2) if (norm1 * norm2) > 0 else 0.0
            return float(similarity)
        except Exception as e:
            logger.warning(f"Semantic similarity computation failed: {e}")
            # Fallback to word overlap
            words1 = set(text1.lower().split())
            words2 = set(text2.lower().split())
            if not words1 or not words2:
                return 0.0
            intersection = words1.intersection(words2)
            union = words1.union(words2)
            return len(intersection) / len(union) if union else 0.0
    
    def find_topic_shifts(self, sentences: List[Tuple[str, int, int]]) -> List[int]:
        """
        Identify topic shift points in sentences using semantic similarity.
        
        Returns:
            List of sentence indices where topic shifts occur
        """
        if len(sentences) <= 1:
            return []
        
        shift_points = []
        
        # Compare consecutive sentence pairs
        for i in range(len(sentences) - 1):
            sent1 = sentences[i][0]
            sent2 = sentences[i + 1][0]
            
            similarity = self.compute_semantic_similarity(sent1, sent2)
            
            # Low similarity indicates a topic shift
            if similarity < self.similarity_threshold:
                shift_points.append(i + 1)
        
        return shift_points
    
    def create_chunk_with_overlap(
        self,
        text: str,
        start_char: int,
        end_char: int,
        previous_chunk_end: Optional[int] = None,
        full_text: Optional[str] = None
    ) -> Tuple[str, int, int]:
        """
        Create a chunk with overlap from previous chunk.
        
        Returns:
            (chunk_text, actual_start_char, actual_end_char)
        """
        if full_text is None:
            full_text = text
        
        actual_start = start_char
        actual_end = end_char
        
        # Add overlap from previous chunk
        if previous_chunk_end is not None and previous_chunk_end < start_char:
            overlap_text = full_text[previous_chunk_end:start_char]
            overlap_tokens = self.count_tokens(overlap_text)
            
            if overlap_tokens < self.overlap_tokens:
                # Try to extend backwards
                remaining_overlap = self.overlap_tokens - overlap_tokens
                extend_start = max(0, start_char - remaining_overlap * 4)  # Approximate
                overlap_text = full_text[extend_start:start_char]
                actual_start = extend_start
        
        chunk_text = full_text[actual_start:actual_end]
        
        # Ensure chunk doesn't exceed max tokens
        chunk_tokens = self.count_tokens(chunk_text)
        if chunk_tokens > self.max_chunk_tokens:
            # Truncate to max tokens
            truncated = self._truncate_to_tokens(chunk_text, self.max_chunk_tokens)
            actual_end = actual_start + len(truncated)
            chunk_text = truncated
        
        return chunk_text, actual_start, actual_end
    
    def _truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """Truncate text to approximately max_tokens."""
        if self.tokenizer:
            try:
                tokens = self.tokenizer.encode(text)
                if len(tokens) <= max_tokens:
                    return text
                truncated_tokens = tokens[:max_tokens]
                return self.tokenizer.decode(truncated_tokens)
            except Exception:
                pass
        
        # Fallback: character-based truncation
        approx_chars = max_tokens * 4
        return text[:approx_chars]
    
    def chunk_text(self, text: str, document_id: Optional[str] = None) -> List[Chunk]:
        """
        Main chunking function that creates semantic chunks.
        
        Args:
            text: Input text to chunk
            document_id: Optional document identifier for chunk IDs
        
        Returns:
            List of Chunk objects ready for embedding and FAISS indexing
        """
        if not text or not text.strip():
            return []
        
        logger.info(f"Starting semantic chunking for text of length {len(text)}")
        
        # Step 1: Split into sentences
        sentences = self.split_into_sentences(text)
        logger.info(f"Split into {len(sentences)} sentences")
        
        if not sentences:
            return []
        
        # Step 2: Identify topic shifts
        topic_shifts = self.find_topic_shifts(sentences)
        logger.info(f"Found {len(topic_shifts)} topic shift points")
        
        # Step 3: Group sentences into semantic units
        semantic_units = self._group_sentences(sentences, topic_shifts)
        logger.info(f"Created {len(semantic_units)} semantic units")
        
        # Step 4: Create chunks with overlaps
        chunks = []
        previous_chunk_end = None
        
        for idx, unit in enumerate(semantic_units):
            unit_text = ' '.join([s[0] for s in unit])
            unit_start = unit[0][1] if unit else 0
            unit_end = unit[-1][2] if unit else len(text)
            
            unit_tokens = self.count_tokens(unit_text)
            
            # If unit is too large, split it further
            if unit_tokens > self.max_chunk_tokens:
                sub_chunks = self._split_large_unit(unit, text)
                for sub_idx, (sub_text, sub_start, sub_end) in enumerate(sub_chunks):
                    chunk_text, actual_start, actual_end = self.create_chunk_with_overlap(
                        text, sub_start, sub_end, previous_chunk_end, text
                    )
                    
                    chunk_tokens = self.count_tokens(chunk_text)
                    if chunk_tokens >= self.min_chunk_tokens:
                        chunk_id = f"{document_id or 'doc'}_chunk_{len(chunks)}"
                        chunk = Chunk(
                            chunk_id=chunk_id,
                            text=chunk_text,
                            token_length=chunk_tokens,
                            start_char=actual_start,
                            end_char=actual_end,
                            metadata={
                                'unit_index': idx,
                                'sub_index': sub_idx,
                                'has_math': self.detect_mathematical_concepts(chunk_text)
                            }
                        )
                        chunks.append(chunk)
                        previous_chunk_end = actual_end
            else:
                # Unit fits in one chunk
                chunk_text, actual_start, actual_end = self.create_chunk_with_overlap(
                    text, unit_start, unit_end, previous_chunk_end, text
                )
                
                chunk_tokens = self.count_tokens(chunk_text)
                if chunk_tokens >= self.min_chunk_tokens:
                    chunk_id = f"{document_id or 'doc'}_chunk_{len(chunks)}"
                    chunk = Chunk(
                        chunk_id=chunk_id,
                        text=chunk_text,
                        token_length=chunk_tokens,
                        start_char=actual_start,
                        end_char=actual_end,
                        metadata={
                            'unit_index': idx,
                            'has_math': self.detect_mathematical_concepts(chunk_text)
                        }
                    )
                    chunks.append(chunk)
                    previous_chunk_end = actual_end
        
        logger.info(f"Created {len(chunks)} chunks")
        return chunks
    
    def _group_sentences(
        self,
        sentences: List[Tuple[str, int, int]],
        topic_shifts: List[int]
    ) -> List[List[Tuple[str, int, int]]]:
        """
        Group sentences into semantic units based on topic shifts.
        """
        if not sentences:
            return []
        
        units = []
        current_unit = [sentences[0]]
        
        for i in range(1, len(sentences)):
            if i in topic_shifts:
                # Start a new unit
                if current_unit:
                    units.append(current_unit)
                current_unit = [sentences[i]]
            else:
                # Add to current unit
                current_unit.append(sentences[i])
        
        # Add the last unit
        if current_unit:
            units.append(current_unit)
        
        return units
    
    def _split_large_unit(
        self,
        unit: List[Tuple[str, int, int]],
        full_text: str
    ) -> List[Tuple[str, int, int]]:
        """
        Split a large semantic unit into smaller chunks.
        Uses sentence boundaries and tries to maintain semantic coherence.
        """
        if not unit:
            return []
        
        unit_text = ' '.join([s[0] for s in unit])
        unit_tokens = self.count_tokens(unit_text)
        
        if unit_tokens <= self.max_chunk_tokens:
            return [(unit_text, unit[0][1], unit[-1][2])]
        
        # Split by sentences, trying to keep chunks near max_tokens
        chunks = []
        current_chunk = []
        current_tokens = 0
        
        for sentence in unit:
            sent_text = sentence[0]
            sent_tokens = self.count_tokens(sent_text)
            
            if current_tokens + sent_tokens <= self.max_chunk_tokens:
                current_chunk.append(sentence)
                current_tokens += sent_tokens
            else:
                # Finalize current chunk
                if current_chunk:
                    chunk_text = ' '.join([s[0] for s in current_chunk])
                    chunks.append((
                        chunk_text,
                        current_chunk[0][1],
                        current_chunk[-1][2]
                    ))
                
                # Start new chunk
                current_chunk = [sentence]
                current_tokens = sent_tokens
        
        # Add remaining chunk
        if current_chunk:
            chunk_text = ' '.join([s[0] for s in current_chunk])
            chunks.append((
                chunk_text,
                current_chunk[0][1],
                current_chunk[-1][2]
            ))
        
        return chunks


def chunk_document(
    text: str,
    document_id: Optional[str] = None,
    **kwargs
) -> List[Chunk]:
    """
    Convenience function to chunk a document.
    
    Args:
        text: Input text to chunk
        document_id: Optional document identifier
        **kwargs: Additional arguments passed to SemanticChunker
    
    Returns:
        List of Chunk objects
    """
    chunker = SemanticChunker(**kwargs)
    return chunker.chunk_text(text, document_id)


def chunks_to_faiss_format(chunks: List[Chunk]) -> List[Dict]:
    """
    Convert chunks to format suitable for FAISS indexing.
    
    Args:
        chunks: List of Chunk objects
    
    Returns:
        List of dictionaries with chunk data and metadata
    """
    return [chunk.to_dict() for chunk in chunks]

