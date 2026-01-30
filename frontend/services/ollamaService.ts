import { AgentType, Message } from "../types";

export const generateOllamaResponse = async (
  agentType: AgentType,
  systemInstruction: string,
  history: Message[],
  lastMessage: string
): Promise<string> => {
  try {
    const response = await fetch("/api/ollama", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentType,
        systemInstruction,
        history,
        lastMessage,
      }),
    });

    if (!response.ok) {
      return "Thinking...";
    }

    const data = await response.json();
    return data?.text || "...";
  } catch (error) {
    console.error("Ollama API Error:", error);
    return "Thinking...";
  }
};
