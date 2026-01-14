export enum AppScreen {
  INTRO = 'INTRO',
  WAITING = 'WAITING',
  CHAT = 'CHAT',
  EVALUATION = 'EVALUATION',
}

export enum Condition {
  ELIZA_VS_GEMINI = 'Eliza vs. Gemini',
  GEMINI_VS_STANFORD = 'Gemini vs. Stanford',
}

export enum AgentType {
  ELIZA_CLASSIC = 'ELIZA_CLASSIC',
  GEMINI_ELIZA = 'GEMINI_ELIZA',
  GEMINI_STUDENT = 'GEMINI_STUDENT',
  REAL_STUDENT = 'REAL_STUDENT', // In this demo, this will be simulated
}

export interface Message {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: number;
}

export interface EvaluationResult {
  condition: Condition;
  agentType: AgentType;
  rating: number; // 1-7
  timestamp: number;
}
