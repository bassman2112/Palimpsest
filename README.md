# Palimpsest

A free, open-source PDF viewer and editor. View, annotate, organize pages, and more — all locally on your machine.

<!-- ![Screenshot](screenshot.png) -->

## Features

### Viewing & Navigation
- **Continuous scroll** with lazy page rendering and pinch-to-zoom
- **Multi-tab** — open multiple PDFs side by side in tabs
- **Thumbnail sidebar** and **gallery view** with drag-and-drop page reorder
- **Text search** with match navigation (Cmd/Ctrl+F)
- **Fit Width / Fit Page** zoom presets, plus manual zoom input (10%–10,000%)
- **Drag & drop** — open files by dragging them onto the window
- **Text selection** via PDF.js TextLayer

### Annotations
- **Highlights** — drag to create, 7-color palette, resize handles, recolor via right-click
- **Notes** — click to place, editable popover, drag to reposition
- **Signatures & initials** — draw freehand or type (3 cursive fonts), saved for reuse
- All annotations are **draggable and resizable** after placement
- **Undo / Redo** for all annotation actions (Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z)
- Annotations are **saved directly into the PDF**

### Page Management
- **Reorder** pages via drag-and-drop in sidebar, gallery, or context menu
- **Delete** pages with hover button or context menu
- **Multi-select** in gallery (click, Shift+click, Cmd/Ctrl+A)
- **Merge PDFs** — combine multiple documents into one

### Saving & Export
- **Save**, **Save As**, and **Save As Locked** (flattens annotations into non-editable page content)
- **Print** via native OS dialog
- Smart save prompt for documents with signatures

### General
- **Cross-platform** — macOS, Windows, and Linux
- **Fast & private** — everything runs locally, no files uploaded anywhere
- **Dark mode** — follows your system preference
- **Recent files** — quick access from the File menu

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

APGL-3.0
