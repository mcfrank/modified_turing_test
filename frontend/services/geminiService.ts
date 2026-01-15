import { Message } from "../types";

export const generateGeminiResponse = async (
  systemInstruction: string,
  history: Message[],
  lastMessage: string
): Promise<string> => {
  try {
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
    console.error("Gemini API Error:", error);
    return "Thinking...";
  }
};
