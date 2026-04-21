import React from 'react';
import { Source } from '../types';

interface SourcePillProps { source: Source; }

const SourcePill: React.FC<SourcePillProps> = ({ source }) => {
  let hostname = '';
  try { hostname = new URL(source.uri).hostname.replace('www.', ''); } catch {}

  return (
    <a
      href={source.uri}
      target="_blank"
      rel="noopener noreferrer"
      title={source.title}
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-all duration-150 truncate max-w-[200px]"
      style={{
        background: 'rgba(129,140,248,0.07)',
        border: '1px solid rgba(129,140,248,0.15)',
        color: 'rgba(167,139,250,0.75)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(129,140,248,0.12)';
        (e.currentTarget as HTMLAnchorElement).style.border = '1px solid rgba(129,140,248,0.28)';
        (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(196,181,253,0.9)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(129,140,248,0.07)';
        (e.currentTarget as HTMLAnchorElement).style.border = '1px solid rgba(129,140,248,0.15)';
        (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(167,139,250,0.75)';
      }}
    >
      <span className="truncate">{source.title || hostname}</span>
      <svg className="w-2.5 h-2.5 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
};

export default SourcePill;
