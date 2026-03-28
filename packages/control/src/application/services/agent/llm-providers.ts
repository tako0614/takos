/**
 * Multi-Model Provider Abstraction
 * Supports OpenAI, Anthropic Claude, and Google Gemini
 */

import type { AgentMessage, AgentTool, ToolCall } from './agent-models';
import { logError } from '../../../shared/utils/logger';
import {
  DEFAULT_MODEL_ID,
  getModelProvider,
  type ModelProvider,
} from './model-catalog';
export { DEFAULT_MODEL_ID } from './model-catalog';
export type { ModelProvider } from './model-catalog';

/** Truncate and redact LLM API error bodies to prevent API key / secret leakage. */
function sanitizeLlmError(body: string, maxLen = 500): string {
  return body
    .slice(0, maxLen)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/key-[A-Za-z0-9_-]{10,}/g, 'key-***')
    .replace(/Bearer\s+[A-Za-z0-9_-]+/gi, 'Bearer ***');
}

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: 'stop' | 'tool_calls' | 'length';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  chat(messages: AgentMessage[], tools?: AgentTool[], signal?: AbortSignal): Promise<LLMResponse>;
}

// ============================================================================
// OpenAI Provider
// ============================================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

class OpenAIProvider implements LLMProvider {
  constructor(private config: ModelConfig) {}

  private convertTools(tools: AgentTool[]) {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));
  }

  private convertMessages(messages: AgentMessage[]): OpenAIMessage[] {
    return messages.map(msg => {
      if (msg.role === 'system' || msg.role === 'user') {
        return { role: msg.role, content: msg.content };
      }
      if (msg.role === 'assistant') {
        const openaiMsg: OpenAIMessage = { role: 'assistant', content: msg.content || null };
        if (msg.tool_calls?.length) {
          openaiMsg.tool_calls = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
            },
          }));
        }
        return openaiMsg;
      }
      if (msg.role === 'tool') {
        return { role: 'tool', content: msg.content, tool_call_id: msg.tool_call_id ?? '' };
      }
      return { role: msg.role as OpenAIMessage['role'], content: msg.content };
    });
  }

  private isReasoningModel(): boolean {
    const m = this.config.model;
    return /^o[0-9]/.test(m) || m.includes('o1') || m.includes('o3') || m.includes('gpt-5');
  }

  async chat(messages: AgentMessage[], tools?: AgentTool[], signal?: AbortSignal): Promise<LLMResponse> {
    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_completion_tokens: this.config.maxTokens || 4096,
      messages: this.convertMessages(messages),
    };

    // Reasoning models (o1, o3, etc.) only support temperature=1
    if (!this.isReasoningModel()) {
      requestBody.temperature = this.config.temperature ?? 1;
    }

    if (tools?.length) {
      requestBody.tools = this.convertTools(tools);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const error = sanitizeLlmError(await response.text());
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    if (!data.choices || data.choices.length === 0) {
      throw new Error('OpenAI API returned empty choices array');
    }

    const choice = data.choices[0];
    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        try {
          toolCalls.push({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) });
        } catch (e) {
          logError('Failed to parse tool call', e, { module: 'services/agent/providers' });
        }
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: choice.finish_reason as LLMResponse['stopReason'],
      usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens },
    };
  }
}

// ============================================================================
// Anthropic Provider
// ============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | { type: string; text?: string; tool_use_id?: string; content?: string; id?: string; name?: string; input?: unknown }[];
}

class AnthropicProvider implements LLMProvider {
  constructor(private config: ModelConfig) {}

  private convertTools(tools: AgentTool[]) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  private convertMessages(messages: AgentMessage[]): { system: string; messages: AnthropicMessage[] } {
    let systemPrompt = '';
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
        continue;
      }

      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls?.length) {
          const content: { type: string; id?: string; name?: string; input?: unknown; text?: string }[] = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          anthropicMessages.push({ role: 'assistant', content });
        } else {
          anthropicMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        // Tool results need to be in a user message
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as { type: string; tool_use_id?: string; content?: string }[]).push({
            type: 'tool_result',
            tool_use_id: msg.tool_call_id ?? '',
            content: msg.content,
          });
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id ?? '', content: msg.content }],
          });
        }
      }
    }

    return { system: systemPrompt, messages: anthropicMessages };
  }

  async chat(messages: AgentMessage[], tools?: AgentTool[], signal?: AbortSignal): Promise<LLMResponse> {
    const { system, messages: anthropicMessages } = this.convertMessages(messages);

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens || 4096,
      messages: anthropicMessages,
    };

    if (system) {
      requestBody.system = system;
    }

    if (tools?.length) {
      requestBody.tools = this.convertTools(tools);
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const error = sanitizeLlmError(await response.text());
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    if (!data.content || !Array.isArray(data.content)) {
      throw new Error('Anthropic API returned invalid content structure');
    }

    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textContent += block.text || '';
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? '',
          name: block.name ?? '',
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: data.stop_reason === 'tool_use' ? 'tool_calls' : (data.stop_reason as LLMResponse['stopReason']),
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
    };
  }
}

// ============================================================================
// Google Gemini Provider
// ============================================================================

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text?: string; functionCall?: { name: string; args: unknown }; functionResponse?: { name: string; response: unknown } }[];
}

class GoogleProvider implements LLMProvider {
  constructor(private config: ModelConfig) {}

  private convertTools(tools: AgentTool[]) {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'OBJECT',
          properties: Object.fromEntries(
            Object.entries(tool.parameters.properties).map(([key, value]: [string, { type?: string; description?: string }]) => [
              key,
              { type: (value.type || 'string').toUpperCase(), description: value.description },
            ])
          ),
          required: tool.parameters.required,
        },
      })),
    }];
  }

  private convertMessages(messages: AgentMessage[]): { systemInstruction: string; contents: GeminiContent[] } {
    let systemInstruction = '';
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction += (systemInstruction ? '\n\n' : '') + msg.content;
        continue;
      }

      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts: GeminiContent['parts'] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
        }
        if (parts.length) {
          contents.push({ role: 'model', parts });
        }
      } else if (msg.role === 'tool') {
        // Find the corresponding tool call name
        const prevMsg = contents[contents.length - 1];
        const functionCall = prevMsg?.parts.find(p => p.functionCall);
        const name = functionCall?.functionCall?.name || 'unknown';

        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name, response: { result: msg.content } } }],
        });
      }
    }

    return { systemInstruction, contents };
  }

  async chat(messages: AgentMessage[], tools?: AgentTool[], signal?: AbortSignal): Promise<LLMResponse> {
    const { systemInstruction, contents } = this.convertMessages(messages);

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature ?? 1,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (tools?.length) {
      requestBody.tools = this.convertTools(tools);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const error = sanitizeLlmError(await response.text());
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      candidates: { content: { parts: { text?: string; functionCall?: { name: string; args: unknown } }[] }; finishReason: string }[];
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('Google API returned empty candidates array');
    }

    const candidate = data.candidates[0];

    if (!candidate.content || !candidate.content.parts) {
      throw new Error('Google API returned invalid candidate content structure');
    }
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        textContent += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: `call_${crypto.randomUUID()}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args as Record<string, unknown>,
        });
      }
    }

    const finishReason = candidate.finishReason === 'STOP' ? 'stop' :
                         toolCalls.length > 0 ? 'tool_calls' : 'stop';

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: finishReason as LLMResponse['stopReason'],
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createProvider(config: ModelConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google':
      return new GoogleProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Get provider from model ID
 */
export function getProviderFromModel(modelId: string): ModelProvider {
  return getModelProvider(modelId);
}
