import { serve } from '@hono/node-server';
import app from './index';

const PORT = parseInt(process.env.PORT || '3001', 10);

serve({ fetch: app.fetch, port: PORT });
console.log(`Takos Docs server running at http://localhost:${PORT}`);
