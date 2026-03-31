import { Hono } from 'hono';
import executionRoutes from './execution.ts';
import jobLifecycleRoutes from './job-lifecycle.ts';
import jobQueryRoutes from './job-queries.ts';

const app = new Hono();

// Mount execution routes (checkout + step)
app.route('/', executionRoutes);

// Mount job lifecycle routes (start, complete, cancel)
app.route('/', jobLifecycleRoutes);

// Mount job query routes (status, logs)
app.route('/', jobQueryRoutes);

export default app;
