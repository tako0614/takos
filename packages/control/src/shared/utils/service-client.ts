/**
 * Generic service-call error handling for non-Cloudflare upstream APIs.
 *
 * Cloudflare-specific clients (WfpClient, CloudflareApiClient) use their own
 * error model (CloudflareAPIError / classifyAPIError in wfp/client.ts) because
 * they need rate-limit, retry-after, and isRetryable metadata that is specific
 * to the Cloudflare Management API. Merging the two would either bloat the
 * generic model or lose Cloudflare-specific context, so they are intentionally
 * kept separate.
 */
import {
  AppError,
  ErrorCodes,
  type ErrorCode,
} from '@takoserver/common/errors';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCodes.BAD_REQUEST,
  401: ErrorCodes.UNAUTHORIZED,
  403: ErrorCodes.FORBIDDEN,
  404: ErrorCodes.NOT_FOUND,
  409: ErrorCodes.CONFLICT,
  422: ErrorCodes.VALIDATION_ERROR,
  429: ErrorCodes.RATE_LIMITED,
  502: ErrorCodes.BAD_GATEWAY,
  503: ErrorCodes.SERVICE_UNAVAILABLE,
  504: ErrorCodes.GATEWAY_TIMEOUT,
};

function mapUpstreamStatus(status: number): { code: ErrorCode; statusCode: number } {
  const mapped = STATUS_TO_CODE[status];
  if (mapped) return { code: mapped, statusCode: status };
  if (status >= 400 && status < 500) return { code: ErrorCodes.BAD_REQUEST, statusCode: 400 };
  return { code: ErrorCodes.INTERNAL_ERROR, statusCode: 500 };
}

export class ServiceCallError extends AppError {
  public readonly upstreamStatus: number;
  public readonly upstreamCode?: string;
  public readonly upstreamBody?: string;
  public readonly serviceName: string;

  constructor(opts: {
    serviceName: string;
    upstreamStatus: number;
    upstreamCode?: string;
    upstreamBody?: string;
    message?: string;
  }) {
    const { code, statusCode } = mapUpstreamStatus(opts.upstreamStatus);
    super(
      opts.message ?? `${opts.serviceName} returned ${opts.upstreamStatus}`,
      code,
      statusCode,
    );
    this.name = 'ServiceCallError';
    this.serviceName = opts.serviceName;
    this.upstreamStatus = opts.upstreamStatus;
    this.upstreamCode = opts.upstreamCode;
    this.upstreamBody = opts.upstreamBody;
  }
}

export async function parseServiceResponse<T>(
  res: Response,
  serviceName: string,
): Promise<T> {
  if (res.ok) {
    if (res.status === 204 || res.status === 205) {
      return undefined as T;
    }

    const bodyText = await res.text();
    if (bodyText.trim().length === 0) {
      return undefined as T;
    }

    try {
      return JSON.parse(bodyText) as T;
    } catch (error) {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
      throw new ServiceCallError({
        serviceName,
        upstreamStatus: res.status,
        upstreamBody: bodyText,
        message: `${serviceName} returned malformed JSON${detail}`,
      });
    }
  }

  let upstreamBody: string | undefined;
  let upstreamCode: string | undefined;
  try {
    upstreamBody = await res.text();
    const parsed = JSON.parse(upstreamBody);
    if (parsed?.error?.code) {
      upstreamCode = String(parsed.error.code);
    }
  } catch {
    // body wasn't JSON or was empty
  }

  throw new ServiceCallError({
    serviceName,
    upstreamStatus: res.status,
    upstreamCode,
    upstreamBody,
  });
}
