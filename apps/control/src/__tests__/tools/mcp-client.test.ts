import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertMcpSchema } from '@/tools/mcp-client';
import type { McpTool } from '@/tools/mcp-client';

// ---------------------------------------------------------------------------
// convertMcpSchema
// ---------------------------------------------------------------------------

describe('convertMcpSchema', () => {
  it('converts a basic MCP tool to a ToolDefinition', () => {
    const tool: McpTool = {
      name: 'get_weather',
      description: 'Fetch weather data',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
        },
        required: ['location'],
      },
    };

    const def = convertMcpSchema(tool);

    expect(def.name).toBe('get_weather');
    expect(def.description).toBe('Fetch weather data');
    expect(def.category).toBe('mcp');
    expect(def.parameters.type).toBe('object');
    expect(def.parameters.properties).toHaveProperty('location');
    expect(def.parameters.required).toContain('location');
  });

  it('uses empty parameters when inputSchema is undefined', () => {
    const tool: McpTool = {
      name: 'no_params',
      description: 'Tool without params',
      inputSchema: { type: 'object' },
    };

    const def = convertMcpSchema(tool);

    expect(def.parameters.type).toBe('object');
    expect(def.parameters.properties ?? {}).toEqual({});
  });

  it('defaults description to empty string when missing', () => {
    const tool = {
      name: 'no_desc',
      inputSchema: { type: 'object', properties: {} },
    } as McpTool;

    const def = convertMcpSchema(tool);
    expect(def.description).toBe('');
  });
});

// ---------------------------------------------------------------------------
// McpClient — SDK mocked at the module level
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockListTools = vi.fn();
  const mockCallTool = vi.fn();
  const mockConnect = vi.fn();
  const mockClose = vi.fn();
  const MockClientClass = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  }));
  const MockStreamableTransport = vi.fn().mockImplementation(() => ({}));
  const MockSSETransport = vi.fn().mockImplementation(() => ({}));
  return {
    mockListTools,
    mockCallTool,
    mockConnect,
    mockClose,
    MockClientClass,
    MockStreamableTransport,
    MockSSETransport,
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mocks.MockClientClass,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mocks.MockStreamableTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mocks.MockSSETransport,
}));

import { McpClient } from '@/tools/mcp-client';

describe('McpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockConnect.mockResolvedValue(undefined);
    mocks.mockClose.mockResolvedValue(undefined);
  });

  it('connects via StreamableHTTP on first attempt', async () => {
    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();

    expect(mocks.MockStreamableTransport).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
    expect(mocks.mockConnect).toHaveBeenCalledOnce();
  });

  it('falls back to SSE when StreamableHTTP connect throws', async () => {
    mocks.mockConnect
      .mockRejectedValueOnce(new Error('streamable failed'))
      .mockResolvedValueOnce(undefined);

    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();

    // SSE transport should be constructed on fallback
    expect(mocks.MockSSETransport).toHaveBeenCalledOnce();
    expect(mocks.mockConnect).toHaveBeenCalledTimes(2);
  });

  it('listTools returns mapped definitions', async () => {
    mocks.mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'do_thing',
          description: 'Does a thing',
          inputSchema: { type: 'object', properties: { x: { type: 'string', description: 'x' } } },
        },
      ],
    });

    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();
    const tools = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].definition.name).toBe('do_thing');
    expect(tools[0].definition.category).toBe('mcp');
  });

  it('callTool returns concatenated text content', async () => {
    mocks.mockCallTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });

    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();
    const result = await client.callTool('do_thing', { x: '1' });

    expect(result).toBe('hello\nworld');
  });

  it('callTool returns empty string when content is empty', async () => {
    mocks.mockCallTool.mockResolvedValue({ content: [] });

    const client = new McpClient('https://example.com/mcp', null, 'my_server');
    await client.connect();
    const result = await client.callTool('do_thing', {});

    expect(result).toBe('');
  });

  it('callTool throws when not connected', async () => {
    const client = new McpClient('https://example.com/mcp', null, 'my_server');

    await expect(client.callTool('tool', {})).rejects.toThrow('not connected');
  });

  it('close disconnects the underlying client', async () => {
    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();
    await client.close();

    expect(mocks.mockClose).toHaveBeenCalledOnce();
  });
});
