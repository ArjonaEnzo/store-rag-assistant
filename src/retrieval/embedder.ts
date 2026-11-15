export interface Embedder {
  /** Returns L2-normalized vectors. `kind` lets models with asymmetric prefixes (e5) embed queries and passages differently. */
  embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
  readonly id?: string;
}

export const DEFAULT_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";

/** Local, free embeddings via transformers.js (ONNX on CPU). First run downloads the model (~120 MB) to the HF cache. */
export class LocalEmbedder implements Embedder {
  readonly id: string;
  private extractor: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> | undefined;

  constructor(private readonly model = DEFAULT_EMBEDDING_MODEL) {
    this.id = model;
  }

  private load() {
    this.extractor ??= import("@huggingface/transformers").then(
      async ({ pipeline }) => (await pipeline("feature-extraction", this.model, { dtype: "q8" })) as never,
    );
    return this.extractor;
  }

  async embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    const extract = await this.load();
    const prefixed = texts.map((t) => `${kind}: ${t}`);
    const out: number[][] = [];
    for (let i = 0; i < prefixed.length; i += 16) {
      const tensor = await extract(prefixed.slice(i, i + 16), { pooling: "mean", normalize: true });
      out.push(...tensor.tolist());
    }
    return out;
  }
}
