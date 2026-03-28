import React, { useState } from 'react';
import { ThumbsUpIcon, ThumbsDownIcon } from '../constants';
import { markLastTurnCorrect } from '../services/logger';

interface FeedbackProps {
  messageId: number;
  onFeedback: (messageId: number, feedback: string) => void;
}

const Feedback: React.FC<FeedbackProps> = ({ messageId, onFeedback }) => {
  const [showInput, setShowInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

  const handleFeedbackClick = (isGood: boolean) => {
    if (isGood) {
      // FIX 3: mark the last turn of the current session as correct
      markLastTurnCorrect(true);
      onFeedback(messageId, 'The answer was correct and helpful.');
      setFeedbackSent(true);
    } else {
      setShowInput(true);
    }
  };

  const handleSendFeedback = () => {
    if (feedbackText.trim()) {
      // FIX 3: mark the last turn of the current session as incorrect
      markLastTurnCorrect(false);
      onFeedback(messageId, feedbackText);
      setShowInput(false);
      setFeedbackText('');
      setFeedbackSent(true);
    }
  };

  if (feedbackSent) {
    return (
      <div className="p-3 bg-green-500/10 border-2 border-green-400/30 rounded-xl">
        <p className="text-xs text-green-300 font-semibold flex items-center gap-2">
          <span>🎉</span>
          Thank you for your feedback!
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {!showInput && (
        <div className="flex items-center gap-3 p-4 glass-strong rounded-2xl border-2 border-white/20">
          <span className="text-sm text-gray-300 font-semibold">Was this helpful?</span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => handleFeedbackClick(true)}
              className="flex items-center gap-2 px-4 py-2 text-gray-300 hover:text-white bg-green-600/20 hover:bg-green-600/40 border-2 border-green-500/30 hover:border-green-400/60 rounded-xl transition-all duration-300 transform hover:scale-105 group shadow-lg hover:shadow-green-500/20"
              aria-label="Good answer"
            >
              <ThumbsUpIcon className="w-5 h-5 group-hover:animate-bounce" />
              <span className="text-sm font-medium">Helpful</span>
            </button>
            <button
              onClick={() => handleFeedbackClick(false)}
              className="flex items-center gap-2 px-4 py-2 text-gray-300 hover:text-white bg-red-600/20 hover:bg-red-600/40 border-2 border-red-500/30 hover:border-red-400/60 rounded-xl transition-all duration-300 transform hover:scale-105 group shadow-lg hover:shadow-red-500/20"
              aria-label="Bad answer"
            >
              <ThumbsDownIcon className="w-5 h-5 group-hover:animate-bounce" />
              <span className="text-sm font-medium">Not Helpful</span>
            </button>
          </div>
        </div>
      )}

      {showInput && (
        <div className="space-y-3 p-4 glass-strong rounded-2xl border-2 border-blue-400/30">
          <textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="Tell me how I can improve this answer..."
            rows={3}
            className="w-full p-3 border-2 border-white/10 rounded-xl bg-white/5 text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-400/50 transition-all duration-300 resize-none"
          />
          <button
            onClick={handleSendFeedback}
            className="w-full px-4 py-3 font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl hover:from-blue-500 hover:to-purple-500 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-lg"
            disabled={!feedbackText.trim()}
          >
            ✨ Refine Answer
          </button>
        </div>
      )}
    </div>
  );
};

export default Feedback;
