# Palimpsest

A free, open-source PDF viewer and editor. View, annotate, organize pages, and more — all locally on your machine.

<!-- ![Screenshot](screenshot.png) -->

## Features

- **View PDFs** — continuous scroll with lazy page rendering
- **Annotations** — highlight regions and place sticky notes, saved directly into the PDF
- **Page management** — reorder, delete, and organize pages via gallery view or thumbnail sidebar
- **Drag & drop** — open files by dragging them into the window
- **Search** — full-text search with match navigation (Cmd/Ctrl+F)
- **Zoom** — pinch-to-zoom, manual input, fit width, and fit page
- **Print** — native OS print dialog
- **Undo / Redo** — full undo/redo for annotations (Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z)
- **Cross-platform** — runs on macOS, Windows, and Linux
- **Fast & private** — everything runs locally, no files are uploaded anywhere
- **Dark mode** — follows your system preference

## Download

Grab the latest release for your platform from the [Releases](../../releases/latest) page:

| Platform | File |
|----------|------|
| macOS (Intel & Apple Silicon) | `.dmg` |
| Windows | `.msi` / `.exe` |
| Linux | `.deb` / `.AppImage` |

## Development

**Prerequisites:** Node.js 22+, Rust stable, and [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/).

```sh
# Install dependencies
npm install

# Run in dev mode (hot reload)
make run

# Type-check frontend + backend
make check

# Production build
make build
```

### Cutting a release

```sh
make release VERSION=0.1.0
```

This bumps the version in `package.json` and `Cargo.toml`, commits, tags `v0.1.0`, and pushes the tag. GitHub Actions then builds binaries for all platforms and publishes them as a GitHub Release.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **Desktop:** Tauri 2
- **PDF rendering:** PDF.js (pdfjs-dist)
- **PDF manipulation:** lopdf (Rust)

## License

MIT
