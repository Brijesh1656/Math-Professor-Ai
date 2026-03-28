import React from 'react';
import { marked } from 'marked';
import { Message, Role, KnowledgeSource } from '../types';
import Feedback from './Feedback';
import SourcePill from './SourcePill';
import { DownloadIcon, BotIcon } from '../constants';
import ExtractedQuestions from './ExtractedQuestions';

interface MessageBubbleProps {
  message: Message;
  onFeedback?: (messageId: number, feedback: string) => void;
  onQuestionSelect?: (question: string) => void;
}

const TypingIndicator: React.FC<{ text?: string }> = ({ text }) => (
    <div className="flex items-center space-x-2 p-3">
        <div className="w-3 h-3 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full typing-dot" style={{animationDelay: '0s'}}></div>
        <div className="w-3 h-3 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full typing-dot" style={{animationDelay: '0.2s'}}></div>
        <div className="w-3 h-3 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full typing-dot" style={{animationDelay: '0.4s'}}></div>
        <span className="text-sm text-gray-400 ml-2">{text || 'Thinking...'}</span>
    </div>
);

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onFeedback, onQuestionSelect }) => {
  const isUser = message.role === Role.USER;

  const downloadAnswer = () => {
    const markdownContent = `
# Math Agent Solution

---

**Answer:**
${message.text}

---
**Source:** ${message.knowledgeSource || 'N/A'}
${message.sources && message.sources.length > 0 ? `
**Web Sources:**
${message.sources.map(s => `- [${s.title}](${s.uri})`).join('\n')}
` : ''}
    `;

    const blob = new Blob([markdownContent.trim()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `math_agent_solution_${message.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const renderMessageContent = () => {
    if (message.isLoading) {
      return <TypingIndicator text={message.text || undefined} />;
    }
    const sanitizedHtml = marked.parse(message.text.replace(/<script.*?>.*?<\/script>/gi, ''));
    return <div className="prose prose-sm prose-invert max-w-none prose-p:text-gray-300 prose-headings:text-white prose-strong:text-white prose-code:text-cyan-300 prose-a:text-blue-400" dangerouslySetInnerHTML={{ __html: sanitizedHtml as string }} />;
  };

  const bubbleBaseClasses = "w-full p-6 rounded-3xl shadow-2xl transition-all duration-300";

  return (
    <div className={`flex items-start gap-4 ${isUser ? 'flex-row-reverse' : ''} ${isUser ? 'message-bubble-user' : 'message-bubble-agent'}`}>
       {!isUser && (
         <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-lg glow-blue">
           <BotIcon className="w-7 h-7 text-white" />
         </div>
       )}
       {isUser && (
         <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl shadow-lg">
           <span className="text-2xl">👤</span>
         </div>
       )}
      <div className={`max-w-3xl ${isUser ? 'ml-auto' : 'mr-auto'}`}>
          <div className={`${bubbleBaseClasses} ${
              isUser
                ? 'bg-gradient-to-br from-blue-600/80 to-blue-500/80 text-white glass-strong border-2 border-blue-400/30 rounded-br-md'
                : message.isError 
                ? 'bg-gradient-to-br from-red-600/50 to-red-500/50 text-red-100 glass-strong border-2 border-red-400/50 rounded-bl-md'
                : 'glass-strong text-gray-100 rounded-bl-md border-2 border-white/10 relative overflow-hidden hover:border-blue-400/30'
            }`}
          >
             {!isUser && !message.isError && !message.isLoading && (
              <div className="absolute top-0 left-0 h-full w-1.5 bg-gradient-to-b from-blue-400 via-purple-500 to-cyan-400"></div>
             )}
            <div className="whitespace-pre-wrap pl-2">{renderMessageContent()}</div>
            
            {message.extractedQuestions && onQuestionSelect && (
              <ExtractedQuestions questions={message.extractedQuestions} onQuestionSelect={onQuestionSelect} />
            )}
            
            {!isUser && !message.isError && !message.isLoading && message.text && (
              <div className="mt-6 pt-4 border-t border-white/20 pl-2">
                 {message.knowledgeSource && (
                    <div className="flex items-center justify-between mb-4">
                        <span className={`text-xs font-bold px-3 py-1.5 rounded-full border-2 ${
                            message.knowledgeSource === KnowledgeSource.KNOWLEDGE_BASE
                                ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border-green-400/50'
                                : 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border-purple-400/50'
                        }`}>
                           🔍 {message.knowledgeSource}
                        </span>
                        <button 
                          onClick={downloadAnswer} 
                          className="p-2 text-gray-400 hover:text-blue-400 transition-all duration-300 hover:scale-110 btn-hover-lift glass rounded-xl" 
                          aria-label="Download answer as Markdown"
                        >
                            <DownloadIcon className="w-5 h-5" />
                        </button>
                    </div>
                )}
                 {message.isRefined && (
                    <div className="mb-3 p-3 bg-green-500/10 border-2 border-green-400/30 rounded-xl">
                      <p className="text-xs text-green-300 font-semibold flex items-center gap-2">
                        <span>✨</span>
                        This answer has been refined based on your feedback
                      </p>
                    </div>
                )}
                
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-2">
                    <h4 className="text-xs font-bold text-gray-400 mb-2">Web Sources:</h4>
                    <div className="flex flex-wrap gap-2">
                      {message.sources.map((source, index) => (
                        <SourcePill key={index} source={source} />
                      ))}
                    </div>
                  </div>
                )}

                {onFeedback && !message.isRefined && !message.extractedQuestions && <Feedback messageId={message.id} onFeedback={onFeedback} />}
              </div>
            )}
          </div>
      </div>
    </div>
  );
};

export default MessageBubble;