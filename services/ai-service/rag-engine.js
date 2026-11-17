/**
 * Internal AI QA Testing Platform - RAG Retrieval Engine
 * Retrieves business rules, task history, and design specifications with explicit citations.
 * Defined in Section 10 of System Design v1.0.
 */

import { db } from '../../database/db.js';
import { BusinessRuleStore } from './business-rule-store.js';

export class RagEngine {
  /**
   * Retrieve relevant knowledge chunks for a given module and query context
   */
  static async retrieveChunks({ moduleId, keywords = [], minRelevance = 1 }) {
    await db.init();
    const chunks = db.getTable('knowledge_chunks');
    const sources = db.getTable('knowledge_sources');

    // Build source map
    const sourceMap = new Map();
    sources.forEach(s => sourceMap.set(s.id, s));

    const scored = [];

    for (const chunk of chunks) {
      const source = sourceMap.get(chunk.source_id);
      // Skip inactive or outdated sources
      if (!source || source.status !== 'ACTIVE') continue;

      let score = 0;

      // Module match bonus
      if (moduleId && source.module_id === moduleId) {
        score += 3;
      }

      // Keyword matching
      const contentLower = chunk.content_text.toLowerCase();
      keywords.forEach(kw => {
        if (!kw) return;
        const kwLower = kw.toLowerCase();
        if (contentLower.includes(kwLower)) {
          score += 2;
        }
      });

      if (score >= minRelevance) {
        scored.push({
          chunkId: chunk.id,
          sourceId: source.id,
          sourceTitle: source.title,
          sourceVersion: source.version,
          sourceUri: source.source_uri,
          contentText: chunk.content_text,
          metadata: typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata || '{}') : (chunk.metadata || {}),
          score
        });
      }
    }

    // Sort descending by relevance score
    // Merge confirmed rules from "Kho Business Rule Haraworks"
    scored.push(...BusinessRuleStore.retrieveChunks({ moduleId, keywords }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5); // Return top 5 relevant chunks
  }

  /**
   * Format citations string for AI output
   */
  static formatCitations(chunks) {
    if (!chunks || chunks.length === 0) return [];
    return chunks.map(c => ({
      citation_id: `cite_${c.chunkId}`,
      source_title: c.sourceTitle,
      version: c.sourceVersion,
      uri: c.sourceUri,
      excerpt: c.contentText.substring(0, 150) + '...'
    }));
  }
}
