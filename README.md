# Advanced SHP Editor (ASE)

<img width="1363" height="717" alt="image" src="https://github.com/user-attachments/assets/ddf513de-10e2-4c21-9e54-cd01f97b4fa1" />

A high-performance, professional-grade web-based editor for Westwood Studios' **SHP (Format 80)** sprite format, as used in *Command & Conquer: Tiberian Sun* and *Red Alert 2*.

> **Experiment & Vision:** This project is part of an exploration into **"AI-Vibe Coding"** methodologies using the **Antigravity IDE**. It was built to fulfill the need for a modern, open-source, and cross-platform alternative to aging legacy tools, ensuring the C&C modding scene remains accessible on any operating system. Developed by **FS-21** (*C&C Reloaded* modder and lead developer).

## 🚀 Key Features

### 🎨 Professional Layer-Based Editing
- **Per-Frame Multi-Layer System:** The editor treats every individual frame as a complex composition. You can work with multiple layers per frame, allowing for non-destructive editing and advanced sprite assembly.
- **Layer Groups & Blending:** For each frame organize your workflow with layer groups, visibility toggling, and alpha-blending modes, bringing a professional image editor UX (similar to Photoshop or GIMP) to the SHP format.
- **Advanced Toolkit:** Includes Pencil, Brush (Circular/Square), Spray, Bucket Fill (with tolerance), and Magic Wand selection—all optimized for multi-layer interaction.
- **Canvas Resizing:** Real-time canvas expansion or shrinking with high-quality pixel-art resampling algorithms including **Smart (Area Average)**, **Nearest Neighbor**, **xBR 4x**, **HQ4x**, **OmniScale**, **xBRZ**, and **ScaleFX**, perfect for scaling sprites or adapting them to different game resolutions.

### 🌓 Shadow Management (C&C Specialized)
- **Shadow Automation:** Automated tools to fix invalid shadow pixels.
- **Cross-Game Conversion:** Seamlessly convert shadow formats between *Tiberian Sun* (TS) and *Red Alert 2* (RA2).

### 🎞️ Frame Management
- **Split File View:** Dual-pane interface to transfer frames between two different SHP files using drag-and-drop.
- **Versatile Views:** Toggle between Mosaic, Strip, and Pair-Strip (Normal/Shadow) views.

### 🤖 Specialized Modding Tools
- **Infantry & Vehicle Sequence Managers:** High-level tools to manage and preview complex unit animations. Automatically generates and exports correct sequence data for **`art.ini`** and **`artmd.ini`** (Yuri's Revenge), including frame ranges, timings, and action triggers.

### 📐 Palette Management
- **Versatile Selection:** Integrated support for all game palettes, including unit, building, and animation palettes.
- **Persistence:** Features a sophisticated **Palette Management Menu** where your imported palettes are kept between sessions using browser **Local Storage**.

## ⚙️ Configuration & Vanilla Mode
By default, the editor includes specialized presets and palettes for **C&C Reloaded** (a *Yuri's Revenge* mod by FS-21). If you prefer a **standard/vanilla** experience:
1. Open the generated `advanced_shp_editor.html` or the `index.html` of the PWA folder in a text editor.
2. Search for `let CnCReloadedMode = true;` near the top of the file.
3. Change it to `let CnCReloadedMode = false;`.
4. Save and reload the editor. This will hide all Reloaded-specific scaling presets and palette categories.

## 📦 Distribution & Offline Use
- **Self-Contained Build:** The `build.py` script generates a single, standalone file named **`advanced_shp_editor.html`**. This file is **100% portable** and works entirely **offline** without any external dependencies.
- **PWA Ready:** The project includes a dedicated `PWA/` directory with a manifest and service worker. You can host this on any web service (GitHub Pages, Vercel, etc.) to enable "Install as App" functionality on your desktop.

## 🛠️ Compatibility & Technology
- **Performance First:** 100% Vanilla JavaScript (ES6+). Optimized for speed and large file handling.
- **Best Experience:** Use **Chrome** or **Edge** for the full suite of features, including native file system integration.
- **Browser Notes:** While mostly functional in **Firefox**, certain features related to PWA installation and local storage persistence for a "native-like" experience may be limited or incompatible due to browser engine differences.

## 🌐 Internationalization (i18n)
The editor is fully localized and supports multiple languages, making it accessible to the global C&C community. Supported languages include:
- **English** (EN)
- **Spanish** (ES)
- **Russian** (RU)
- **German** (DE)
- **French** (FR)
- **Chinese** (Simplified & Traditional)

## 🔨 How to Build
Run `python build.py` to generate the latest standalone version.

---
*Created for the C&C Modding community.*

## 📜 Legal Disclaimer
**Command & Conquer** (including *Tiberian Sun*, *Red Alert 2*, and *Yuri's Revenge*) is a trademark or registered trademark of Electronic Arts Inc. in the U.S. and/or other countries. This project is an unofficial, community-driven toolset and is not affiliated with, endorsed by, or sponsored by Electronic Arts. It is developed for educational and modding preservation purposes.
