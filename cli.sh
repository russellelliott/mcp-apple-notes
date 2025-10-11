# Index only 1000 notes for testing
#bun cli.ts --max=100

# Create table from scratch, but only with 100 notes
#bun cli.ts --max=200 --mode=fresh

# Create table from scratch, go over all notes
# not from scratch; icremental change
# bun cli.ts

# start with small amount of notes to make sure it works; start from scratch using enhanced method
bun cli.ts --max=10 --mode=fresh --method=enhanced