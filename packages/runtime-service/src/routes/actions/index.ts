import { Hono } from 'hono';
import executionRoutes from './execution.js';
import jobLifecycleRoutes from './job-lifecycle.js';
import jobQueryRoutes from './job-queries.js';

const app = new Hono();

// Mount execution routes (checkout + step)
app.route('/', executionRoutes);

// Mount job lifecycle routes (start, complete, cancel)
app.route('/', jobLifecycleRoutes);

// Mount job query routes (status, logs)
app.route('/', jobQueryRoutes);

export default app;
