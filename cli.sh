# Index only 10 notes for testing using enhanced method
#bun cli.ts --max=100

# Create table from scratch, but only with 200 notes using enhanced method
#bun cli.ts --max=200 --mode=fresh

# Create table from scratch, go over all notes using enhanced method
# bun cli.ts --mode=fresh

# start with small amount of notes to make sure it works; start from scratch using enhanced method
bun cli.ts --max=10 --mode=fresh