# FancyCrack

A polished, static demo app to crack hash digests with a dictionary or small brute-force search. Runs entirely in the browser using a Web Worker. No server required.

## Features

- Dictionary mode (upload a wordlist `.txt`)
- Brute-force mode (custom charset, small max length)
- SHA-1, SHA-256, SHA-384, SHA-512 via WebCrypto
- Live progress, throughput, cancel
- Tailwind + DaisyUI for a clean, modern UI

## Quick Start

Open `index.html` directly in a modern browser or serve the directory:

```bash
cd /home/jacob/Documents/SRC/fancycrack
python -m http.server 8000
# then open http://localhost:8000
```

## Demo

- Click "Demo Data" to auto-fill the SHA-256 hash for `password`
- Provide a small wordlist or try brute-force with default charset `a-z0-9` and max length 5

## Notes

- MD5 is not supported by WebCrypto; this demo focuses on SHA family
- Brute-force grows exponentially; keep ranges small for live demos
- Everything runs client-side; avoid very large wordlists to keep browsers responsive


