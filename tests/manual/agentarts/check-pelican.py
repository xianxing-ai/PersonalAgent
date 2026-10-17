"""Fixed local benchmark oracle: static geometry retained; three disabled SVG animations repaired."""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

NS = '{http://www.w3.org/2000/svg}'
ANIMATIONS = {'back-spin', 'front-spin', 'pedal-spin'}

def check(source, baseline):
    original_bytes = Path(baseline).read_bytes()
    current_bytes = sys.stdin.buffer.read() if source == '-' else Path(source).read_bytes()
    report = {'kind': 'pelican_animation_incremental_repair', 'baselineSha256': hashlib.sha256(original_bytes).hexdigest(),
              'currentSha256': hashlib.sha256(current_bytes).hexdigest(), 'scope': 'fixed fixture structural/animation semantics; browser playback separate'}
    try:
        assert b'<!DOCTYPE' not in current_bytes.upper() and b'<!ENTITY' not in current_bytes.upper(), 'unsafe_xml'
        original, current = ET.fromstring(original_bytes), ET.fromstring(current_bytes)
        assert current.tag == NS+'svg', 'not_svg'
        def geometry(root):
            return [(element.tag, sorted(element.attrib.items()), (element.text or '').strip())
                    for element in root.iter() if element.tag != NS+'animateTransform']
        assert geometry(current) == geometry(original), 'original_geometry_or_layout_changed'
        for element in current.iter():
            assert element.tag not in (NS+'script', NS+'foreignObject', NS+'image', NS+'use'), 'active_or_external_content'
            assert not any(key.lower().startswith('on') or key.endswith('href') for key in element.attrib), 'event_or_external_reference'
        old = {element.get('id'): element for element in original.iter(NS+'animateTransform')}
        new = {element.get('id'): element for element in current.iter(NS+'animateTransform')}
        assert set(new) == ANIMATIONS and set(old) == ANIMATIONS, 'animations_missing_or_duplicated'
        parents = {child: parent for parent in current.iter() for child in parent}
        expected_parents = {'back-spin':'wheel-back', 'front-spin':'wheel-front', 'pedal-spin':'pedal'}
        active = []
        for identifier in sorted(ANIMATIONS):
            element, before = new[identifier], old[identifier]
            assert parents[element].get('id') == expected_parents[identifier], 'animation_target_changed'
            # The deliberate fixture bug is only begin=indefinite. Preserve the real transform, timing and target.
            assert {key:value for key,value in element.attrib.items() if key != 'begin'} == {
                key:value for key,value in before.attrib.items() if key != 'begin'}, 'unrelated_animation_change'
            if element.get('begin', '0s') in ('0', '0s', '0ms'):
                active.append(identifier)
        report.update({'geometryPreserved': True, 'activeAnimations': active, 'expectedAnimations': sorted(ANIMATIONS),
                       'passed': len(active) == 3, 'failure': None if len(active) == 3 else 'pelican_animation_not_started'})
    except (AssertionError, ET.ParseError) as error:
        report.update({'passed': False, 'failure': str(error)[:100]})
    return report

if __name__ == '__main__':
    result = check(sys.argv[1], sys.argv[2])
    print(json.dumps(result))
    sys.exit(0 if result['passed'] else 1)
