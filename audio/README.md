Khmer audio files for the dictionary live in this folder.

Naming rule:

- Entry id `0` -> `000000.mp3`
- Entry id `1` -> `000001.mp3`
- Entry id `12` -> `000012.mp3`

After adding mp3 files, run:

```sh
node /Users/debydi/캄보디아어사전/scripts/build_dictionary.mjs
```

The builder will add `audio/000000.mp3` style paths to matching dictionary entries.
