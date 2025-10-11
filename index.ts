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
// Remove TurndownService import
import {
  EmbeddingFunction,
  LanceSchema,
  register,
} from "@lancedb/lancedb/embedding";
import { type Float, Float32, Utf8 } from "apache-arrow";
import { pipeline } from "@huggingface/transformers";

// Remove the turndown instance
const db = await lancedb.connect(
  path.join(os.homedir(), ".mcp-apple-notes", "data")
);

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

// Updated schema to include chunk information - fix the embedding field
const notesTableSchema = LanceSchema({
  title: new Utf8(), // Regular field, not for embedding
  content: new Utf8(), // Regular field, not for embedding  
  creation_date: new Utf8(), // Regular field
  modification_date: new Utf8(), // Regular field
  chunk_index: new Utf8(), // Regular field
  total_chunks: new Utf8(), // Regular field
  chunk_content: func.sourceField(new Utf8()), // This is the field that gets embedded
  vector: func.vectorField(), // This stores the embeddings
});

const QueryNotesSchema = z.object({
  query: z.string(),
});

const GetNoteSchema = z.object({
  title: z.string(),
  creation_date: z.string().optional(),
});

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
          "Index all my Apple Notes for Semantic Search using enhanced method that handles duplicate note titles better. Please tell the user that the sync takes couple of seconds up to couple of minutes depending on how many notes you have.",
        inputSchema: {
          type: "object",
          properties: {},
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
      // Remove create-note tool since it's not needed
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
export const fetchAndIndexAllNotes = async (notesTable: any, maxNotes?: number) => {
  const start = performance.now();
  
  console.log(`Starting full notes fetch and indexing${maxNotes ? ` (max: ${maxNotes} notes)` : ''}...`);
  
  // Step 1: First fetch all titles and creation dates
  console.log('\nStep 1: Fetching note titles and creation dates...');
  
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
          creation_date: note.creationDate().toLocaleString()
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
  }>;
  console.log(`Fetched ${noteTitles.length} note titles in ${((performance.now() - start)/1000).toFixed(1)}s`);
  
  // Step 2: Fetch each note by title AND creation date
  console.log('\nStep 2: Fetching full note content by title and creation date...');
  
  const allNotes: Array<{
    title: string;
    content: string;
    creation_date: string;
    modification_date: string;
  }> = [];
  
  let fetchProgress = 0;
  const batchSize = 50; // Process in batches for better performance
  
  for (let i = 0; i < noteTitles.length; i += batchSize) {
    const batch = noteTitles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(noteTitles.length / batchSize);
    
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} notes):`);
    
    // Fetch batch in parallel
    const batchResults = await Promise.all(
      batch.map(async ({ title, creation_date }, index) => {
        try {
          console.log(`   📄 [${batchNum}.${index + 1}] Fetching: "${title}" (${creation_date})`);
          const result = await getNoteByTitleAndDate(title, creation_date);
          if (result) {
            console.log(`   ✅ [${batchNum}.${index + 1}] Success: "${title}"`);
          } else {
            console.log(`   ⚠️ [${batchNum}.${index + 1}] Empty result: "${title}"`);
          }
          return result;
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
    
    if (fetchProgress % 100 === 0 || fetchProgress === noteTitles.length) {
      console.log(`🎯 Overall progress: ${fetchProgress}/${noteTitles.length} notes processed`);
    }
  }
  
  console.log(`Fetched ${allNotes.length} complete notes in ${((performance.now() - start)/1000).toFixed(1)}s`);
  
  // Step 3: Process into chunks and add to database
  console.log('\nStep 3: Processing notes into chunks...');
  
  let totalChunks = 0;
  let processed = 0;
  let failed = 0;
  const allChunks: Array<{
    title: string;
    content: string;
    creation_date: string;
    modification_date: string;
    chunk_index: string;
    total_chunks: string;
    chunk_content: string;
  }> = [];
  
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
  
  // Step 4: Add to database in batches
  const DB_BATCH_SIZE = 100;
  
  console.log(`\nStep 4: Adding ${allChunks.length} chunks to database...`);
  console.log(`💡 Using batch size of ${DB_BATCH_SIZE} chunks per database write for optimal performance.`);
  
  const totalBatches = Math.ceil(allChunks.length / DB_BATCH_SIZE);
  
  for (let i = 0; i < allChunks.length; i += DB_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + DB_BATCH_SIZE);
    const batchNum = Math.floor(i / DB_BATCH_SIZE) + 1;
    
    console.log(`💾 [${batchNum}/${totalBatches}] Writing batch of ${batch.length} chunks to database...`);
    
    await notesTable.add(batch);
    
    const progress = Math.min(i + DB_BATCH_SIZE, allChunks.length);
    console.log(`✅ [${batchNum}/${totalBatches}] Written ${progress}/${allChunks.length} chunks`);
    
    if ((i + DB_BATCH_SIZE) % 1000 === 0) {
      console.log(`🎯 Major checkpoint: ${i + DB_BATCH_SIZE}/${allChunks.length} chunks written to database`);
    }
  }
  
  const totalTime = (performance.now() - start) / 1000;
  
  console.log(`\nComplete! ${processed} notes → ${totalChunks} chunks in ${totalTime.toFixed(1)}s`);
  
  return { processed, totalChunks, failed, timeSeconds: totalTime };
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