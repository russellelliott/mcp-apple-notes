#!/usr/bin/env bun
import { clusterNotes, listClusters, getNotesInCluster } from "./index.js";
import * as lancedb from "@lancedb/lancedb";

async function main() {
    console.log("🎯 Clustering and displaying all notes...\n");
    
    try {
        // Connect directly to the database (same method as searchNotes.ts)
        const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
        const notesTable = await db.openTable("notes");
    
    // First, check how many notes we actually have in the database
    const allChunks = await notesTable.search("").toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => `${chunk.title}|||${chunk.creation_date}`));
    
    console.log(`📊 Database contains: ${uniqueNotes.size} notes (${allChunks.length} chunks)`);
    
    if (uniqueNotes.size < 10) {
      console.log("⚠️ Very few notes found in database. You may need to run indexing first:");
      console.log("   bun cli.ts --max=100 --mode=fresh");
      console.log("");
    }
    
    // Run clustering with optimal parameters we found earlier
    console.log("🔬 Running DBSCAN clustering with optimal parameters...");
    console.log("   • min_cluster_size = 2");
    console.log("   • epsilon = 0.6 (captures most similar notes)");
    
    const clusterResult = await clusterNotes(
      notesTable, 
      2,   // min_cluster_size = 2 
      0.6  // epsilon = 0.6 (optimal value we found)
    );
    
    console.log(`\n✅ Clustering complete: ${clusterResult.totalClusters} clusters, ${clusterResult.outliers} outliers`);
    console.log(`   ⏱️ Time: ${clusterResult.timeSeconds.toFixed(1)}s`);
    
    // Display all clusters with full details
    console.log("\n" + "=".repeat(60));
    console.log("🎯 ALL CLUSTERS FOUND:");
    console.log("=".repeat(60));
    
    const clusters = await listClusters(notesTable);
    
    let totalNotesShown = 0;
    let clusterNum = 1;
    
    // Show real clusters first
    const realClusters = clusters.filter(c => c.cluster_id !== '-1');
    const outlierCluster = clusters.find(c => c.cluster_id === '-1');
    
    for (const cluster of realClusters) {
      console.log(`\n🎯 Cluster ${clusterNum}: "${cluster.cluster_label}"`);
      console.log(`   📊 ${cluster.note_count} notes`);
      console.log(`   💭 ${cluster.cluster_summary}`);
      console.log(`   🔗 Cluster ID: ${cluster.cluster_id}`);
      
      const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
      console.log(`   📖 Notes in this cluster:`);
      
      notesInCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
        console.log(`         📅 Created: ${note.creation_date}`);
        console.log(`         ✏️ Modified: ${note.modification_date}`);
      });
      
      totalNotesShown += notesInCluster.length;
      clusterNum++;
    }
    
    // Show outliers
    if (outlierCluster && outlierCluster.note_count > 0) {
      console.log(`\n📌 OUTLIER NOTES (unclustered):`);
      console.log(`   📊 ${outlierCluster.note_count} notes don't fit into any cluster`);
      console.log(`   💭 ${outlierCluster.cluster_summary}`);
      
      const outlierNotes = await getNotesInCluster(notesTable, '-1');
      console.log(`   📖 Outlier notes (showing first 10):`);
      
      outlierNotes.slice(0, 10).forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      
      if (outlierNotes.length > 10) {
        console.log(`      ... and ${outlierNotes.length - 10} more outlier notes`);
      }
      
      totalNotesShown += outlierNotes.length;
    }
    
    // Final summary
    console.log("\n" + "=".repeat(60));
    console.log("📈 FINAL CLUSTERING STATISTICS:");
    console.log("=".repeat(60));
    console.log(`   📝 Total notes processed: ${totalNotesShown}`);
    console.log(`   🎯 Meaningful clusters: ${realClusters.length}`);
    console.log(`   📌 Outlier notes: ${outlierCluster?.note_count || 0}`);
    console.log(`   🏷️ Clustering success rate: ${totalNotesShown > 0 ? ((realClusters.reduce((sum, c) => sum + c.note_count, 0) / totalNotesShown) * 100).toFixed(1) : 0}%`);
    console.log(`   ⏱️ Total processing time: ${clusterResult.timeSeconds.toFixed(1)}s`);
    
    if (realClusters.length > 0) {
      console.log("\n✨ SUCCESS: Your notes have been automatically grouped by similarity!");
    } else {
      console.log("\n💡 TIP: All notes are too different to cluster. Try running with more notes or different parameters.");
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

main();