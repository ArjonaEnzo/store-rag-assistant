/** Manual retrieval check without any LLM: pnpm tsx scripts/smoke-search.ts "query 1" "query 2" */
import { WooCommerceJsonAdapter } from "../src/adapters/woocommerce.ts";
import { LocalEmbedder } from "../src/retrieval/embedder.ts";
import { ProductIndex } from "../src/retrieval/index.ts";

const products = await new WooCommerceJsonAdapter("data/woocommerce-products.json").listProducts();
const t0 = Date.now();
const index = await ProductIndex.build(products, new LocalEmbedder(), ".cache/index.json");
console.log(`index built: ${index.size} products in ${Date.now() - t0} ms`);
for (const q of process.argv.slice(2)) {
  const hits = await index.search(q);
  console.log(`\n> ${q}`);
  for (const h of hits) console.log(`  ${h.score.toFixed(3)}  ${h.product.id}  ${h.product.name}  $${h.product.price}`);
}
