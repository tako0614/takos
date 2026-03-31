import { convertMcpSchema } from '@/tools/mcp-client';
import type { McpTool } from '@/tools/mcp-client';

// ---------------------------------------------------------------------------
// convertMcpSchema
// ---------------------------------------------------------------------------


import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

  Deno.test('convertMcpSchema - converts a basic MCP tool to a ToolDefinition', () => {
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

    assertEquals(def.name, 'get_weather');
    assertEquals(def.description, 'Fetch weather data');
    assertEquals(def.category, 'mcp');
    assertEquals(def.parameters.type, 'object');
    assert('location' in def.parameters.properties);
    assertStringIncludes(def.parameters.required, 'location');
})
  Deno.test('convertMcpSchema - uses empty parameters when inputSchema is undefined', () => {
  const tool: McpTool = {
      name: 'no_params',
      description: 'Tool without params',
      inputSchema: { type: 'object' },
    };

    const def = convertMcpSchema(tool);

    assertEquals(def.parameters.type, 'object');
    assertEquals(def.parameters.properties ?? {}, {});
})
  Deno.test('convertMcpSchema - defaults description to empty string when missing', () => {
  const tool = {
      name: 'no_desc',
      inputSchema: { type: 'object', properties: {} },
    } as McpTool;

    const def = convertMcpSchema(tool);
    assertEquals(def.description, '');
})
// ---------------------------------------------------------------------------
// McpClient — SDK mocked at the module level
// ---------------------------------------------------------------------------

const mocks = {
  const mockListTools = ((..._args: any[]) => undefined) as any;
  const mockCallTool = ((..._args: any[]) => undefined) as any;
  const mockConnect = ((..._args: any[]) => undefined) as any;
  const mockClose = ((..._args: any[]) => undefined) as any;
  const MockClientClass = () => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  });
  const MockStreamableTransport = () => ({});
  const MockSSETransport = () => ({});
  return {
    mockListTools,
    mockCallTool,
    mockConnect,
    mockClose,
    MockClientClass,
    MockStreamableTransport,
    MockSSETransport,
  };
};

// [Deno] vi.mock removed - manually stub imports from '@modelcontextprotocol/sdk/client/index.js'
// [Deno] vi.mock removed - manually stub imports from '@modelcontextprotocol/sdk/client/streamableHttp.js'
// [Deno] vi.mock removed - manually stub imports from '@modelcontextprotocol/sdk/client/sse.js'
import { McpClient } from '@/tools/mcp-client';


  Deno.test('McpClient - connects via StreamableHTTP on first attempt', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.mockConnect = (async () => undefined) as any;
    mocks.mockClose = (async () => undefined) as any;
  const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();

    assertSpyCallArgs(mocks.MockStreamableTransport, 0, [
      /* expect.any(URL) */ {} as any,
      ({ fetch: /* expect.any(Function) */ {} as any }),
    ]);
    assertSpyCalls(mocks.mockConnect, 1);
})
  Deno.test('McpClient - falls back to SSE when StreamableHTTP connect throws', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.mockConnect = (async () => undefined) as any;
    mocks.mockClose = (async () => undefined) as any;
  mocks.mockConnect
       = (async () => { throw new Error('streamable failed'); }) as any
       = (async () => undefined) as any;

    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();

    // SSE transport should be constructed on fallback
    assertSpyCalls(mocks.MockSSETransport, 1);
    assertSpyCalls(mocks.mockConnect, 2);
})
  Deno.test('McpClient - listTools returns mapped definitions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.mockConnect = (async () => undefined) as any;
    mocks.mockClose = (async () => undefined) as any;
  mocks.mockListTools = (async () => ({
      tools: [
        {
          name: 'do_thing',
          description: 'Does a thing',
          inputSchema: { type: 'object', properties: { x: { type: 'string', description: 'x' } } },
        },
      ],
    })) as any;

    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();
    const tools = await client.listTools();

    assertEquals(tools.length, 1);
    assertEquals(tools[0].definition.name, 'do_thing');
    assertEquals(tools[0].definition.category, 'mcp');
})
  Deno.test('McpClient - callTool returns concatenated text content', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.mockConnect = (async () => undefined) as any;
    mocks.mockClose = (async () => undefined) as any;
  mocks.mockCallTool = (async () => ({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    })) as any;

    const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();
    const result = await client.callTool('do_thing', { x: '1' });

    assertEquals(result, 'hello\nworld');
})
  Deno.test('McpClient - callTool returns empty string when content is empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.mockConnect = (async () => undefined) as any;
    mocks.mockClose = (async () => undefined) as any;
  mocks.mockCallTool = (async () => ({ content: [] })) as any;

    const client = new McpClient('https://example.com/mcp', null, 'my_server');
    await client.connect();
    const result = await client.callTool('do_thing', {});

    assertEquals(result, '');
})
  Deno.test('McpClient - callTool throws when not connected', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.mockConnect = (async () => undefined) as any;
    mocks.mockClose = (async () => undefined) as any;
  const client = new McpClient('https://example.com/mcp', null, 'my_server');

    await await assertRejects(async () => { await client.callTool('tool', {}); }, 'not connected');
})
  Deno.test('McpClient - close disconnects the underlying client', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.mockConnect = (async () => undefined) as any;
    mocks.mockClose = (async () => undefined) as any;
  const client = new McpClient('https://example.com/mcp', 'tok', 'my_server');
    await client.connect();
    await client.close();

    assertSpyCalls(mocks.mockClose, 1);
})