# App Architecture

This app is a small Next.js App Router chat application with a single interactive client surface, a Gemini chat API route, and a RAG path (with a choice of Pinecone or Qdrant as the vector DB) that proxies to an external Python/FastAPI backend for document Q&A.

The editable Draw.io source lives in [ARCHITECTURE.drawio](/Users/bhogaai/my_test_chat_app/ARCHITECTURE.drawio) (not yet updated for the RAG addition below).

## Diagram

```mermaid
flowchart LR
  U[User in browser] --> P[App Router page<br/>app/page.tsx]
  P --> L[Root layout<br/>app/layout.tsx]
  P --> C[Client chat UI<br/>app/components/Chat.tsx]

  C <-->|local state: conversations,<br/>mode, ragIndexName, ragProvider| C

  C -->|"POST /api/chat<br/>(no PDF uploaded yet)"| R[Route handler<br/>app/api/chat/route.ts]
  R -->|reads| E[GOOGLE_GENAI_API_KEY]
  R -->|SDK call| G[@google/genai]
  G -->|generateContent| M[Gemini model]
  M --> R --> C

  C -->|"POST /api/rag/upload<br/>multipart PDF"| RU[app/api/rag/upload/route.ts]
  C -->|"POST /api/rag/ask<br/>{ question, indexName }"| RA[app/api/rag/ask/route.ts]

  RU -->|reads| RB[RAG_BACKEND_URL]
  RA -->|reads| RB
  RU -->|proxies to, + provider field| FAPI[FastAPI backend<br/>pinecone_rag_homework/api.py]
  RA -->|proxies to, + provider field| FAPI
  FAPI -->|provider=pinecone| RC[rag_core.py]
  FAPI -->|provider=qdrant| QC[qdrant_core.py]
  RC -->|page-based ingestion +<br/>new index per upload| PC[(Pinecone)]
  QC -->|page-based ingestion +<br/>new collection per upload| QD[(Qdrant, local on-disk<br/>qdrant_data/)]
  RC --> FAPI
  QC --> FAPI
  FAPI --> RU
  FAPI --> RA
  RU --> C
  RA --> C

  C -->|"POST /api/evaluate<br/>{ question, answer, context }"| EV[app/api/evaluate/route.ts]
  EV -->|reads| E
  EV -->|SDK call, different model| G
  EV -->|appends row| EVC[(evaluations.csv)]
  EV --> C

  L -->|loads global styles + fonts| S[app/globals.css]
```

## Request Flow

**Gemini chat (default, unchanged):**
1. The browser opens `/`, which is rendered by `app/page.tsx`, returning the `Chat` client component.
2. `Chat.tsx` manages conversation state in the browser with React hooks.
3. On submit, if the active conversation has no uploaded document, the client sends the full message history to `POST /api/chat`.
4. `app/api/chat/route.ts` runs on the server, reads `GOOGLE_GENAI_API_KEY`, and calls Gemini through `@google/genai`.
5. The server returns the generated text to the client, which appends it to the message list.

**RAG document Q&A (new):**
1. The header has a Chat / Document Q&A mode switch (`Conversation.mode`, independent per conversation). In Document Q&A mode, a Vector DB selector (Pinecone or Qdrant) and an Upload PDF button replace the model dropdown.
2. The user picks a vector DB, then a PDF via the Upload PDF button. The client `POST`s the file as `multipart/form-data`, including the selected `provider`, to `app/api/rag/upload/route.ts`, which forwards it to the FastAPI backend's `/upload` endpoint (`RAG_BACKEND_URL`, default `http://localhost:8000`).
3. The FastAPI backend dispatches on `provider`: `rag_core.ingest_pdf` (Pinecone) or `qdrant_core.ingest_pdf` (Qdrant, a local on-disk instance at `qdrant_data/` — no server or API key needed). Both load the PDF page-by-page (one LangChain Document per page, identical chunking) and return `{ index_name, filename, page_count, provider }`.
4. The client stores `ragIndexName`/`ragFilename`/`ragProvider` on the active conversation (switching its `mode` to `"document"`) and posts a confirmation message naming the provider used. The Vector DB selector is then disabled/locked to that provider until the document is cleared, so a conversation's questions can never be routed to the wrong vector DB.
5. Subsequent submits in that conversation, while still in Document Q&A mode, go to `app/api/rag/ask/route.ts` instead of `/api/chat`, forwarding `{ question, index_name, provider }` to the FastAPI `/ask` endpoint, which dispatches to `rag_core.ask` or `qdrant_core.ask` accordingly.
6. Both `ask()` implementations retrieve once, generate the answer from that exact retrieved context, and return `{ answer, context, sources }` in an identical shape regardless of provider — so everything above `api.py` (the Next proxy, the client, and "Evaluate this chat") is provider-agnostic by construction.
7. The "Asking about `<file>` (Provider)" badge above the input lets the user clear the active document (also unlocking the Vector DB selector). Switching to the "Chat" tab stops routing to the document without clearing it — switching back to "Document Q&A" resumes using it; the document is only ever cleared by the badge's X button, never by switching tabs.

**LLM-as-judge evaluation (new):**
1. "Evaluate this chat" under an assistant reply sends `{ question, answer, context, answerModel }` to `app/api/evaluate/route.ts` — `context` is the exact retrieved-chunk text returned by `/api/rag/ask` for that reply (now sourced from a single retrieval pass in `rag_core.ask`, reused for both generation and the response, so the judge sees precisely what the generator saw); plain Gemini replies have no context, since there's no retrieval step.
2. The route picks a judge model distinct from `answerModel` (`app/lib/judge.ts`), builds a judge prompt with `@google/genai` using the existing `GOOGLE_GENAI_API_KEY`, and asks for a one-line `correct`/`incorrect` verdict plus a short reasoning sentence.
3. The verdict, reasoning, and judge model are returned to the client and rendered in a panel under the reply; the same row (timestamp, question, answer, context, verdict, reasoning, judge model) is appended to `evaluations.csv` at the project root (gitignored, like `feedback.csv`).
4. For RAG replies this checks faithfulness to the retrieved context; for plain Gemini replies (no context) it's a plausibility-only check, and the UI says so.

## Key Boundaries

- `app/page.tsx` is a server component by default.
- `app/components/Chat.tsx` is a client component because it uses `useState`, `useRef`, and `useEffect`.
- `app/api/chat/route.ts` is server-only and keeps `GOOGLE_GENAI_API_KEY` out of the browser bundle.
- `app/api/rag/upload/route.ts` and `app/api/rag/ask/route.ts` are server-only proxies to the FastAPI backend — the browser never talks to it directly, so no CORS configuration is needed on that side and `RAG_BACKEND_URL` never reaches the client. Both validate the `provider` field against `app/lib/vectorDbs.ts` before forwarding it.
- Qdrant runs embedded/on-disk inside the FastAPI backend process (`qdrant_core.py`, storage at `pinecone_rag_homework/qdrant_data/`, gitignored) — no server, account, or API key, so it introduces no new secret anywhere in either repo.
- `app/api/evaluate/route.ts` is server-only and reuses `GOOGLE_GENAI_API_KEY` — no new secret is introduced for the judge.
- `app/layout.tsx` applies the shared document shell, fonts, and metadata.

## Main Files

- `app/page.tsx` - entry point for `/`
- `app/layout.tsx` - root HTML shell and metadata
- `app/components/Chat.tsx` - interactive chat UI, including the Chat/Document Q&A mode switch, vector DB selector, PDF upload, RAG routing, and the evaluate action
- `app/api/chat/route.ts` - Gemini API bridge
- `app/api/rag/upload/route.ts` - proxies PDF uploads to the FastAPI backend's `/upload`, forwarding `provider`
- `app/api/rag/ask/route.ts` - proxies questions to the FastAPI backend's `/ask`, forwarding `provider`
- `app/api/evaluate/route.ts` - LLM-as-judge: scores an answer against its retrieved context (or plausibility alone) and logs to `evaluations.csv`
- `app/lib/judge.ts` - judge model selection, prompt building, and verdict parsing
- `app/lib/vectorDbs.ts` - the Pinecone/Qdrant provider list and validation, shared by the client and both RAG proxy routes
- `app/globals.css` - global styling and theme tokens
