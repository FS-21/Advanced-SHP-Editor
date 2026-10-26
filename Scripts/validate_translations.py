
import re
import os
import sys

def main():
    base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    trans_file = os.path.join(base_path, "js", "translations.js")

    if not os.path.exists(trans_file):
        print(f"[ERROR] {trans_file} not found")
        sys.exit(1)

    with open(trans_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match the AVAILABLE_LANGUAGES object to get the source of truth
    # Structure: { code: "en", ... }
    avail_langs_match = re.search(r'(?:export\s+)?const AVAILABLE_LANGUAGES = \[(.*?)\];', content, re.DOTALL)
    if not avail_langs_match:
        print("[ERROR] AVAILABLE_LANGUAGES constant not found in translations.js")
        sys.exit(1)
    
    avail_langs_text = avail_langs_match.group(1)
    EXPECTED_LANGUAGES = re.findall(r'code:\s*"([^"]+)"', avail_langs_text)
    
    if not EXPECTED_LANGUAGES:
        print("[ERROR] Could not extract language codes from AVAILABLE_LANGUAGES")
        sys.exit(1)

    print(f"Auditing translations for: {', '.join(EXPECTED_LANGUAGES)}")

    # Match the TRANSLATIONS object
    translations_match = re.search(r'export const TRANSLATIONS = \{(.*?)\};', content, re.DOTALL)
    if not translations_match:
        print("[ERROR] TRANSLATIONS object not found in translations.js")
        sys.exit(1)
    
    trans_text = translations_match.group(1)
    languages = {}
    
    # Extract language blocks
    lang_matches = list(re.finditer(r'^\s*"?([a-z-]+)"?:\s*\{', trans_text, re.MULTILINE))
    
    if not lang_matches:
        print("[ERROR] No language blocks found in TRANSLATIONS")
        sys.exit(1)

    found_langs = []
    for i in range(len(lang_matches)):
        lang_code = lang_matches[i].group(1)
        found_langs.append(lang_code)
        start = lang_matches[i].end()
        end = lang_matches[i+1].start() if i+1 < len(lang_matches) else len(trans_text)
        
        block = trans_text[start:end]
        # Extract keys: "key": or key:
        keys = set(re.findall(r'^\s*"?([a-zA-Z0-9_-]+)"?:\s*', block, re.MULTILINE))
        languages[lang_code] = keys

    # Check for entirely missing languages
    missing_langs_top = set(EXPECTED_LANGUAGES) - set(found_langs)
    if missing_langs_top:
        print(f"[CRITICAL] Languages completely missing from TRANSLATIONS object: {list(missing_langs_top)}")

    # Find ALL unique keys across ALL languages
    all_keys = set()
    for keys in languages.values():
        all_keys.update(keys)

    missing_langs_count = 0
    all_reports = []

    # Get sorted list of all languages (including those missing from TRANSLATIONS object but expected)
    all_langs_to_check = sorted(list(set(EXPECTED_LANGUAGES) | set(found_langs)))

    for lang in all_langs_to_check:
        keys = languages.get(lang, set())
        
        # We check against ALL KEYS found in the whole file
        missing = sorted(list(all_keys - keys))
        
        if missing:
            missing_langs_count += 1
            report = f"Missing '{lang}' keys: {len(missing)}"
            for k in missing:
                report += f"\n  - {k}"
            all_reports.append(report)
        else:
            all_reports.append(f"Missing '{lang}' keys: 0")

    # Cross-reference with HTML files
    html_files = ["index.html", "advanced_shp_editor.html"]
    html_keys = set()
    i18n_attr_patterns = [
        r'data-i18n="([^"]+)"',
        r'data-i18n-html="([^"]+)"',
        r'data-i18n-placeholder="([^"]+)"',
        r'data-i18n-title="([^"]+)"',
        r'data-i18n-tooltip="([^"]+)"'
    ]

    for hf in html_files:
        hf_path = os.path.join(base_path, hf)
        if os.path.exists(hf_path):
            with open(hf_path, 'r', encoding='utf-8') as f:
                h_content = f.read()
                for pattern in i18n_attr_patterns:
                    matches = re.findall(pattern, h_content)
                    html_keys.update(matches)

    # Report keys found in HTML but missing in ALL languages
    missing_from_all = sorted(list(html_keys - all_keys))
    if missing_from_all:
        report = f"\n[CRITICAL] {len(missing_from_all)} keys referenced in HTML are MISSING from ALL languages in TRANSLATIONS!"
        for k in missing_from_all:
            report += f"\n  - {k}"
        print(report)
        all_reports.append(report)
    else:
        print("\n[OK] All keys referenced in HTML are present in TRANSLATIONS.")

    # Cross-reference translation keys referenced from JavaScript
    js_dir = os.path.join(base_path, "js")
    js_key_refs = {}
    if os.path.isdir(js_dir):
        for js_name in sorted(os.listdir(js_dir)):
            if not js_name.endswith(".js") or js_name in ("translations.js", "translations.js.backup"):
                continue
            js_path = os.path.join(js_dir, js_name)
            with open(js_path, "r", encoding="utf-8", errors="replace") as f:
                for line_no, line in enumerate(f, 1):
                    for key in re.findall(r"\bt\(\s*['\"]([^'\"]+)['\"]", line):
                        js_key_refs.setdefault(key, []).append(f"{js_name}:{line_no}")
                    for key in re.findall(r"state\.translations\[\s*['\"]([^'\"]+)['\"]\s*\]", line):
                        js_key_refs.setdefault(key, []).append(f"{js_name}:{line_no}")

    missing_js_keys = sorted(set(js_key_refs) - all_keys)
    if missing_js_keys:
        report = f"\n[CRITICAL] {len(missing_js_keys)} keys referenced in JavaScript are MISSING from ALL languages in TRANSLATIONS!"
        for k in missing_js_keys:
            report += f"\n  - {k}  <- {', '.join(js_key_refs[k])}"
        print(report)
        all_reports.append(report)
    else:
        print("\n[OK] All keys referenced in JavaScript are present in TRANSLATIONS.")

    # Guard against hardcoded Spanish in user-facing calls. These strings must
    # go through t() so English stays the default and other locales can override it.
    spanish_markers = re.compile(
        r"[áéíóúÁÉÍÓÚñÑ¿¡]|"
        r"\b(no se|no hay|error al|el archivo|la imagen|los |las |debe |asegúrese|"
        r"archivo|archivos|proyecto|portapapeles|tesela|teselas|fotograma|fotogramas|"
        r"paleta|paletas|ventana|guardar|guarde|abrir|cargar|imagen|imágenes|imagenes)\b",
        re.IGNORECASE,
    )
    user_call_pat = re.compile(r"\b(alert|showAlert|showConfirm|showChoice|showPasteNotification|throw\s+new\s+Error)\s*\(")
    hardcoded_spanish = []
    if os.path.isdir(js_dir):
        for js_name in sorted(os.listdir(js_dir)):
            if not js_name.endswith(".js") or js_name in ("translations.js", "translations.js.backup"):
                continue
            js_path = os.path.join(js_dir, js_name)
            with open(js_path, "r", encoding="utf-8", errors="replace") as f:
                for line_no, line in enumerate(f, 1):
                    if not user_call_pat.search(line) or "t(" in line:
                        continue
                    if spanish_markers.search(line) and ('"' in line or "'" in line or "`" in line):
                        hardcoded_spanish.append(f"{js_name}:{line_no}: {line.strip()}")

    if hardcoded_spanish:
        report = f"\n[CRITICAL] {len(hardcoded_spanish)} user-facing message(s) appear to be hardcoded in Spanish!"
        for item in hardcoded_spanish:
            report += f"\n  - {item}"
        print(report)
        all_reports.append(report)
    else:
        print("\n[OK] No hardcoded Spanish strings found in user-facing calls.")

    # Save report to file (save inside the Scripts folder)
    report_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "translation_audit.txt")
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(f"Languages with missing keys: {missing_langs_count}\n")
        f.write("\n".join(all_reports))
    
    print(f"Summary: {missing_langs_count} languages have missing keys. See Scripts/translation_audit.txt for details.")

    if missing_langs_count > 0 or missing_from_all or missing_langs_top or missing_js_keys or hardcoded_spanish:
        print("\n[FAILED] Translation parity check failed.")
        sys.exit(1)
    else:
        print("\n[SUCCESS] Translation parity check passed.")
        sys.exit(0)

if __name__ == "__main__":
    main()
