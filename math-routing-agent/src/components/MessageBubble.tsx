import React from 'react';
import { marked } from 'marked';
import { Message, Role, KnowledgeSource } from '../types';
import Feedback from './Feedback';
import SourcePill from './SourcePill';
import { DownloadIcon } from '../constants';
import ExtractedQuestions from './ExtractedQuestions';

interface MessageBubbleProps {
  message: Message;
  onFeedback?: (messageId: number, feedback: string) => void;
  onQuestionSelect?: (question: string) => void;
}

const AgentAvatar: React.FC = () => (
  <div
    className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
    style={{
      background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(129,140,248,0.12))',
      border: '1px solid rgba(16,185,129,0.28)',
      boxShadow: '0 0 12px rgba(16,185,129,0.12)',
    }}
  >
    <span className="text-sm font-bold logo-gradient leading-none select-none">∑</span>
  </div>
);

const LoadingIndicator: React.FC<{ text?: string }> = ({ text }) => (
  <div className="flex items-center gap-3 py-0.5">
    <div className="flex items-center gap-1">
      <div className="w-2 h-2 rounded-full bg-emerald-400/70 typing-dot" />
      <div className="w-2 h-2 rounded-full bg-violet-400/70  typing-dot" />
      <div className="w-2 h-2 rounded-full bg-sky-400/70     typing-dot" />
    </div>
    {text && (
      <span className="text-[13px] text-white/40 truncate max-w-[380px] leading-relaxed">
        {text}
      </span>
    )}
  </div>
);

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onFeedback, onQuestionSelect }) => {
  const isUser = message.role === Role.USER;

  const downloadAnswer = () => {
    const md = `# Math Agent Solution\n\n---\n\n**Answer:**\n${message.text}\n\n---\n**Source:** ${message.knowledgeSource || 'N/A'}${
      message.sources?.length
        ? `\n\n**Web Sources:**\n${message.sources.map(s => `- [${s.title}](${s.uri})`).join('\n')}`
        : ''
    }`;
    const url = URL.createObjectURL(new Blob([md.trim()], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `math_solution_${message.id}.md` });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderContent = () => {
    if (message.isLoading) return <LoadingIndicator text={message.text || undefined} />;
    const html = marked.parse(message.text.replace(/<script.*?>.*?<\/script>/gi, '')) as string;
    return <div className="prose-chat" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  /* ── USER ─────────────────────────────────────────────────────────────── */
  if (isUser) {
    return (
      <div className="message-in flex justify-end">
        <div className="max-w-[76%]">
          <p className="text-[10px] uppercase tracking-widest text-white/20 text-right mb-1.5 pr-1">You</p>
          <div
            className="px-4 py-3.5 rounded-2xl rounded-tr-md text-white/90 text-[15px] leading-relaxed"
            style={{
              background: 'linear-gradient(135deg, #1a1730 0%, #1c1828 100%)',
              border: '1px solid rgba(129,140,248,0.18)',
              boxShadow: '0 2px 16px rgba(129,140,248,0.06)',
            }}
          >
            {message.text}
          </div>
        </div>
      </div>
    );
  }

  /* ── AGENT ────────────────────────────────────────────────────────────── */
  return (
    <div className="message-in flex items-start gap-3.5">
      <AgentAvatar />

      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-white/20 mb-2.5">Math Professor</p>

        {/* Content area */}
        {message.isError ? (
          <div
            className="px-4 py-3.5 rounded-2xl text-red-300 text-[15px] leading-relaxed"
            style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            {renderContent()}
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed">{renderContent()}</div>
        )}

        {/* Extracted questions */}
        {message.extractedQuestions && onQuestionSelect && (
          <ExtractedQuestions questions={message.extractedQuestions} onQuestionSelect={onQuestionSelect} />
        )}

        {/* Footer */}
        {!message.isError && !message.isLoading && message.text && (
          <div
            className="mt-4 pt-3.5 flex flex-col gap-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            {/* Top row: badge + download */}
            <div className="flex items-center justify-between">
              {message.knowledgeSource && (
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-lg font-medium"
                  style={
                    message.knowledgeSource === KnowledgeSource.KNOWLEDGE_BASE
                      ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: 'rgba(52,211,153,0.85)' }
                      : { background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.18)', color: 'rgba(167,139,250,0.8)' }
                  }
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: message.knowledgeSource === KnowledgeSource.KNOWLEDGE_BASE ? 'rgba(52,211,153,0.8)' : 'rgba(167,139,250,0.8)' }}
                  />
                  {message.knowledgeSource}
                </span>
              )}
              <button
                onClick={downloadAnswer}
                className="ml-auto p-1.5 text-white/25 hover:text-white/60 rounded-lg transition-all duration-150 hover:bg-white/[0.05]"
                aria-label="Download answer"
              >
                <DownloadIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Refined badge */}
            {message.isRefined && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)', color: 'rgba(52,211,153,0.8)' }}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Refined based on your feedback
              </div>
            )}

            {/* Sources */}
            {message.sources && message.sources.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/20 mb-2">Sources</p>
                <div className="flex flex-wrap gap-1.5">
                  {message.sources.map((source, i) => <SourcePill key={i} source={source} />)}
                </div>
              </div>
            )}

            {/* Feedback */}
            {onFeedback && !message.isRefined && !message.extractedQuestions && (
              <Feedback messageId={message.id} onFeedback={onFeedback} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
