/**
 * Tiny dependency-free lexical retriever.
 *
 * The corpus is small and trusted, so this stays simple: paragraph chunks scored
 * by TF-IDF over the query terms. No embeddings, no index files, no
 * dependencies. It is rebuilt in memory at startup.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type Chunk = { source: string; text: string };
export type Scored = Chunk & { score: number };
export type DocumentIndex = { search: (query: string, k?: number) => Scored[] };

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "were",
  "it", "its", "for", "on", "at", "by", "as", "be", "this", "that", "with",
  "from", "what", "which", "who", "how", "does", "do", "did", "about", "into",
  "than", "then", "so", "if", "not", "you", "your", "we", "our", "they",
  "their", "he", "she", "his", "her", "them", "i",
]);

const MAX_CHUNK_WORDS = 200;
const WINDOW_WORDS = 120;
const WINDOW_OVERLAP = 30;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length > 1 && !STOPWORDS.has(token),
  );
}

/** Paragraph chunks; window any paragraph that is unusually long. */
function chunkText(source: string, text: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    const words = trimmed.split(/\s+/);
    if (words.length <= MAX_CHUNK_WORDS) {
      chunks.push({ source, text: trimmed });
      continue;
    }

    const step = WINDOW_WORDS - WINDOW_OVERLAP;
    for (let i = 0; i < words.length; i += step) {
      chunks.push({ source, text: words.slice(i, i + WINDOW_WORDS).join(" ") });
      if (i + WINDOW_WORDS >= words.length) break;
    }
  }

  return chunks;
}

async function loadDocuments(dir: string): Promise<Chunk[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const chunks: Chunk[] = [];
  for (const name of entries.sort()) {
    if (!/\.(md|txt)$/i.test(name)) continue;
    const text = await readFile(path.join(dir, name), "utf-8");
    chunks.push(...chunkText(`${path.basename(dir)}/${name}`, text));
  }
  return chunks;
}

export async function buildIndex(dir: string): Promise<DocumentIndex> {
  const chunks = await loadDocuments(dir);
  const tokens = chunks.map((chunk) => tokenize(chunk.text));

  const documentFrequency = new Map<string, number>();
  for (const list of tokens) {
    for (const term of new Set(list)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const idf = (term: string) =>
    Math.log(1 + chunks.length / (1 + (documentFrequency.get(term) ?? 0)));

  return {
    search(query: string, k = 3): Scored[] {
      const terms = new Set(tokenize(query));
      const scored: Scored[] = [];

      chunks.forEach((chunk, i) => {
        const termFrequency = new Map<string, number>();
        for (const term of tokens[i]) {
          termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
        }

        let score = 0;
        for (const term of terms) {
          score += (termFrequency.get(term) ?? 0) * idf(term);
        }
        if (score > 0) scored.push({ ...chunk, score });
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}
