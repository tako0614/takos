import {
  MOBILE_PUSH_REGISTRATION_PATH,
  registerMobilePushWithHost,
  unregisterMobilePushWithHost,
  type FetchLike,
  type MobilePushRegistrationCallbackInput,
} from "@takosjp/takosumi-mobile-kit";

export const TAKOS_MOBILE_PUSH_REGISTRATION_PATH =
  MOBILE_PUSH_REGISTRATION_PATH;

export interface RegisterTakosMobilePushOptions {
  readonly path?: string;
  readonly fetch?: FetchLike;
}

export async function registerTakosMobilePush(
  input: MobilePushRegistrationCallbackInput,
  options: RegisterTakosMobilePushOptions = {},
): Promise<void> {
  await registerMobilePushWithHost({
    session: input.session,
    registration: input.registration,
    path: options.path,
    fetch: options.fetch,
  });
}

export async function unregisterTakosMobilePush(
  input: MobilePushRegistrationCallbackInput,
  options: RegisterTakosMobilePushOptions = {},
): Promise<void> {
  await unregisterMobilePushWithHost({
    session: input.session,
    registration: input.registration,
    path: options.path,
    fetch: options.fetch,
  });
}
