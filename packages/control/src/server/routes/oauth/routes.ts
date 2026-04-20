import { Hono } from "hono";
import type { PublicRouteEnv } from "../route-auth.ts";
import { oauthBodyLimit } from "../../middleware/body-size.ts";
import oauthAuthorize from "./authorize.ts";
import oauthDevice from "./device.ts";
import oauthIntrospect from "./introspect.ts";
import oauthRegister from "./register.ts";
import oauthRevoke from "./revoke.ts";
import oauthToken from "./token.ts";
import oauthUserinfo from "./userinfo.ts";

const oauth = new Hono<PublicRouteEnv>();

// Apply body size limit for all OAuth endpoints (64KB)
// OAuth requests are typically small (auth codes, tokens, client registrations)
oauth.use("*", oauthBodyLimit);

// OAuth2 Authorization Server routes
oauth.route("/", oauthAuthorize);
oauth.route("/", oauthDevice);
oauth.route("/", oauthToken);
oauth.route("/", oauthRevoke);
oauth.route("/", oauthIntrospect);
oauth.route("/", oauthRegister);
oauth.route("/", oauthUserinfo);

export default oauth;
