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

// Enhanced chunking function with token awareness
const createChunks = async (text: string, maxTokens = CHUNK_SIZE, overlap = CHUNK_OVERLAP): Promise<string[]> => {
  if (!text || text.trim().length === 0) {
    return [''];
  }
  
  try {
    // Tokenize the full text
    const tokens = await tokenizer(text);
    const tokenIds = Array.from(tokens.input_ids.data);
    
    if (tokenIds.length <= maxTokens) {
      // Text fits in one chunk
      return [text];
    }
    
    const chunks: string[] = [];
    let start = 0;
    
    while (start < tokenIds.length) {
      const end = Math.min(start + maxTokens, tokenIds.length);
      const chunkTokens = tokenIds.slice(start, end);
      
      // Decode tokens back to text
      const chunkText = tokenizer.decode(chunkTokens, { skip_special_tokens: true });
      
      // Clean up the chunk text
      const cleanedChunk = chunkText.trim();
      if (cleanedChunk.length > 0) {
        chunks.push(cleanedChunk);
      }
      
      // Move start position considering overlap
      start = end - overlap;
      
      // Safety check to prevent infinite loop
      if (start >= tokenIds.length - overlap) {
        break;
      }
    }
    
    return chunks.length > 0 ? chunks : [text.substring(0, 1000)]; // Fallback
  } catch (error) {
    console.log(`⚠️ Tokenization error, falling back to character-based chunking: ${error.message}`);
    
    // Fallback to character-based chunking (approximately 4 chars per token)
    const approxChunkSize = maxTokens * 4;
    const approxOverlap = overlap * 4;
    
    if (text.length <= approxChunkSize) {
      return [text];
    }
    
    const chunks: string[] = [];
    let start = 0;
    
    while (start < text.length) {
      const end = Math.min(start + approxChunkSize, text.length);
      const chunk = text.substring(start, end);
      
      if (chunk.trim().length > 0) {
        chunks.push(chunk.trim());
      }
      
      start = end - approxOverlap;
      
      if (start >= text.length - approxOverlap) {
        break;
      }
    }
    
    return chunks.length > 0 ? chunks : [text.substring(0, 1000)];
  }
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
    return await Promise.all(
      data.map(async (item) => {
        const cleanedItem = this.cleanText(item);
        const output = await extractor(cleanedItem, { 
          pooling: "mean", 
          normalize: true // Critical for proper similarity calculation
        });
        return output.data as number[];
      })
    );
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
          "Index all my Apple Notes for Semantic Search. Please tell the user that the sync takes couple of seconds up to couple of minutes depending on how many notes you have.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get-note",
        description: "Get a note full content and details by title",
        inputSchema: {
          type: "object",
          properties: {
            title: z.string(),
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
    const BATCH_SIZE = 25;
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

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error("   ❌ Error getting notes list:", error.message);
    throw new Error(`Failed to get notes list: ${error.message}`);
  }
};

const getNoteDetailsByTitle = async (title: string) => {
  const note = await runJxa(
    `const app = Application('Notes');
    const title = "${title}"
    
    try {
        const note = app.notes.whose({name: title})[0];
        
        const noteInfo = {
            title: note.name(),
            content: note.body(),
            creation_date: note.creationDate().toLocaleString(),
            modification_date: note.modificationDate().toLocaleString()
        };
        
        return JSON.stringify(noteInfo);
    } catch (error) {
        return "{}";
    }`
  );

  return JSON.parse(note as string) as {
    title: string;
    content: string;
    creation_date: string;
    modification_date: string;
  };
};

// Update the indexNotes function to use the new converter
// Update indexNotes to accept a limit parameter

// Optimized version of indexNotes for faster processing
export const indexNotes = async (
  notesTable: any,
  maxNotes?: number,
  deps = {
    getNotes,
    getNoteDetailsByTitle
  }
) => {
  const start = performance.now();
  let report = "";
  let processed = 0;
  let successful = 0;
  let failed = 0;
  let totalChunks = 0;
  let allNotes: string[] = [];
  
  console.log(`📚 Getting and processing notes with chunking${maxNotes ? ` (max: ${maxNotes})` : ''}...`);
  
  for await (const batch of deps.getNotes(maxNotes)) {
    allNotes = [...allNotes, ...batch.titles];
    console.log(`\n📦 Processing batch of ${batch.titles.length} notes (${batch.progress.current}/${batch.progress.total})`);
    
    // Process notes in parallel batches
    const PARALLEL_BATCH_SIZE = 5;
    const batchResults = [];
    
    for (let i = 0; i < batch.titles.length; i += PARALLEL_BATCH_SIZE) {
      const parallelBatch = batch.titles.slice(i, i + PARALLEL_BATCH_SIZE);
      console.log(`   🔍 Processing ${parallelBatch.length} notes in parallel...`);
      
      const parallelResults = await Promise.allSettled(
        parallelBatch.map(async (note) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);
          
          try {
            const result = await Promise.race([
              deps.getNoteDetailsByTitle(note),
              new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => 
                  reject(new Error('Note processing timed out after 60s'))
                );
              })
            ]);
            clearTimeout(timeout);
            return result;
          } catch (error) {
            clearTimeout(timeout);
            throw error;
          }
        })
      );
      
      // Process results and create chunks
      for (let idx = 0; idx < parallelResults.length; idx++) {
        const result = parallelResults[idx];
        const note = parallelBatch[idx];
        
        if (result.status === 'fulfilled') {
          processed++;
          successful++;
          batchResults.push(result.value);
          console.log(`   ✅ Note "${note}" processed successfully`);
        } else {
          failed++;
          console.log(`   ❌ Failed to process note "${note}": ${result.reason?.message}`);
          report += `Error processing note "${note}": ${result.reason?.message}\n`;
        }
      }
      
      if (i + PARALLEL_BATCH_SIZE < batch.titles.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    console.log("📥 Converting batch to plain text and creating chunks...");
    
    const notesWithTitle = batchResults.filter((n) => n.title);
    console.log(`   🔍 After title filter: ${batchResults.length} -> ${notesWithTitle.length} notes`);
    
    const allChunks = [];
    
    for (const note of notesWithTitle) {
      try {
        const plainTextContent = htmlToPlainText(note.content || "");
        const fullText = `${note.title}\n\n${plainTextContent}`;
        
        // Create chunks from the full text
        const chunks = await createChunks(fullText);
        console.log(`   📄 "${note.title}": ${chunks.length} chunks created`);
        
        // Create chunk records
        chunks.forEach((chunkContent, index) => {
          allChunks.push({
            title: note.title,
            content: plainTextContent, // Keep full content for reference
            creation_date: note.creation_date,
            modification_date: note.modification_date,
            chunk_index: index.toString(),
            total_chunks: chunks.length.toString(),
            chunk_content: chunkContent, // This is what gets embedded
          });
        });
        
        totalChunks += chunks.length;
        
      } catch (error) {
        console.log(`   ❌ Error processing note "${note.title}": ${error.message}`);
        report += `Error processing note "${note.title}": ${error.message}\n`;
        failed++;
        successful--;
      }
    }

    if (allChunks.length > 0) {
      console.log(`💾 Adding ${allChunks.length} chunks to database...`);
      try {
        await notesTable.add(allChunks);
        console.log(`✅ Successfully added ${allChunks.length} chunks from ${notesWithTitle.length} notes`);
      } catch (error) {
        console.log(`   ❌ Database error: ${error.message}`);
        report += `Error adding chunks to database: ${error.message}\n`;
        failed += notesWithTitle.length;
        successful -= notesWithTitle.length;
      }
    }
  }

  return {
    chunks: totalChunks,
    notes: successful,
    failed,
    report,
    allNotes: allNotes.length,
    time: performance.now() - start,
  };
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

// Smart indexing with updates
export const indexNotesIncremental = async (
  notesTable: any,
  existingNotes: Map<string, any>,
  maxNotes?: number,
  deps = { getNotes, getNoteDetailsByTitle }
) => {
  const start = performance.now();
  let report = "";
  let processed = 0;
  let successful = 0;
  let failed = 0;
  let updated = 0;
  let added = 0;
  let skipped = 0;
  let totalChunks = 0;
  let allNotes: string[] = [];
  
  const isFreshMode = existingNotes.size === 0;
  console.log(`📚 Smart indexing${maxNotes ? ` (max: ${maxNotes})` : ''} with update detection...`);
  if (isFreshMode) {
    console.log(`🆕 Fresh mode detected - all notes will be processed as new`);
  }
  
  for await (const batch of deps.getNotes(maxNotes)) {
    allNotes = [...allNotes, ...batch.titles];
    console.log(`\n📦 Processing batch of ${batch.titles.length} notes (${batch.progress.current}/${batch.progress.total})`);
    
    // First pass: quick check which notes need processing
    const notesToProcess = [];
    const notesToSkip = [];
    
    for (const noteTitle of batch.titles) {
      if (isFreshMode) {
        // In fresh mode, process all notes as new
        notesToProcess.push({ title: noteTitle, reason: 'new' });
      } else {
        const existingNote = existingNotes.get(noteTitle);
        if (!existingNote) {
          notesToProcess.push({ title: noteTitle, reason: 'new' });
        } else {
          // For existing notes, we'll need to fetch details to check modification date
          notesToProcess.push({ title: noteTitle, reason: 'check' });
        }
      }
    }
    
    console.log(`   🎯 Quick scan: ${notesToProcess.length} notes need ${isFreshMode ? 'processing (fresh mode)' : 'checking'}, ${notesToSkip.length} can be skipped immediately`);
    
    // Process in smaller parallel batches for better performance
    const PARALLEL_BATCH_SIZE = 3; // Reduced for better stability
    const notesToUpdate = [];
    const notesToAdd = [];
    
    for (let i = 0; i < notesToProcess.length; i += PARALLEL_BATCH_SIZE) {
      const parallelBatch = notesToProcess.slice(i, i + PARALLEL_BATCH_SIZE);
      console.log(`   🔍 Processing parallel batch ${Math.floor(i/PARALLEL_BATCH_SIZE) + 1}/${Math.ceil(notesToProcess.length/PARALLEL_BATCH_SIZE)} (${parallelBatch.length} notes)`);
      
      const batchPromises = parallelBatch.map(async ({ title, reason }) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000); // Reduced timeout
        
        try {
          const result = await Promise.race([
            deps.getNoteDetailsByTitle(title),
            new Promise((_, reject) => {
              controller.signal.addEventListener('abort', () => 
                reject(new Error('Note processing timed out after 45s'))
              );
            })
          ]);
          clearTimeout(timeout);
          return { success: true, data: result, title, reason };
        } catch (error) {
          clearTimeout(timeout);
          return { success: false, error, title, reason };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      batchResults.forEach((result, idx) => {
        const { title, reason } = parallelBatch[idx];
        
        if (result.status === 'fulfilled' && result.value.success) {
          const noteDetails = result.value.data;
          processed++;
          successful++;
          
          if (isFreshMode) {
            // In fresh mode, treat all notes as new
            console.log(`     ✨ "${title}" (fresh mode) - will add`);
            notesToAdd.push(noteDetails);
            added++;
          } else {
            const existingNote = existingNotes.get(title);
            
            if (existingNote) {
              // Check modification date
              const existingModDate = new Date(existingNote.modification_date);
              const currentModDate = new Date(noteDetails.modification_date);
              
              if (currentModDate > existingModDate) {
                console.log(`     🔄 "${title}" was modified - will update`);
                notesToUpdate.push(noteDetails);
                updated++;
              } else {
                console.log(`     ⏭️ "${title}" unchanged - skipping`);
                skipped++;
              }
            } else {
              console.log(`     ✨ "${title}" is new - will add`);
              notesToAdd.push(noteDetails);
              added++;
            }
          }
        } else {
          failed++;
          const error = result.status === 'fulfilled' ? result.value.error : result.reason;
          console.log(`     ❌ Failed to process "${title}": ${error?.message || 'Unknown error'}`);
          report += `Error processing note "${title}": ${error?.message || 'Unknown error'}\n`;
        }
      });
      
      // Shorter delay between parallel batches
      if (i + PARALLEL_BATCH_SIZE < notesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Process updates and additions - CREATE CHUNKS PROPERLY
    const allNotesToProcess = [...notesToUpdate, ...notesToAdd];
    
    if (allNotesToProcess.length > 0) {
      console.log(`📥 Converting ${allNotesToProcess.length} notes to plain text and creating chunks...`);
      
      const allChunks = [];
      
      for (const note of allNotesToProcess) {
        try {
          const plainTextContent = htmlToPlainText(note.content || "");
          const fullText = `${note.title}\n\n${plainTextContent}`;
          
          // Create chunks from the full text
          const chunks = await createChunks(fullText);
          console.log(`     📄 "${note.title}": ${chunks.length} chunks created`);
          
          // Create chunk records with chunk_content field
          chunks.forEach((chunkContent, index) => {
            allChunks.push({
              title: note.title,
              content: plainTextContent, // Keep full content for reference
              creation_date: note.creation_date,
              modification_date: note.modification_date,
              chunk_index: index.toString(),
              total_chunks: chunks.length.toString(),
              chunk_content: chunkContent, // This is what gets embedded - CRITICAL FIELD
            });
          });
          
          totalChunks += chunks.length;
          
        } catch (error) {
          console.log(`     ⚠️ Error processing note "${note.title}": ${error.message}`);
          report += `Error processing note "${note.title}": ${error.message}\n`;
          failed++;
          successful--;
        }
      }

      if (allChunks.length > 0) {
        console.log(`💾 Adding ${allChunks.length} chunks to database...`);
        
        // Debug: Log first chunk to verify structure
        console.log(`🔍 Sample chunk structure:`, JSON.stringify(allChunks[0], null, 2));
        
        try {
          await notesTable.add(allChunks);
          
          // Update our existing notes map (only relevant for incremental mode)
          if (!isFreshMode) {
            allNotesToProcess.forEach(note => {
              existingNotes.set(note.title, {
                modification_date: note.modification_date,
                row: note
              });
            });
          }
          
          console.log(`✅ Successfully added ${allChunks.length} chunks from ${allNotesToProcess.length} notes`);
          
        } catch (error) {
          console.log(`   ❌ Database error: ${error.message}`);
          report += `Error adding chunks to database: ${error.message}\n`;
          failed += allNotesToProcess.length;
          successful -= allNotesToProcess.length;
        }
      }
    } else {
      console.log(`⏭️ No notes in this batch needed processing`);
    }
    
    // Brief pause between batches
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return {
    chunks: totalChunks,
    notes: successful,
    failed,
    updated,
    added,
    skipped,
    report,
    allNotes: allNotes.length,
    time: performance.now() - start,
  };
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
        const { title } = GetNoteSchema.parse(args);
        const note = await getNoteDetailsByTitle(title);

        return createTextResponse(`${JSON.stringify(note, null, 2)}`);
      } catch (error) {
        return createTextResponse(error.message);
      }
    } else if (name === "index-notes") {
      const { time, chunks, notes, report, allNotes } = await indexNotes(notesTable);
      return createTextResponse(
        `Indexed ${notes} notes into ${chunks} chunks in ${(time/1000).toFixed(1)}s. You can now search for them using the "search-notes" tool.`
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
    const vectorResults = await notesTable.search(query, "vector").limit(50).toArray();
    
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
    const ftsResults = await notesTable.search(query, "fts", "chunk_content").limit(30).toArray();
    
    ftsResults.forEach(chunk => {
      if (!noteResults.has(chunk.title)) {
        noteResults.set(chunk.title, {
          title: chunk.title,
          content: chunk.content,
          creation_date: chunk.creation_date,
          modification_date: chunk.modification_date,
          _relevance_score: 70,
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
  
  // Strategy 3: Exact phrase matching in chunks
  console.log(`\n3️⃣ Exact phrase search in chunks...`);
  const allChunks = await notesTable.search("").limit(20000).toArray();
  const queryRegex = new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  
  const exactMatches = allChunks.filter(chunk => {
    const titleMatch = queryRegex.test(chunk.title || '');
    const contentMatch = queryRegex.test(chunk.chunk_content || '');
    return titleMatch || contentMatch;
  });
  
  exactMatches.forEach(chunk => {
    if (!noteResults.has(chunk.title)) {
      noteResults.set(chunk.title, {
        title: chunk.title,
        content: chunk.content,
        creation_date: chunk.creation_date,
        modification_date: chunk.modification_date,
        _relevance_score: 100,
        _source: 'exact_match',
        _best_chunk_index: chunk.chunk_index,
        _total_chunks: chunk.total_chunks,
        _matching_chunk_content: chunk.chunk_content
      });
    }
  });
  
  console.log(`📋 Exact matches: ${exactMatches.length} chunks`);
  
  // Combine and rank results
  const combinedResults = Array.from(noteResults.values())
    .sort((a, b) => b._relevance_score - a._relevance_score)
    .slice(0, displayLimit);
  
  console.log(`\n📊 Final results: ${combinedResults.length} notes (from ${noteResults.size} total matches)`);
  
  if (combinedResults.length > 0) {
    combinedResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. "${result.title}" (score: ${result._relevance_score.toFixed(1)}, source: ${result._source}, chunk: ${result._best_chunk_index}/${result._total_chunks})`);
    });
  }
  
  return combinedResults.map(result => ({
    title: result.title,
    content: result.content?.substring(0, 300) + (result.content?.length > 300 ? '...' : ''),
    creation_date: result.creation_date,
    modification_date: result.modification_date,
    _relevance_score: result._relevance_score,
    _source: result._source,
    _best_chunk_index: result._best_chunk_index,
    _total_chunks: result._total_chunks,
    _matching_chunk_preview: result._matching_chunk_content?.substring(0, 200) + (result._matching_chunk_content?.length > 200 ? '...' : '')
  }));
};

const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});

export { db };