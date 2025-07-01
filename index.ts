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
import TurndownService from "turndown";
import {
  EmbeddingFunction,
  LanceSchema,
  register,
} from "@lancedb/lancedb/embedding";
import { type Float, Float32, Utf8 } from "apache-arrow";
import { pipeline } from "@huggingface/transformers";

const turndown = new TurndownService();
const db = await lancedb.connect(
  path.join(os.homedir(), ".mcp-apple-notes", "data")
);
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);

@register("openai")
export class OnDeviceEmbeddingFunction extends EmbeddingFunction<string> {
  toJSON(): object {
    return {};
  }
  ndims() {
    return 384;
  }
  embeddingDataType(): Float {
    return new Float32();
  }
  async computeQueryEmbeddings(data: string) {
    const output = await extractor(data, { pooling: "mean" });
    return output.data as number[];
  }
  async computeSourceEmbeddings(data: string[]) {
    return await Promise.all(
      data.map(async (item) => {
        const output = await extractor(item, { pooling: "mean" });

        return output.data as number[];
      })
    );
  }
}

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

const getNotes = async function* () {
  console.log("   Requesting notes list from Apple Notes...");
  try {
    const BATCH_SIZE = 25;
    let startIndex = 1;
    let hasMore = true;

    // First get the total count
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); //timdesrochers

    const totalCount = await Promise.race([
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

    while (hasMore) {
      console.log(`   Fetching batch of notes (${startIndex} to ${startIndex + BATCH_SIZE - 1})...`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); //timdesrochers

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

export const indexNotes = async (
  notesTable: any, 
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
  
  console.log("📚 Getting and processing notes...");
  
  // Use injected dependencies instead of globals
  for await (const batch of deps.getNotes()) {
    allNotes = [...allNotes, ...batch.titles];
    console.log(`\n📦 Processing batch of ${batch.titles.length} notes (${batch.progress.current}/${batch.progress.total})`);
    
    // Process notes sequentially instead of in parallel to avoid overwhelming Apple Notes
    const batchResults = [];
    for (let index = 0; index < batch.titles.length; index++) {
      const note = batch.titles[index];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000); // Increased to 2 minutes
        
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
          
          // Debug: Log the result structure
          console.log(`   ✅ Note "${note}" result:`, {
            hasTitle: !!result.title,
            titleLength: result.title?.length || 0,
            hasContent: !!result.content,
            contentLength: result.content?.length || 0,
            hasCreationDate: !!result.creation_date,
            hasModificationDate: !!result.modification_date
          });
          
          if (processed % 10 === 0 || processed === batch.progress.total) {
            const progress = ((processed / batch.progress.total) * 100).toFixed(1);
            console.log(`   Progress: ${processed}/${batch.progress.total} notes (${progress}%) | ✅ ${successful} | ❌ ${failed}`);
          }
          
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
      
      // Add a small delay between notes to be gentle on Apple Notes
      if (index < batch.titles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log("📥 Converting batch to markdown format...");
    
    // Debug: Log filtering step
    const notesWithTitle = batchResults.filter((n) => n.title);
    console.log(`   🔍 After title filter: ${batchResults.length} -> ${notesWithTitle.length} notes`);
    
    const batchChunks = notesWithTitle
      .map((node, index) => {
        try {
          console.log(`   🔄 Converting note "${node.title}" to markdown...`);
          const converted = {
            ...node,
            content: turndown.turndown(node.content || ""),
          };
          console.log(`   ✅ Converted note "${node.title}" successfully`);
          return converted;
        } catch (error) {
          console.log(`   ❌ Error converting note "${node.title}" to markdown: ${error.message}`);
          report += `Error converting note "${node.title}" to markdown: ${error.message}\n`;
          return node;
        }
      })
      .map((note, index) => ({
        title: note.title,
        content: note.content,
        creation_date: note.creation_date,
        modification_date: note.modification_date,
      }));

      console.log(`   📊 Batch stats: ${batch.titles.length} requested, ${batchResults.length} processed, ${batchChunks.length} valid`);
      console.log(`   📊 Failed in this batch: ${batch.titles.length - batchResults.filter(r => r.title).length}`);
      
      // Debug: Log sample of what we're getting
      if (batchChunks.length > 0) {
        console.log(`   📋 Sample valid note:`, {
          title: batchChunks[0].title,
          contentPreview: batchChunks[0].content?.substring(0, 100) + "...",
          hasCreationDate: !!batchChunks[0].creation_date,
          hasModificationDate: !!batchChunks[0].modification_date
        });
      }

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
 * The results are combined using RRF
 */
export const searchAndCombineResults = async (
  notesTable: lancedb.Table,
  query: string,
  limit = 20
) => {
  const [vectorResults, ftsSearchResults] = await Promise.all([
    (async () => {
      const results = await notesTable
        .search(query, "vector")
        .limit(limit)
        .toArray();
      return results;
    })(),
    (async () => {
      const results = await notesTable
        .search(query, "fts", "content")
        .limit(limit)
        .toArray();
      return results;
    })(),
  ]);

  const k = 60;
  const scores = new Map<string, number>();

  const processResults = (results: any[], startRank: number) => {
    results.forEach((result, idx) => {
      const key = `${result.title}::${result.content}`;
      const score = 1 / (k + startRank + idx);
      scores.set(key, (scores.get(key) || 0) + score);
    });
  };

  processResults(vectorResults, 0);
  processResults(ftsSearchResults, 0);

  const results = Array.from(scores.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key]) => {
      const [title, content] = key.split("::");
      return { title, content };
    });

  return results;
};

const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});

export { db };