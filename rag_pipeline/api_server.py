"""
Standalone Python API server for semantic chunking + research logging.
Can be deployed on Railway, Render, Fly.io, or any Python hosting service.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os
import hashlib
from datetime import datetime, timedelta, timezone

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

try:
    from semantic_chunker import chunk_document, chunks_to_faiss_format
    CHUNKING_AVAILABLE = True
except ImportError as e:
    CHUNKING_AVAILABLE = False
    print(f"Warning: Chunking module not available: {e}")

# FIX 9 — Supabase client (optional — falls back gracefully if not configured)
try:
    from supabase import create_client, Client as SupabaseClient  # type: ignore

    _SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
    _SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

    if _SUPABASE_URL and _SUPABASE_KEY:
        _supabase: SupabaseClient = create_client(_SUPABASE_URL, _SUPABASE_KEY)
        SUPABASE_AVAILABLE = True
        print("✅ Supabase client initialised")
    else:
        _supabase = None  # type: ignore
        SUPABASE_AVAILABLE = False
        print("⚠️  SUPABASE_URL / SUPABASE_SERVICE_KEY not set — server-side logging disabled")
except ImportError:
    _supabase = None  # type: ignore
    SUPABASE_AVAILABLE = False
    print("⚠️  supabase-py not installed — server-side logging disabled")

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'healthy',
        'chunking_available': CHUNKING_AVAILABLE,
        'supabase_available': SUPABASE_AVAILABLE,
    })


# ---------------------------------------------------------------------------
# Semantic chunking — unchanged behaviour, FIX 7 default overlap 64
# ---------------------------------------------------------------------------
@app.route('/chunk', methods=['POST', 'OPTIONS'])
def chunk():
    """
    Chunk a document using semantic chunking with sentence-boundary-aware splitting.

    Request body:
    {
        "text": "document text to chunk",
        "document_id": "optional_doc_id",
        "overlap_tokens": 64,          <- FIX 7: default changed from 150 to 64
        "max_chunk_tokens": 512,
        "min_chunk_tokens": 50,
        "similarity_threshold": 0.7
    }
    """
    if request.method == 'OPTIONS':
        return '', 200

    try:
        data = request.get_json()

        if not data:
            return jsonify({'success': False, 'error': 'Missing request body'}), 400

        text = data.get('text', '')
        document_id = data.get('document_id', None)
        overlap_tokens = data.get('overlap_tokens', 64)      # FIX 7: was 150
        max_chunk_tokens = data.get('max_chunk_tokens', 512)
        min_chunk_tokens = data.get('min_chunk_tokens', 50)
        similarity_threshold = data.get('similarity_threshold', 0.7)

        if not text:
            return jsonify({'success': False, 'error': 'Missing required field: text'}), 400

        if not CHUNKING_AVAILABLE:
            return jsonify({
                'success': False,
                'error': 'Chunking module not available. Please check dependencies.',
            }), 503

        chunks = chunk_document(
            text=text,
            document_id=document_id,
            overlap_tokens=overlap_tokens,
            max_chunk_tokens=max_chunk_tokens,
            min_chunk_tokens=min_chunk_tokens,
            similarity_threshold=similarity_threshold,
        )

        faiss_data = chunks_to_faiss_format(chunks)

        return jsonify({
            'success': True,
            'chunks': faiss_data,
            'total_chunks': len(faiss_data),
            'document_id': document_id,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': f'Internal server error: {str(e)}'}), 500


# ---------------------------------------------------------------------------
# FIX 9 — Research turn logging endpoint
#
# Accepts a TurnLog JSON body, SHA-256 hashes the caller IP, applies rate
# limits, then inserts into Supabase table `rag_logs`.
#
# Rate limits:
#   • Max 5 distinct sessions per ip_hash per 24 hours
#   • Max 8 turns per session_id
#
# Returns HTTP 429 if either limit is exceeded.
# Returns HTTP 503 if Supabase is not configured.
# All errors are logged server-side but never leak to the UI — the frontend
# uses fire-and-forget so a 5xx here is silently ignored.
# ---------------------------------------------------------------------------
@app.route('/log-turn', methods=['POST', 'OPTIONS'])
def log_turn():
    if request.method == 'OPTIONS':
        return '', 200

    if not SUPABASE_AVAILABLE:
        return jsonify({'success': False, 'error': 'Supabase not configured'}), 503

    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Missing request body'}), 400

        # SHA-256 hash the caller IP — never store raw IPs
        raw_ip = request.remote_addr or '0.0.0.0'
        ip_hash = hashlib.sha256(raw_ip.encode('utf-8')).hexdigest()

        session_id = str(data.get('sessionId', ''))
        if not session_id:
            return jsonify({'success': False, 'error': 'Missing sessionId'}), 400

        # ── Rate limit 1: max 5 sessions per ip_hash per 24 hours ────────
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        sessions_resp = (
            _supabase.table('rag_logs')
            .select('session_id')
            .eq('ip_hash', ip_hash)
            .gte('timestamp', since)
            .execute()
        )
        unique_sessions = {row['session_id'] for row in (sessions_resp.data or [])}
        if session_id not in unique_sessions and len(unique_sessions) >= 5:
            return jsonify({'success': False, 'error': 'Rate limit: max 5 sessions per 24h'}), 429

        # ── Rate limit 2: max 8 turns per session_id ─────────────────────
        turns_resp = (
            _supabase.table('rag_logs')
            .select('turn_number')
            .eq('session_id', session_id)
            .execute()
        )
        if len(turns_resp.data or []) >= 8:
            return jsonify({'success': False, 'error': 'Rate limit: max 8 turns per session'}), 429

        # ── Insert log row ────────────────────────────────────────────────
        row = {
            'session_id': session_id,
            'turn_number': int(data.get('turnNumber', 0)),
            'sub_query': str(data.get('subQuery', ''))[:300],
            'original_query': str(data.get('originalQuery', ''))[:500],
            'rag_chunk_count': int(data.get('ragChunkCount', 0)),
            'grounding_chunk_count': int(data.get('groundingChunkCount', 0)),
            'context_token_count': int(data.get('contextTokenCount', 0)),
            'used_web_search': bool(data.get('usedWebSearch', False)),
            'retrieval_tier': int(data.get('retrievalTier', 3)),
            'similarity_score': float(data.get('similarityScore', 0.0)),
            'was_correct': data.get('wasCorrect'),  # nullable boolean
            'problem_type': str(data.get('problemType', 'other'))[:50],
            'anchoring_enabled': bool(data.get('anchoringEnabled', True)),
            'timestamp': str(data.get('timestamp', datetime.now(timezone.utc).isoformat())),
            'ip_hash': ip_hash,
        }

        _supabase.table('rag_logs').insert(row).execute()

        return jsonify({'success': True})

    except Exception as e:
        print(f"Error in /log-turn: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
