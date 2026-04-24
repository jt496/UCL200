# UCL 200 - Mathematical Visualisations

This repository contains interactive mathematical visualisations developed for the UCL 200 Quiz celebrations.

## Project Sections

### 1. [Penrose Tilings] (./penrose/)
- **Explorer**: [Tiling explorer](https://jt496.github.io/UCL200/penrose/penrose.html)
- **Inflation**: [Robinson triangle inflation explorer](https://jt496.github.io/UCL200/penrose/robinson.html)
- **Game**: [Play the game live](https://jt496.github.io/UCL200/penrose/game.html)

### 2. [Torus Graph Embeddings](./doughnut/)
An interactive explorer for graph embeddings on a torus (the "doughnut").
- **Explorer**: [Interactive torus visualization](https://jt496.github.io/UCL200/doughnut/)

## 🚀 Live Demo
The entire project is hosted on GitHub Pages:
**[https://jt496.github.io/UCL200/](https://jt496.github.io/UCL200/)**

## 🛠️ Development

### Penrose
The Penrose section is built with vanilla HTML5 Canvas and JavaScript. To run locally:
```bash
cd penrose
./serve_game.sh
```

### Doughnut
The Torus section is a React + TypeScript application built with Vite and Three.js.
```bash
cd doughnut
npm install
npm run dev
```

## 📜 License
MIT

Built with lots of help from Claude Code and Gemini