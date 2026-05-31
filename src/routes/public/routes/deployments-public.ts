import type { Hono } from 'hono';
import { TAKOS_PUBLIC_API_PATHS } from 'takos-api-contract';
import { actorFromAuthenticatedRequest, hasTrustedActorHeaderSource } from '../shared/api/auth.ts';
import type { ApiBindings } from '../shared/api/bindings.ts';
import { commonError, isRecord, readBodyString, readJsonBody } from '../shared/api/common.ts';
import {
  maybeWriteGitOpsDeploymentIntent,
  normalizeAppInstallationBindings,
  retiredInlineWorkflowDeploymentResponse,
} from '../shared/api/deploy.ts';
import { actorSpaceIdFromPublicJsonBody } from '../shared/api/forwarding.ts';
import { handleTakosumiLaunch } from '../shared/api/launch.ts';
import { RETIRED_PUBLIC_DEPLOYMENT_PATHS, retiredTakosDeploymentProxyResponse } from '../shared/api/retired.ts';

export function registerDeploymentsPublicRoutes(
  app: Hono<{ Bindings: ApiBindings }>,
): void {
  app.post('/_takosumi/app-installation-bindings', async (c) => {
    if (!hasTrustedActorHeaderSource(c.req.raw.headers)) {
      return c.json(
        commonError('UNAUTHORIZED', 'trusted service authentication required'),
        401,
      );
    }
    const body = await readJsonBody(c.req);
    if (!isRecord(body)) {
      return c.json(
        commonError('INVALID_ARGUMENT', 'request body is required'),
        400,
      );
    }
    const installationId = readBodyString(body, 'installationId') ??
      readBodyString(body, 'installation_id');
    const appId = readBodyString(body, 'appId') ??
      readBodyString(body, 'app_id');
    const spaceId = readBodyString(body, 'space_id') ??
      readBodyString(body, 'spaceId');
    if (!installationId) {
      return c.json(
        commonError('INVALID_ARGUMENT', 'installationId is required'),
        400,
      );
    }
    if (!appId) {
      return c.json(commonError('INVALID_ARGUMENT', 'appId is required'), 400);
    }
    if (!spaceId) {
      return c.json(
        commonError('INVALID_ARGUMENT', 'space_id is required'),
        400,
      );
    }
    const bindings = normalizeAppInstallationBindings(body.bindings);
    if (bindings instanceof Response) return bindings;
    return c.json({
      accepted: true,
      installationId,
      appId,
      spaceId,
      bindings,
    }, 202);
  });

  app.get('/_takosumi/launch', (c) => handleTakosumiLaunch(c.req.raw, c.env));

  app.post('/_takosumi/launch', (c) => handleTakosumiLaunch(c.req.raw, c.env));

  app.post(TAKOS_PUBLIC_API_PATHS.deployments, async (c) => {
    const body = await c.req.raw.text();
    const actorSpaceId = actorSpaceIdFromPublicJsonBody(body);
    const retiredWorkflowResponse = retiredInlineWorkflowDeploymentResponse(
      body,
    );
    if (retiredWorkflowResponse) {
      const actorResult = await actorFromAuthenticatedRequest(
        c.req.raw,
        crypto.randomUUID(),
        actorSpaceId ?? '',
        { env: c.env },
      );
      if (!actorResult.ok) return actorResult.response;
      return retiredWorkflowResponse;
    }
    const gitOpsResponse = await maybeWriteGitOpsDeploymentIntent(
      c.req.raw,
      body,
      actorSpaceId,
      c.env,
    );
    return gitOpsResponse;
  });

  app.all(
    RETIRED_PUBLIC_DEPLOYMENT_PATHS.deployments,
    () => retiredTakosDeploymentProxyResponse(),
  );

  app.all(
    RETIRED_PUBLIC_DEPLOYMENT_PATHS.deployment,
    () => retiredTakosDeploymentProxyResponse(),
  );

  app.all(
    RETIRED_PUBLIC_DEPLOYMENT_PATHS.deploymentApply,
    () => retiredTakosDeploymentProxyResponse(),
  );

  app.all(
    RETIRED_PUBLIC_DEPLOYMENT_PATHS.deploymentApprove,
    () => retiredTakosDeploymentProxyResponse(),
  );

  app.all(
    RETIRED_PUBLIC_DEPLOYMENT_PATHS.deploymentObservations,
    () => retiredTakosDeploymentProxyResponse(),
  );

  app.all(
    RETIRED_PUBLIC_DEPLOYMENT_PATHS.groupHead,
    () => retiredTakosDeploymentProxyResponse(),
  );

  app.all(
    RETIRED_PUBLIC_DEPLOYMENT_PATHS.groupRollback,
    () => retiredTakosDeploymentProxyResponse(),
  );
}
