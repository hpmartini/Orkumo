export interface AnalysisResult {
  command: string;
  port: number;
  type: string;
  summary: string;
}

export interface AnalysisError {
  error: string;
  fallback?: Partial<AnalysisResult>;
  parsedResponse?: unknown;
  rawResponse?: string;
}

import { API_BASE_URL } from '../utils/apiConfig';

/**
 * Analyzes app configuration using the backend AI proxy.
 * API key is securely stored on the server.
 *
 * @throws Error with detailed message if analysis fails
 */
export const analyzeAppConfig = async (
  fileName: string,
  fileContent: string
): Promise<AnalysisResult> => {
  const response = await fetch(`${API_BASE_URL}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileName, fileContent }),
  });

  const data = await response.json();

  if (!response.ok) {
    // Extract error details from response
    const errorData = data as AnalysisError;
    const errorMessage = errorData.error || `HTTP error: ${response.status}`;
    console.error('Analysis failed:', errorMessage);
    if (errorData.parsedResponse) {
      console.error('Parsed response was:', errorData.parsedResponse);
    }
    if (errorData.rawResponse) {
      console.error('Raw response was:', errorData.rawResponse);
    }
    throw new Error(errorMessage);
  }

  // Validate response structure
  if (!isValidAnalysisResult(data)) {
    throw new Error('Invalid response structure from API');
  }

  return data;
};

/**
 * Analyzes app configuration with fallback to defaults on error.
 * Use this when you want graceful degradation.
 */
export const analyzeAppConfigWithFallback = async (
  fileName: string,
  fileContent: string
): Promise<AnalysisResult> => {
  try {
    return await analyzeAppConfig(fileName, fileContent);
  } catch (error) {
    console.error('Analysis request failed, using defaults:', error);
    return {
      command: 'npm run dev',
      port: 3000,
      type: 'unknown',
      summary: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}. Using defaults.`,
    };
  }
};

/**
 * Type guard to validate AnalysisResult structure
 */
function isValidAnalysisResult(data: unknown): data is AnalysisResult {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.command === 'string' &&
    typeof obj.port === 'number' &&
    typeof obj.type === 'string' &&
    typeof obj.summary === 'string'
  );
}

/**
 * Check if AI features are available
 */
export const checkAiHealth = async (): Promise<{ aiEnabled: boolean }> => {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    const data = await response.json();
    return { aiEnabled: data.aiEnabled ?? false };
  } catch {
    return { aiEnabled: false };
  }
};
