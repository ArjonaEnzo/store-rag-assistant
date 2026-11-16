import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { buildIndex, buildProvider } from "./bootstrap.ts";

const app = createApp({ ...buildProvider(), index: await buildIndex() });

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`store-rag-assistant listening on http://localhost:${port}`));
