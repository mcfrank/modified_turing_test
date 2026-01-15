import React, { useState } from 'react';
import { AppScreen, Condition, AgentType, ChatStats } from './types';
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
  const [loggingMessage, setLoggingMessage] = useState<string | null>(null);

  // Function to determine agent assignment logic
  const assignAgent = (condition: Condition): AgentType => {
    const random = Math.random();
    if (condition === Condition.ELIZA_VS_GEMINI) {
      // 50/50 split
      return random < 0.5 ? AgentType.ELIZA_CLASSIC : AgentType.GEMINI_ELIZA;
    } else {
      // 50/50 split
      return random < 0.5 ? AgentType.GEMINI_STUDENT : AgentType.REAL_STUDENT;
    }
  };

  const isValidAgentType = (value: string): value is AgentType => {
    return Object.values(AgentType).includes(value as AgentType);
  };

  const handleSelectCondition = async (condition: Condition) => {
    setSelectedCondition(condition);
    setCurrentScreen(AppScreen.WAITING);
    setChatStats(null);
    setSessionId(null);
    setLoggingMessage(null);
    
    let agent = assignAgent(condition);
    let newSessionId: string | null = null;

    try {
      const response = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.agentType && isValidAgentType(data.agentType)) {
          agent = data.agentType;
        }
        if (data?.sessionId) {
          newSessionId = data.sessionId;
        }
      }
    } catch (error) {
      console.warn('Failed to start session on backend, using local assignment', error);
    }

    setAssignedAgent(agent);
    setSessionId(newSessionId);

    if (agent === AgentType.REAL_STUDENT) {
      // Connect to socket and wait for real match
      socketService.connect();
      socketService.joinQueue(condition, () => {
        // Match found!
        setCurrentScreen(AppScreen.CHAT);
      });
    } else {
      // Simulate matching delay for bots
      const delay = 2000 + Math.random() * 2000;
      setTimeout(() => {
        setCurrentScreen(AppScreen.CHAT);
      }, delay);
    }
  };

  const handleChatFinished = (stats: ChatStats) => {
    // If we were using socket, disconnect now
    if (assignedAgent === AgentType.REAL_STUDENT) {
      socketService.disconnect();
    }
    setChatStats(stats);
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
    const resolvedSessionId = sessionId || `local-${Date.now()}`;

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
        <IntroScreen onSelectCondition={handleSelectCondition} />
      )}
      {currentScreen === AppScreen.WAITING && (
        <WaitingScreen />
      )}
      {currentScreen === AppScreen.CHAT && selectedCondition && assignedAgent && (
        <ChatScreen 
          condition={selectedCondition} 
          agentType={assignedAgent} 
          onFinished={handleChatFinished} 
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