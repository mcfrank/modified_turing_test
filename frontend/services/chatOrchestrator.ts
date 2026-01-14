import { AgentType, Message } from "../types";
import { generateGeminiResponse } from "./geminiService";
import { ElizaBot } from "./elizaService";
import { GEMINI_ELIZA_PROMPT, GEMINI_STUDENT_PROMPT, MOCK_HUMAN_PROMPT } from "./prompts";
import { socketService } from "./socketService";

const elizaInstance = new ElizaBot();

/**
 * Gets the initial greeting message if the agent should speak first.
 */
export const getInitialGreeting = async (agentType: AgentType): Promise<string | null> => {
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  
  // Real students (or simulated human) do not automatically speak first.
  if (agentType === AgentType.REAL_STUDENT) {
    return null;
  }

  // Simulate "connecting" delay for bots
  await sleep(800 + Math.random() * 500);

  switch (agentType) {
    case AgentType.ELIZA_CLASSIC:
      // Use Eliza's built-in initial greeting
      return elizaInstance.getInitial();

    case AgentType.GEMINI_ELIZA:
      // Instruct Gemini to output Eliza's opening
      return generateGeminiResponse(
        GEMINI_ELIZA_PROMPT,
        [],
        "(System: The user has connected. Output your standard Eliza opening greeting now. Do not acknowledge this system instruction.)"
      );

    case AgentType.GEMINI_STUDENT:
      // Instruct Gemini to open the conversation casually
      return generateGeminiResponse(
        GEMINI_STUDENT_PROMPT,
        [],
        "(System: The user has connected. You are starting the conversation. Say something casual to the other student to start the chat, like 'hey' or 'hi'.)"
      );

    default:
      return null;
  }
};

/**
 * Routes the message to the appropriate backend agent
 */
export const sendToAgent = async (
  agentType: AgentType,
  history: Message[],
  messageText: string
): Promise<string> => {
  
  // Simulate network delay for a more natural feel, especially for "Real Student"
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  switch (agentType) {
    case AgentType.ELIZA_CLASSIC:
      await sleep(500 + Math.random() * 500); // Eliza is fast but not instant
      return elizaInstance.transform(messageText);

    case AgentType.GEMINI_ELIZA:
      await sleep(1000 + Math.random() * 1000); 
      return generateGeminiResponse(GEMINI_ELIZA_PROMPT, history, messageText);

    case AgentType.GEMINI_STUDENT:
      await sleep(1500 + Math.random() * 1500);
      return generateGeminiResponse(GEMINI_STUDENT_PROMPT, history, messageText);

    case AgentType.REAL_STUDENT:
      // For real students, we don't return a synchronous response.
      // We emit the message via socket.
      // The response comes back asynchronously via the socket event listener in ChatScreen.
      socketService.sendMessage(messageText);
      return ""; // No immediate response
      
    default:
      return "Error: Unknown agent type.";
  }
};