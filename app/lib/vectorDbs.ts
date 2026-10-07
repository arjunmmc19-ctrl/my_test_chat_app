export type VectorDbId = "pinecone" | "qdrant";

export interface VectorDb {
  id: VectorDbId;
  label: string;
}

export const VECTOR_DBS: VectorDb[] = [
  { id: "pinecone", label: "Pinecone" },
  { id: "qdrant", label: "Qdrant" },
];

export const DEFAULT_VECTOR_DB: VectorDbId = "pinecone";

export function isSupportedVectorDb(value: unknown): value is VectorDbId {
  return typeof value === "string" && VECTOR_DBS.some((db) => db.id === value);
}
