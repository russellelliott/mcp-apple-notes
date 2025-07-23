import { searchAndCombineResults } from './index';
import * as lancedb from "@lancedb/lancedb";
import readline from "readline";

/**
 * Prompts the user for a query using readline.
 */
function prompt(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

async function main() {
  console.log("🔍 Apple Notes Search\n");

  // Connect to the LanceDB database
  const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
  const notesTable = await db.openTable("notes");

  const query = (await prompt("Enter your search query: ")).trim();

  if (!query) {
    console.error("⚠️  Please provide a search query.");
    process.exit(1);
  }

  console.log(`\n🔎 Searching for: "${query}" ...`);
  try {
    const results = await searchAndCombineResults(notesTable, query);
    if (!results.length) {
      console.log("No results found.");
    } else {
      console.log(`\n=== Search Results (${results.length}) ===`);
      results.forEach((result, idx) => {
        console.log(`\n#${idx + 1}`);
        console.log(`Title: ${result.title}`);
        console.log(`Relevant Chunk: ${result._matching_chunk_preview}`);
      });
    }
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error during search:", error);
    process.exit(1);
  }
}

main();
