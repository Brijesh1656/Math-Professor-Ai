"""
Vercel Serverless Function for research turn logging.
Uses Supabase REST API directly (no supabase-py dependency).
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
SUPABASE_AVAILABLE = bool(SUPABASE_URL and SUPABASE_KEY)


def supabase_select(table, select, filters):
    """Run a SELECT query via Supabase REST API."""
    params = f'select={select}'
    for key, op, val in filters:
        if op == 'eq':
            params += f'&{key}=eq.{val}'
        elif op == 'gte':
            params += f'&{key}=gte.{val}'
    url = f'{SUPABASE_URL}/rest/v1/{table}?{params}'
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def supabase_insert(table, row):
    """Insert a row via Supabase REST API."""
    url = f'{SUPABASE_URL}/rest/v1/{table}'
    data = json.dumps(row).encode()
    req = urllib.request.Request(url, data=data, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    })
    with urllib.request.urlopen(req) as resp:
        return resp.status


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if not SUPABASE_AVAILABLE:
            self._send(503, {'success': False, 'error': 'Supabase not configured'})
            return

        try:
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length).decode('utf-8'))

            raw_ip = self.headers.get('x-forwarded-for', '0.0.0.0').split(',')[0].strip()
            ip_hash = hashlib.sha256(raw_ip.encode()).hexdigest()

            session_id = str(data.get('sessionId', ''))
            if not session_id:
                self._send(400, {'success': False, 'error': 'Missing sessionId'})
                return

            # Rate limit 1: max 5 sessions per ip_hash per 24h
            since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            rows = supabase_select('rag_logs', 'session_id', [
                ('ip_hash', 'eq', ip_hash),
                ('timestamp', 'gte', since),
            ])
            unique_sessions = {r['session_id'] for r in rows}
            if session_id not in unique_sessions and len(unique_sessions) >= 5:
                self._send(429, {'success': False, 'error': 'Rate limit: max 5 sessions per 24h'})
                return

            # Rate limit 2: max 8 turns per session
            turns = supabase_select('rag_logs', 'turn_number', [
                ('session_id', 'eq', session_id),
            ])
            if len(turns) >= 8:
                self._send(429, {'success': False, 'error': 'Rate limit: max 8 turns per session'})
                return

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
                'was_correct': data.get('wasCorrect'),
                'problem_type': str(data.get('problemType', 'other'))[:50],
                'anchoring_enabled': bool(data.get('anchoringEnabled', True)),
                'timestamp': str(data.get('timestamp', datetime.now(timezone.utc).isoformat())),
                'ip_hash': ip_hash,
            }

            supabase_insert('rag_logs', row)
            self._send(200, {'success': True})

        except Exception as e:
            print(f'Error in /log-turn: {e}')
            self._send(500, {'success': False, 'error': str(e)})

    def _send(self, status, body):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())
