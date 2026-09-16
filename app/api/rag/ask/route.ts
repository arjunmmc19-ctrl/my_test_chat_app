import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

interface RagSource {
  page_number: number | null;
  source: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const { question, indexName } = await request.json();

    if (typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }
    if (typeof indexName !== "string" || !indexName.trim()) {
      return NextResponse.json({ error: "indexName is required" }, { status: 400 });
    }

    const response = await fetch(`${RAG_BACKEND_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, index_name: indexName }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.detail || "Failed to get an answer" },
        { status: response.status }
      );
    }

    return NextResponse.json({
      text: data.answer,
      sources: (data.sources || []).map((s: RagSource) => ({
        pageNumber: s.page_number,
        source: s.source,
      })),
    });
  } catch (error) {
    console.error("RAG ask proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach the RAG backend. Is it running?" },
      { status: 502 }
    );
  }
}
