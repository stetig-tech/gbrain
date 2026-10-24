import type express from 'express';
import type { ServeHttpContext } from './serve-http.ts';
import { mountOAuth, mountOAuthConsent, mountOwnerLoginLinks } from './serve-http-oauth.ts';
import { mountHealth, mountMetrics } from './serve-http-metrics.ts';
import { mountAdminApi, mountAdminLogin } from './serve-http-admin-api.ts';
import { mountSpa } from './serve-http-spa.ts';
import { mountMcp } from './serve-http-mcp.ts';
import { mountWebhooks } from './serve-http-webhooks.ts';

export async function mountServeHttpRoutes(app: express.Express, ctx: ServeHttpContext, serverless = false) {
  if (serverless) {
    // Consent sessions are process-local. Machine clients use pre-registered credentials.
    app.all(['/authorize', '/register'], (_req, res) => { res.status(404).json({ error: 'not_found' }); });
    app.use((req, res, next) => {
      if (req.path === '/.well-known/oauth-authorization-server') {
        const json = res.json.bind(res);
        res.json = body => {
          delete body.authorization_endpoint; delete body.registration_endpoint;
          delete body.code_challenge_methods_supported;
          return json({ ...body, grant_types_supported: ['client_credentials'], response_types_supported: [],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'] });
        };
      }
      next();
    });
    mountOAuth(app, ctx);
    // These entrypoints require resident agent/skill-sync runners, not the publication worker.
    const resident = new Set(['submit_agent', 'get_agent_job', 'cancel_job', 'request_tools', 'join_brain', 'sync_brain_skills', 'leave_brain']);
    mountMcp(app, { ...ctx, mcpOperationsBase: ctx.mcpOperationsBase.filter(op => !resident.has(op.name)) });
    return;
  }
  mountOAuth(app, ctx);
  mountHealth(app, ctx);
  mountAdminLogin(app, ctx);
  mountOwnerLoginLinks(app, ctx);
  mountOAuthConsent(app, ctx.oauthProvider, ctx.requireAdmin, ctx.adminLimits.consent);
  mountMetrics(app, ctx);
  mountAdminApi(app, ctx);
  await mountSpa(app, ctx);
  mountMcp(app, ctx);
  mountWebhooks(app, ctx);
}
