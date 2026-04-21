import React, { useState } from 'react';
import { markLastTurnCorrect } from '../services/logger';

interface FeedbackProps {
  messageId: number;
  onFeedback: (messageId: number, feedback: string) => void;
}

const Feedback: React.FC<FeedbackProps> = ({ messageId, onFeedback }) => {
  const [showInput, setShowInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

  const handleGood = () => {
    markLastTurnCorrect(true);
    onFeedback(messageId, 'The answer was correct and helpful.');
    setFeedbackSent(true);
  };

  const handleBad = () => setShowInput(true);

  const handleSend = () => {
    if (!feedbackText.trim()) return;
    markLastTurnCorrect(false);
    onFeedback(messageId, feedbackText);
    setShowInput(false);
    setFeedbackText('');
    setFeedbackSent(true);
  };

  if (feedbackSent) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
        <p className="text-xs text-emerald-400/60">Thanks for your feedback</p>
      </div>
    );
  }

  return (
    <div>
      {!showInput && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/25">Helpful?</span>
          <button
            onClick={handleGood}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all duration-150"
            style={{ border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.3)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.1)';
              (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(16,185,129,0.25)';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(52,211,153,0.85)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(255,255,255,0.07)';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.3)';
            }}
            aria-label="Good answer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H5.904c-.66 0-1.174.544-1.174 1.215v4.154c0 .671.514 1.215 1.174 1.215h1.305c.162 0 .315.031.465.09L8.21 15.307c.553.185 1.12.348 1.688.483a18.75 18.75 0 0 0 5.483-3.884c.253-.332.48-.682.682-1.051a3.397 3.397 0 0 0 .23-1.12c0-.166-.017-.332-.051-.49a1.44 1.44 0 0 0-.42-1.07Z" />
            </svg>
            Good
          </button>
          <button
            onClick={handleBad}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all duration-150"
            style={{ border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.3)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)';
              (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(239,68,68,0.25)';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(252,165,165,0.85)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.border = '1px solid rgba(255,255,255,0.07)';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.3)';
            }}
            aria-label="Bad answer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.587 8.188a11.953 11.953 0 0 1-1.043 2.268c-.294.424-.904.683-1.465.683H12.25c-.47 0-.91-.121-1.308-.34L5.58 14.55a4.502 4.502 0 0 1-2.433-4.084V8.625a4.5 4.5 0 0 1 4.5-4.5h.633Z" />
            </svg>
            Improve
          </button>
        </div>
      )}

      {showInput && (
        <div className="space-y-2.5 pt-0.5">
          <textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="How can I improve this answer?"
            rows={2}
            className="w-full p-3 text-sm text-white/80 placeholder-white/20 focus:outline-none resize-none rounded-xl transition-all"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.09)',
            }}
            onFocus={e => { (e.target as HTMLTextAreaElement).style.border = '1px solid rgba(16,185,129,0.3)'; }}
            onBlur={e => { (e.target as HTMLTextAreaElement).style.border = '1px solid rgba(255,255,255,0.09)'; }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={!feedbackText.trim()}
              className="px-4 py-1.5 text-sm rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(5,150,105,0.18))',
                border: '1px solid rgba(16,185,129,0.28)',
                color: 'rgba(52,211,153,0.9)',
              }}
            >
              Refine Answer
            </button>
            <button
              onClick={() => setShowInput(false)}
              className="px-3 py-1.5 text-sm text-white/30 hover:text-white/55 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Feedback;
