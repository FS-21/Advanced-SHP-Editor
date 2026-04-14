import os
import re
import sys
from datetime import datetime

# Configuration
APPEND_BUILD_ID = False  # Set to True to append YYYYMMDD_HHMMSS to APP_VERSION
COMPONENT_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_FILE = os.path.join(COMPONENT_DIR, 'index.html')
CSS_FILE = os.path.join(COMPONENT_DIR, 'styles.css')
JS_DIR = os.path.join(COMPONENT_DIR, 'js')
OUTPUT_FILE = os.path.join(COMPONENT_DIR, 'Build', 'advanced_shp_editor.html')

# Scripts directory
SCRIPTS_DIR = os.path.join(COMPONENT_DIR, 'Scripts')

# Optional Comment Cleanup Script
COMMENT_CLEANUP_SCRIPT = 'clean_comments.py'

# HTML Structure Validator Script
HTML_VALIDATOR_SCRIPT = 'validate_html.py'

# Translation Validator Script
TRANSLATION_VALIDATOR_SCRIPT = 'validate_translations.py'

# Game Palettes Configuration
PALETTES_SOURCE_DIR = os.path.join(COMPONENT_DIR, 'Palettes')
GAME_PALETTES_JS = os.path.join(JS_DIR, 'game_palettes.js')

import base64
import json

# Order is critical for dependencies
JS_ORDER = [
    'constants.js',
    'state.js',
    'translations.js',
    'shp_format.js',
    'history.js',
    'utils.js',
    'preview_window.js',
    'external_shp.js',
    'ui.js',
    'tools.js',
    'import_shp.js',
    'pcx_loader.js',
    'export_helper.js',
    'file_io.js',
    'image_ops.js',
    'game_palettes.js',
    'palette_menu.js',
    'infantry_sequence.js',
    'vehicle_sequence.js',
    'menu_handlers.js',
    'main.js'
]

def generate_game_palettes_data():
    if not os.path.exists(PALETTES_SOURCE_DIR):
        print(f"[INFO] Palettes source directory not found at {PALETTES_SOURCE_DIR}. Skipping generation.")
        return

    print("Generating game palettes data...")
    categories = [
        {"folder": "Tiberian Sun", "key": "ts"},
        {"folder": "Red Alert 2", "key": "ra2"},
        {"folder": "Yuri's Revenge", "key": "yr"},
        {"folder": "cnc reloaded", "key": "cncreloaded"}
    ]
    
    game_palettes = {}
    
    # Get actual directory names on disk for case-insensitive matching
    available_dirs = {d.lower(): d for d in os.listdir(PALETTES_SOURCE_DIR) 
                      if os.path.isdir(os.path.join(PALETTES_SOURCE_DIR, d))}
    
    for cat in categories:
        folder_key = cat["folder"].lower()
        if folder_key not in available_dirs:
            continue
            
        folder_path = os.path.join(PALETTES_SOURCE_DIR, available_dirs[folder_key])
            
        files = [f for f in os.listdir(folder_path) if f.lower().endswith('.pal')]
        files.sort()
        
        for filename in files:
            file_path = os.path.join(folder_path, filename)
            with open(file_path, "rb") as f:
                data = f.read()
                
            if len(data) == 768:
                b64_data = base64.b64encode(data).decode('utf-8')
                name = os.path.splitext(filename)[0]
                pal_id = f"game_{cat['key']}_{name.lower().replace(' ', '_')}"
                
                if cat["key"] not in game_palettes:
                    game_palettes[cat["key"]] = []
                
                game_palettes[cat["key"]].append({ # type: ignore
                    "id": pal_id,
                    "name": name,
                    "b64": b64_data,
                    "category": cat["key"]
                })

    content = f"// AUTO-GENERATED GAME PALETTES DATA\nexport const GAME_PALETTES = {json.dumps(game_palettes, indent=2)};\n"
    
    with open(GAME_PALETTES_JS, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[OK] Generated {GAME_PALETTES_JS}")

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def bundle():
    print("Bundling Advanced SHP Editor...")
    
    # 0. Generate game palettes
    generate_game_palettes_data()
    
    if COMPONENT_DIR not in sys.path:
        sys.path.insert(0, COMPONENT_DIR)
    if SCRIPTS_DIR not in sys.path:
        sys.path.insert(0, SCRIPTS_DIR)
    
    # 0.5 Validate source HTML Structure (pre-build)
    validator_path = os.path.join(SCRIPTS_DIR, HTML_VALIDATOR_SCRIPT)
    if os.path.exists(validator_path):
        print("\nRunning pre-build HTML validation on source (index.html)...")
        from validate_html import validate_html_file  # type: ignore
        errors, _ = validate_html_file(HTML_FILE)
        if errors:
            print("\n[ERROR] Source HTML has structural issues. Build aborted.")
            print("        Fix the errors above before building.\n")
            sys.exit(1)
        print("Source HTML validation passed.\n")
        
    # 0.7 Check for TODO/FIXME in all source files
    print("Scanning for unfinished tasks (TODO/FIXME)...")
    todo_found = False
    for root, _, files in os.walk(COMPONENT_DIR):
        if any(d in root for d in ('.git', '.gemini', '__pycache__')): continue
        for f in files:
            if not f.endswith(('.html', '.js', '.css', '.py')): continue
            # Don't scan this script itself for its own keywords
            if f == os.path.basename(__file__): continue
            
            p = os.path.join(root, f)
            with open(p, 'r', encoding='utf-8', errors='ignore') as src:
                for line_no, content in enumerate(src, 1):
                    if 'TODO' in content or 'FIXME' in content:
                        print(f"  [INFO] Task found in {os.path.relpath(p, COMPONENT_DIR)} (L{line_no}): {content.strip()}")
                        todo_found = True
    if not todo_found:
        print("  [OK] No TODOs or FIXMEs found. Code looks ready.")
    else:
        print("  [TIP] Remember to check the tasks listed above before final deployment.\n")
    html_content = read_file(HTML_FILE)

    # 1.5 Handle Build ID / Versioning
    if APPEND_BUILD_ID:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        # Strip any existing build ID first, then append the new one
        html_content = re.sub(
            r"(const APP_VERSION = ')(.*?)(\s*-\s*Build\s*\d{8}_\d{6})?(')",
            fr"\1\2 - Build {ts}\4",
            html_content
        )
        print(f"[OK] Build ID injected: {ts}")

    # 2. Embed CSS
    print(f"Embedding {CSS_FILE}...")
    css_content = read_file(CSS_FILE)
    html_content = html_content.replace(
        '<link rel="stylesheet" href="styles.css">',
        f'<style>\n{css_content}\n</style>'
    )
    
    # 3. Bundle JS
    print("Bundling JavaScript modules...")
    js_bundle = ""
    
    for js_name in JS_ORDER:
        path = os.path.join(JS_DIR, js_name)
        if not os.path.exists(path):
            print(f"Error: Could not find {path}")
            return
            
        print(f"Processing {js_name}...")
        script_content = read_file(path)
        
        # Remove import statements (handles multi-line)
        script_content = re.sub(r'import\s+.*?from\s+[\'"].*?[\'"];?\n?', '', script_content, flags=re.DOTALL)
        
        # Remove export keywords (handles export async function, export const, etc.)
        script_content = re.sub(r'export\s+(async\s+)?(function|const|let|var|class)\s+', r'\1\2 ', script_content)
        
        # Remove export { ... } statements
        script_content = re.sub(r'export\s+\{.*?\};?\n?', '', script_content, flags=re.DOTALL)
        
        js_bundle += f"\n// --- {js_name} ---\n{script_content}\n"

    # 3.5 Check Syntax Using Node.js
    import subprocess
    print("Checking JavaScript syntax using Node.js...")
    tmp_js = os.path.join(COMPONENT_DIR, '.syntax_check.js')
    with open(tmp_js, 'w', encoding='utf-8') as f:
        f.write(js_bundle)
    try:
        res = subprocess.run(['node', '-c', '.syntax_check.js'], capture_output=True, text=True, cwd=COMPONENT_DIR)
        if res.returncode != 0:
            print("\n[ERROR] JavaScript Syntax Error found during build!")
            print("="*40)
            print(res.stderr)
            print("="*40)
            print("Build aborted. Fix the syntax error above.")
            sys.exit(1)
        else:
            print("[OK] JavaScript syntax is valid.")
    except FileNotFoundError:
        print("\n" + "="*60)
        print("[WARNING] Node.js is not installed or not in your PATH.")
        print("          Syntax checking for the final bundle will be skipped.")
        print("="*60)
        print("\nWhat is Node.js?")
        print("  Node.js is simply the JavaScript engine from Google Chrome")
        print("  packaged as a standalone, lightweight program. It is the")
        print("  industry standard for validating JavaScript code offline.")
        print("\nDoes it install Docker or bloatware?")
        print("  NO. It does not install Docker, virtual machines, or heavy")
        print("  background services. It's just a clean executable engine.")
        print("\nHow to install it (Recommended):")
        print("  1. Go to https://nodejs.org/")
        print("  2. Download the 'LTS' (Long Term Support) installer for Windows.")
        print("  3. Run the installer (you can leave all default options).")
        print("  4. IMPORTANT: Close this terminal/command prompt and open a new one")
        print("     so Windows registers the new 'node' command.")
        print("  5. Run 'python build.py' again. You will now have automatic,")
        print("     bulletproof syntax checking!")
        print("\n" + "="*60 + "\n")
    finally:
        if os.path.exists(tmp_js):
            os.remove(tmp_js)

    # 4. Embed JS into HTML
    # Replace the module script tag with the bundled script
    html_content = html_content.replace(
        '<script type="module" src="js/main.js"></script>',
        f'<script>\n{js_bundle}\n</script>'
    )
    
    # 5.5 Update PWA Manifest dynamically to match OUTPUT_FILE basename
    print(f"Updating PWA manifest for {os.path.basename(OUTPUT_FILE)}...")
    manifest_match = re.search(r"<link rel=\"manifest\"[\s\S]+?href='data:application/json,([\s\S]+?)'\s*>", html_content, re.DOTALL)
    if manifest_match:
        try:
            manifest_json = json.loads(manifest_match.group(1))
            basename = os.path.basename(OUTPUT_FILE)
            manifest_json['start_url'] = f"./{basename}"
            if 'file_handlers' in manifest_json:
                for handler in manifest_json['file_handlers']:
                    handler['action'] = f"./{basename}"
            else:
                # Add default SHP file handler if missing
                manifest_json['file_handlers'] = [
                    {
                        "action": f"./{basename}",
                        "accept": {
                            "application/x-wwn-shp": [".shp"]
                        },
                        "launch_type": "single-client"
                    }
                ]
            
            updated_manifest = f"<link rel=\"manifest\" href='data:application/json,{json.dumps(manifest_json)}'>"
            html_content = html_content.replace(manifest_match.group(0), updated_manifest)
        except Exception as e:
            print(f"[WARNING] Failed to update PWA manifest: {e}")

    # 6. Prepare Final Content with License
    license_header = f"""<!--
    Advanced SHP Editor
    Copyright (C) 2026 FS-21

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
-->
"""
    full_content = license_header + html_content

    # 6.1 Write Standard Bundle Output
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(full_content)
        
    print(f"Done! Created {OUTPUT_FILE}")

    # 7. Generate PWA deployment folder
    pwa_dir = os.path.join(COMPONENT_DIR, 'Build', 'PWA')
    print(f"\nGenerating PWA deployment folder at {pwa_dir}...")
    if not os.path.exists(pwa_dir):
        os.makedirs(pwa_dir)
    
    # 7.1 Copy bundle as index.html
    pwa_index = os.path.join(pwa_dir, 'index.html')
    pwa_html = full_content
    
    manifest_data = {
        "name": "Advanced SHP Editor",
        "short_name": "ASE",
        "description": "Advanced SHP Sprite Editor for Tiberian Sun & Red Alert 2",
        "start_url": "./index.html",
        "display": "standalone",
        "background_color": "#0d0e12",
        "theme_color": "#00ff9d",
        "icons": [
            {
                "src": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iIzBkMGUxMiIvPjxnIHN0cm9rZT0iIzAwZmY5ZCIgc3Ryb2tlLXdpZHRoPSIwLjMiIG9wYWNpdHk9IjAuMyI+PHJlY3QgeD0iMTAiIHk9IjI4IiB3aWR0aD0iNDQiIGhlaWdodD0iMzIiIHJ4PSIxIiBzdHJva2Utd2lkdGg9IjEiIG9wYWNpdHk9IjAuNiIvPjxwYXRoIGQ9Ik0xNCAyOFY2MCBNMTggMjhWNjAgTTIyIDI4VjYwIE0yNiAyOFY2MCBNMzAgMjhWNjAgTTM0IDI4VjYwIE0zOCAyOFY2MCBNNDIgMjhWNjAgTTQ2IDI4VjYwIE01MCAyOFY2MCIgLz48cGF0aCBkPSJNMTAgMzJINTQgTTEwIDM2SDU0IE0xMCA0MEg1NCBNMTAgNDRINTQgTTEwIDQ4SDU0IE0xMCA1Mkg1NCBNMTAgNTZINTQiIC8+PC9nPjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDI2LCAzMikiPjxyZWN0IHg9IjIiIHk9IjAiIHdpZHRoPSI0IiBoZWlnaHQ9IjIiIGZpbGw9IiNmZjAwMDAiIC8+PHJlY3QgeD0iMiIgeT0iMiIgd2lkdGg9IjIiIGhlaWdodD0iMiIgZmlsbD0iI2ZmY2M5OSIvPjxyZWN0IHg9IjAiIHk9IjQiIHdpZHRoPSIyIiBoZWlnaHQ9IjQiIGZpbGw9IiMxMTEiIC8+PHJlY3QgeD0iMiIgeT0iNCIgd2lkdGg9IjQiIGhlaWdodD0iNiIgZmlsbD0iIzRkNWRzMCIvPjxyZWN0IHg9IjYiIHk9IjQiIHdpZHRoPSIyIiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmNjOTkiLz48cmVjdCB4PSIyIiB5PSIxMCIgd2lkdGg9IjIiIGhlaWdodD0iNiIgZmlsbD0iIzRkNWRzMCIvPjxyZWN0IHg9IjQiIHk9IjEwIiB3aWR0aD0iMiIgaGVpZ2h0PSI2IiBmaWxsPSIjMzMzIi8+PHJlY3QgeD0iMiIgeT0iMTYiIHdpZHRoPSI0IiBoZWlnaHQ9IjIiIGZpbGw9IiMwMDAiLz48L2c+PHRleHQgeD0iMzIiIHk9IjIyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjZmZmZmZmIiBmb250LWZhbWlseT0iVmVyZGFuYSwgc2Fucy1zZXJpZiIgZm9udC13ZWlnaHQ9Ijk1MCIgZm9udC1zaXplPSIyMiIgbGV0dGVyLXNwYWNpbmc9Ii0xIj5BU0U8L3RleHQ+PC9zdmc+",
                "sizes": "64x64 any",
                "type": "image/svg+xml",
                "purpose": "any"
            }
        ],
        "file_handlers": [
            {
                "action": "./index.html",
                "accept": {
                    "application/x-wwn-shp": [".shp"]
                },
                "launch_type": "single-client"
            }
        ]
    }
    
    manifest_file = os.path.join(pwa_dir, 'manifest.json')
    with open(manifest_file, 'w', encoding='utf-8') as f:
        json.dump(manifest_data, f, indent=4)
    print(f"[OK] PWA manifest.json created.")

    # 7.2 Update index.html in PWA folder to point to manifest.json instead of data URI
    manifest_pattern = r'<link rel="manifest"[\s\S]+?href=\'data:application/json,[\s\S]+?\'\s*>'
    pwa_html = re.sub(manifest_pattern, '<link rel="manifest" href="manifest.json">', pwa_html)

    with open(pwa_index, 'w', encoding='utf-8') as f:
        f.write(pwa_html)
    print(f"[OK] PWA index.html created.")

    # 7.3 Generate Dedicated Service Worker for PWA folder
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    pwa_sw_file = os.path.join(pwa_dir, 'sw.js')
    pwa_sw_content = f"""const CACHE_NAME = 'shp-editor-pwa-{ts}';
const ASSETS = [
    './',
    './index.html'
];

self.addEventListener('install', (event) => {{
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {{
            return cache.addAll(ASSETS);
        }})
    );
}});

self.addEventListener('activate', (event) => {{
    event.waitUntil(
        caches.keys().then((keys) => {{
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }})
    );
}});

self.addEventListener('fetch', (event) => {{
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {{
            return cachedResponse || fetch(event.request);
        }})
    );
}});
"""
    with open(pwa_sw_file, 'w', encoding='utf-8') as f:
        f.write(pwa_sw_content)
    print(f"[OK] PWA sw.js updated.")

    # 7.4 Ensure global Service Worker still exists for primary build
    sw_file = os.path.join(COMPONENT_DIR, 'sw.js')
    sw_content = f"""const CACHE_NAME = 'shp-editor-{ts}';
const ASSETS = [
    './',
    './{os.path.basename(OUTPUT_FILE)}',
    './index.html',
    './sw.js'
];

self.addEventListener('install', (event) => {{
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {{
            return cache.addAll(ASSETS);
        }})
    );
}});

self.addEventListener('activate', (event) => {{
    event.waitUntil(
        caches.keys().then((keys) => {{
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }})
    );
}});

self.addEventListener('fetch', (event) => {{
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {{
            return cachedResponse || fetch(event.request);
        }})
    );
}});
"""
    with open(sw_file, 'w', encoding='utf-8') as f:
        f.write(sw_content)
    print(f"Global Service Worker updated at {sw_file}")

import subprocess

if __name__ == '__main__':
    bundle()
    
    # Post-build: Validate HTML structure of the final bundle
    validator_path = os.path.join(SCRIPTS_DIR, HTML_VALIDATOR_SCRIPT)
    if os.path.exists(validator_path):
        print("\nRunning post-build HTML structure validation on bundle...")
        from validate_html import validate_html_file  # type: ignore
        errors, warnings = validate_html_file(OUTPUT_FILE)
        if errors:
            print("[WARNING] Bundle has HTML structure issues! Check the report above.")
    else:
        print(f"\n[INFO] HTML validator '{HTML_VALIDATOR_SCRIPT}' not found. Skipping.")

    # Run comment validation script after build, if it exists
    cleanup_path = os.path.join(SCRIPTS_DIR, COMMENT_CLEANUP_SCRIPT)
    if os.path.exists(cleanup_path):
        print("\nRunning post-build comment validation...")
        result = subprocess.run(['python', cleanup_path], cwd=COMPONENT_DIR)
        if result.returncode != 0:
            print("\n[WARNING] Build succeeded but comment validation failed.")
    else:
        print(f"\n[INFO] Comment cleanup script '{COMMENT_CLEANUP_SCRIPT}' not found. Skipping validation.")

    # Post-build Translation Parity Check
    trans_validator_path = os.path.join(SCRIPTS_DIR, TRANSLATION_VALIDATOR_SCRIPT)
    if os.path.exists(trans_validator_path):
        print("\nChecking translations for missing entries (parity scan)...")
        result = subprocess.run(['python', trans_validator_path], cwd=COMPONENT_DIR)
        if result.returncode != 0:
            print("\n[CRITICAL] Translation parity check FAILED. Please fix missing keys above.")
            sys.exit(1)
        else:
            print("[SUCCESS] Translations are consistent across all languages.")

