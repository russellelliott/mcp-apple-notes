import * as lancedb from "@lancedb/lancedb";

async function checkIndexingHistory() {
  const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
  const notesTable = await db.openTable("notes");

  console.log("🔍 Analyzing your indexing history...\n");
  
  const totalNotes = await notesTable.countRows();
  console.log(`📊 Total notes in database: ${totalNotes}`);
  
  // Get sample of notes to see date patterns
  const allNotes = await notesTable.search("").limit(100).toArray();
  
  // Group by creation/modification dates to see indexing patterns
  const datePatterns = {};
  allNotes.forEach(note => {
    const creationDate = note.creation_date?.split(' ')[0]; // Get just the date part
    if (creationDate) {
      datePatterns[creationDate] = (datePatterns[creationDate] || 0) + 1;
    }
  });
  
  console.log("📅 Sample of notes by creation date:");
  Object.entries(datePatterns)
    .sort()
    .slice(-10) // Show last 10 dates
    .forEach(([date, count]) => {
      console.log(`  ${date}: ${count} notes`);
    });
  
  // Check for duplicate titles (sign of multiple indexing)
  const titleCounts = {};
  allNotes.forEach(note => {
    const title = note.title;
    if (title) {
      titleCounts[title] = (titleCounts[title] || 0) + 1;
    }
  });
  
  const duplicates = Object.entries(titleCounts).filter(([_, count]) => count > 1);
  console.log(`\n🔄 Found ${duplicates.length} duplicate titles in sample:`);
  duplicates.slice(0, 5).forEach(([title, count]) => {
    console.log(`  "${title}": ${count} copies`);
  });
  
  if (duplicates.length > 0) {
    console.log("\n⚠️  You likely have duplicate notes from multiple indexing runs!");
  }
  
  process.exit(0);
}

checkIndexingHistory();