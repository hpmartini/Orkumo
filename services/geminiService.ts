export interface AnalysisResult {
  command: string;
  port: number;
  type: string;
  summary: string;
}

const API_BASE_URL = '/api';

/**
 * Analyzes app configuration using the backend AI proxy.
 * API key is securely stored on the server.
 */
export const analyzeAppConfig = async (
  fileName: string,
  fileContent: string
): Promise<AnalysisResult> => {
  try {
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName, fileContent }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    // Validate response structure
    if (!isValidAnalysisResult(data)) {
      throw new Error('Invalid response structure from API');
    }

    return data;
  } catch (error) {
    console.error('Analysis request failed:', error);
    return {
      command: 'npm run dev',
      port: 3000,
      type: 'unknown',
      summary: 'Analysis failed. Defaulting to standard configuration.',
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
