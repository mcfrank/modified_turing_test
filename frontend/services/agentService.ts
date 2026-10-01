import { AgentType, Message } from "../types";

// All model calls go through the backend, which holds the prompts.
export const fetchAgentReply = async (
  agentType: AgentType,
  sessionId: string | null,
  history: Message[],
  lastMessage: string,
  greeting = false
): Promise<string> => {
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, agentType, history, lastMessage, greeting }),
    });

    if (!response.ok) {
      return "Thinking...";
    }

    const data = await response.json();
    return data?.text || "...";
  } catch (error) {
    console.error("Agent API Error:", error);
    return "Thinking...";
  }
};
