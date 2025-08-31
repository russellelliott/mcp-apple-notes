import { runJxa } from "run-jxa";

const getNoteIdByTitle = async (title: string) => {
  try {
    const result = await runJxa(`
      const app = Application('Notes');
      app.includeStandardAdditions = true;
      
      try {
        const note = app.notes.whose({name: "${title}"})[0];
        if (note) {
          return {
            success: true,
            id: note.id(),
            title: note.name(),
            found: true
          };
        } else {
          return {
            success: true,
            found: false,
            message: "Note not found"
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    `);

    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Get title from command line argument or use test title
const testTitle = process.argv[2] || "Apple MCP Notes";

// Run the test
console.log(`🔍 Looking for note with title: "${testTitle}"`);
getNoteIdByTitle(testTitle)
  .then(result => {
    console.log('\nResult:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
