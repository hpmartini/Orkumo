import { GoogleGenAI, Type } from "@google/genai";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY not found in environment variables.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeAppConfig = async (fileName: string, fileContent: string): Promise<{ command: string; port: number; type: string; summary: string }> => {
  const ai = getAiClient();
  if (!ai) {
    return {
      command: "npm start",
      port: 3000,
      type: "unknown",
      summary: "API Key missing. Using defaults."
    };
  }

  const prompt = `
    You are a DevOps expert. Analyze the following configuration file content (e.g., package.json or README) for a web application.
    Filename: ${fileName}
    Content:
    ${fileContent.substring(0, 3000)}

    Determine the best command to run this application in development mode, the likely port it will use, and the project type.
    Return a JSON object with keys: command (string), port (number), type (string enum: vite, next, node, static, unknown), and summary (string, short description).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            command: { type: Type.STRING },
            port: { type: Type.NUMBER },
            type: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return {
      command: "npm run dev",
      port: 3000,
      type: "unknown",
      summary: "Analysis failed. Defaulting to standard configuration."
    };
  }
};
