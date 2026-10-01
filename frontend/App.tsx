import React, { useEffect, useState } from 'react';
import { AppScreen, Condition, AgentType, ChatStats, Message } from './types';
import { IntroScreen } from './components/IntroScreen';
import { WaitingScreen } from './components/WaitingScreen';
import { ChatScreen } from './components/ChatScreen';
import { EvaluationScreen } from './components/EvaluationScreen';
import { socketService } from './services/socketService';

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.INTRO);
  const [selectedCondition, setSelectedCondition] = useState<Condition | null>(null);
  const [assignedAgent, setAssignedAgent] = useState<AgentType | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatStats, setChatStats] = useState<ChatStats | null>(null);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [giveaways, setGiveaways] = useState(false);
  const [loggingMessage, setLoggingMessage] = useState<string | null>(null);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (!response.ok) return;
        const data = await response.json();
        if (isMounted && typeof data?.debugMode === 'boolean') {
          setDebugMode(data.debugMode);
        }
      } catch (error) {
        console.warn('Failed to load config', error);
      }
    };
    loadConfig();
    return () => { isMounted = false; };
  }, []);

  const isValidAgentType = (value: string): value is AgentType => {
    return Object.values(AgentType).includes(value as AgentType);
  };

  const handleSelectCondition = async (condition: Condition, forcedAgentType?: AgentType) => {
    setSelectedCondition(condition);
    setCurrentScreen(AppScreen.WAITING);
    setChatStats(null);
    setSessionId(null);
    setLoggingMessage(null);
    setWaitingMessage(null);
    
    let agent: AgentType | null = null;
    let newSessionId: string | null = null;

    let newGiveaways = false;

    try {
      const response = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition, forcedAgentType }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.agentType && isValidAgentType(data.agentType)) {
          agent = data.agentType;
        }
        if (data?.sessionId) {
          newSessionId = data.sessionId;
        }
        newGiveaways = Boolean(data?.giveaways);
      }
    } catch (error) {
      console.warn('Failed to start session on backend', error);
    }

    // The backend only answers for sessions it issued, so there's no local fallback.
    if (!agent || !newSessionId) {
      setWaitingMessage("Sorry, couldn't start a session. Please try again.");
      setTimeout(() => {
        setSelectedCondition(null);
        setCurrentScreen(AppScreen.INTRO);
      }, 3000);
      return;
    }

    setAssignedAgent(agent);
    setSessionId(newSessionId);
    setGiveaways(newGiveaways);

    if (agent === AgentType.REAL_STUDENT) {
      // Connect to socket and wait for real match
      socketService.connect();
      socketService.joinQueue(
        newSessionId,
        () => {
          // Match found!
          setCurrentScreen(AppScreen.CHAT);
        },
        () => {
          setWaitingMessage("Sorry, no partner found.");
          setTimeout(() => {
            setSelectedCondition(null);
            setAssignedAgent(null);
            setCurrentScreen(AppScreen.INTRO);
          }, 3000);
        }
      );
    } else {
      // Simulate matching delay for bots
      const delay = 2000 + Math.random() * 2000;
      setTimeout(() => {
        setCurrentScreen(AppScreen.CHAT);
      }, delay);
    }
  };

  const handleChatFinished = (stats: ChatStats, messages: Message[], reason: string) => {
    // If we were using socket, disconnect now
    if (assignedAgent === AgentType.REAL_STUDENT) {
      socketService.disconnect();
    }
    setChatStats(stats);
    setTranscript(messages);
    setEndReason(reason);
    setCurrentScreen(AppScreen.EVALUATION);
  };

  const handleEvaluationSubmit = async (rating: number) => {
    setLoggingMessage(null);
    const fallbackStats: ChatStats = {
      turnsUser: 0,
      turnsAgent: 0,
      turnsTotal: 0,
      wordsUser: 0,
      wordsAgent: 0,
      wordsTotal: 0,
      durationSeconds: 0,
    };
    const resolvedStats = chatStats || fallbackStats;
    const resolvedSessionId = sessionId;

    // Here we would typically save the data to a backend
    console.log("Session Result:", {
      condition: selectedCondition,
      agent: assignedAgent,
      rating: rating,
      timestamp: Date.now(),
      stats: resolvedStats,
      sessionId: resolvedSessionId,
    });

    try {
      const response = await fetch('/api/evaluation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: resolvedSessionId,
          condition: selectedCondition,
          agentType: assignedAgent,
          rating,
          ...resolvedStats,
          endReason,
          transcript,
        }),
      });
      if (response.ok) {
        setLoggingMessage('Logging succeeded. Thank you!');
      } else {
        setLoggingMessage('Logging failed. Please alert the instructor.');
      }
    } catch (error) {
      console.error('Failed to submit evaluation to backend', error);
      setLoggingMessage('Logging failed. Please alert the instructor.');
    }
    
    // Reset app for next student
    alert("Thank you! Your judgment has been recorded.");
    // Small delay before reset
    setTimeout(() => {
        setSelectedCondition(null);
        setAssignedAgent(null);
        setCurrentScreen(AppScreen.INTRO);
    }, 500);
  };

  return (
    <div className="antialiased text-gray-100">
      {currentScreen === AppScreen.INTRO && (
        <IntroScreen onSelectCondition={handleSelectCondition} debugMode={debugMode} />
      )}
      {currentScreen === AppScreen.WAITING && (
        <WaitingScreen message={waitingMessage} />
      )}
      {currentScreen === AppScreen.CHAT && selectedCondition && assignedAgent && (
        <ChatScreen 
          condition={selectedCondition} 
          agentType={assignedAgent} 
          sessionId={sessionId}
          giveaways={giveaways}
          onFinished={handleChatFinished} 
          debugMode={debugMode}
        />
      )}
      {currentScreen === AppScreen.EVALUATION && selectedCondition && (
        <EvaluationScreen 
          condition={selectedCondition} 
          onSubmit={handleEvaluationSubmit} 
          loggingMessage={loggingMessage}
        />
      )}
    </div>
  );
};

export default App;