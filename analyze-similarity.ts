#!/usr/bin/env bun
import { createNotesTable, aggregateChunksToNotes } from "./index.js";

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Calculate Euclidean distance between two vectors
function euclideanDistance(a: number[], b: number[]): number {
  const squaredDiffs = a.map((ai, i) => Math.pow(ai - b[i], 2));
  return Math.sqrt(squaredDiffs.reduce((sum, diff) => sum + diff, 0));
}

async function analyzeSimilarity() {
  console.log("🔍 Analyzing note similarity...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get note embeddings
    const noteEmbeddings = await aggregateChunksToNotes(notesTable);
    console.log(`📊 Analyzing ${noteEmbeddings.length} notes\n`);
    
    // Calculate all pairwise similarities
    const similarities: Array<{
      note1: string;
      note2: string;
      cosineSim: number;
      euclideanDist: number;
    }> = [];
    
    for (let i = 0; i < noteEmbeddings.length; i++) {
      for (let j = i + 1; j < noteEmbeddings.length; j++) {
        const note1 = noteEmbeddings[i];
        const note2 = noteEmbeddings[j];
        
        const cosineSim = cosineSimilarity(note1.embedding, note2.embedding);
        const euclideanDist = euclideanDistance(note1.embedding, note2.embedding);
        
        similarities.push({
          note1: note1.title,
          note2: note2.title,
          cosineSim,
          euclideanDist
        });
      }
    }
    
    // Sort by cosine similarity (higher = more similar)
    similarities.sort((a, b) => b.cosineSim - a.cosineSim);
    
    console.log("🎯 Most similar note pairs (top 5):");
    similarities.slice(0, 5).forEach((sim, idx) => {
      console.log(`${idx + 1}. "${sim.note1}" ↔ "${sim.note2}"`);
      console.log(`   Cosine similarity: ${sim.cosineSim.toFixed(3)}`);
      console.log(`   Euclidean distance: ${sim.euclideanDist.toFixed(3)}`);
      console.log('');
    });
    
    console.log("📊 Distance statistics:");
    const euclideanDistances = similarities.map(s => s.euclideanDist);
    const minDist = Math.min(...euclideanDistances);
    const maxDist = Math.max(...euclideanDistances);
    const avgDist = euclideanDistances.reduce((sum, d) => sum + d, 0) / euclideanDistances.length;
    
    console.log(`   Min Euclidean distance: ${minDist.toFixed(3)}`);
    console.log(`   Max Euclidean distance: ${maxDist.toFixed(3)}`);
    console.log(`   Average Euclidean distance: ${avgDist.toFixed(3)}`);
    
    console.log("\n💡 DBSCAN epsilon recommendations:");
    console.log(`   Current epsilon: 1.0`);
    console.log(`   Try epsilon: ${(maxDist * 0.8).toFixed(3)} (80% of max distance)`);
    console.log(`   Try epsilon: ${avgDist.toFixed(3)} (average distance)`);
    console.log(`   Try epsilon: ${(minDist * 2).toFixed(3)} (2x min distance)`);
    
    // Show which pairs would cluster together with different epsilon values
    const testEpsilons = [0.5, 1.0, 1.5, 2.0, avgDist, maxDist * 0.8];
    
    console.log("\n🔬 Clustering potential with different epsilon values:");
    testEpsilons.forEach(eps => {
      const pairsWithinEps = similarities.filter(s => s.euclideanDist <= eps).length;
      console.log(`   ε=${eps.toFixed(2)}: ${pairsWithinEps} pairs within distance`);
    });
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

analyzeSimilarity();