import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_VECTOR_DB, isSupportedVectorDb } from "@/app/lib/vectorDbs";

export const runtime = "nodejs";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const provider = formData.get("provider");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const selectedProvider = isSupportedVectorDb(provider) ? provider : DEFAULT_VECTOR_DB;

    const upstreamForm = new FormData();
    upstreamForm.append("file", file, file.name);
    upstreamForm.append("provider", selectedProvider);

    const response = await fetch(`${RAG_BACKEND_URL}/upload`, {
      method: "POST",
      body: upstreamForm,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.detail || "Upload failed" },
        { status: response.status }
      );
    }

    return NextResponse.json({
      indexName: data.index_name,
      filename: data.filename,
      pageCount: data.page_count,
      provider: data.provider ?? selectedProvider,
    });
  } catch (error) {
    console.error("RAG upload proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach the RAG backend. Is it running?" },
      { status: 502 }
    );
  }
}
