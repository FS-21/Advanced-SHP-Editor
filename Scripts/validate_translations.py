
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

    # Match the TRANSLATIONS object
    translations_match = re.search(r'export const TRANSLATIONS = \{(.*?)\};', content, re.DOTALL)
    if not translations_match:
        print("[ERROR] TRANSLATIONS object not found in translations.js")
        sys.exit(1)
    
    trans_text = translations_match.group(1)
    languages = {}
    
    # Extract language blocks
    # Ensure we use a multiline regex that handles both "key": { and key: {
    lang_matches = list(re.finditer(r'^\s*"?([a-z-]+)"?:\s*\{', trans_text, re.MULTILINE))
    
    if not lang_matches:
        print("[ERROR] No language blocks found in TRANSLATIONS")
        sys.exit(1)

    for i in range(len(lang_matches)):
        lang_code = lang_matches[i].group(1)
        start = lang_matches[i].end()
        end = lang_matches[i+1].start() if i+1 < len(lang_matches) else len(trans_text)
        
        block = trans_text[start:end]
        # Extract keys: "key": or key:
        keys = set(re.findall(r'^\s*"?([a-zA-Z0-9_-]+)"?:\s*', block, re.MULTILINE))
        languages[lang_code] = keys

    # Find ALL unique keys across ALL languages
    all_keys = set()
    for keys in languages.values():
        all_keys.update(keys)

    # We use 'en' as the reference for "missing" but also report if a key exists in others but not in 'en'
    en_keys = languages.get('en', set())
    
    missing_langs_count = 0
    all_reports = []

    # Get sorted list of all languages
    sorted_langs = sorted(languages.keys())

    for lang in sorted_langs:
        keys = languages[lang]
        
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
        report = f"\n[CRITICAL] Keys found in HTML but missing in TRANSLATIONS: {len(missing_from_all)}"
        for k in missing_from_all:
            report += f"\n  - {k}"
        print(report)
        all_reports.append(report)
    else:
        print("\nAll keys referenced in HTML are present in TRANSLATIONS (at least in one language).")

    # Save report to file (save inside the Scripts folder)
    report_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "translation_audit.txt")
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(f"Languages with missing keys: {missing_langs_count}\n")
        f.write("\n".join(all_reports))
    print(f"\nDetailed report updated in translation_audit.txt")

if __name__ == "__main__":
    main()
