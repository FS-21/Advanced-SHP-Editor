import os
import re
import sys

# Keywords that typically indicate non-technical, AI-generated conversational comments
# or conversational fragments. We avoid generic technical terms.
SUSPICIOUS_PATTERNS = [
    r'(?i)\b(arregla|arreglado|fix(ing)? this|i\s?think|i\s?will|let\'s|we\s?need\s?to)\b',
    r'(?i)\b(pensamiento|thought|recordar|recuerda|te\s?recuerdo|usuario)\b',
    r'(?i)\b(user\s?(requested|feedback|says|wants|asked|noted))\b',
    r'(?i)\b(esto\s?es\s?porque|debido\s?a|ya\s?que|como\s?pediste|has\s?pedido)\b',
    r'(?i)\b(feo|bonito|feos|bonitos|horrible|ugly|pretty|beautiful)\b',
    r'(?i)\b(aqui\s?esta\s?el\s?fix|aqui\s?tienes|te\s?dejo|te\s?pongo)\b',
    r'(?i)\b(we\s?should|maybe\s?we\s?can|i\s?could|i\s?might|let\s?me\s?know)\b',
    r'(?i)\b(bug\s?fix(ed)?\s?by)\b',
    r'(?i)\b(added\s?by\s?(ai|agent|assistant|bot))\b',
]

# Directories to skip
EXCLUDE_DIRS = ['node_modules', '.git', 'worldalteringeditor-master']

# File extensions to check (only source code)
ALLOWED_EXTENSIONS = ['.js', '.html', '.css']

def scan_file_for_comments(filepath):
    """Scans a file line by line and reports any suspicious comments."""
    findings = []
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        for i, line in enumerate(lines):
            # Only look for patterns inside JS/CSS // or /* */ comments, or HTML <!-- --> comments.
            # A simple heuristic is to check if the line contains a comment token.
            if '//' in line or '/*' in line or '*/' in line or '<!--' in line or '-->' in line:
                for pattern in SUSPICIOUS_PATTERNS:
                    if re.search(pattern, line):
                        findings.append((i + 1, line.strip()))
                        break # Only report line once even if multiple patterns match
                        
    except Exception as e:
        print(f"Error reading file {filepath}: {e}")
        
    return findings

def main():
    print("Starting comment cleanup scan...")
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    total_findings = 0
    files_with_findings = 0
    
    for root, dirs, files in os.walk(project_root):
        # Exclude directories inline
        dirs[:] = [d for d in dirs if d.lower() not in EXCLUDE_DIRS]
        
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in ALLOWED_EXTENSIONS:
                filepath = os.path.join(root, file)
                findings = scan_file_for_comments(filepath)
                
                if findings:
                    files_with_findings += 1
                    print(f"\n[!] Suspicious comments found in: {os.path.relpath(filepath, project_root)}")
                    for line_num, content in findings:
                        print(f"    Line {line_num}: {content}")
                        total_findings += 1
                        
    print(f"\nScan complete. Found {total_findings} suspicious comments across {files_with_findings} files.")
    
    if total_findings > 0:
        print("Please review the listed files and remove conversational/non-technical comments.")
        sys.exit(1)
    else:
        print("No suspicious comments found! Codebase looks clean.")
        sys.exit(0)

if __name__ == "__main__":
    main()
