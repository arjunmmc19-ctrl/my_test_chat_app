# App Architecture

This app is a small Next.js App Router chat application with a single interactive client surface, a Gemini chat API route, and a RAG path that proxies to an external Python/FastAPI backend for document Q&A.

The editable Draw.io source lives in [ARCHITECTURE.drawio](/Users/bhogaai/my_test_chat_app/ARCHITECTURE.drawio) (not yet updated for the RAG addition below).

## Diagram

```mermaid
flowchart LR
  U[User in browser] --> P[App Router page<br/>app/page.tsx]
  P --> L[Root layout<br/>app/layout.tsx]
  P --> C[Client chat UI<br/>app/components/Chat.tsx]

  C <-->|local state: conversations,<br/>messages, ragIndexName| C

  C -->|"POST /api/chat<br/>(no PDF uploaded yet)"| R[Route handler<br/>app/api/chat/route.ts]
  R -->|reads| E[GOOGLE_GENAI_API_KEY]
  R -->|SDK call| G[@google/genai]
  G -->|generateContent| M[Gemini model]
  M --> R --> C

  C -->|"POST /api/rag/upload<br/>multipart PDF"| RU[app/api/rag/upload/route.ts]
  C -->|"POST /api/rag/ask<br/>{ question, indexName }"| RA[app/api/rag/ask/route.ts]

  RU -->|reads| RB[RAG_BACKEND_URL]
  RA -->|reads| RB
  RU -->|proxies to| FAPI[FastAPI backend<br/>pinecone_rag_homework/api.py]
  RA -->|proxies to| FAPI
  FAPI -->|page-based ingestion +<br/>new Pinecone index| PC[(Pinecone)]
  FAPI -->|retrieval + LangChain/OpenAI| PC
  FAPI --> RU
  FAPI --> RA
  RU --> C
  RA --> C

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
1. The user clicks the paperclip button in `Chat.tsx` and picks a PDF.
2. The client `POST`s the file as `multipart/form-data` to `app/api/rag/upload/route.ts`, which forwards it to the FastAPI backend's `/upload` endpoint (`RAG_BACKEND_URL`, default `http://localhost:8000`).
3. The FastAPI backend loads the PDF page-by-page (one LangChain Document per page), embeds it, creates a new Pinecone index unique to that upload, and returns `{ indexName, filename, pageCount }`.
4. The client stores `ragIndexName`/`ragFilename` on the active conversation and posts a confirmation message.
5. Subsequent submits in that conversation go to `app/api/rag/ask/route.ts` instead of `/api/chat`, which forwards `{ question, index_name }` to the FastAPI `/ask` endpoint.
6. FastAPI retrieves relevant pages from that document's Pinecone index, runs the LangChain/OpenAI RAG chain, and returns the answer plus source page numbers, which the client renders under the reply.
7. The "Asking about `<file>`" badge above the input lets the user clear the active document and return to plain Gemini chat.

## Key Boundaries

- `app/page.tsx` is a server component by default.
- `app/components/Chat.tsx` is a client component because it uses `useState`, `useRef`, and `useEffect`.
- `app/api/chat/route.ts` is server-only and keeps `GOOGLE_GENAI_API_KEY` out of the browser bundle.
- `app/api/rag/upload/route.ts` and `app/api/rag/ask/route.ts` are server-only proxies to the FastAPI backend — the browser never talks to it directly, so no CORS configuration is needed on that side and `RAG_BACKEND_URL` never reaches the client.
- `app/layout.tsx` applies the shared document shell, fonts, and metadata.

## Main Files

- `app/page.tsx` - entry point for `/`
- `app/layout.tsx` - root HTML shell and metadata
- `app/components/Chat.tsx` - interactive chat UI, including PDF upload and RAG routing
- `app/api/chat/route.ts` - Gemini API bridge
- `app/api/rag/upload/route.ts` - proxies PDF uploads to the FastAPI backend's `/upload`
- `app/api/rag/ask/route.ts` - proxies questions to the FastAPI backend's `/ask`
- `app/globals.css` - global styling and theme tokens
