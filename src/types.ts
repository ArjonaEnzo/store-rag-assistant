/** Platform-agnostic product. Every store adapter normalizes into this shape. */
export type Product = {
  id: string;
  name: string;
  /** Current selling price, ARS integer. */
  price: number;
  regularPrice: number;
  onSale: boolean;
  inStock: boolean;
  stockQty: number | null;
  categories: string[];
  attributes: Record<string, string[]>;
  /** Plain text (no HTML). */
  description: string;
  url: string;
};

export interface StoreAdapter {
  listProducts(): Promise<Product[]>;
}
