import React from 'react';
import MessageBubbleRouter from './MessageBubbleRouter';
import { LoadingSpinner } from '../../components/ui';

interface MessageWithAttachments {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  thinking?: string;
  isStreaming?: boolean;
  attachments?: { name: string; content: string }[];
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

interface MessageBubbleProps {
  message: MessageWithAttachments;
  currentAssistantName?: string;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  currentAssistantName,
}) => {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isAssistant = message.role === 'assistant' || message.role === 'system';

  const getBubbleStyles = () => {
    if (isUser) {
      return {
        container: 'justify-end',
        bubble:
          'text-primary-foreground bg-primary shadow-lg border border-primary/20',
        avatar: '🧑‍💻',
        avatarBg: 'bg-primary',
      };
    } else if (isTool) {
      return {
        container: 'justify-start',
        bubble:
          'bg-muted text-muted-foreground shadow-lg border border-muted/20',
        avatar: '🔧',
        avatarBg: 'bg-muted',
      };
    } else {
      return {
        container: 'justify-start',
        bubble:
          'bg-secondary text-secondary-foreground shadow-lg border border-secondary/20',
        avatar: '🤖',
        avatarBg: 'bg-secondary',
      };
    }
  };

  const styles = getBubbleStyles();

  const getRoleLabel = () => {
    if (isUser) return 'You';
    if (isTool) return 'Tool Output';
    if (isAssistant)
      return currentAssistantName
        ? `Agent (${currentAssistantName})`
        : 'Assistant';
    return '';
  };

  return (
    <div
      className={`flex ${styles.container} mb-8 mt-3 animate-in fade-in slide-in-from-bottom-4 duration-500`}
    >
      <div
        className={`max-w-[85%] lg:max-w-4xl ${styles.bubble} rounded-2xl px-5 py-4 backdrop-blur-sm transition-all duration-200 hover:shadow-xl`}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`w-7 h-7 ${styles.avatarBg} rounded-full flex items-center justify-center text-sm shadow-sm`}
          >
            {styles.avatar}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium opacity-90">
              {getRoleLabel()}
            </span>
            <span className="text-xs opacity-60">
              {new Date().toLocaleTimeString()}
            </span>
          </div>
        </div>
        {message.thinking && (
          <div className="flex items-center gap-3 mt-4 p-3 bg-popover rounded-lg border border-border">
            {message.isStreaming ? <LoadingSpinner size="sm" /> : <></>}
            <span className="text-sm opacity-50 italic">
              {message.thinking}
            </span>
          </div>
        )}
        <MessageBubbleRouter message={message} />
      </div>
    </div>
  );
};

export default MessageBubble;
