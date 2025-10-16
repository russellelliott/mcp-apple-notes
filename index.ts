import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as lancedb from "@lancedb/lancedb";
import { runJxa } from "run-jxa";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
// Remove TurndownService import
import {
  EmbeddingFunction,
  LanceSchema,
  register,
} from "@lancedb/lancedb/embedding";
import { type Float, Float32, Utf8 } from "apache-arrow";
import { pipeline } from "@huggingface/transformers";

// Install with: bun add density-clustering
// For density-based clustering (using DBSCAN since HDBSCAN is not available)
import { DBSCAN } from "density-clustering";

// Remove the turndown instance
const db = await lancedb.connect(
  path.join(os.homedir(), ".mcp-apple-notes", "data")
);

// Path for notes cache file
const NOTES_CACHE_PATH = path.join(os.homedir(), ".mcp-apple-notes", "notes-cache.json");

// Types for note metadata
interface NoteMetadata {
  title: string;
  creation_date: string;
  modification_date: string;
}

interface NotesCache {
  last_sync: string;
  notes: NoteMetadata[];
}

interface ChunkData {
  title: string;
  content: string;
  creation_date: string;
  modification_date: string;
  chunk_index: string;
  total_chunks: string;
  chunk_content: string;
  cluster_id: string;
  cluster_label: string;
  cluster_confidence: string;
  cluster_summary: string;
  last_clustered: string;
}

// Utility functions for notes cache
const loadNotesCache = async (): Promise<NotesCache | null> => {
  try {
    const cacheContent = await fs.readFile(NOTES_CACHE_PATH, 'utf8');
    return JSON.parse(cacheContent);
  } catch (error) {
    console.log(`📁 No existing cache file found or error reading it`);
    return null;
  }
};

const saveNotesCache = async (notes: NoteMetadata[]): Promise<void> => {
  try {
    // Ensure directory exists
    const cacheDir = path.dirname(NOTES_CACHE_PATH);
    await fs.mkdir(cacheDir, { recursive: true });
    
    const cache: NotesCache = {
      last_sync: new Date().toISOString(),
      notes: notes
    };
    
    await fs.writeFile(NOTES_CACHE_PATH, JSON.stringify(cache, null, 2));
    console.log(`💾 Saved ${notes.length} notes to cache file`);
    console.log(`📅 Cache timestamp: ${cache.last_sync}`);
    
    // Show a sample of what's being cached
    if (notes.length > 0) {
      console.log(`📝 Sample cached notes:`);
      notes.slice(0, 3).forEach((note, idx) => {
        console.log(`   ${idx + 1}. "${note.title}" (created: ${note.creation_date}, modified: ${note.modification_date})`);
      });
      if (notes.length > 3) {
        console.log(`   ... and ${notes.length - 3} more notes`);
      }
    }
  } catch (error) {
    console.log(`⚠️ Failed to save cache file: ${(error as Error).message}`);
  }
};

// Helper to identify new/modified notes
const identifyChangedNotes = (currentNotes: NoteMetadata[], cachedNotes: NoteMetadata[]): {
  newNotes: NoteMetadata[];
  modifiedNotes: NoteMetadata[];
  unchangedNotes: NoteMetadata[];
} => {
  const cachedMap = new Map<string, { creation_date: string; modification_date: string }>(); // title -> dates
  
  cachedNotes.forEach(note => {
    cachedMap.set(note.title, {
      creation_date: note.creation_date,
      modification_date: note.modification_date
    });
  });
  
  const newNotes: NoteMetadata[] = [];
  const modifiedNotes: NoteMetadata[] = [];
  const unchangedNotes: NoteMetadata[] = [];
  
  currentNotes.forEach(note => {
    const cached = cachedMap.get(note.title);
    
    if (!cached) {
      // New note (not in cache)
      newNotes.push(note);
    } else if (cached.modification_date !== note.modification_date) {
      // Modified note (modification date changed)
      modifiedNotes.push(note);
    } else if (cached.creation_date !== note.creation_date) {
      // Edge case: creation date changed (shouldn't happen but handle it)
      console.log(`⚠️ Note "${note.title}" has different creation date - treating as modified`);
      modifiedNotes.push(note);
    } else {
      // Unchanged note
      unchangedNotes.push(note);
    }
  });
  
  return { newNotes, modifiedNotes, unchangedNotes };
};

// HDBSCAN Clustering Functions
// ============================

// Aggregate chunks to note-level embeddings for clustering
export const aggregateChunksToNotes = async (notesTable: any) => {
  console.log("📊 Aggregating chunks to note-level embeddings for clustering...");
  
  // Get all chunks from database
  const allChunks = await notesTable.search("").limit(100000).toArray();
  console.log(`📄 Found ${allChunks.length} chunks to aggregate`);
  
  // Group by note (using title + creation_date as unique key)
  const noteMap = new Map();
  
  for (const chunk of allChunks) {
    const noteKey = `${chunk.title}|||${chunk.creation_date}`;
    
    if (!noteMap.has(noteKey)) {
      noteMap.set(noteKey, {
        title: chunk.title,
        creation_date: chunk.creation_date,
        modification_date: chunk.modification_date,
        content: chunk.content,
        vectors: [],
        chunks: []
      });
    }
    
    // LanceDB stores vectors as Vector objects, convert to array
    let vectorArray = null;
    if (chunk.vector) {
      if (typeof chunk.vector.toArray === 'function') {
        // Use toArray method and convert to regular array
        const typedArray = chunk.vector.toArray();
        vectorArray = Array.from(typedArray);
      } else if (Symbol.iterator in chunk.vector) {
        // Fall back to Array.from if iterable
        vectorArray = Array.from(chunk.vector);
      }
    }
    
    if (vectorArray && Array.isArray(vectorArray) && vectorArray.length > 0) {
      noteMap.get(noteKey).vectors.push(vectorArray);
      noteMap.get(noteKey).chunks.push({
        index: chunk.chunk_index,
        content: chunk.chunk_content
      });
    }
  }
  
  // Create note-level embeddings by averaging chunk vectors
  const noteEmbeddings = Array.from(noteMap.values())
    .filter(note => note.vectors.length > 0)
    .map(note => {
      // Average all chunk vectors for this note
      const avgVector = note.vectors[0].map((_, dimIdx) => 
        note.vectors.reduce((sum, vec) => sum + vec[dimIdx], 0) / note.vectors.length
      );
      
      return {
        ...note,
        embedding: avgVector,
        numChunks: note.vectors.length
      };
    });
  
  console.log(`✅ Aggregated into ${noteEmbeddings.length} notes with embeddings`);
  return noteEmbeddings;
};

// DBSCAN clustering using density-clustering library
// Note: DBSCAN is similar to HDBSCAN but uses fixed epsilon distance
const runDBSCAN = (vectors: number[][], minClusterSize = 10, epsilon = 0.3) => {
  console.log(`🔬 Running DBSCAN clustering (epsilon=${epsilon}, min_samples=${minClusterSize})...`);
  
  const dbscan = new DBSCAN();
  
  // Run DBSCAN clustering
  // DBSCAN parameters: dataset, epsilon (neighborhood distance), minPts (minimum points)
  const clusters = dbscan.run(vectors, epsilon, minClusterSize);
  
  // DBSCAN returns arrays of point indices for each cluster, need to convert to labels
  const labels = new Array(vectors.length).fill(-1); // -1 = noise/outlier
  
  clusters.forEach((cluster, clusterId) => {
    if (Array.isArray(cluster)) {
      cluster.forEach((pointIndex) => {
        labels[pointIndex] = clusterId;
      });
    }
  });
  
  const totalClusters = clusters.length;
  const outliers = labels.filter((l) => l === -1).length;
  
  console.log(`✅ DBSCAN found ${totalClusters} clusters, ${outliers} outliers`);
  return labels;
};

// Main clustering function
export const clusterNotes = async (
  notesTable: any,
  minClusterSize = 10,
  epsilon = 0.3
) => {
  const start = performance.now();
  console.log(`🔬 Starting note clustering...`);
  
  // Step 1: Aggregate chunks to note-level embeddings
  const noteEmbeddings = await aggregateChunksToNotes(notesTable);
  
  if (noteEmbeddings.length === 0) {
    throw new Error("No notes with embeddings found");
  }
  
  // Step 2: Extract vectors for clustering
  const vectors = noteEmbeddings.map(n => n.embedding);
  
  // Step 3: Run clustering
  const clusterLabels = runDBSCAN(vectors, minClusterSize, epsilon);
  
  // Step 4: Group notes by cluster
  const clusters = new Map();
  clusterLabels.forEach((clusterId, idx) => {
    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, []);
    }
    clusters.get(clusterId).push({
      ...noteEmbeddings[idx],
      cluster_id: clusterId
    });
  });
  
  // Step 5: Generate cluster labels and summaries
  const clusterSummaries = new Map();
  for (const [clusterId, notes] of clusters.entries()) {
    if (clusterId === -1) {
      clusterSummaries.set(clusterId, {
        label: "Uncategorized",
        summary: "Notes that don't fit into any specific cluster",
        confidence: "0.0"
      });
    } else {
      // Simple label generation based on most common words in titles
      const allTitles = notes.map(n => n.title).join(' ');
      const words = allTitles.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 3);
      
      const wordCounts = words.reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const topWords = Object.entries(wordCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 2)
        .map(([word]) => word);
      
      clusterSummaries.set(clusterId, {
        label: topWords.length > 0 ? topWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : `Cluster ${clusterId}`,
        summary: `${notes.length} notes related to ${topWords.join(', ')}`,
        confidence: "0.8"
      });
    }
  }
  
  // Step 6: Update ALL chunks with cluster information
  console.log(`💾 Updating database with cluster assignments...`);
  
  for (const [clusterId, notes] of clusters.entries()) {
    const clusterInfo = clusterSummaries.get(clusterId)!;
    
    for (const note of notes) {
      try {
        // Update all chunks belonging to this note
        await notesTable.update({
          where: `title = '${note.title.replace(/'/g, "''")}' AND creation_date = '${note.creation_date}'`,
          values: {
            cluster_id: clusterId.toString(),
            cluster_label: clusterInfo.label,
            cluster_confidence: clusterInfo.confidence,
            cluster_summary: clusterInfo.summary,
            last_clustered: new Date().toISOString()
          }
        });
        
        console.log(`   ✅ Updated "${note.title}" → Cluster ${clusterId} (${clusterInfo.label})`);
      } catch (error) {
        console.log(`   ⚠️ Failed to update "${note.title}": ${(error as Error).message}`);
      }
    }
  }
  
  const totalTime = (performance.now() - start) / 1000;
  const validClusters = clusters.size - (clusters.has(-1) ? 1 : 0);
  const outliers = clusters.get(-1)?.length || 0;
  
  console.log(`\n✨ Clustering complete in ${totalTime.toFixed(1)}s!`);
  console.log(`📊 Results:`);
  console.log(`  • Valid clusters: ${validClusters}`);
  console.log(`  • Outlier notes: ${outliers}`);
  console.log(`  • Total notes processed: ${noteEmbeddings.length}`);
  
  return {
    totalClusters: validClusters,
    outliers,
    totalNotes: noteEmbeddings.length,
    clusterSizes: Array.from(clusters.entries())
      .filter(([id]) => id >= 0)
      .map(([id, notes]) => ({
        id,
        label: clusterSummaries.get(id)?.label,
        size: notes.length
      }))
      .sort((a, b) => b.size - a.size),
    timeSeconds: totalTime
  };
};

// Get all notes in a specific cluster
export const getNotesInCluster = async (notesTable: any, clusterId: string) => {
  console.log(`📂 Fetching notes in cluster ${clusterId}...`);
  
  // Fetch all chunks with this cluster_id
  const chunks = await notesTable
    .search("")
    .where(`cluster_id = '${clusterId}'`)
    .toArray();
  
  // Group chunks back into unique notes
  const notesMap = new Map();
  
  for (const chunk of chunks) {
    const noteKey = `${chunk.title}|||${chunk.creation_date}`;
    
    if (!notesMap.has(noteKey)) {
      notesMap.set(noteKey, {
        title: chunk.title,
        content: chunk.content,
        creation_date: chunk.creation_date,
        modification_date: chunk.modification_date,
        cluster_id: chunk.cluster_id,
        cluster_label: chunk.cluster_label,
        cluster_confidence: chunk.cluster_confidence,
        cluster_summary: chunk.cluster_summary,
        total_chunks: parseInt(chunk.total_chunks || '1')
      });
    }
  }
  
  const notes = Array.from(notesMap.values());
  console.log(`✅ Found ${notes.length} notes in cluster ${clusterId}`);
  
  return notes;
};

// List all clusters with counts
export const listClusters = async (notesTable: any) => {
  console.log(`📊 Listing all clusters...`);
  
  const chunks = await notesTable
    .search("")
    .select(["cluster_id", "cluster_label", "cluster_summary", "title", "creation_date"])
    .where("cluster_id IS NOT NULL")
    .toArray();
  
  // Group by cluster
  const clusterMap = new Map();
  
  for (const chunk of chunks) {
    if (!clusterMap.has(chunk.cluster_id)) {
      clusterMap.set(chunk.cluster_id, {
        id: chunk.cluster_id,
        label: chunk.cluster_label || 'Unknown',
        summary: chunk.cluster_summary || '',
        notes: new Set()
      });
    }
    
    clusterMap.get(chunk.cluster_id).notes.add(`${chunk.title}|||${chunk.creation_date}`);
  }
  
  // Convert to array with counts
  const clusters = Array.from(clusterMap.values()).map(cluster => ({
    cluster_id: cluster.id,
    cluster_label: cluster.label,
    cluster_summary: cluster.summary,
    note_count: cluster.notes.size
  })).sort((a, b) => b.note_count - a.note_count);
  
  console.log(`✅ Found ${clusters.length} clusters`);
  
  return clusters;
};

// Update to better embedding model
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/bge-small-en-v1.5" // Better model for semantic search
);

// Get tokenizer from the model
const tokenizer = extractor.tokenizer;

// Chunking configuration
const CHUNK_SIZE = 400; // tokens (留出余量给系统 tokens)
const CHUNK_OVERLAP = 50; // tokens overlap between chunks
const MAX_CHUNK_SIZE = 512; // hard limit for safety

// Enhanced chunking function with better text preservation
const createChunks = async (text: string, maxTokens = CHUNK_SIZE, overlap = CHUNK_OVERLAP): Promise<string[]> => {
  if (!text || text.trim().length === 0) {
    return [''];
  }
  
  try {
    // First, try to estimate if we need chunking at all
    const roughTokenCount = text.length / 4; // Rough estimate: ~4 chars per token
    
    if (roughTokenCount <= maxTokens) {
      // Text is likely small enough, verify with actual tokenization
      const tokens = await tokenizer(text);
      const tokenIds = Array.from(tokens.input_ids.data);
      
      if (tokenIds.length <= maxTokens) {
        return [text]; // Return original text to preserve formatting
      }
    }
    
    // Text needs chunking - use a smarter approach
    // Split on natural boundaries first (paragraphs, sentences)
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    if (paragraphs.length === 1) {
      // Single paragraph, split on sentences
      const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      return await createChunksFromSegments(sentences, maxTokens, overlap);
    } else {
      // Multiple paragraphs, try to chunk by paragraphs first
      return await createChunksFromSegments(paragraphs, maxTokens, overlap);
    }
    
  } catch (error) {
    console.log(`⚠️ Smart chunking failed, using fallback: ${error.message}`);
    return createFallbackChunks(text, maxTokens, overlap);
  }
};

// Helper function to create chunks from text segments (paragraphs or sentences)
const createChunksFromSegments = async (segments: string[], maxTokens: number, overlap: number): Promise<string[]> => {
  const chunks: string[] = [];
  let currentChunk = '';
  let currentTokens = 0;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    // Estimate tokens for this segment
    const segmentTokens = await estimateTokens(segment);
    
    // If adding this segment would exceed limit, finalize current chunk
    if (currentTokens + segmentTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap
      const overlapText = createOverlapText(currentChunk, overlap);
      currentChunk = overlapText + (overlapText ? '\n\n' : '') + segment;
      currentTokens = await estimateTokens(currentChunk);
    } else {
      // Add segment to current chunk
      if (currentChunk.length > 0) {
        currentChunk += '\n\n' + segment;
      } else {
        currentChunk = segment;
      }
      currentTokens += segmentTokens;
    }
    
    // If a single segment is too large, split it further
    if (segmentTokens > maxTokens) {
      chunks.push(...createFallbackChunks(segment, maxTokens, overlap));
      currentChunk = '';
      currentTokens = 0;
    }
  }
  
  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.length > 0 ? chunks : [segments.join('\n\n')];
};

// Helper to estimate token count without full tokenization
const estimateTokens = async (text: string): Promise<number> => {
  // For performance, use character-based estimation for most cases
  const charEstimate = Math.ceil(text.length / 4);
  
  // If it's close to the limit, do actual tokenization
  if (charEstimate > CHUNK_SIZE * 0.8) {
    try {
      const tokens = await tokenizer(text);
      return tokens.input_ids.data.length;
    } catch {
      return charEstimate;
    }
  }
  
  return charEstimate;
};

// Helper to create overlap text from the end of previous chunk
const createOverlapText = (chunk: string, overlapTokens: number): string => {
  if (!chunk || overlapTokens <= 0) return '';
  
  // Take approximately the last portion for overlap
  const overlapChars = overlapTokens * 4; // Rough estimate
  const words = chunk.split(/\s+/);
  
  // Take last few words to approximate overlap
  const overlapWords = words.slice(-Math.max(1, Math.floor(overlapTokens / 2)));
  return overlapWords.join(' ');
};

// Fallback chunking using character-based approach (preserves formatting better)
const createFallbackChunks = (text: string, maxTokens: number, overlap: number): string[] => {
  const approxChunkSize = maxTokens * 4; // ~4 chars per token
  const approxOverlap = overlap * 4;
  
  if (text.length <= approxChunkSize) {
    return [text];
  }
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + approxChunkSize, text.length);
    let chunk = text.substring(start, end);
    
    // Try to break on word boundaries
    if (end < text.length) {
      const lastSpace = chunk.lastIndexOf(' ');
      const lastNewline = chunk.lastIndexOf('\n');
      const breakPoint = Math.max(lastSpace, lastNewline);
      
      if (breakPoint > start + approxChunkSize * 0.7) {
        chunk = text.substring(start, start + breakPoint);
        start = start + breakPoint + 1;
      } else {
        start = end;
      }
    } else {
      start = end;
    }
    
    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim());
    }
    
    // Apply overlap for next chunk
    if (start < text.length) {
      start = Math.max(start - approxOverlap, 0);
    }
  }
  
  return chunks.length > 0 ? chunks : [text.substring(0, approxChunkSize)];
};

@register("openai")
export class OnDeviceEmbeddingFunction extends EmbeddingFunction<string> {
  toJSON(): object {
    return {};
  }
  ndims() {
    return 384; // bge-small-en-v1.5 uses 384 dimensions
  }
  embeddingDataType(): Float {
    return new Float32();
  }
  
  // Enhanced preprocessing for better semantic capture
  private cleanText(text: string): string {
    return text
      .toLowerCase() // Normalize case
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s\-.,!?;:()\[\]{}'"]/g, ' ') // Keep basic punctuation
      .replace(/\s+/g, ' ') // Clean up extra spaces
      .trim();
  }
  
  async computeQueryEmbeddings(data: string) {
    const cleanedData = this.cleanText(data);
    const output = await extractor(cleanedData, { 
      pooling: "mean", 
      normalize: true // Critical for proper similarity calculation
    });
    return output.data as number[];
  }
  
  async computeSourceEmbeddings(data: string[]) {
    // Process embeddings in batches for better performance
    const EMBEDDING_BATCH_SIZE = 10;
    const results = [];
    
    for (let i = 0; i < data.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = data.slice(i, i + EMBEDDING_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          const cleanedItem = this.cleanText(item);
          const output = await extractor(cleanedItem, { 
            pooling: "mean", 
            normalize: true
          });
          return output.data as number[];
        })
      );
      results.push(...batchResults);
    }
    
    return results;
  }
}




//convert html to plaintext
// Replace the HTML to text conversion function
const htmlToPlainText = (html: string): string => {
  if (!html) return "";
  
  return html
    // Remove script and style elements completely
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    
    // Convert common HTML elements to readable text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    
    // Handle lists
    .replace(/<ul[^>]*>/gi, '\n')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '\n')
    .replace(/<\/ol>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    
    // Handle headers - preserve their content but make them readable
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n$1\n' + '='.repeat(50) + '\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n$1\n' + '-'.repeat(30) + '\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n$1\n')
    .replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, '\n\n$1\n')
    
    // Handle emphasis
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    
    // Handle links
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    
    // Remove all remaining HTML tags
    .replace(/<[^>]*>/g, '')
    
    // Clean up entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-zA-Z]+;/g, '') // Remove other entities
    
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ') // Multiple spaces/tabs to single space
    .trim();
};

const func = new OnDeviceEmbeddingFunction();

// Updated schema to include chunk information and clustering fields
const notesTableSchema = LanceSchema({
  title: new Utf8(), // Regular field, not for embedding
  content: new Utf8(), // Regular field, not for embedding  
  creation_date: new Utf8(), // Regular field
  modification_date: new Utf8(), // Regular field
  chunk_index: new Utf8(), // Regular field
  total_chunks: new Utf8(), // Regular field
  chunk_content: func.sourceField(new Utf8()), // This is the field that gets embedded
  vector: func.vectorField(), // This stores the embeddings
  
  // NEW: Clustering fields (same value for all chunks of the same note)
  cluster_id: new Utf8(), // -1 for outliers, 0+ for cluster ID (using string to handle -1)
  cluster_label: new Utf8(), // Human-readable name like "Work Projects", "Python Development"
  cluster_confidence: new Utf8(), // How strongly this note belongs to the cluster (0.0-1.0)
  cluster_summary: new Utf8(), // Auto-generated description of what this cluster contains
  last_clustered: new Utf8(), // ISO timestamp when clustering was last run
});

const QueryNotesSchema = z.object({
  query: z.string(),
});

const GetNoteSchema = z.object({
  title: z.string(),
  creation_date: z.string().optional(),
});

const IndexNotesSchema = z.object({
  mode: z.enum(["fresh", "incremental"]).optional().default("incremental"),
});

const ClusterNotesSchema = z.object({
  min_cluster_size: z.number().optional().default(10),
  epsilon: z.number().optional().default(0.3),
});

const GetClusterSchema = z.object({
  cluster_id: z.string(),
});

const ListClustersSchema = z.object({});

export const server = new Server(
  {
    name: "my-apple-notes-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Add a shutdown method
export const shutdown = async () => {
  await db.close();
  // Force cleanup of the pipeline
  if (extractor) {
    // @ts-ignore - accessing internal cleanup method
    await extractor?.cleanup?.();
  }
  // Force exit since stdio transport doesn't have cleanup
  process.exit(0);
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list-notes",
        description: "Lists just the titles of all my Apple Notes",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "index-notes",
        description:
          "Index all my Apple Notes for Semantic Search using enhanced method that handles duplicate note titles better. Uses incremental mode by default to only process new/modified notes. Please tell the user that the sync takes couple of seconds up to couple of minutes depending on how many notes you have.",
        inputSchema: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["fresh", "incremental"],
              description: "fresh: reindex all notes from scratch, incremental: only process new/modified notes",
              default: "incremental"
            }
          },
          required: [],
        },
      },
      {
        name: "get-note",
        description: "Get a note full content and details by title. If multiple notes have the same title, you can specify creation_date to get a specific one.",
        inputSchema: {
          type: "object",
          properties: {
            title: z.string(),
            creation_date: z.string().optional(),
          },
          required: ["title"],
        },
      },
      {
        name: "search-notes",
        description: "Search for notes by title or content",
        inputSchema: {
          type: "object",
          properties: {
            query: z.string(),
          },
          required: ["query"],
        },
      },
      {
        name: "cluster-notes",
        description: "Run DBSCAN clustering on all notes to automatically group similar notes together. This analyzes note content to create meaningful clusters using density-based clustering.",
        inputSchema: {
          type: "object",
          properties: {
            min_cluster_size: {
              type: "number",
              description: "Minimum number of notes required to form a cluster (default: 10)",
              default: 10
            },
            epsilon: {
              type: "number", 
              description: "Maximum distance between points in a cluster (default: 0.3, smaller = tighter clusters)",
              default: 0.3
            }
          },
          required: [],
        },
      },
      {
        name: "list-clusters",
        description: "List all note clusters with their labels, summaries, and note counts",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get-cluster-notes",
        description: "Get all notes belonging to a specific cluster",
        inputSchema: {
          type: "object",
          properties: {
            cluster_id: {
              type: "string",
              description: "ID of the cluster to retrieve notes from (use -1 for uncategorized notes)"
            }
          },
          required: ["cluster_id"],
        },
      },
      {
        name: "create-note",
        description:
          "Create a new Apple Note with specified title and content. Must be in HTML format WITHOUT newlines",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
      }
    ],
  };
});

const getNotes = async function* (maxNotes?: number) {
  console.log("   Requesting notes list from Apple Notes...");
  try {
    const BATCH_SIZE = 50; // Increased from 25 to 50 for faster note fetching
    let startIndex = 1;
    let hasMore = true;

    // Get total count or use the limit
    let totalCount: number;
    
    if (maxNotes) {
      totalCount = maxNotes;
      console.log(`   🎯 Using subset limit: ${totalCount} notes`);
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      totalCount = await Promise.race([
        runJxa(`
          const app = Application('Notes');
          app.includeStandardAdditions = true;
          return app.notes().length;
        `),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => 
            reject(new Error('Getting notes count timed out after 120s'))
          );
        })
      ]) as number;

      clearTimeout(timeout);
      console.log(`   📊 Total notes found: ${totalCount}`);
    }

    while (hasMore) {
      console.log(`   Fetching batch of notes (${startIndex} to ${startIndex + BATCH_SIZE - 1})...`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      const batchResult = await Promise.race([
        runJxa(`
          const app = Application('Notes');
          app.includeStandardAdditions = true;
          
          const titles = [];
          for (let i = ${startIndex}; i < ${startIndex + BATCH_SIZE}; i++) {
            try {
              const note = app.notes[i - 1];
              if (note) {
                titles.push(note.name());
              }
            } catch (error) {
              continue;
            }
          }
          return titles;
        `),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => 
            reject(new Error('Getting notes batch timed out after 120s'))
          );
        })
      ]);

      clearTimeout(timeout);
      
      const titles = batchResult as string[];
      
      // Yield the batch along with progress info
      yield {
        titles,
        progress: {
          current: startIndex + titles.length - 1,
          total: totalCount,
          batch: {
            start: startIndex,
            end: startIndex + BATCH_SIZE - 1
          }
        }
      };
      
      startIndex += BATCH_SIZE;
      hasMore = startIndex <= totalCount && titles.length > 0;

      await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 1000ms to 500ms
    }

  } catch (error) {
    console.error("   ❌ Error getting notes list:", error.message);
    throw new Error(`Failed to get notes list: ${error.message}`);
  }
};

// Update the existing getNoteDetailsByTitle to use the new function
const getNoteDetailsByTitle = async (title: string, creationDate?: string) => {
  // If creation date is provided, fetch that specific note
  if (creationDate) {
    const note = await getNoteByTitleAndDate(title, creationDate);
    if (!note) {
      throw new Error(`Note "${title}" with creation date "${creationDate}" not found`);
    }
    return note;
  }
  
  // Otherwise, find all notes with this title
  const notesWithTitle = await runJxa(`
    const app = Application('Notes');
    const targetTitle = "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";
    
    try {
      const matchingNotes = app.notes.whose({name: targetTitle});
      const results = [];
      
      for (let i = 0; i < matchingNotes.length; i++) {
        const note = matchingNotes[i];
        results.push({
          title: note.name(),
          creation_date: note.creationDate().toLocaleString()
        });
      }
      
      return JSON.stringify(results);
    } catch (error) {
      return "[]";
    }
  `);
  
  const matches = JSON.parse(notesWithTitle as string) as Array<{
    title: string;
    creation_date: string;
  }>;
  
  if (matches.length === 0) {
    throw new Error(`Note "${title}" not found`);
  }
  
  if (matches.length === 1) {
    // Single note, fetch it
    return await getNoteByTitleAndDate(matches[0].title, matches[0].creation_date);
  }
  
  // Multiple notes with same title - return info about all of them
  throw new Error(
    `Multiple notes found with title "${title}".\n` +
    `Found ${matches.length} notes with creation dates:\n` +
    matches.map((m, i) => `  ${i + 1}. Created: ${m.creation_date}`).join('\n') +
    `\n\nPlease specify the creation_date parameter to get a specific note.`
  );
};

// New helper function to get note by title AND creation date
const getNoteByTitleAndDate = async (title: string, creationDate: string) => {
  // Escape special characters in title and date
  const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedDate = creationDate.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  const note = await runJxa(`
    const app = Application('Notes');
    const targetTitle = "${escapedTitle}";
    const targetDate = "${escapedDate}";
    
    try {
      // Get all notes with matching title
      const matchingNotes = app.notes.whose({name: targetTitle});
      
      if (matchingNotes.length === 0) {
        return "{}";
      }
      
      // If only one note with this title, return it
      if (matchingNotes.length === 1) {
        const note = matchingNotes[0];
        return JSON.stringify({
          title: note.name(),
          content: note.body(),
          creation_date: note.creationDate().toLocaleString(),
          modification_date: note.modificationDate().toLocaleString()
        });
      }
      
      // Multiple notes with same title - find by creation date
      for (let i = 0; i < matchingNotes.length; i++) {
        const note = matchingNotes[i];
        const noteDate = note.creationDate().toLocaleString();
        
        if (noteDate === targetDate) {
          return JSON.stringify({
            title: note.name(),
            content: note.body(),
            creation_date: noteDate,
            modification_date: note.modificationDate().toLocaleString()
          });
        }
      }
      
      // Fallback: return first match if date doesn't match exactly
      // (date formatting might differ slightly)
      const note = matchingNotes[0];
      return JSON.stringify({
        title: note.name(),
        content: note.body(),
        creation_date: note.creationDate().toLocaleString(),
        modification_date: note.modificationDate().toLocaleString()
      });
      
    } catch (error) {
      console.log("Error fetching note: " + error.toString());
      return "{}";
    }
  `);

  const parsed = JSON.parse(note as string);
  
  // Return null if empty object (note not found)
  if (Object.keys(parsed).length === 0) {
    return null;
  }
  
  return parsed as {
    title: string;
    content: string;
    creation_date: string;
    modification_date: string;
  };
};

// Enhanced fetchAndIndexAllNotes function that fetches by title and creation date
export const fetchAndIndexAllNotes = async (notesTable: any, maxNotes?: number, mode: 'fresh' | 'incremental' = 'incremental') => {
  const start = performance.now();
  
  console.log(`Starting notes fetch and indexing${maxNotes ? ` (max: ${maxNotes} notes)` : ''} in ${mode} mode...`);
  
  // Step 1: First fetch all titles, creation dates, and modification dates
  console.log('\nStep 1: Fetching note titles, creation dates, and modification dates...');
  
  const noteTitlesData = await runJxa(`
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    
    const notes = app.notes();
    const totalCount = notes.length;
    const maxNotes = ${maxNotes || 'null'};
    const limitCount = maxNotes ? Math.min(totalCount, maxNotes) : totalCount;
    
    console.log("Found " + totalCount + " notes" + (maxNotes ? ", limiting to " + limitCount : ""));
    
    const noteTitles = [];
    
    for (let i = 0; i < limitCount; i++) {
      try {
        const note = notes[i];
        noteTitles.push({
          title: note.name(),
          creation_date: note.creationDate().toLocaleString(),
          modification_date: note.modificationDate().toLocaleString()
        });
        
        if ((i + 1) % 100 === 0) {
          console.log("Fetched titles: " + (i + 1) + "/" + limitCount);
        }
      } catch (error) {
        console.log("Error at index " + i + ": " + error.toString());
      }
    }
    
    return JSON.stringify(noteTitles);
  `);
  
  const noteTitles = JSON.parse(noteTitlesData as string) as Array<{
    title: string;
    creation_date: string;
    modification_date: string;
  }>;
  console.log(`Fetched ${noteTitles.length} note titles in ${((performance.now() - start)/1000).toFixed(1)}s`);
  
  // Step 2: Determine which notes to process based on mode
  let notesToProcess: NoteMetadata[] = noteTitles;
  let skippedCount = 0;
  
  if (mode === 'incremental') {
    console.log('\nStep 2: Comparing with cached notes to find changes...');
    
    const cachedNotes = await loadNotesCache();
    
    if (cachedNotes) {
      console.log(`📂 Found cache with ${cachedNotes.notes.length} notes from ${cachedNotes.last_sync}`);
      
      const { newNotes, modifiedNotes, unchangedNotes } = identifyChangedNotes(noteTitles, cachedNotes.notes);
      
      console.log(`📊 Change analysis:`);
      console.log(`  • New notes: ${newNotes.length}`);
      console.log(`  • Modified notes: ${modifiedNotes.length}`);
      console.log(`  • Unchanged notes: ${unchangedNotes.length}`);
      
      // Show details of new notes
      if (newNotes.length > 0) {
        console.log(`\n🆕 New notes detected:`);
        newNotes.slice(0, 10).forEach((note, idx) => {
          console.log(`  ${idx + 1}. "${note.title}" (created: ${note.creation_date}, modified: ${note.modification_date})`);
        });
        if (newNotes.length > 10) {
          console.log(`  ... and ${newNotes.length - 10} more new notes`);
        }
      }
      
      // Show details of modified notes
      if (modifiedNotes.length > 0) {
        console.log(`\n✏️ Modified notes detected:`);
        modifiedNotes.slice(0, 10).forEach((note, idx) => {
          const cached = cachedNotes.notes.find(c => c.title === note.title);
          console.log(`  ${idx + 1}. "${note.title}"`);
          console.log(`      Created: ${note.creation_date}`);
          console.log(`      Modified: ${cached?.modification_date} → ${note.modification_date}`);
        });
        if (modifiedNotes.length > 10) {
          console.log(`  ... and ${modifiedNotes.length - 10} more modified notes`);
        }
      }
      
      notesToProcess = [...newNotes, ...modifiedNotes];
      skippedCount = unchangedNotes.length;
      
      if (notesToProcess.length === 0) {
        console.log(`✨ No changes detected! All notes are up to date.`);
        // Still save the cache to update last_sync time
        await saveNotesCache(noteTitles);
        return { processed: 0, totalChunks: 0, failed: 0, skipped: skippedCount, timeSeconds: (performance.now() - start) / 1000 };
      }
      
      // Remove old chunks for modified notes from database
      if (modifiedNotes.length > 0) {
        console.log(`\n🗑️ Removing old chunks for ${modifiedNotes.length} modified notes...`);
        for (const modNote of modifiedNotes) {
          try {
            // Delete existing chunks for this note
            await notesTable.delete(`title = '${modNote.title.replace(/'/g, "''")}'`);
            console.log(`   ✅ Removed old chunks for "${modNote.title}"`);
          } catch (error) {
            console.log(`   ⚠️ Could not remove old chunks for "${modNote.title}": ${(error as Error).message}`);
          }
        }
      }
    } else {
      console.log(`📁 No cache found, processing all ${noteTitles.length} notes`);
    }
  } else {
    console.log(`\nStep 2: Fresh mode - processing all ${noteTitles.length} notes`);
  }
  
  // Step 3: Fetch content for notes that need processing
  console.log(`\nStep 3: Fetching full note content for ${notesToProcess.length} notes...`);
  
  const allNotes: Array<{
    title: string;
    content: string;
    creation_date: string;
    modification_date: string;
  }> = [];
  
  let fetchProgress = 0;
  const batchSize = 50; // Process in batches for better performance
  
  for (let i = 0; i < notesToProcess.length; i += batchSize) {
    const batch = notesToProcess.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(notesToProcess.length / batchSize);
    
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} notes):`);
    
    // Fetch batch in parallel
    const batchResults = await Promise.all(
      batch.map(async ({ title, creation_date, modification_date }, index) => {
        try {
          console.log(`   📄 [${batchNum}.${index + 1}] Fetching: "${title}"`);
          console.log(`       Created: ${creation_date}`);
          console.log(`       Modified: ${modification_date}`);
          const result = await getNoteByTitleAndDate(title, creation_date);
          if (result) {
            console.log(`   ✅ [${batchNum}.${index + 1}] Success: "${title}"`);
            return {
              title: result.title,
              content: result.content,
              creation_date: result.creation_date,
              modification_date: modification_date // Use the fresh modification date
            };
          } else {
            console.log(`   ⚠️ [${batchNum}.${index + 1}] Empty result: "${title}"`);
          }
          return null;
        } catch (error) {
          console.log(`   ❌ [${batchNum}.${index + 1}] Failed: "${title}" - ${(error as Error).message}`);
          return null;
        }
      })
    );
    
    // Add successful fetches to allNotes
    batchResults.forEach(note => {
      if (note) {
        allNotes.push(note);
      }
    });
    
    fetchProgress += batch.length;
    console.log(`📊 Batch ${batchNum} complete: ${batchResults.filter(r => r !== null).length}/${batch.length} successful`);
    
    if (fetchProgress % 100 === 0 || fetchProgress === notesToProcess.length) {
      console.log(`🎯 Overall progress: ${fetchProgress}/${notesToProcess.length} notes processed`);
    }
  }
  
  console.log(`Fetched ${allNotes.length} complete notes in ${((performance.now() - start)/1000).toFixed(1)}s`);
  
  // Step 4: Process into chunks and add to database
  console.log(`\nStep 4: Processing notes into chunks...`);
  
  let totalChunks = 0;
  let processed = 0;
  let failed = 0;
  const allChunks: ChunkData[] = [];
  
  for (const note of allNotes) {
    try {
      console.log(`📝 [${processed + 1}/${allNotes.length}] Chunking: "${note.title}"`);
      
      const plainText = htmlToPlainText(note.content || "");
      const fullText = `${note.title}\n\n${plainText}`;
      const chunks = await createChunks(fullText);
      
      console.log(`   ✂️ Created ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} for "${note.title}"`);
      
      chunks.forEach((chunkContent, index) => {
        allChunks.push({
          title: note.title,
          content: plainText,
          creation_date: note.creation_date,
          modification_date: note.modification_date,
          chunk_index: index.toString(),
          total_chunks: chunks.length.toString(),
          chunk_content: chunkContent,
          // Initialize cluster fields as empty - will be populated when clustering is run
          cluster_id: "",
          cluster_label: "",
          cluster_confidence: "",
          cluster_summary: "",
          last_clustered: "",
        });
      });
      
      totalChunks += chunks.length;
      processed++;
      
      if (processed % 5 === 0 || processed === allNotes.length) {
        console.log(`📊 Chunking progress: ${processed}/${allNotes.length} notes → ${totalChunks} total chunks`);
      }
    } catch (error) {
      failed++;
      console.log(`❌ [${processed + 1}/${allNotes.length}] Failed to chunk "${note.title}": ${(error as Error).message}`);
    }
  }
  
  // Step 5: Add to database in batches
  const DB_BATCH_SIZE = 100;
  
  console.log(`\nStep 5: Adding ${allChunks.length} chunks to database...`);
  console.log(`💡 Using batch size of ${DB_BATCH_SIZE} chunks per database write for optimal performance.`);
  
  const totalBatches = Math.ceil(allChunks.length / DB_BATCH_SIZE);
  let totalWritten = 0;
  
  for (let i = 0; i < allChunks.length; i += DB_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + DB_BATCH_SIZE);
    const batchNum = Math.floor(i / DB_BATCH_SIZE) + 1;
    
    console.log(`💾 [${batchNum}/${totalBatches}] Writing batch of ${batch.length} chunks to database...`);
    
    try {
      await notesTable.add(batch);
      
      // Verify the write by counting rows immediately after
      const currentRowCount = await notesTable.countRows();
      console.log(`🔍 [${batchNum}/${totalBatches}] Database now has ${currentRowCount} total rows`);
      
      totalWritten += batch.length;
      const progress = Math.min(i + DB_BATCH_SIZE, allChunks.length);
      console.log(`✅ [${batchNum}/${totalBatches}] Written ${progress}/${allChunks.length} chunks`);
      
    } catch (error) {
      console.error(`❌ [${batchNum}/${totalBatches}] Failed to write batch:`, error);
      throw error; // Re-throw to stop the process
    }
    
    if ((i + DB_BATCH_SIZE) % 1000 === 0) {
      console.log(`🎯 Major checkpoint: ${i + DB_BATCH_SIZE}/${allChunks.length} chunks written to database`);
    }
  }
  
  // Final verification
  const finalRowCount = await notesTable.countRows();
  console.log(`\n🔍 Final verification: Database has ${finalRowCount} rows (expected ${allChunks.length})`);
  
  if (finalRowCount !== allChunks.length) {
    console.error(`❌ DATABASE WRITE VERIFICATION FAILED!`);
    console.error(`   Expected: ${allChunks.length} chunks`);
    console.error(`   Actual: ${finalRowCount} chunks`);
    console.error(`   Missing: ${allChunks.length - finalRowCount} chunks`);
    throw new Error(`Database write verification failed: ${finalRowCount}/${allChunks.length} chunks persisted`);
  } else {
    console.log(`✅ Database write verification successful: All ${finalRowCount} chunks persisted`);
  }
  
  // Step 6: Save updated cache
  console.log(`\nStep 6: Updating notes cache...`);
  await saveNotesCache(noteTitles);
  
  const totalTime = (performance.now() - start) / 1000;
  
  console.log(`\n✨ Complete! ${processed} notes → ${totalChunks} chunks in ${totalTime.toFixed(1)}s`);
  if (skippedCount > 0) {
    console.log(`⏩ Skipped ${skippedCount} unchanged notes (incremental mode)`);
  }
  
  return { processed, totalChunks, failed, skipped: skippedCount, timeSeconds: totalTime };
};

// Helper function to create FTS index on chunk_content
const createFTSIndex = async (notesTable: any) => {
  try {
    const indices = await notesTable.listIndices();
    if (!indices.find((index) => index.name === "chunk_content_idx")) {
      await notesTable.createIndex("chunk_content", {
        config: lancedb.Index.fts(),
        replace: true,
      });
      console.log(`✅ Created FTS index on chunk_content`);
    }
  } catch (error) {
    console.log(`⚠️ FTS index creation failed: ${error.message}`);
  }
};

// Replace your createNotesTable function with this smart version:
export const createNotesTableSmart = async (overrideName?: string, mode: 'fresh' | 'incremental' = 'incremental') => {
  const start = performance.now();
  const tableName = overrideName || "notes";
  
  if (mode === 'fresh') {
    // Fresh start - drop and recreate
    try {
      await db.dropTable(tableName);
      console.log(`🗑️ Dropped existing '${tableName}' table for fresh start`);
    } catch (error) {
      console.log(`ℹ️ No existing table to drop`);
    }
    
    const notesTable = await db.createEmptyTable(
      tableName,
      notesTableSchema,
      { mode: "create", existOk: false }
    );
    
    console.log(`✅ Created fresh '${tableName}' table`);
    await createFTSIndex(notesTable);
    return { notesTable, existingNotes: new Map(), time: performance.now() - start };
  } else {
    // Incremental mode - smart updates
    let notesTable;
    let existingNotes = new Map();
    
    try {
      notesTable = await db.openTable(tableName);
      console.log(`📂 Opened existing '${tableName}' table`);
      
      // Load existing notes for comparison
      console.log(`🔍 Loading existing notes for deduplication...`);
      const existing = await notesTable.search("").limit(50000).toArray();
      
      // Create map: title -> {modification_date, id}
      existing.forEach(note => {
        if (note.title) {
          existingNotes.set(note.title, {
            modification_date: note.modification_date,
            // Store the row for potential deletion
            row: note
          });
        }
      });
      
      console.log(`📊 Found ${existingNotes.size} existing notes for comparison`);
      
    } catch (error) {
      // Table doesn't exist, create it
      notesTable = await db.createEmptyTable(
        tableName,
        notesTableSchema,
        { mode: "create", existOk: false }
      );
      console.log(`✅ Created new '${tableName}' table`);
    }
    
    await createFTSIndex(notesTable);
    return { notesTable, existingNotes, time: performance.now() - start };
  }
};

export const createNotesTable = async (overrideName?: string) => {
  // Use the smart version with incremental mode by default
  return await createNotesTableSmart(overrideName, 'incremental');
};

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request, c) => {
  const { notesTable } = await createNotesTable();
  const { name, arguments: args } = request.params;

  try {
    if (name === "create-note") {
      // Remove createNote functionality since it's not needed
      return createTextResponse(`Create note functionality not implemented.`);
    } else if (name === "list-notes") {
      const totalChunks = await notesTable.countRows();
      // Get unique note titles to count actual notes
      const allChunks = await notesTable.search("").limit(50000).toArray();
      const uniqueNotes = new Set(allChunks.map(chunk => chunk.title));
      return createTextResponse(
        `There are ${uniqueNotes.size} notes (${totalChunks} chunks) in your Apple Notes database.`
      );
    } else if (name == "get-note") {
      try {
        const { title, creation_date } = GetNoteSchema.parse(args);
        const note = await getNoteDetailsByTitle(title, creation_date);

        return createTextResponse(`${JSON.stringify(note, null, 2)}`);
      } catch (error) {
        return createTextResponse(error.message);
      }
    } else if (name === "index-notes") {
      // Use the enhanced method by default for better reliability
      const { mode } = IndexNotesSchema.parse(args);
      const { processed, totalChunks, failed, skipped, timeSeconds } = await fetchAndIndexAllNotes(notesTable, undefined, mode);
      
      let message = `Successfully indexed ${processed} notes into ${totalChunks} chunks in ${timeSeconds.toFixed(1)}s using enhanced method.\n\n` +
        `📊 Summary:\n` +
        `• Notes processed: ${processed}\n` +
        `• Chunks created: ${totalChunks}\n` +
        `• Failed: ${failed}\n`;
      
      if (skipped > 0) {
        message += `• Skipped unchanged: ${skipped}\n`;
      }
      
      message += `• Average chunks per note: ${processed > 0 ? (totalChunks/processed).toFixed(1) : '0'}\n` +
        `• Processing time: ${timeSeconds.toFixed(1)} seconds\n` +
        `• Mode: ${mode}\n\n` +
        `✨ Enhanced indexing handles duplicate titles better by using creation dates!\n`;
      
      if (mode === 'incremental' && skipped > 0) {
        message += `⚡ Incremental mode: Only processed new/modified notes. ${skipped} notes unchanged.\n`;
      }
      
      message += `Your notes are now ready for semantic search using the "search-notes" tool!`;
      
      return createTextResponse(message);
    } else if (name === "cluster-notes") {
      // Run DBSCAN clustering on all notes
      const { min_cluster_size, epsilon } = ClusterNotesSchema.parse(args);
      
      try {
        const result = await clusterNotes(notesTable, min_cluster_size, epsilon);
        
        let message = `Successfully clustered ${result.totalNotes} notes in ${result.timeSeconds.toFixed(1)}s!\n\n`;
        message += `📊 Clustering Results:\n`;
        message += `• Total clusters: ${result.totalClusters}\n`;
        message += `• Uncategorized notes: ${result.outliers}\n`;
        message += `• Parameters: min_cluster_size=${min_cluster_size}, epsilon=${epsilon}\n\n`;
        
        if (result.clusterSizes.length > 0) {
          message += `🏷️ Top clusters by size:\n`;
          result.clusterSizes.slice(0, 10).forEach((cluster, idx) => {
            message += `  ${idx + 1}. "${cluster.label}" (${cluster.size} notes)\n`;
          });
          
          if (result.clusterSizes.length > 10) {
            message += `  ... and ${result.clusterSizes.length - 10} more clusters\n`;
          }
        }
        
        message += `\n✨ Use "list-clusters" to see all clusters or "get-cluster-notes" to explore specific clusters!`;
        
        return createTextResponse(message);
      } catch (error) {
        return createTextResponse(`Clustering failed: ${(error as Error).message}`);
      }
    } else if (name === "list-clusters") {
      // List all clusters with summaries
      try {
        const clusters = await listClusters(notesTable);
        
        if (clusters.length === 0) {
          return createTextResponse("No clusters found. Run 'cluster-notes' first to create clusters.");
        }
        
        let message = `📂 Found ${clusters.length} clusters:\n\n`;
        
        clusters.forEach((cluster, idx) => {
          const isOutlier = cluster.cluster_id === '-1';
          const emoji = isOutlier ? '📌' : '📁';
          
          message += `${emoji} ${idx + 1}. ${cluster.cluster_label} (ID: ${cluster.cluster_id})\n`;
          message += `   📊 ${cluster.note_count} notes\n`;
          if (cluster.cluster_summary) {
            message += `   📝 ${cluster.cluster_summary}\n`;
          }
          message += '\n';
        });
        
        message += `💡 Use "get-cluster-notes" with a cluster_id to see all notes in a specific cluster.`;
        
        return createTextResponse(message);
      } catch (error) {
        return createTextResponse(`Failed to list clusters: ${(error as Error).message}`);
      }
    } else if (name === "get-cluster-notes") {
      // Get all notes in a specific cluster
      const { cluster_id } = GetClusterSchema.parse(args);
      
      try {
        const notes = await getNotesInCluster(notesTable, cluster_id);
        
        if (notes.length === 0) {
          return createTextResponse(`No notes found in cluster "${cluster_id}". Use "list-clusters" to see available clusters.`);
        }
        
        const clusterInfo = notes[0]; // All notes in cluster have same cluster info
        
        let message = `📁 Cluster: ${clusterInfo.cluster_label} (ID: ${cluster_id})\n`;
        message += `📝 ${clusterInfo.cluster_summary}\n`;
        message += `📊 ${notes.length} notes in this cluster:\n\n`;
        
        notes.forEach((note, idx) => {
          message += `${idx + 1}. "${note.title}"\n`;
          message += `   📅 Created: ${note.creation_date}\n`;
          message += `   ✏️ Modified: ${note.modification_date}\n`;
          message += `   📄 ${note.total_chunks} chunks\n\n`;
        });
        
        message += `💡 Use "get-note" with a title to see the full content of any note.`;
        
        return createTextResponse(message);
      } catch (error) {
        return createTextResponse(`Failed to get cluster notes: ${(error as Error).message}`);
      }
    } else if (name === "index-notes-enhanced") {
      const { processed, totalChunks, failed, timeSeconds } = await fetchAndIndexAllNotes(notesTable);
      return createTextResponse(
        `Successfully indexed ${processed} notes into ${totalChunks} chunks in ${timeSeconds.toFixed(1)}s using enhanced method.\n\n` +
        `📊 Summary:\n` +
        `• Notes processed: ${processed}\n` +
        `• Chunks created: ${totalChunks}\n` +
        `• Failed: ${failed}\n` +
        `• Average chunks per note: ${(totalChunks/processed).toFixed(1)}\n` +
        `• Processing time: ${timeSeconds.toFixed(1)} seconds\n\n` +
        `✨ Enhanced indexing handles duplicate titles better by using creation dates!\n` +
        `Your notes are now ready for semantic search using the "search-notes" tool!`
      );
    } else if (name === "search-notes") {
      const { query } = QueryNotesSchema.parse(args);
      const combinedResults = await searchAndCombineResults(notesTable, query);
      return createTextResponse(JSON.stringify(combinedResults, null, 2));
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    throw error;
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Local Machine MCP Server running on stdio");

const createTextResponse = (text: string) => ({
  content: [{ type: "text", text }],
});

/**
 * Enhanced search relying purely on semantic content analysis
 */
export const searchAndCombineResults = async (
  notesTable: lancedb.Table,
  query: string,
  displayLimit = 5,
  minCosineSimilarity = 0.05
) => {
  console.log(`🔍 Semantic search for: "${query}"`);
  console.log(`📊 Table has ${await notesTable.countRows()} chunks`);
  
  const noteResults = new Map(); // title -> best result for that note
  
  // Strategy 1: Vector search on chunks
  console.log(`\n1️⃣ Vector semantic search on chunks...`);
  try {
    const vectorResults = await notesTable.search(query, "vector").toArray();
    
    if (vectorResults.length > 0) {
      console.log(`🎯 Found ${vectorResults.length} relevant chunks`);
      
      vectorResults.forEach(chunk => {
        const distance = chunk._distance || 0;
        const cosineSimilarity = Math.max(0, 1 - (distance * distance / 2));
        
        if (cosineSimilarity > minCosineSimilarity) {
          const existing = noteResults.get(chunk.title);
          
          if (!existing || cosineSimilarity > existing._relevance_score) {
            noteResults.set(chunk.title, {
              title: chunk.title,
              content: chunk.content,
              creation_date: chunk.creation_date,
              modification_date: chunk.modification_date,
              _relevance_score: cosineSimilarity * 100,
              _source: 'vector_semantic',
              _best_chunk_index: chunk.chunk_index,
              _total_chunks: chunk.total_chunks,
              _matching_chunk_content: chunk.chunk_content
            });
          }
        }
      });
      
      console.log(`📋 Unique notes from vector search: ${noteResults.size}`);
    }
  } catch (error) {
    console.log(`❌ Vector Error: ${error.message}`);
  }
  
  // Strategy 2: FTS search on chunk content
  console.log(`\n2️⃣ Full-text search on chunks...`);
  try {
    const ftsResults = await notesTable.search(query, "fts", "chunk_content").toArray();

    // Compute query embedding once for all FTS results
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await func.computeQueryEmbeddings(query);
    } catch (e) {
      console.log(`⚠️ Could not compute query embedding for FTS scoring: ${e.message}`);
    }

    // Helper to compute cosine similarity
    const cosineSimilarity = (a: number[], b: number[]) => {
      if (!a || !b || a.length !== b.length) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      if (normA === 0 || normB === 0) return 0;
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    ftsResults.forEach(chunk => {
      if (!noteResults.has(chunk.title)) {
        let score = 70; // fallback
        if (queryEmbedding && Array.isArray(chunk.vector) && chunk.vector.length === queryEmbedding.length) {
          score = Math.max(0, cosineSimilarity(queryEmbedding, chunk.vector)) * 100;
        }
        noteResults.set(chunk.title, {
          title: chunk.title,
          content: chunk.content,
          creation_date: chunk.creation_date,
          modification_date: chunk.modification_date,
          _relevance_score: score,
          _source: 'fts',
          _best_chunk_index: chunk.chunk_index,
          _total_chunks: chunk.total_chunks,
          _matching_chunk_content: chunk.chunk_content
        });
      }
    });

    console.log(`📝 FTS results: ${ftsResults.length} chunks`);
  } catch (error) {
    console.log(`❌ FTS Error: ${error.message}`);
  }
  
  // Strategy 3: Database-level exact phrase matching (much more efficient)
  console.log(`\n3️⃣ Database-level exact phrase search...`);
  try {
    // Use SQL-like filtering instead of loading all chunks
    const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    
    if (queryWords.length > 0) {
      // Search for chunks that contain all query words
      const sqlFilter = `LOWER(chunk_content) LIKE '%${queryWords.join("%' AND LOWER(chunk_content) LIKE '%")}%'`;
      
      const exactMatches = await notesTable
        .search("")
        .where(sqlFilter)
        .limit(100)
        .toArray();
      
      console.log(`📋 Database exact matches: ${exactMatches.length} chunks`);
      
      exactMatches.forEach(chunk => {
        if (!noteResults.has(chunk.title)) {
          // Check if it's a real exact match (for better scoring)
          const isExactMatch = chunk.chunk_content?.toLowerCase().includes(query.toLowerCase()) ||
                              chunk.title?.toLowerCase().includes(query.toLowerCase());
          
          noteResults.set(chunk.title, {
            title: chunk.title,
            content: chunk.content,
            creation_date: chunk.creation_date,
            modification_date: chunk.modification_date,
            _relevance_score: isExactMatch ? 100 : 85,
            _source: isExactMatch ? 'exact_match' : 'partial_match',
            _best_chunk_index: chunk.chunk_index,
            _total_chunks: chunk.total_chunks,
            _matching_chunk_content: chunk.chunk_content
          });
        }
      });
    }
  } catch (error) {
    console.log(`❌ Database search error: ${error.message}`);
    // Fallback: try a simpler approach
    console.log(`🔄 Trying fallback search...`);
    try {
      const fallbackResults = await notesTable
        .search("")
        .limit(1000) // Much smaller limit
        .toArray();
      
      const queryRegex = new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      
      const matches = fallbackResults.filter(chunk => {
        const titleMatch = queryRegex.test(chunk.title || '');
        const contentMatch = queryRegex.test(chunk.chunk_content || '');
        return titleMatch || contentMatch;
      });
      
      console.log(`📋 Fallback matches: ${matches.length} chunks`);
      
      matches.forEach(chunk => {
        if (!noteResults.has(chunk.title)) {
          noteResults.set(chunk.title, {
            title: chunk.title,
            content: chunk.content,
            creation_date: chunk.creation_date,
            modification_date: chunk.modification_date,
            _relevance_score: 90,
            _source: 'fallback_exact',
            _best_chunk_index: chunk.chunk_index,
            _total_chunks: chunk.total_chunks,
            _matching_chunk_content: chunk.chunk_content
          });
        }
      });
    } catch (fallbackError) {
      console.log(`❌ Fallback also failed: ${fallbackError.message}`);
    }
  }
  
  // Combine and rank results
  const combinedResults = Array.from(noteResults.values())
    .sort((a, b) => b._relevance_score - a._relevance_score);

  console.log(`\n📊 Final results: ${combinedResults.length} notes (from ${noteResults.size} total matches)`);

  if (combinedResults.length > 0) {
    combinedResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. "${result.title}" (score: ${result._relevance_score.toFixed(1)}, source: ${result._source}, chunk: ${result._best_chunk_index}/${result._total_chunks})`);
    });
  }

  return combinedResults.map(result => ({
    title: result.title,
    creation_date: result.creation_date,
    modification_date: result.modification_date,
    _relevance_score: result._relevance_score,
    _source: result._source,
    _best_chunk_index: result._best_chunk_index,
    _total_chunks: result._total_chunks,
    _matching_chunk_preview: result._matching_chunk_content
  }));
};