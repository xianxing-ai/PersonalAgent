"""Offline generated-artifact contract. Browser motion and human visual identity are separate evidence."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys


class Drawing(HTMLParser):
    def __init__(self, text=''):
        super().__init__(convert_charrefs=True)
        self.ids = {}
        self.stack = []
        self.animations = {}
        self.failures = []
        self.ancestors = {}
        self.animation_spans = {}
        self.line_offsets = [0]
        for line in text.splitlines(keepends=True):
            self.line_offsets.append(self.line_offsets[-1] + len(line))

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in ('script', 'iframe', 'object', 'embed', 'foreignobject', 'image', 'use', 'link', 'base'):
            self.failures.append('active_or_external_element:' + tag)
        for key, value in attrs:
            if key.startswith('on') or key in ('href', 'xlink:href', 'src', 'srcset', 'action', 'formaction'):
                self.failures.append('active_or_external_attribute:' + key)
            if key == 'http-equiv':
                self.failures.append('http_equiv_not_allowed')
        identifier = values.get('id')
        if identifier:
            if identifier in self.ids:
                self.failures.append('duplicate_id:' + identifier)
            self.ids[identifier] = tag
            self.ancestors[identifier] = tuple(item[1] for item in self.stack)
        if tag == 'animatetransform':
            self.animations[identifier] = (values, self.stack[-1][1] if self.stack else None)
            line, column = self.getpos()
            self.animation_spans[identifier] = (self.line_offsets[line - 1] + column, self.get_starttag_text())
        if tag not in ('meta', 'br', 'hr', 'input', 'img', 'source', 'wbr'):
            self.stack.append((tag, identifier))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                self.stack = self.stack[:index]
                break


def check_bytes(raw):
    result = {'kind': 'model_generated_wukong_contract', 'currentSha256': hashlib.sha256(raw).hexdigest(),
              'scope': 'self-contained HTML/SVG contract only; semantic artwork identity requires visual review; real browser motion checked separately'}
    try:
        text = raw.decode('utf-8')
        assert not re.search(r'<!ENTITY|<!DOCTYPE\s+[^h]|@import', text, re.I), 'external_or_entity_content'
        drawing = Drawing(text)
        drawing.feed(text)
        assert not drawing.failures, ','.join(drawing.failures)
        # Only literal same-document fragments are allowed, with ordinary CSS quoting/spacing.
        # Reject CSS escapes, encoded/external resources and absent targets; do not enable href/use.
        fragment_url = re.compile(r'''url\s*\(\s*(?:(["'])\s*(#[A-Za-z_][A-Za-z0-9_.:-]*)\s*\1|(#[A-Za-z_][A-Za-z0-9_.:-]*))\s*\)''', re.I)
        for candidate in re.finditer(r'\burl\s*\(', text, re.I):
            reference = fragment_url.match(text, candidate.start())
            assert reference, 'external_or_invalid_url_reference'
            target = (reference.group(2) or reference.group(3))[1:]
            assert target in drawing.ids, 'fragment_target_missing:' + target
        assert '<svg' in text.lower(), 'svg_missing'
        for identifier in ('wukong', 'white-dragon-horse', 'rider-motion', 'horse-motion'):
            assert drawing.ids.get(identifier) == 'g', 'required_group_missing:' + identifier
        for artwork, motion in (('wukong', 'rider-motion'), ('white-dragon-horse', 'horse-motion')):
            assert motion in drawing.ancestors[artwork], 'artwork_motion_ancestor_missing:' + artwork
        for identifier, parent in (('rider-bob', 'rider-motion'), ('horse-gallop', 'horse-motion')):
            attrs, actual_parent = drawing.animations.get(identifier, ({}, None))
            assert actual_parent == parent, 'motion_target_missing:' + identifier
            assert attrs.get('begin', '0s') in ('0', '0s', '0ms'), 'animation_not_started:' + identifier
            assert attrs.get('repeatcount') == 'indefinite', 'animation_not_repeating:' + identifier
            assert attrs.get('type') == 'translate', 'motion_not_translate:' + identifier
            values = attrs.get('values', '').split(';')
            assert len(set(value.strip() for value in values)) > 1, 'constant_motion:' + identifier
        result.update(passed=True, failure=None)
    except (AssertionError, UnicodeError, ValueError) as error:
        result.update(passed=False, failure=str(error))
    return result


def pause_smil(raw):
    baseline = check_bytes(raw)
    assert baseline['passed'], 'Fault injection requires a valid original structural contract'
    text = raw.decode('utf-8')
    drawing = Drawing(text)
    drawing.feed(text)
    edits = []
    # Tokenize entire attributes so text resembling begin inside another quoted value is untouched.
    attribute = re.compile(r'''([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?''')
    for identifier in ('rider-bob', 'horse-gallop'):
        offset, tag = drawing.animation_spans[identifier]
        tag_name = re.match(r'<[^\s/>]+', tag)
        tokens = [match for match in attribute.finditer(tag, tag_name.end()) if match.group(1).lower() == 'begin']
        assert len(tokens) <= 1, 'Ambiguous begin attribute:' + identifier
        if tokens:
            token = tokens[0]
            edits.append((offset + token.start(), offset + token.end(), 'begin="indefinite"'))
        else:
            closing = re.search(r'/?>\s*$', tag)
            edits.append((offset + closing.start(), offset + closing.start(), ' begin="indefinite"'))
    for start, end, value in sorted(edits, reverse=True):
        text = text[:start] + value + text[end:]
    injected = text.encode('utf-8')
    failed = check_bytes(injected)
    assert not failed['passed'] and failed['failure'].startswith('animation_not_started:'), 'Injected fault must actually fail'
    return {'kind': 'pause_smil', 'source': text, 'beforeSha256': baseline['currentSha256'],
            'afterSha256': failed['currentSha256'], 'structure': failed, 'animationIds': ['rider-bob', 'horse-gallop']}


if __name__ == '__main__':
    inject = sys.argv[1] == '--pause-smil'
    target = sys.argv[2] if inject else sys.argv[1]
    raw = sys.stdin.buffer.read() if target == '-' else Path(target).read_bytes()
    result = pause_smil(raw) if inject else check_bytes(raw)
    # The pipe may use a Windows legacy code page; ASCII JSON preserves the exact UTF-8 source bytes after parsing.
    print(json.dumps(result, ensure_ascii=True))
    sys.exit(0 if inject or result['passed'] else 1)
