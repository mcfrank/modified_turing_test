import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AgentType, Message, Condition, ChatStats } from '../types';
import { fetchGreeting, fetchReply, getInitialGreetingLegacy, sendToAgentLegacy } from '../services/chatOrchestrator';
import { socketService } from '../services/socketService';

interface ChatScreenProps {
  condition: Condition;
  agentType: AgentType;
  sessionId: string | null;
  // true = legacy interface, where bots speak first, show an instant typing
  // indicator, lock the input while replying, and reply after a fixed delay;
  // false = bots and humans are indistinguishable by interface cues.
  giveaways: boolean;
  onFinished: (stats: ChatStats, messages: Message[], endReason: string) => void;
  debugMode: boolean;
}

const TOTAL_TIME_MS = 3 * 60 * 1000; // 3 minutes

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// Matched-mode timing, roughly a student typing on a laptop.
const readDelayMs = (text: string) => Math.min(800 + 25 * text.length, 3000) + Math.random() * 1000;
const typingDelayMs = (text: string) => Math.min(Math.max((text.length / 6) * 1000, 1000), 12000) + Math.random() * 1000;

const DEBUG_AGENT_LABELS: Record<AgentType, string> = {
  [AgentType.ELIZA_CLASSIC]: 'Eliza',
  [AgentType.GEMINI_ELIZA]: 'Gemini Eliza',
  [AgentType.GEMINI_STUDENT]: 'Gemini Student',
  [AgentType.REAL_STUDENT]: 'Real Student',
  [AgentType.LLAMA_BASE]: 'Base (Llama-3.1-8B)',
  [AgentType.LLAMA_POSTTRAINED]: 'Post-trained (Llama-3.1-8B-Instruct)',
};

export const ChatScreen: React.FC<ChatScreenProps> = ({ condition, agentType, sessionId, giveaways, onFinished, debugMode }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME_MS);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const replyTokenRef = useRef(0);
  const partnerTypingTimeoutRef = useRef<number | null>(null);
  const lastTypingEmitRef = useRef(0);
  const isBot = agentType !== AgentType.REAL_STUDENT;
  // Legacy mode locks the input while a bot is "typing".
  const inputLocked = giveaways && isTyping;

  const addAgentMessage = (text: string) => {
    setMessages(prev => [...prev, {
      id: 'agent-' + Date.now() + Math.random(),
      sender: 'agent',
      text,
      timestamp: Date.now(),
    }]);
  };

  // Matched mode: wait as if reading, show typing for as long as a person
  // would take to type the reply, then post it. A newer user message that
  // arrives before typing starts supersedes this reply.
  const deliverMatched = async (getText: () => Promise<string | null>, readMs: number) => {
    const token = ++replyTokenRef.current;
    const [text] = await Promise.all([getText(), sleep(readMs)]);
    if (!text || token !== replyTokenRef.current || finishedRef.current) return;
    setIsTyping(true);
    await sleep(typingDelayMs(text));
    if (finishedRef.current) return;
    addAgentMessage(text);
    if (token === replyTokenRef.current) setIsTyping(false);
  };

  // Initialize with a greeting from agent if applicable
  useEffect(() => {
    let isMounted = true;
    
    const initChat = async () => {
      // Only check for greeting if no messages exist
      if (messages.length > 0) return;

      // Real students don't trigger automatic greetings, so we don't need to show typing
      if (agentType === AgentType.REAL_STUDENT) return;

      if (!giveaways) {
        // Like a human partner, open the conversation only about half the
        // time, and only if the user hasn't already said something.
        if (Math.random() < 0.5) return;
        await sleep(3000 + Math.random() * 5000);
        if (!isMounted || messagesRef.current.length > 0) return;
        deliverMatched(() => fetchGreeting(agentType, sessionId), 0);
        return;
      }

      setIsTyping(true);
      try {
        const greeting = await getInitialGreetingLegacy(agentType, sessionId);
        if (isMounted && greeting) {
          const agentMsg: Message = {
            id: 'init-' + Date.now(),
            sender: 'agent',
            text: greeting,
            timestamp: Date.now()
          };
          setMessages([agentMsg]);
        }
      } catch (error) {
        console.error("Failed to get initial greeting", error);
      } finally {
        if (isMounted) {
            setIsTyping(false);
            // Re-focus input after agent speaks
            setTimeout(() => inputRef.current?.focus(), 100);
        }
      }
    };

    initChat();

    return () => { isMounted = false; };
  }, [agentType]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    startTimeRef.current = Date.now();
  }, []);

  const buildStats = useCallback((endTime: number): ChatStats => {
    const messagesSnapshot = messagesRef.current;
    const startTime = startTimeRef.current || endTime;

    let turnsUser = 0;
    let turnsAgent = 0;
    let wordsUser = 0;
    let wordsAgent = 0;

    const countWords = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return 0;
      return trimmed.split(/\s+/).length;
    };

    for (const msg of messagesSnapshot) {
      if (msg.sender === 'user') {
        turnsUser += 1;
        wordsUser += countWords(msg.text);
      } else {
        turnsAgent += 1;
        wordsAgent += countWords(msg.text);
      }
    }

    const durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000));

    return {
      turnsUser,
      turnsAgent,
      turnsTotal: turnsUser + turnsAgent,
      wordsUser,
      wordsAgent,
      wordsTotal: wordsUser + wordsAgent,
      durationSeconds,
    };
  }, []);

  // Listener for Real Student socket messages
  useEffect(() => {
    if (agentType === AgentType.REAL_STUDENT) {
      socketService.onReceiveMessage((msg) => {
        setPartnerTyping(false);
        setMessages(prev => [...prev, msg]);
      });
      if (!giveaways) {
        socketService.onPartnerTyping(() => {
          setPartnerTyping(true);
          if (partnerTypingTimeoutRef.current) window.clearTimeout(partnerTypingTimeoutRef.current);
          partnerTypingTimeoutRef.current = window.setTimeout(() => setPartnerTyping(false), 3000);
        });
      }
      socketService.onPartnerDisconnected(() => {
        if (finishedRef.current) return;
        const systemMsg: Message = {
          id: 'sys-' + Date.now(),
          sender: 'system',
          text: '[technical issue - chat partner disconnected]',
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, systemMsg]);
        finishedRef.current = true;
        setTimeout(() => {
          const stats = buildStats(Date.now());
          onFinished(stats, messagesRef.current, 'partner_disconnected');
        }, 5000);
      });
    }
  }, [agentType, giveaways, buildStats, onFinished]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, partnerTyping]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1000) {
          clearInterval(timer);
          if (finishedRef.current) {
            return 0;
          }
          finishedRef.current = true;
          const stats = buildStats(Date.now());
          onFinished(stats, messagesRef.current, 'timer');
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [buildStats, onFinished]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const finishChatEarly = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const stats = buildStats(Date.now());
    onFinished(stats, messagesRef.current, 'ended_early');
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || inputLocked) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputText,
      timestamp: Date.now()
    };

    const history = messagesRef.current;
    messagesRef.current = [...history, userMsg];
    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    if (!isBot) {
      // Real student responses come via the socket listener above.
      socketService.sendMessage(userMsg.text);
      return;
    }

    if (!giveaways) {
      deliverMatched(() => fetchReply(agentType, sessionId, history, userMsg.text), readDelayMs(userMsg.text));
      return;
    }

    setIsTyping(true);

    try {
      const responseText = await sendToAgentLegacy(agentType, sessionId, history, userMsg.text);
      if (responseText) addAgentMessage(responseText);
    } catch (error) {
      console.error("Failed to get response", error);
    } finally {
      setIsTyping(false);
      // Re-focus input after response
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    // Let a human partner see "typing...", as they would for a bot.
    if (!giveaways && !isBot && Date.now() - lastTypingEmitRef.current > 1000) {
      lastTypingEmitRef.current = Date.now();
      socketService.sendTyping();
    }
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700 shadow-md relative">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Condition</span>
          <span className="text-sm font-medium text-blue-300">{condition}</span>
        </div>
        
        {debugMode && (
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none flex items-center justify-center">
            <div className="bg-red-900/90 text-red-100 px-3 py-1 rounded-md text-xs font-mono border border-red-500 shadow-lg">
              DEBUG: {DEBUG_AGENT_LABELS[agentType] || agentType}
            </div>
          </div>
        )}

        <div className={`text-xl font-mono font-bold ${timeLeft < 30000 ? 'text-red-500 animate-pulse' : 'text-gray-200'}`}>
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isTyping && !partnerTyping && (
          <div className="flex h-full items-center justify-center text-gray-600 italic">
            Start the conversation...
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-2xl break-words text-sm md:text-base shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : msg.sender === 'system'
                    ? 'bg-red-900/60 text-red-200 border border-red-700'
                    : 'bg-gray-700 text-gray-200 rounded-bl-none'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {(isTyping || partnerTyping) && (
           <div className="flex justify-start w-full">
             <div className="bg-gray-700 px-4 py-3 rounded-2xl rounded-bl-none flex space-x-1 items-center">
               <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
               <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
               <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
             </div>
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSendMessage} className="p-4 bg-gray-800 border-t border-gray-700">
        <div className="flex space-x-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder="Type your message..."
            className="flex-1 bg-gray-900 border border-gray-600 text-gray-100 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            disabled={inputLocked}
          />
          <button
            type="submit"
            disabled={!inputText.trim() || inputLocked}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full p-2 w-10 h-10 flex items-center justify-center transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={finishChatEarly}
            className="bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-full px-4 py-2 text-sm font-semibold border border-gray-600 transition-colors"
          >
            End Chat
          </button>
        </div>
      </form>
    </div>
  );
};