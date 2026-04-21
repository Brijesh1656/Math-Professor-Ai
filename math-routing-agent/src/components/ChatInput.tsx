import React, { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  disabled: boolean;
  children?: React.ReactNode;
}

const ArrowUpIcon: React.FC = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
  </svg>
);

const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, disabled, children }) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const submit = () => {
    if (text.trim() && !disabled) {
      onSendMessage(text.trim());
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }} className="flex items-end gap-2 p-3">
      {children}

      <div className="flex-grow py-0.5">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a math question… (Shift+Enter for newline)"
          disabled={disabled}
          className="w-full px-3 py-2 bg-transparent text-[15px] text-white/90 placeholder-white/20 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed resize-none leading-relaxed overflow-hidden"
          style={{ maxHeight: 200 }}
        />
      </div>

      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send"
        className="flex-shrink-0 mb-0.5 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 focus:outline-none"
        style={canSend
          ? {
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#fff',
              boxShadow: '0 2px 12px rgba(16,185,129,0.35)',
            }
          : {
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.2)',
              cursor: 'not-allowed',
            }
        }
      >
        <ArrowUpIcon />
      </button>
    </form>
  );
};

export default ChatInput;
