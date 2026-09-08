import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

/**
 * openapi.yaml lives at the repository root. Resolving from __dirname rather than the
 * process working directory means the same path holds for `src/routes` under tsx, for
 * `dist/routes` after a build, and inside the container.
 */
const SPEC_PATH = path.resolve(__dirname, '../../openapi.yaml');

const specification = parse(fs.readFileSync(SPEC_PATH, 'utf8')) as Record<string, unknown>;

export const docsRouter = Router();

docsRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(specification, {
    customSiteTitle: 'Solugen Authentication API',
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  }),
);
