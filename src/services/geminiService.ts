import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateTestCases(params: {
  flowDescription: string;
  contextDocs: string[];
  projectDescription?: string;
}) {
  const { flowDescription, contextDocs, projectDescription } = params;

  const systemInstruction = `You are a Senior QA Engineer specializing in test case design.
Your task is to generate detailed, high-quality test cases based on a user flow description and optional context documents.
Each test case must include:
- A clear, concise title.
- The specific user flow being tested.
- A list of logical, sequential steps.
- The expected result.
- A status (default to "draft").

Context from documents:
${contextDocs.join('\n\n')}

Project Context: ${projectDescription || 'N/A'}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate 3-5 comprehensive test cases for the following flow: ${flowDescription}`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            flow: { type: Type.STRING },
            steps: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            expectedResult: { type: Type.STRING },
            status: { type: Type.STRING, enum: ["draft", "active", "deprecated"] }
          },
          required: ["title", "flow", "steps", "expectedResult", "status"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini response as JSON:", response.text);
    throw new Error("Invalid response format from AI");
  }
}

export async function summarizeDocument(content: string) {
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Summarize the following technical document focusing on key features, business logic, and edge cases:\n\n${content}`,
        config: {
            systemInstruction: "You are a technical analyst."
        }
    });
    return response.text;
}

export async function cleanScrapedContent(rawContent: string) {
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Process the following raw scraped website data and extract only the relevant technical information, features, and business logic. Remove navigation links, footers, scripts, and jargon. Format it clean and logical for a test case generation engine.\n\nRaw Content:\n${rawContent}`,
        config: {
            systemInstruction: "You are a data cleaner that converts messy HTML text into structured technical requirements."
        }
    });
    return response.text;
}

export async function askDocumentQuestion(params: {
    question: string;
    documentContent: string;
}) {
    const { question, documentContent } = params;

    const systemInstruction = `You are an AI assistant helping a user understand technical documentation for test case design.
Answer the user's question accurately using ONLY the provided document content.
If the answer is not in the document, say "I don't find that information in the provided context."

Context Document:
${documentContent}`;

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: question,
        config: {
            systemInstruction,
        }
    });

    return response.text;
}
