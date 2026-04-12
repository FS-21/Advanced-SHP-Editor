"""
HTML Structure Validator for the SHP Editor
============================================
Uses ONLY Python's standard library (html.parser).
Validates:
  - Matching open/close tags (detects extra or missing closing tags)
  - Proper nesting hierarchy with full ancestor chain
  - Duplicate element IDs
  - Unclosed tags at end of document
  - Reports precise line numbers and source context for every issue

Usage:
  python validate_html.py                  # Validates index.html
  python validate_html.py somefile.html    # Validates a specific file

Exit code:
  0 = No issues found
  1 = Issues found (prints report)
"""

import os
import re
import sys
from html.parser import HTMLParser

# --- Configuration ---
COMPONENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_HTML = os.path.join(COMPONENT_DIR, 'index.html')

# How many lines of source code to show around each error
CONTEXT_LINES = 3

# Void elements (self-closing, never have a closing tag)
VOID_ELEMENTS = frozenset([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
    'command', 'keygen', 'menuitem'
])

# SVG self-closing elements (parsed differently but valid in inline SVG)
SVG_ELEMENTS = frozenset([
    'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline',
    'rect', 'use', 'stop', 'animate', 'animatetransform',
    'clippath', 'defs', 'g', 'lineargradient', 'radialgradient',
    'symbol', 'text', 'tspan'
])

# Elements where the browser auto-closes them (optional closing tags)
OPTIONAL_CLOSE = frozenset([
    'li', 'dt', 'dd', 'p', 'option', 'thead', 'tbody', 'tfoot',
    'tr', 'th', 'td', 'rt', 'rp', 'optgroup', 'colgroup'
])


def describe_tag(tag, attrs_dict):
    """Create a human-readable description of a tag with key attributes."""
    parts = [f'<{tag}']
    if attrs_dict.get('id'):
        parts.append(f'id="{attrs_dict["id"]}"')
    elif attrs_dict.get('class'):
        cls = attrs_dict["class"]
        # Truncate long class lists
        if len(cls) > 40:
            cls = cls[:37] + '...'
        parts.append(f'class="{cls}"')
    return ' '.join(parts) + '>'


def get_context_block(source_lines, target_line, radius=CONTEXT_LINES):
    """
    Returns a formatted block of source lines around target_line.
    target_line is 1-indexed.
    """
    start = max(0, target_line - 1 - radius)
    end = min(len(source_lines), target_line + radius)
    lines = []
    for i in range(start, end):
        line_num = i + 1
        marker = ' >>>' if line_num == target_line else '    '
        content = source_lines[i].rstrip('\r\n')
        # Truncate very long lines for readability
        if len(content) > 120:
            content = content[:117] + '...'
        lines.append(f"    {marker} {line_num:>5} | {content}")
    return '\n'.join(lines)


def get_nesting_chain(tag_stack, max_depth=6):
    """
    Returns a human-readable nesting chain from the tag stack.
    Shows the path from root to current position.
    """
    if not tag_stack:
        return "(empty)"
    
    # Show last N entries for readability
    entries = tag_stack[-max_depth:]
    prefix = "... > " if len(tag_stack) > max_depth else ""
    
    parts = []
    for tag, line, attrs in entries:
        elem_id = attrs.get('id', '')
        if elem_id:
            parts.append(f'<{tag} id="{elem_id}"> (L{line})')
        else:
            cls = attrs.get('class', '')
            if cls:
                short_cls = cls.split()[0] if ' ' in cls else cls
                if len(short_cls) > 25:
                    short_cls = short_cls[:22] + '...'
                parts.append(f'<{tag} .{short_cls}> (L{line})')
            else:
                parts.append(f'<{tag}> (L{line})')
    
    return prefix + ' > '.join(parts)


class HTMLStructureValidator(HTMLParser):
    """
    HTML structure validator that tracks open/close tag matching
    and reports structural problems with line numbers and nesting context.
    """

    def __init__(self):
        super().__init__()
        self.tag_stack = []       # Stack of (tag_name, line_no, attrs_dict)
        self.issues = []          # List of issue dicts
        self.ids_seen = {}        # {id_value: line_number}
        self._in_svg = 0          # SVG depth counter (SVG elements can self-close)
        self.tag_counts = {}      # {tag_name: [open_count, close_count]}

    def _pos(self):
        line, _ = self.getpos()
        return line

    def _check_external_ref(self, line, tag, attr, value):
        """Warn if an attribute contains an external URL (not useful for offline bundle)."""
        if not value:
            return
            
        # Match http://, https://, or // (protocol-relative)
        if re.match(r'^(https?:)?//', value.strip(), re.IGNORECASE):
            # Skip documentation links in <a> tags, but warn on resource loaders
            if tag == 'a' and attr == 'href':
                return
                
            self._add_issue(
                line, 'WARN',
                f'External reference found in <{tag} {attr}="{value}">',
                hint='For complete offline functionality, download this resource and bundle it locally or encode it as data-URI.'
            )

    def _add_issue(self, line, severity, message, related_line=None, hint=None):
        issue = {
            'line': line,
            'severity': severity,  # 'ERROR' or 'WARN'
            'message': message,
            'related_line': related_line,  # Optional: the other relevant line
            'hint': hint,                  # Optional: suggestion to fix
            'nesting': get_nesting_chain(self.tag_stack),
        }
        self.issues.append(issue)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        line = self._pos()
        attrs_dict = dict(attrs)

        # Track SVG context
        if tag == 'svg':
            self._in_svg += 1

        # Check for duplicate IDs
        elem_id = attrs_dict.get('id')
        if elem_id:
            if elem_id in self.ids_seen:
                self._add_issue(
                    line, 'ERROR',
                    f'Duplicate id="{elem_id}" — first defined at line {self.ids_seen[elem_id]}',
                    related_line=self.ids_seen[elem_id],
                    hint=f'Each id must be unique. Rename one of the id="{elem_id}" occurrences.'
                )
            else:
                self.ids_seen[elem_id] = line

        # Track tag counts for summary (ignore void elements)
        if tag in VOID_ELEMENTS:
            return

        if tag not in self.tag_counts:
            self.tag_counts[tag] = [0, 0]
        self.tag_counts[tag][0] += 1

        self.tag_stack.append((tag, line, attrs_dict))

        # Check for external references in common attributes
        for attr_name, attr_val in attrs:
            attr_name = attr_name.lower()
            if attr_name in ('src', 'href', 'data', 'srcset', 'poster'):
                # For 'href', we primarily care about stylesheets or icons
                if attr_name == 'href' and tag not in ('link', 'a', 'area'):
                    self._check_external_ref(line, tag, attr_name, attr_val)
                elif attr_name == 'href' and tag == 'link':
                    self._check_external_ref(line, tag, attr_name, attr_val)
                elif attr_name != 'href':
                     self._check_external_ref(line, tag, attr_name, attr_val)

    def handle_startendtag(self, tag, attrs):
        """Handle self-closing tags like <br/>, <path ... />, etc."""
        tag = tag.lower()
        line = self._pos()
        attrs_dict = dict(attrs)

        # Check for duplicate IDs even in self-closing tags
        elem_id = attrs_dict.get('id')
        if elem_id:
            if elem_id in self.ids_seen:
                self._add_issue(
                    line, 'ERROR',
                    f'Duplicate id="{elem_id}" — first defined at line {self.ids_seen[elem_id]}',
                    related_line=self.ids_seen[elem_id],
                    hint=f'Each id must be unique. Rename one of the id="{elem_id}" occurrences.'
                )
            else:
                self.ids_seen[elem_id] = line
        
        # Check for external references even in self-closing tags
        for attr_name, attr_val in attrs:
            attr_name = attr_name.lower()
            if attr_name in ('src', 'href', 'data', 'srcset', 'poster'):
                if attr_name == 'href' and tag not in ('link', 'a', 'area'):
                    self._check_external_ref(line, tag, attr_name, attr_val)
                elif attr_name == 'href' and tag == 'link':
                    self._check_external_ref(line, tag, attr_name, attr_val)
                elif attr_name != 'href':
                     self._check_external_ref(line, tag, attr_name, attr_val)
        # Self-closing: don't push to stack

    def handle_endtag(self, tag):
        tag = tag.lower()
        line = self._pos()

        # Track SVG context
        if tag == 'svg':
            self._in_svg = max(0, self._in_svg - 1)

        # Track tag counts for summary (ignore void elements)
        if tag in VOID_ELEMENTS:
            return

        if tag not in self.tag_counts:
            self.tag_counts[tag] = [0, 0]
        self.tag_counts[tag][1] += 1

        if not self.tag_stack:
            self._add_issue(
                line, 'ERROR',
                f'Extra closing </{tag}> with no matching open tag (tag stack is empty)',
                hint=f'Remove this </{tag}> or add a corresponding <{tag}> earlier.'
            )
            return

        top_tag, top_line, top_attrs = self.tag_stack[-1]

        if top_tag == tag:
            self.tag_stack.pop()
            return

        # Mismatch — search the stack for the matching open tag
        found_idx = None
        for idx in range(len(self.tag_stack) - 1, -1, -1):
            if self.tag_stack[idx][0] == tag:
                found_idx = idx
                break

        if found_idx is not None:
            # Report all unclosed tags between the match and the top of stack
            unclosed = self.tag_stack[found_idx + 1:]
            for uc_tag, uc_line, uc_attrs in unclosed:
                desc = describe_tag(uc_tag, uc_attrs)
                if uc_tag in OPTIONAL_CLOSE:
                    self._add_issue(
                        uc_line, 'WARN',
                        f'{desc} opened at line {uc_line} was implicitly closed by </{tag}> at line {line}',
                        related_line=line
                    )
                elif self._in_svg and uc_tag in SVG_ELEMENTS:
                    # SVG elements that were self-closed in source but parsed as open
                    pass  # Suppress false positives for SVG
                else:
                    self._add_issue(
                        uc_line, 'ERROR',
                        f'{desc} opened at line {uc_line} is missing its closing </{uc_tag}> tag — '
                        f'encountered </{tag}> at line {line} instead',
                        related_line=line,
                        hint=f'Add </{uc_tag}> before line {line}, or remove the extra <{uc_tag}> at line {uc_line}.'
                    )
            self.tag_stack = self.tag_stack[:found_idx]
        else:
            # No matching open tag found
            top_desc = describe_tag(top_tag, top_attrs)
            self._add_issue(
                line, 'ERROR',
                f'Extra closing </{tag}> — expected </{top_tag}> to close {top_desc} (opened at line {top_line})',
                related_line=top_line,
                hint=f'Either remove this </{tag}> or change it to </{top_tag}>.'
            )

    def handle_data(self, data):
        # Check for external references in CSS url() calls within <style> tags
        if self.tag_stack and self.tag_stack[-1][0] == 'style':
            line = self._pos()
            # Find all url(...) patterns in CSS
            urls = re.findall(r'url\s*\(\s*[\'"]?((https?:)?//[^)]+)[\'"]?\s*\)', data, re.IGNORECASE)
            for url_tuple in urls:
                url = url_tuple[0]
                self._add_issue(
                    line, 'WARN',
                    f'External URL found in CSS: url("{url}")',
                    hint='Images or fonts loaded from external URLs will fail in offline mode.'
                )

    def handle_comment(self, data):
        pass

    def handle_decl(self, decl):
        pass

    def finalize(self):
        """Report any remaining unclosed tags at end of document."""
        for tag, line, attrs in self.tag_stack:
            desc = describe_tag(tag, attrs)
            if tag in OPTIONAL_CLOSE:
                self._add_issue(
                    line, 'WARN',
                    f'{desc} opened at line {line} was never closed (end of file)',
                    hint='Add the closing tag or verify this is intentional.'
                )
            elif self._in_svg and tag in SVG_ELEMENTS:
                pass  # Suppress SVG false positives
            else:
                self._add_issue(
                    line, 'ERROR',
                    f'{desc} opened at line {line} was never closed (reached end of file)',
                    hint=f'Add </{tag}> at the appropriate location.'
                )





def validate_html_file(filepath):
    """
    Main validation entry point.
    Returns (errors, warnings) lists and prints a detailed report.
    """
    if not os.path.exists(filepath):
        print(f"[ERROR] File not found: {filepath}")
        return [{'line': 0, 'severity': 'ERROR', 'message': 'File not found'}], []

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    source_lines = content.split('\n')
    filename = os.path.basename(filepath)

    print(f"\n{'='*70}")
    print(f"  HTML Structure Validator — {filename}")
    print(f"{'='*70}")

    total_lines = len(source_lines)
    print(f"  File:  {filepath}")
    print(f"  Lines: {total_lines:,}")
    print(f"  Size:  {len(content):,} bytes")
    print()

    # --- Phase 1: Structural Validation & Counting ---
    validator = HTMLStructureValidator()
    try:
        validator.feed(content)
    except Exception as e:
        print(f"  [PARSE ERROR] HTML parser encountered an error: {e}")
        return [{'line': 0, 'severity': 'ERROR', 'message': str(e)}], []

    validator.finalize()

    # --- Phase 2: Tag Balance Summary (from parsed data) ---
    imbalanced = {tag: counts for tag, counts in validator.tag_counts.items()
                  if counts[0] != counts[1] and tag not in OPTIONAL_CLOSE
                  and tag not in SVG_ELEMENTS}

    if imbalanced:
        print("  Tag Balance Overview (showing only imbalanced tags):")
        print(f"  {'Tag':<15} {'Opened':>8} {'Closed':>8} {'Delta':>8}")
        print(f"  {'-'*15} {'-'*8} {'-'*8} {'-'*8}")
        for tag in sorted(imbalanced.keys()):
            o, c = imbalanced[tag]
            diff = o - c
            sign = '+' if diff > 0 else ''
            direction = 'extra open' if diff > 0 else 'extra close'
            print(f"  [!] {tag:<13} {o:>8} {c:>8} {sign}{diff:>7}  ({abs(diff)} {direction})")
        print()
    else:
        print("  [OK] All non-void tag counts are balanced.\n")

    # --- Separate errors and warnings ---
    all_errors = sorted(
        [i for i in validator.issues if i['severity'] == 'ERROR'],
        key=lambda x: x['line']
    )
    all_warnings = sorted(
        [i for i in validator.issues if i['severity'] == 'WARN'],
        key=lambda x: x['line']
    )

    # --- Print Detailed Report ---
    if all_errors:
        print(f"  [FAIL] {len(all_errors)} ERROR(s) found:")
        print(f"  {'─'*66}")
        for idx, issue in enumerate(all_errors, 1):
            line = issue['line']
            print(f"\n  ERROR #{idx}  (line {line})")
            print(f"  Message: {issue['message']}")
            if issue.get('hint'):
                print(f"  Fix:     {issue['hint']}")
            print(f"  Nesting: {issue['nesting']}")
            
            # Show source context at the error line
            print(f"\n  Source context (line {line}):")
            print(get_context_block(source_lines, line))
            
            # If there's a related line, show that context too
            if issue.get('related_line') and issue['related_line'] != line:
                rel = issue['related_line']
                print(f"\n  Related context (line {rel}):")
                print(get_context_block(source_lines, rel))
            
            print(f"  {'─'*66}")
        print()

    if all_warnings:
        print(f"\n  [WARN] {len(all_warnings)} WARNING(s):")
        for issue in all_warnings:
            print(f"    Line {issue['line']:>5}: {issue['message']}")
        print()

    if not all_errors and not all_warnings:
        print("  [OK] No structural issues found! HTML nesting looks clean.\n")

    # --- Summary ---
    print(f"{'='*70}")
    err_count = len(all_errors)
    warn_count = len(all_warnings)
    if err_count == 0:
        status = f"[PASS] ({warn_count} warning(s))" if warn_count else "[PASS] All clean!"
        print(f"  RESULT: {status}")
    else:
        print(f"  RESULT: [FAIL] {err_count} error(s), {warn_count} warning(s)")
    print(f"{'='*70}\n")

    return all_errors, all_warnings


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_HTML
    errors, warnings = validate_html_file(target)
    sys.exit(1 if errors else 0)
