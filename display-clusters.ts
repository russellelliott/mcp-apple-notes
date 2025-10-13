#!/usr/bin/env bun
import { createNotesTable, listClusters, getNotesInCluster } from "./index.js";

async function displayClusterResults() {
  console.log("🎯 Note Clustering Results\n");
  console.log("=" .repeat(50));
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get all clusters
    const clusters = await listClusters(notesTable);
    
    console.log(`\n📊 Summary: Found ${clusters.length} groups\n`);
    
    // Separate real clusters from outliers
    const realClusters = clusters.filter(c => c.cluster_id !== '-1');
    const outlierCluster = clusters.find(c => c.cluster_id === '-1');
    
    // Display real clusters first
    if (realClusters.length > 0) {
      console.log("🎯 IDENTIFIED CLUSTERS:\n");
      
      for (let i = 0; i < realClusters.length; i++) {
        const cluster = realClusters[i];
        console.log(`Cluster ${i + 1}: "${cluster.cluster_label}"`);
        console.log(`   📊 ${cluster.note_count} notes`);
        console.log(`   💭 ${cluster.cluster_summary}`);
        console.log(`   🔗 Cluster ID: ${cluster.cluster_id}`);
        
        // Get and display notes in this cluster
        const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
        console.log(`   📖 Notes in this cluster:`);
        
        notesInCluster.forEach((note, idx) => {
          console.log(`      ${idx + 1}. "${note.title}"`);
          console.log(`         📅 Created: ${note.creation_date}`);
          console.log(`         ✏️ Modified: ${note.modification_date}`);
        });
        
        console.log(); // Empty line
      }
    } else {
      console.log("🎯 NO CLUSTERS FOUND");
      console.log("   All notes are too different to group together.\n");
    }
    
    // Display outliers
    if (outlierCluster && outlierCluster.note_count > 0) {
      console.log("📌 OUTLIER NOTES (unclustered):\n");
      console.log(`   📊 ${outlierCluster.note_count} notes don't fit into any cluster`);
      console.log(`   💭 ${outlierCluster.cluster_summary}`);
      
      const outlierNotes = await getNotesInCluster(notesTable, '-1');
      console.log(`   📖 Outlier notes:`);
      
      outlierNotes.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      
      console.log();
    }
    
    // Show statistics
    const totalNotes = clusters.reduce((sum, c) => sum + c.note_count, 0);
    const clusteredNotes = realClusters.reduce((sum, c) => sum + c.note_count, 0);
    const clusteringRate = totalNotes > 0 ? (clusteredNotes / totalNotes * 100).toFixed(1) : 0;
    
    console.log("📈 CLUSTERING STATISTICS:");
    console.log(`   📝 Total notes: ${totalNotes}`);
    console.log(`   🎯 Notes in clusters: ${clusteredNotes} (${clusteringRate}%)`);
    console.log(`   📌 Outlier notes: ${outlierCluster?.note_count || 0}`);
    console.log(`   🏷️ Total clusters found: ${realClusters.length}`);
    
    if (realClusters.length > 0) {
      console.log("\n✨ SUCCESS: Notes have been automatically grouped by similarity!");
    } else {
      console.log("\n💡 TIP: Try adding more similar notes or adjusting clustering parameters.");
    }
    
  } catch (error) {
    console.error("❌ Error displaying results:", error);
  }
  
  process.exit(0);
}

displayClusterResults();