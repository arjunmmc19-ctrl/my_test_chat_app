"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Menu, Plus, MessageCircle, Settings, HelpCircle, ChevronDown, X, RotateCcw, AlertTriangle, Info, Copy, Check, ThumbsUp, ThumbsDown } from "lucide-react";
import { GEMINI_MODELS, DEFAULT_GEMINI_MODEL } from "../lib/models";
import {
  GenerationSettings,
  DEFAULT_GENERATION_SETTINGS,
  sanitizeGenerationSettings,
} from "../lib/generationSettings";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reaction?: "up" | "down";
}

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackOpenId, setFeedbackOpenId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<Record<string, "sent" | "error">>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentConv = conversations.find((c) => c.id === currentConvId);
  const messages = currentConv?.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    setFeedbackOpenId(null);
    setFeedbackText("");
  }, [currentConvId]);

  const startNewChat = () => {
    const newId = Date.now().toString();
    setConversations((prev) => [...prev, { id: newId, title: "New chat", messages: [] }]);
    setCurrentConvId(newId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    if (!currentConvId) {
      startNewChat();
    }

    const convId = currentConvId || Date.now().toString();
    const userMessage: Message = { id: generateId(), role: "user", content: input };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [...c.messages, userMessage] }
          : c
      )
    );

    setInput("");
    setLoading(true);
    setWarnings([]);

    try {
      const { settings: sanitizedSettings, warnings: clientWarnings } =
        sanitizeGenerationSettings(settings);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          model,
          settings: sanitizedSettings,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error || "Failed to generate response. Please try again."
        );
      }
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: data.text,
      };

      setWarnings([...clientWarnings, ...(data.warnings || [])]);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, assistantMessage] }
            : c
        )
      );

      if (messages.length === 0) {
        const title = userMessage.content.substring(0, 30) + (userMessage.content.length > 30 ? "..." : "");
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, title } : c))
        );
      }
    } catch (error) {
      // Expected, already-handled failure (network hiccup or a Gemini API
      // error surfaced by the backend) — logged at warn level so it doesn't
      // trip Next.js's dev-mode error overlay for a case the UI already
      // recovers from gracefully.
      console.warn("Chat request failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Sorry, I encountered an error. Please try again.";
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    id: generateId(),
                    role: "assistant",
                    content: message,
                  },
                ],
              }
            : c
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (msg: Message) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedId(msg.id);
      setTimeout(() => {
        setCopiedId((id) => (id === msg.id ? null : id));
      }, 1500);
    } catch (error) {
      console.warn("Copy to clipboard failed:", error);
    }
  };

  const toggleReaction = (messageId: string, reaction: "up" | "down") => {
    if (!currentConvId) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentConvId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId
                  ? { ...m, reaction: m.reaction === reaction ? undefined : reaction }
                  : m
              ),
            }
          : c
      )
    );
  };

  const openFeedback = (messageId: string) => {
    setFeedbackOpenId(messageId);
    setFeedbackText("");
  };

  const cancelFeedback = () => {
    setFeedbackOpenId(null);
    setFeedbackText("");
  };

  const submitFeedback = async (msg: Message) => {
    const trimmed = feedbackText.trim();
    if (!trimmed) return;

    setFeedbackSubmitting(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: msg.content,
          reaction: msg.reaction ?? "",
          feedback: trimmed,
        }),
      });

      if (!response.ok) throw new Error("Failed to save feedback");

      setFeedbackStatus((prev) => ({ ...prev, [msg.id]: "sent" }));
      setFeedbackOpenId(null);
      setFeedbackText("");
    } catch (error) {
      console.warn("Feedback submit failed:", error);
      setFeedbackStatus((prev) => ({ ...prev, [msg.id]: "error" }));
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const suggestedPrompts = [
    "Explain quantum computing",
    "Write a Python function",
    "Plan a trip to Japan",
    "Summarize a topic",
  ];

  return (
    <div className="flex h-screen bg-gradient-to-br from-blue-100 via-blue-50 to-white">
      {/* Sidebar */}
      <div
        className={`transition-all duration-300 flex flex-col bg-white border-r border-gray-200 ${
          sidebarOpen ? "w-64" : "w-0"
        } overflow-hidden`}
      >
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors font-medium"
          >
            <Plus size={18} />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setCurrentConvId(conv.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                  currentConvId === conv.id
                    ? "bg-gray-200 text-gray-900 font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} />
                  <span className="truncate">{conv.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors">
            <HelpCircle size={18} />
            Help & FAQ
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors"
          >
            <Settings size={18} />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white bg-opacity-80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Menu size={20} className="text-gray-700" />
              </button>
              <h1 className="text-2xl font-semibold text-gray-900">My Gemini App</h1>
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  aria-label="Select Gemini model"
                  className="appearance-none pl-3 pr-8 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors cursor-pointer"
                >
                  {GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto w-full px-4 py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                <h2 className="text-3xl font-semibold text-gray-900 mb-2">Hello there</h2>
                <p className="text-gray-600 mb-8">How can I help you today?</p>

                <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      className="p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-left transition-colors"
                    >
                      <p className="text-gray-900 text-sm font-medium">{prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 py-6 animate-in fade-in ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                    🤖
                  </div>
                )}
                <div
                  className={`max-w-2xl ${
                    msg.role === "user"
                      ? "text-right"
                      : "text-left"
                  }`}
                >
                  <p className="text-gray-900 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>

                  {msg.role === "assistant" && (
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        onClick={() => handleCopy(msg)}
                        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                        aria-label="Copy response"
                        title="Copy"
                      >
                        {copiedId === msg.id ? (
                          <Check size={14} className="text-green-600" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      <button
                        onClick={() => toggleReaction(msg.id, "up")}
                        className={`p-1.5 rounded-md hover:bg-gray-100 transition-colors ${
                          msg.reaction === "up"
                            ? "text-blue-600 bg-blue-50"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                        aria-label="Thumbs up"
                        aria-pressed={msg.reaction === "up"}
                        title="Good response"
                      >
                        <ThumbsUp size={14} />
                      </button>
                      <button
                        onClick={() => toggleReaction(msg.id, "down")}
                        className={`p-1.5 rounded-md hover:bg-gray-100 transition-colors ${
                          msg.reaction === "down"
                            ? "text-blue-600 bg-blue-50"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                        aria-label="Thumbs down"
                        aria-pressed={msg.reaction === "down"}
                        title="Bad response"
                      >
                        <ThumbsDown size={14} />
                      </button>
                      <button
                        onClick={() =>
                          feedbackOpenId === msg.id ? cancelFeedback() : openFeedback(msg.id)
                        }
                        className={`px-2 py-1 rounded-md hover:bg-gray-100 text-xs font-medium transition-colors ${
                          feedbackOpenId === msg.id
                            ? "text-blue-600 bg-blue-50"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        Feedback
                      </button>
                      {copiedId === msg.id && (
                        <span className="text-xs text-green-600">Copied</span>
                      )}
                      {feedbackStatus[msg.id] === "sent" && feedbackOpenId !== msg.id && (
                        <span className="text-xs text-gray-400">Feedback sent</span>
                      )}
                    </div>
                  )}

                  {msg.role === "assistant" && feedbackOpenId === msg.id && (
                    <div className="mt-2 w-full text-left rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <textarea
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder="What went wrong or right about this response?"
                        rows={3}
                        autoFocus
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-white"
                      />
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          onClick={cancelFeedback}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => submitFeedback(msg)}
                          disabled={!feedbackText.trim() || feedbackSubmitting}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-xs font-medium"
                        >
                          {feedbackSubmitting ? "Sending..." : "Submit"}
                        </button>
                      </div>
                      {feedbackStatus[msg.id] === "error" && (
                        <p className="mt-1.5 text-xs text-red-600">
                          Couldn&apos;t save feedback. Please try again.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-semibold text-lg">
                    👤
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-4 py-6 animate-in fade-in">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                  🤖
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="bg-white bg-opacity-80 backdrop-blur-sm border-t border-gray-200 py-4">
          <div className="max-w-4xl mx-auto px-4">
            {warnings.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  {warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message Gemini"
                disabled={loading}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500 disabled:bg-gray-50 disabled:cursor-not-allowed transition-all bg-white text-gray-900"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-6 py-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

const TOOLTIP_WIDTH = 224; // px, matches w-56

function InfoTooltip({ text }: { text: string }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  // Rendered into document.body so it always sits above the settings
  // panel's overflow-y-auto clipping box, instead of getting cut off
  // for fields near the top/bottom of the scrollable list.
  const show = () => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estimatedHeight = 90;
    const above = rect.bottom + 8 + estimatedHeight > window.innerHeight;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, TOOLTIP_WIDTH / 2 + 8),
      window.innerWidth - TOOLTIP_WIDTH / 2 - 8
    );
    setPos({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left,
      above,
    });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={iconRef}
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <Info
        size={13}
        className="text-gray-400 hover:text-gray-600 cursor-help"
        aria-hidden="true"
      />
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              transform: `translate(-50%, ${pos.above ? "-100%" : "0"})`,
            }}
            className="pointer-events-none z-[100] w-56 rounded-lg bg-gray-900 px-3 py-2 text-xs leading-snug text-white shadow-lg"
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}

function FieldLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <InfoTooltip text={tooltip} />
    </span>
  );
}

function NumberField({
  label,
  tooltip,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  tooltip: string;
  hint: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <FieldLabel label={label} tooltip={tooltip} />
        <span className="text-xs text-gray-400">{hint}</span>
      </div>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder="Model default"
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
    </label>
  );
}

function SliderField({
  label,
  tooltip,
  value,
  defaultValue,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  tooltip: string;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <FieldLabel label={label} tooltip={tooltip} />
        <span className="text-xs text-gray-500 tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{min}</span>
        <span>default {defaultValue}</span>
        <span>{max}</span>
      </div>
    </label>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: GenerationSettings;
  onChange: (settings: GenerationSettings) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => onChange({ ...settings, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-gray-200 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Model settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <SliderField
            label="Temperature"
            tooltip="Controls randomness. Lower values give more focused, predictable answers; higher values give more creative, varied answers."
            value={settings.temperature ?? DEFAULT_GENERATION_SETTINGS.temperature!}
            defaultValue={DEFAULT_GENERATION_SETTINGS.temperature!}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => set("temperature", v)}
          />

          <NumberField
            label="Top K"
            tooltip="Limits the model to picking its next word from only the K most likely options. Lower values keep answers more focused."
            hint="min 1"
            value={settings.topK}
            min={1}
            step={1}
            onChange={(v) => set("topK", v)}
          />

          <NumberField
            label="Top P"
            tooltip="Limits word choices to the smallest group whose combined likelihood reaches this value. Lower values are more focused, higher values more varied."
            hint="0 to 1"
            value={settings.topP}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set("topP", v)}
          />

          <NumberField
            label="Output Tokens"
            tooltip="The maximum length of the reply, in tokens (roughly 4 characters each). Lower values give shorter responses."
            hint="positive integer"
            value={settings.maxOutputTokens}
            min={1}
            step={1}
            onChange={(v) => set("maxOutputTokens", v)}
          />

          <SliderField
            label="Frequency Penalty"
            tooltip="Discourages the model from repeating the same words. Higher values reduce repetition."
            value={settings.frequencyPenalty ?? DEFAULT_GENERATION_SETTINGS.frequencyPenalty!}
            defaultValue={DEFAULT_GENERATION_SETTINGS.frequencyPenalty!}
            min={-2}
            max={2}
            step={0.1}
            onChange={(v) => set("frequencyPenalty", v)}
          />

          <SliderField
            label="Presence Penalty"
            tooltip="Encourages the model to bring up new topics instead of repeating what it already said. Higher values push more toward new ideas."
            value={settings.presencePenalty ?? DEFAULT_GENERATION_SETTINGS.presencePenalty!}
            defaultValue={DEFAULT_GENERATION_SETTINGS.presencePenalty!}
            min={-2}
            max={2}
            step={0.1}
            onChange={(v) => set("presencePenalty", v)}
          />

          <label className="block">
            <div className="flex items-baseline justify-between mb-1">
              <FieldLabel
                label="Stop Sequence"
                tooltip="A word or character that tells the model to stop generating as soon as it appears in the output."
              />
              <span className="text-xs text-gray-400">word or character</span>
            </div>
            <input
              type="text"
              value={settings.stopSequence ?? ""}
              placeholder="e.g. ### or STOP"
              onChange={(e) =>
                set("stopSequence", e.target.value === "" ? undefined : e.target.value)
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </label>

          <NumberField
            label="Seed"
            tooltip="A fixed number that makes replies more reproducible — the same seed and prompt tend to produce similar results."
            hint="integer"
            value={settings.seed}
            step={1}
            onChange={(v) => set("seed", v)}
          />
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200">
          <button
            onClick={() => onChange(DEFAULT_GENERATION_SETTINGS)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <RotateCcw size={14} />
            Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
