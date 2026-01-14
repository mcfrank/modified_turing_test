import { GoogleGenAI } from "@google/genai";
import { Message } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const generateGeminiResponse = async (
  systemInstruction: string,
  history: Message[],
  lastMessage: string
): Promise<string> => {
  if (!apiKey) {
    return "Error: API_KEY is missing.";
  }

  try {
    // Convert history to format expected by Gemini if using chat mode,
    // but here we might just use a single generateContent call with context 
    // for simplicity and strict control over system instruction in every turn 
    // to prevent "drifting" from the persona (especially Eliza).
    
    // Construct a chat history string to feed as context
    const conversationHistory = history
      .map(m => `${m.sender === 'user' ? 'User' : 'Model'}: ${m.text}`)
      .join('\n');

    const fullPrompt = `
      ${conversationHistory}
      User: ${lastMessage}
      Model:
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: fullPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7, // Little creativity for students, lower for Eliza
        maxOutputTokens: 150,
      }
    });

    return response.text || "...";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Thinking..."; // Fallback
  }
};
