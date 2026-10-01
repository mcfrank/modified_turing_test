import { AgentType, Message } from "../types";
import { fetchAgentReply } from "./agentService";
import { ElizaBot } from "./elizaService";

const elizaInstance = new ElizaBot();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Gets the bot's opening message. Real students never auto-greet.
 * No artificial delay here; callers decide the timing.
 */
export const fetchGreeting = async (agentType: AgentType, sessionId: string | null): Promise<string | null> => {
  if (agentType === AgentType.REAL_STUDENT) return null;
  if (agentType === AgentType.ELIZA_CLASSIC) return elizaInstance.getInitial();
  return fetchAgentReply(agentType, sessionId, [], "", true);
};

/**
 * Gets a bot reply with no artificial delay. Not for REAL_STUDENT.
 */
export const fetchReply = async (
  agentType: AgentType,
  sessionId: string | null,
  history: Message[],
  messageText: string
): Promise<string> => {
  if (agentType === AgentType.ELIZA_CLASSIC) return elizaInstance.transform(messageText);
  return fetchAgentReply(agentType, sessionId, history, messageText);
};

// Legacy ("giveaways on") timing: a short "connecting" pause, then the bot
// speaks first; replies arrive after a fixed per-agent delay.
const LEGACY_REPLY_DELAY: Partial<Record<AgentType, [number, number]>> = {
  [AgentType.ELIZA_CLASSIC]: [500, 500],
  [AgentType.GEMINI_ELIZA]: [1000, 1000],
  [AgentType.GEMINI_STUDENT]: [1500, 1500],
  [AgentType.LLAMA_BASE]: [1500, 1500],
  [AgentType.LLAMA_POSTTRAINED]: [1500, 1500],
};

export const getInitialGreetingLegacy = async (agentType: AgentType, sessionId: string | null) => {
  if (agentType === AgentType.REAL_STUDENT) return null;
  await sleep(800 + Math.random() * 500);
  return fetchGreeting(agentType, sessionId);
};

export const sendToAgentLegacy = async (
  agentType: AgentType,
  sessionId: string | null,
  history: Message[],
  messageText: string
): Promise<string> => {
  const [min, range] = LEGACY_REPLY_DELAY[agentType] || [0, 0];
  await sleep(min + Math.random() * range);
  return fetchReply(agentType, sessionId, history, messageText);
};
