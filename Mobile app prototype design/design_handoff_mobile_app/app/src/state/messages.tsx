import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as portal from '../api/portal';
import { Message } from '../data/types';

type MessagesState = {
  messages: Message[];
  typing: boolean;
  /** Empty or whitespace-only text is ignored. */
  send: (text: string) => void;
};

const MessagesContext = createContext<MessagesState | null>(null);

export function useMessages() {
  const value = useContext(MessagesContext);
  if (!value) throw new Error('useMessages must be used inside <MessagesProvider>');
  return value;
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>(() => portal.loadThread());
  const [typing, setTyping] = useState(false);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (replyTimer.current) clearTimeout(replyTimer.current);
  }, []);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((current) => [...current, portal.composeOutgoing(trimmed)]);
    setTyping(true);

    // Prototype only — the real thread receives inbound over push.
    if (replyTimer.current) clearTimeout(replyTimer.current);
    replyTimer.current = setTimeout(() => {
      setTyping(false);
      setMessages((current) => [...current, portal.composeCannedReply()]);
    }, portal.CANNED_REPLY_DELAY);
  }, []);

  const value = useMemo(() => ({ messages, typing, send }), [messages, typing, send]);

  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}
