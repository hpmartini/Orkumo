import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

app.use(cors());
app.use(express.json());

// Validate API key on startup
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('⚠️  GEMINI_API_KEY not found in .env.local - AI features will be disabled');
}

/**
 * POST /api/analyze
 * Analyzes app configuration using Gemini AI
 * Body: { fileName: string, fileContent: string }
 */
app.post('/api/analyze', async (req, res) => {
  const { fileName, fileContent } = req.body;

  if (!fileName || !fileContent) {
    return res.status(400).json({
      error: 'Missing required fields: fileName and fileContent'
    });
  }

  if (!apiKey) {
    return res.json({
      command: 'npm start',
      port: 3000,
      type: 'unknown',
      summary: 'API Key missing. Using defaults.'
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
      You are a DevOps expert. Analyze the following configuration file content (e.g., package.json or README) for a web application.
      Filename: ${fileName}
      Content:
      ${fileContent.substring(0, 3000)}

      Determine the best command to run this application in development mode, the likely port it will use, and the project type.
      Return a JSON object with keys: command (string), port (number), type (string enum: vite, next, node, static, unknown), and summary (string, short description).
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
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
    if (!text) {
      throw new Error('No response from AI');
    }

    // Validate response structure before sending
    const parsed = JSON.parse(text);
    if (!parsed.command || typeof parsed.port !== 'number' || !parsed.type || !parsed.summary) {
      throw new Error('Invalid response structure from AI');
    }

    res.json(parsed);
  } catch (error) {
    console.error('Gemini analysis failed:', error);
    res.json({
      command: 'npm run dev',
      port: 3000,
      type: 'unknown',
      summary: 'Analysis failed. Defaulting to standard configuration.'
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    aiEnabled: !!apiKey,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 DevOrbit API Server running on http://localhost:${PORT}`);
  console.log(`   AI Features: ${apiKey ? '✅ Enabled' : '❌ Disabled (no API key)'}`);
});
