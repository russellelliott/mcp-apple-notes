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
        console.log(`Content: ${result.content}`);
      });
    }
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error during search:", error);
    process.exit(1);
  }
}

main();

/*
async function checkNoteCoverage() {
  const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
  const notesTable = await db.openTable("notes");

  console.log("🔍 Checking note coverage...\n");
  
  // Get all notes from database
  const allNotes = await notesTable.search("").limit(20000).toArray();
  console.log(`📊 Total notes in database: ${allNotes.length}`);
  
  // Search for Ava with word boundaries
  const avaRegex = /\bAva\b/gi;
  const avaMatches = allNotes.filter(note => {
    const titleMatch = avaRegex.test(note.title || '');
    const contentMatch = avaRegex.test(note.content || '');
    return titleMatch || contentMatch;
  });
  
  console.log(`📋 Found ${avaMatches.length} notes containing "Ava" as a whole word:`);
  
  avaMatches.slice(0, 10).forEach((note, idx) => {
    console.log(`${idx + 1}. "${note.title}"`);
  });
  
  // Check for partial matches (like "available")
  const partialMatches = allNotes.filter(note => {
    const titleMatch = note.title?.toLowerCase().includes('ava');
    const contentMatch = note.content?.toLowerCase().includes('ava');
    return titleMatch || contentMatch;
  });
  
  console.log(`\n📋 Found ${partialMatches.length} notes containing "ava" substring:`);
  
  // Show the difference
  const falsePositives = partialMatches.filter(note => !avaMatches.includes(note));
  console.log(`❌ False positives (contains "ava" but not "Ava"): ${falsePositives.length}`);
  
  falsePositives.slice(0, 5).forEach((note, idx) => {
    console.log(`${idx + 1}. "${note.title}" (likely contains "available", "avatar", etc.)`);
  });
  
  process.exit(0);
}

checkNoteCoverage();
*/