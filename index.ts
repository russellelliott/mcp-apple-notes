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
  
  // Clean and preprocess text for better embeddings
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s\-.,!?;:()\[\]{}'"]/g, ' ') // Keep basic punctuation
      .trim()
      .substring(0, 512); // Limit size
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

const notesTableSchema = LanceSchema({
  title: func.sourceField(new Utf8()),
  content: func.sourceField(new Utf8()),
  creation_date: func.sourceField(new Utf8()),
  modification_date: func.sourceField(new Utf8()),
  vector: func.vectorField(),
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
      },
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
  let allNotes: string[] = [];
  
  console.log(`📚 Getting and processing notes${maxNotes ? ` (max: ${maxNotes})` : ''}...`);
  
  for await (const batch of deps.getNotes(maxNotes)) {
    allNotes = [...allNotes, ...batch.titles];
    console.log(`\n📦 Processing batch of ${batch.titles.length} notes (${batch.progress.current}/${batch.progress.total})`);
    
    // Process notes in parallel batches of 5-10 instead of sequentially
    const PARALLEL_BATCH_SIZE = 5;
    const batchResults = [];
    
    for (let i = 0; i < batch.titles.length; i += PARALLEL_BATCH_SIZE) {
      const parallelBatch = batch.titles.slice(i, i + PARALLEL_BATCH_SIZE);
      console.log(`   🔍 Processing ${parallelBatch.length} notes in parallel...`);
      
      const parallelResults = await Promise.allSettled(
        parallelBatch.map(async (note) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000); // Reduced timeout
          
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
      
      // Process results
      parallelResults.forEach((result, idx) => {
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
          batchResults.push({} as any);
        }
      });
      
      // Shorter delay between parallel batches
      if (i + PARALLEL_BATCH_SIZE < batch.titles.length) {
        await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms
      }
    }

    console.log("📥 Converting batch to plain text format...");
    
    const notesWithTitle = batchResults.filter((n) => n.title);
    console.log(`   🔍 After title filter: ${batchResults.length} -> ${notesWithTitle.length} notes`);
    
    const batchChunks = notesWithTitle
      .map((node) => {
        try {
          return {
            ...node,
            content: htmlToPlainText(node.content || ""),
          };
        } catch (error) {
          console.log(`   ❌ Error converting note "${node.title}" to plain text: ${error.message}`);
          return {
            ...node,
            content: node.content || ""
          };
        }
      })
      .map((note) => ({
        title: note.title,
        content: note.content,
        creation_date: note.creation_date,
        modification_date: note.modification_date,
      }));

    if (batchChunks.length > 0) {
      console.log(`💾 Adding batch to database (${batchChunks.length} notes)...`);
      try {
        await notesTable.add(batchChunks);
      } catch (error) {
        console.log(`   ❌ Database error: ${error.message}`);
        report += `Error adding batch to database: ${error.message}\n`;
        failed += batchChunks.length;
        successful -= batchChunks.length;
      }
    }
  }

  return {
    chunks: successful,
    failed,
    report,
    allNotes: allNotes.length,
    time: performance.now() - start,
  };
};

// Helper function to create FTS index
const createFTSIndex = async (notesTable: any) => {
  try {
    const indices = await notesTable.listIndices();
    if (!indices.find((index) => index.name === "content_idx")) {
      await notesTable.createIndex("content", {
        config: lancedb.Index.fts(),
        replace: true,
      });
      console.log(`✅ Created FTS index`);
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
  let allNotes: string[] = [];
  
  console.log(`📚 Smart indexing${maxNotes ? ` (max: ${maxNotes})` : ''} with update detection...`);
  
  for await (const batch of deps.getNotes(maxNotes)) {
    allNotes = [...allNotes, ...batch.titles];
    console.log(`\n📦 Processing batch of ${batch.titles.length} notes (${batch.progress.current}/${batch.progress.total})`);
    
    // First pass: quick check which notes need processing
    const notesToProcess = [];
    const notesToSkip = [];
    
    for (const noteTitle of batch.titles) {
      const existingNote = existingNotes.get(noteTitle);
      if (!existingNote) {
        notesToProcess.push({ title: noteTitle, reason: 'new' });
      } else {
        // For existing notes, we'll need to fetch details to check modification date
        notesToProcess.push({ title: noteTitle, reason: 'check' });
      }
    }
    
    console.log(`   🎯 Quick scan: ${notesToProcess.length} notes need checking, ${notesToSkip.length} can be skipped immediately`);
    
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
    
    // Process updates and additions in one go
    const allNotesToProcess = [...notesToUpdate, ...notesToAdd];
    
    if (allNotesToProcess.length > 0) {
      console.log(`📥 Converting ${allNotesToProcess.length} notes to plain text...`);
      
      const batchChunks = allNotesToProcess
        .map((node) => {
          try {
            return {
              ...node,
              content: htmlToPlainText(node.content || ""),
            };
          } catch (error) {
            console.log(`     ⚠️ HTML conversion error for "${node.title}": ${error.message}`);
            return {
              ...node,
              content: node.content || ""
            };
          }
        })
        .map((note) => ({
          title: note.title,
          content: note.content,
          creation_date: note.creation_date,
          modification_date: note.modification_date,
        }));

      console.log(`💾 Adding ${batchChunks.length} notes to database...`);
      try {
        await notesTable.add(batchChunks);
        
        // Update our existing notes map
        batchChunks.forEach(note => {
          existingNotes.set(note.title, {
            modification_date: note.modification_date,
            row: note
          });
        });
        
        console.log(`✅ Successfully added ${batchChunks.length} notes to database`);
        
      } catch (error) {
        console.log(`   ❌ Database error: ${error.message}`);
        report += `Error adding batch to database: ${error.message}\n`;
        failed += batchChunks.length;
        successful -= batchChunks.length;
      }
    } else {
      console.log(`⏭️ No notes in this batch needed processing`);
    }
    
    // Brief pause between batches
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return {
    chunks: successful,
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
      const { title, content } = CreateNoteSchema.parse(args);
      await createNote(title, content);
      return createTextResponse(`Created note "${title}" successfully.`);
    } else if (name === "list-notes") {
      return createTextResponse(
        `There are ${await notesTable.countRows()} notes in your Apple Notes database.`
      );
    } else if (name == "get-note") {
      try {
        const { title } = GetNoteSchema.parse(args);
        const note = await getNoteDetailsByTitle(title);

        return createTextResponse(`${note}`);
      } catch (error) {
        return createTextResponse(error.message);
      }
    } else if (name === "index-notes") {
      const { time, chunks, report, allNotes } = await indexNotes(notesTable);
      return createTextResponse(
        `Indexed ${chunks} notes chunks in ${time}ms. You can now search for them using the "search-notes" tool.`
      );
    } else if (name === "search-notes") {
      const { query } = QueryNotesSchema.parse(args);
      const combinedResults = await searchAndCombineResults(notesTable, query);
      return createTextResponse(JSON.stringify(combinedResults));
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
 * Search for notes by title or content using both vector and FTS search.
 * The results are combined using RRF with proper similarity filtering
 */
// Replace your complex searchAndCombineResults with this simple version
// Replace your searchAndCombineResults function with this:
export const searchAndCombineResults = async (
  notesTable: lancedb.Table,
  query: string,
  displayLimit = 5,
  minCosineSimilarity = 0.1
) => {
  console.log(`🔍 Searching for: "${query}"`);
  console.log(`📊 Table has ${await notesTable.countRows()} rows`);
  
  // Get all notes from database
  console.log(`\n🔍 Manually searching through all notes for: "${query}"`);
  const allNotes = await notesTable.search("").limit(20000).toArray(); // Increased limit
  
  // Create regex for word boundary matching (this is the key fix!)
  const queryRegex = new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  
  const manualMatches = allNotes.filter(note => {
    const titleMatch = queryRegex.test(note.title || '');
    const contentMatch = queryRegex.test(note.content || '');
    return titleMatch || contentMatch;
  });
  
  console.log(`📋 Manual search found ${manualMatches.length} notes containing "${query}" as a whole word`);
  
  if (manualMatches.length > 0) {
    console.log("✅ Content EXISTS in database. Here's what we found:");
    manualMatches.slice(0, 5).forEach((note, idx) => {
      console.log(`  ${idx + 1}. "${note.title}"`);
      
      // Find and show context for the match
      const content = note.content || '';
      const match = content.match(queryRegex);
      if (match) {
        const matchIndex = content.toLowerCase().indexOf(match[0].toLowerCase());
        if (matchIndex >= 0) {
          const start = Math.max(0, matchIndex - 50);
          const end = Math.min(content.length, matchIndex + match[0].length + 50);
          const snippet = content.substring(start, end);
          console.log(`     Context: ...${snippet}...`);
        }
      }
      
      // Also check title matches
      if (queryRegex.test(note.title || '')) {
        console.log(`     Title contains: "${note.title}"`);
      }
    });
    
    // Return the accurate results
    return manualMatches.slice(0, displayLimit).map(result => ({
      title: result.title,
      content: result.content?.substring(0, 300) + (result.content?.length > 300 ? '...' : ''),
      creation_date: result.creation_date,
      modification_date: result.modification_date,
      _relevance_score: 100,
      _source: 'manual'
    }));
  }
  
  // FTS and vector search code stays the same...
  console.log(`\n🔍 Testing FTS search for: "${query}"`);
  try {
    const ftsResults = await notesTable.search(query, "fts", "content").limit(10).toArray();
    console.log(`📝 FTS found ${ftsResults.length} results`);
    
    if (ftsResults.length > 0) {
      ftsResults.slice(0, 3).forEach((result, idx) => {
        console.log(`  FTS ${idx + 1}. "${result.title}"`);
      });
    }
  } catch (error) {
    console.log(`❌ FTS Error: ${error.message}`);
  }
  
  console.log(`\n🔍 Testing vector search for: "${query}"`);
  try {
    const vectorResults = await notesTable.search(query, "vector").limit(10).toArray();
    console.log(`🎯 Vector found ${vectorResults.length} results`);
    
    if (vectorResults.length > 0) {
      console.log(`📏 Vector distances: ${vectorResults.slice(0, 5).map(r => r._distance?.toFixed(3)).join(', ')}`);
      
      vectorResults.slice(0, 3).forEach((result, idx) => {
        const distance = result._distance || 0;
        const cosineSimilarity = Math.max(0, 1 - (distance * distance / 2));
        console.log(`  Vector ${idx + 1}. "${result.title}" (similarity: ${cosineSimilarity.toFixed(3)})`);
      });
    }
  } catch (error) {
    console.log(`❌ Vector Error: ${error.message}`);
  }
  
  return [];
};

const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});

export { db };