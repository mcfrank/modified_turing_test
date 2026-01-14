import React, { useState, useEffect } from 'react';
import { AppScreen, Condition, AgentType } from './types';
import { IntroScreen } from './components/IntroScreen';
import { WaitingScreen } from './components/WaitingScreen';
import { ChatScreen } from './components/ChatScreen';
import { EvaluationScreen } from './components/EvaluationScreen';
import { socketService } from './services/socketService';

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.INTRO);
  const [selectedCondition, setSelectedCondition] = useState<Condition | null>(null);
  const [assignedAgent, setAssignedAgent] = useState<AgentType | null>(null);

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

  const handleSelectCondition = (condition: Condition) => {
    setSelectedCondition(condition);
    setCurrentScreen(AppScreen.WAITING);
    
    const agent = assignAgent(condition);
    setAssignedAgent(agent);

    if (agent === AgentType.REAL_STUDENT) {
      // Connect to socket and wait for real match
      socketService.connect();
      socketService.joinQueue(() => {
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

  const handleChatFinished = () => {
    // If we were using socket, disconnect now
    if (assignedAgent === AgentType.REAL_STUDENT) {
      socketService.disconnect();
    }
    setCurrentScreen(AppScreen.EVALUATION);
  };

  const handleEvaluationSubmit = (rating: number) => {
    // Here we would typically save the data to a backend
    console.log("Session Result:", {
      condition: selectedCondition,
      agent: assignedAgent,
      rating: rating,
      timestamp: Date.now()
    });
    
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
        />
      )}
    </div>
  );
};

export default App;