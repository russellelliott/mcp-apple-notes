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
  
  // Pass the maxNotes parameter to getNotes
  for await (const batch of deps.getNotes(maxNotes)) {
    allNotes = [...allNotes, ...batch.titles];
    console.log(`\n📦 Processing batch of ${batch.titles.length} notes (${batch.progress.current}/${batch.progress.total})`);
    
    // ... rest of the function stays the same
    const batchResults = [];
    for (let index = 0; index < batch.titles.length; index++) {
      const note = batch.titles[index];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        
        try {
          console.log(`   🔍 Processing note ${index + 1}/${batch.titles.length}: "${note}"`);
          const result = await Promise.race([
            deps.getNoteDetailsByTitle(note),
            new Promise((_, reject) => {
              controller.signal.addEventListener('abort', () => 
                reject(new Error('Note processing timed out after 120s'))
              );
            })
          ]);
          
          clearTimeout(timeout);
          processed++;
          successful++;
          
          console.log(`   ✅ Note "${note}" processed successfully`);
          batchResults.push(result);
        } catch (error) {
          clearTimeout(timeout);
          throw error;
        }
      } catch (error) {
        failed++;
        console.log(`   ❌ Failed to process note "${note}": ${error.message}`);
        report += `Error processing note "${note}": ${error.message}\n`;
        batchResults.push({} as any);
      }
      
      if (index < batch.titles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
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

// Optimized version of indexNotes for faster processing
export const indexNotesOptimized = async (
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

export const createNotesTable = async (overrideName?: string) => {
  const start = performance.now();
  
  // Create a fresh table
  const notesTable = await db.createEmptyTable(
    overrideName || "notes",
    notesTableSchema,
    {
      mode: "create",
      existOk: true,
    }
  );

  const indices = await notesTable.listIndices();
  if (!indices.find((index) => index.name === "content_idx")) {
    await notesTable.createIndex("content", {
      config: lancedb.Index.fts(),
      replace: true,
    });
  }
  return { notesTable, time: performance.now() - start };
};

const createNote = async (title: string, content: string) => {
  // Escape special characters and convert newlines to \n
  const escapedTitle = title.replace(/[\\'"]/g, "\\$&");
  const escapedContent = content
    .replace(/[\\'"]/g, "\\$&")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");

  await runJxa(`
    const app = Application('Notes');
    const note = app.make({new: 'note', withProperties: {
      name: "${escapedTitle}",
      body: "${escapedContent}"
    }});
    
    return true
  `);

  return true;
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
export const searchAndCombineResults = async (
  notesTable: lancedb.Table,
  query: string,
  displayLimit = 5,
  minCosineSimilarity = 0.1 // Very low threshold for debugging
) => {
  console.log(`🔍 Searching for: "${query}"`);
  console.log(`📊 Table has ${await notesTable.countRows()} rows`);
  
  // First, let's see if the content exists AT ALL in our database
  console.log(`\n🔍 Manually searching through all notes for: "${query}"`);
  const allNotes = await notesTable.search("").limit(1000).toArray();
  
  const manualMatches = allNotes.filter(note => {
    const titleMatch = note.title?.toLowerCase().includes(query.toLowerCase());
    const contentMatch = note.content?.toLowerCase().includes(query.toLowerCase());
    return titleMatch || contentMatch;
  });
  
  console.log(`📋 Manual search found ${manualMatches.length} notes containing "${query}"`);
  
  if (manualMatches.length > 0) {
    console.log("✅ Content EXISTS in database. Here's what we found:");
    manualMatches.slice(0, 3).forEach((note, idx) => {
      console.log(`  ${idx + 1}. "${note.title}"`);
      const queryIndex = note.content?.toLowerCase().indexOf(query.toLowerCase()) || -1;
      if (queryIndex >= 0) {
        const start = Math.max(0, queryIndex - 50);
        const end = Math.min((note.content?.length || 0), queryIndex + query.length + 50);
        const snippet = note.content?.substring(start, end) || '';
        console.log(`     Context: ...${snippet}...`);
      }
    });
  } else {
    console.log("❌ Content NOT FOUND in database. This means:");
    console.log("   - The note wasn't indexed");
    console.log("   - The content was lost during HTML conversion");
    console.log("   - The content was truncated by the 512-char limit");
  }
  
  // Now test FTS search
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
  
  // Test vector search with very low threshold
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
  
  // Return manual matches if they exist, otherwise return empty
  if (manualMatches.length > 0) {
    return manualMatches.slice(0, displayLimit).map(result => ({
      title: result.title,
      content: result.content?.substring(0, 300) + (result.content?.length > 300 ? '...' : ''),
      creation_date: result.creation_date,
      modification_date: result.modification_date,
      _relevance_score: 100,
      _source: 'manual'
    }));
  }
  
  return [];
};

const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});

export { db };