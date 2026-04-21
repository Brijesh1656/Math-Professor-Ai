import React from 'react';

interface ExtractedQuestionsProps {
  questions: string[];
  onQuestionSelect: (question: string) => void;
}

const ExtractedQuestions: React.FC<ExtractedQuestionsProps> = ({ questions, onQuestionSelect }) => {
  if (questions.length === 0) return null;

  return (
    <div className="mt-4 pt-3.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-[10px] uppercase tracking-widest text-white/25 mb-3">
        Questions Found <span className="text-emerald-400/60">({questions.length})</span>
      </p>
      <div className="space-y-1.5">
        {questions.map((q, i) => (
          <button
            key={i}
            onClick={() => onQuestionSelect(q)}
            className="group w-full text-left px-3.5 py-3 rounded-xl transition-all duration-150"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.06)';
              (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(16,185,129,0.22)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.02)';
              (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(255,255,255,0.07)';
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="flex-shrink-0 w-6 h-6 rounded-lg text-[11px] font-bold text-emerald-400/70 flex items-center justify-center"
                style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.15)' }}
              >
                {i + 1}
              </span>
              <p className="text-sm text-white/55 group-hover:text-white/85 transition-colors flex-1 text-left leading-snug">
                {q}
              </p>
              <svg
                className="w-3.5 h-3.5 flex-shrink-0 text-white/15 group-hover:text-emerald-400/50 group-hover:translate-x-0.5 transition-all"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ExtractedQuestions;
