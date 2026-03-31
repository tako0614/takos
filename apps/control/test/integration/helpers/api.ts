/**
 * API Test Helpers for takos-control
 *
 * Utilities for testing Hono API routes.
 */

import { Hono } from 'hono';
import type { Env as TakosEnv } from '@/shared/types';
import { createMockEnv } from '../setup.ts';

// ============================================================================
// Types
// ============================================================================

export interface TestRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface TestResponse {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

export interface ApiTestContext {
  env: ReturnType<typeof createMockEnv>;
  request: (options: TestRequestOptions) => Promise<TestResponse>;
  authenticatedRequest: (
    options: TestRequestOptions,
    userId?: string
  ) => Promise<TestResponse>;
}

// ============================================================================
// Test Context Factory
// ============================================================================

/**
 * Create an API test context for testing Hono routes
 */
export function createApiTestContext(
  app: Hono<{ Bindings: TakosEnv }>,
  envOverrides: Partial<Record<string, unknown>> = {}
): ApiTestContext {
  const env = createMockEnv(envOverrides);

  async function makeRequest(options: TestRequestOptions): Promise<TestResponse> {
    const url = new URL(options.path, 'http://localhost');

    // Add query parameters
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    // Build request headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Build request body
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
    }

    // Create request
    const request = new Request(url.toString(), {
      method: options.method || 'GET',
      headers,
      body,
    });

    // Execute request through Hono app
    const response = await app.fetch(request, env as unknown as TakosEnv);

    // Parse response
    const text = await response.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }

    return {
      status: response.status,
      headers: response.headers,
      body: responseBody,
      text,
    };
  }

  async function makeAuthenticatedRequest(
    options: TestRequestOptions,
    userId: string = 'test-user-id'
  ): Promise<TestResponse> {
    // Create a mock JWT token or session cookie
    // In real tests, you might want to create actual tokens
    const headers = {
      ...options.headers,
      // Mock authentication header
      'X-Test-User-Id': userId,
    };

    return makeRequest({ ...options, headers });
  }

  return {
    env,
    request: makeRequest,
    authenticatedRequest: makeAuthenticatedRequest,
  };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a response is successful (2xx status)
 */
export function assertSuccess(response: TestResponse): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Expected success status, got ${response.status}: ${JSON.stringify(response.body)}`
    );
  }
}

/**
 * Assert that a response is a specific status code
 */
export function assertStatus(response: TestResponse, expectedStatus: number): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(response.body)}`
    );
  }
}

/**
 * Assert that a response body matches expected shape
 */
export function assertBodyShape<T>(
  response: TestResponse,
  validator: (body: unknown) => body is T
): asserts response is TestResponse & { body: T } {
  if (!validator(response.body)) {
    throw new Error(`Response body does not match expected shape: ${JSON.stringify(response.body)}`);
  }
}

/**
 * Assert that a response is an error with specific message
 */
export function assertError(
  response: TestResponse,
  expectedStatus: number,
  expectedMessage?: string | RegExp
): void {
  assertStatus(response, expectedStatus);

  if (expectedMessage) {
    const body = response.body as { error?: string; message?: string };
    const errorMessage = body.error || body.message || '';

    if (typeof expectedMessage === 'string') {
      if (!errorMessage.includes(expectedMessage)) {
        throw new Error(
          `Expected error message to include "${expectedMessage}", got "${errorMessage}"`
        );
      }
    } else {
      if (!expectedMessage.test(errorMessage)) {
        throw new Error(
          `Expected error message to match ${expectedMessage}, got "${errorMessage}"`
        );
      }
    }
  }
}

// ============================================================================
// Request Builder (Fluent API)
// ============================================================================

export class RequestBuilder {
  private method: string = 'GET';
  private path: string;
  private headers: Record<string, string> = {};
  private query: Record<string, string> = {};
  private body: unknown;
  private context: ApiTestContext;

  constructor(context: ApiTestContext, path: string) {
    this.context = context;
    this.path = path;
  }

  get(): this {
    this.method = 'GET';
    return this;
  }

  post(data?: unknown): this {
    this.method = 'POST';
    if (data !== undefined) {
      this.body = data;
    }
    return this;
  }

  put(data?: unknown): this {
    this.method = 'PUT';
    if (data !== undefined) {
      this.body = data;
    }
    return this;
  }

  patch(data?: unknown): this {
    this.method = 'PATCH';
    if (data !== undefined) {
      this.body = data;
    }
    return this;
  }

  delete(): this {
    this.method = 'DELETE';
    return this;
  }

  withHeader(key: string, value: string): this {
    this.headers[key] = value;
    return this;
  }

  withQuery(params: Record<string, string>): this {
    this.query = { ...this.query, ...params };
    return this;
  }

  withBody(data: unknown): this {
    this.body = data;
    return this;
  }

  async send(): Promise<TestResponse> {
    return this.context.request({
      method: this.method,
      path: this.path,
      headers: this.headers,
      query: this.query,
      body: this.body,
    });
  }

  async sendAuthenticated(userId?: string): Promise<TestResponse> {
    return this.context.authenticatedRequest(
      {
        method: this.method,
        path: this.path,
        headers: this.headers,
        query: this.query,
        body: this.body,
      },
      userId
    );
  }
}

/**
 * Create a request builder for fluent API testing
 */
export function request(context: ApiTestContext, path: string): RequestBuilder {
  return new RequestBuilder(context, path);
}

// ============================================================================
// Database Test Helpers
// ============================================================================

/**
 * Helper to set up mock database data
 */
export async function seedDatabase(
  env: ReturnType<typeof createMockEnv>,
  data: {
    users?: Array<Record<string, unknown>>;
    workspaces?: Array<Record<string, unknown>>;
    threads?: Array<Record<string, unknown>>;
    messages?: Array<Record<string, unknown>>;
    runs?: Array<Record<string, unknown>>;
  }
): Promise<void> {
  // Since we're using mock D1, this is a no-op by default
  // In a real test with miniflare, you would insert data here
  // For unit tests, you typically mock the specific queries instead
}

/**
 * Helper to verify database state
 */
export async function verifyDatabaseState(
  env: ReturnType<typeof createMockEnv>,
  table: string,
  expectedCount: number
): Promise<void> {
  // Since we're using mock D1, this is a no-op by default
  // In integration tests, you would query the database here
}
