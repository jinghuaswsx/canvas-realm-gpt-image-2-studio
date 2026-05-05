"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import clsx from "clsx";

interface PromptCase {
  id: string;
  category: string;
  categoryLabel: string;
  caseNumber: number;
  title: string;
  author: string;
  authorUrl: string;
  tweetUrl: string;
  imageUrl: string;
  prompt: string;
}

interface PromptLibraryModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (prompt: string) => void;
}

export function PromptLibraryModal({ open, onClose, onSelect }: PromptLibraryModalProps): ReactElement | null {
  const [cases, setCases] = useState<PromptCase[] | null>(null);
  const [error, setError] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || cases) return;
    let cancelled = false;
    fetch("/prompt-library.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PromptCase[]>;
      })
      .then((data) => {
        if (!cancelled) setCases(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, cases]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (previewId) setPreviewId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, previewId]);

  useEffect(() => {
    if (!open) setPreviewId(null);
  }, [open]);

  const categories = useMemo(() => {
    if (!cases) return [];
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const c of cases) {
      const existing = map.get(c.category);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(c.category, { key: c.category, label: c.categoryLabel, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [cases]);

  const filtered = useMemo(() => {
    if (!cases) return [];
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      if (activeCategory !== "all" && c.category !== activeCategory) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.prompt.toLowerCase().includes(q)
      );
    });
  }, [cases, activeCategory, query]);

  const previewCase = useMemo(() => cases?.find((c) => c.id === previewId) ?? null, [cases, previewId]);

  if (!open) return null;

  function handleSelect(c: PromptCase): void {
    onSelect(c.prompt);
    onClose();
  }

  return (
    <div
      className="prompt-library-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="prompt-library-modal" role="dialog" aria-label="提示词库">
        <header className="prompt-library-header">
          <div>
            <h2>提示词库</h2>
            <p>来自 awesome-gpt-image-2-prompts，共 {cases?.length ?? 0} 个案例</p>
          </div>
          <button type="button" className="icon-button ghost" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="prompt-library-toolbar">
          <div className="prompt-library-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === "all"}
              className={clsx(activeCategory === "all" && "active")}
              onClick={() => setActiveCategory("all")}
            >
              全部 {cases ? `· ${cases.length}` : ""}
            </button>
            {categories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                role="tab"
                aria-selected={activeCategory === cat.key}
                className={clsx(activeCategory === cat.key && "active")}
                onClick={() => setActiveCategory(cat.key)}
              >
                {cat.label} · {cat.count}
              </button>
            ))}
          </div>
          <div className="prompt-library-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、作者或提示词关键词…"
            />
          </div>
        </div>

        <div className="prompt-library-body">
          {error ? (
            <div className="prompt-library-empty">加载失败：{error}</div>
          ) : !cases ? (
            <div className="prompt-library-empty">
              <Loader2 size={20} className="spin" /> 加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="prompt-library-empty">没有匹配的案例。</div>
          ) : (
            <div className="prompt-library-grid">
              {filtered.map((c) => (
                <article key={c.id} className="prompt-library-card">
                  <button
                    type="button"
                    className="prompt-library-thumb"
                    onClick={() => setPreviewId(c.id)}
                    aria-label={`预览 ${c.title}`}
                  >
                    <img src={c.imageUrl} alt={c.title} loading="lazy" />
                  </button>
                  <div className="prompt-library-meta">
                    <h3 title={c.title}>{c.title}</h3>
                    <a
                      href={c.authorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="prompt-library-author"
                    >
                      @{c.author}
                    </a>
                  </div>
                  <button type="button" className="prompt-library-select" onClick={() => handleSelect(c)}>
                    <Check size={14} /> 选用
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        {previewCase ? (
          <div
            className="prompt-library-preview"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewId(null);
            }}
          >
            <div className="prompt-library-preview-inner">
              <header>
                <h3>{previewCase.title}</h3>
                <button type="button" className="icon-button ghost" onClick={() => setPreviewId(null)} aria-label="关闭预览">
                  <X size={16} />
                </button>
              </header>
              <div className="prompt-library-preview-body">
                <img src={previewCase.imageUrl} alt={previewCase.title} loading="lazy" />
                <div className="prompt-library-preview-right">
                  <div className="prompt-library-preview-meta">
                    <span className="badge">{previewCase.categoryLabel}</span>
                    <a href={previewCase.authorUrl} target="_blank" rel="noopener noreferrer">
                      @{previewCase.author}
                    </a>
                    <a href={previewCase.tweetUrl} target="_blank" rel="noopener noreferrer">
                      原帖 ↗
                    </a>
                  </div>
                  <pre className="prompt-library-preview-prompt">{previewCase.prompt}</pre>
                  <button type="button" className="primary" onClick={() => handleSelect(previewCase)}>
                    <Check size={14} /> 使用此提示词
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
