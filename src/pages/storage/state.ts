// What the storage tools found, kept while you move between sections.

import type { Analysis, DownloadsFound, DupFound, EmptyFound } from "../../core/api";

export const found: {
  analysis: Analysis | null;
  analyzed: string;
  dups: DupFound | null;
  dupsRoot: string;
  empty: EmptyFound | null;
  emptyRoot: string;
  downloads: DownloadsFound | null;
} = { analysis: null, analyzed: "", dups: null, dupsRoot: "", empty: null, emptyRoot: "", downloads: null };
