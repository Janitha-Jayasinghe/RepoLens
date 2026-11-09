from copy import deepcopy
from io import BytesIO
from urllib.parse import urlsplit

import pymupdf
import pytest
from pypdf import PdfReader
from backend.main import app
from backend.pdf_reports import render_report
from backend.snapshot_api import SNAPSHOT_STORE, SNAPSHOT_LOOKUP
from backend.health_api import HEALTH_CACHE
from backend.tests.test_api import request, snapshot_handler


@pytest.fixture
def snapshot():
    SNAPSHOT_STORE.clear(); SNAPSHOT_LOOKUP.clear(); HEALTH_CACHE.clear()
    value = request('owner/repo', snapshot_handler(), endpoint='/api/snapshot').json()
    yield value
    app.dependency_overrides.clear(); SNAPSHOT_STORE.clear(); SNAPSHOT_LOOKUP.clear(); HEALTH_CACHE.clear()


def pdf_text(data):
    return '\n'.join(page.extract_text() for page in PdfReader(BytesIO(data), strict=True).pages)


def test_pdf_is_parseable_has_embedded_typography_charts_and_source_links(snapshot):
    data = render_report(snapshot)
    reader = PdfReader(BytesIO(data), strict=True)
    assert len(reader.pages) >= 5
    text = pdf_text(data)
    for expected in ['canonical/repo', 'Total detected language bytes: 400', 'Contributor sample', 'Commit activity', 'Maintenance-health assessment', 'Analysis snapshot completed', snapshot['id']]:
        assert expected in text
    fonts = [font.get_object() for page in reader.pages for font in page['/Resources']['/Font'].get_object().values()]
    assert any('/FontDescriptor' in font and '/FontFile2' in font['/FontDescriptor'].get_object() for font in fonts)
    links = [annotation.get_object()['/A']['/URI'] for page in reader.pages for annotation in page.get('/Annots', []) if '/A' in annotation.get_object() and '/URI' in annotation.get_object()['/A']]
    assert any('/commit/' in link for link in links)
    assert all(urlsplit(link).hostname in ('github.com', 'api.github.com') for link in links)
    document = pymupdf.open(stream=data, filetype='pdf')
    assert sum(len(page.get_drawings()) for page in document) > 20


def test_pdf_palette_and_text_stay_within_page_bounds(snapshot):
    document = pymupdf.open(stream=render_report(snapshot), filetype='pdf')
    allowed = [(0, 0, 0), (1, 1, 1), (1, 95 / 255, 0)]
    for page in document:
        for drawing in page.get_drawings():
            for key in ['color', 'fill']:
                color = drawing.get(key)
                if color is not None:
                    assert any(all(abs(a - b) < 0.0001 for a, b in zip(color, expected)) for expected in allowed), color
        for block in page.get_text('dict')['blocks']:
            if block['type'] != 0:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    assert span['color'] in (0x000000, 0xFFFFFF, 0xFF5F00)
                    x0, y0, x1, y1 = span['bbox']
                    assert x0 >= -0.5 and y0 >= -0.5 and x1 <= page.rect.width + 0.5 and y1 <= page.rect.height + 0.5, span


def test_unavailable_statistics_and_partial_history_are_not_invented(snapshot):
    value = deepcopy(snapshot)
    value['overview']['repository']['subscribers_count'] = None
    value['languages'] = {'status': 'unavailable', 'data': None, 'error': {'code': 'missing', 'message': 'Unavailable', 'status': 502, 'retry_after': None}}
    value['commits']['data'].update(complete=False, has_more=True, activity=None, coverage_note='Partial fetched history. More pages exist.')
    health = value['health']['data']; health['score'] = None; health['status'] = 'incomplete'
    health['factors'][0].update(score=None, status='unavailable')
    text = pdf_text(render_report(value))
    assert 'Total detected language bytes' not in text
    assert 'Subscribers' not in text
    assert 'Daily activity chart omitted' in text
    assert 'Assessment incomplete. No overall score.' in text
    assert 'Unscored / 25' in text


def test_external_text_is_escaped_and_unsupported_characters_are_preserved(snapshot):
    value = deepcopy(snapshot)
    value['overview']['repository']['description'] = 'Angstrom \u00c5 \u8868 \U0001f596 <font color="red"><a href="https://unsafe.test">literal</a></font>'
    data = render_report(value)
    text = pdf_text(data)
    assert '[U+8868]' in text and '[U+1F596]' in text
    assert 'Font coverage note' in text
    reader = PdfReader(BytesIO(data), strict=True)
    for page in reader.pages:
        for item in page.get('/Annots', []):
            action = item.get_object().get('/A', {})
            assert 'unsafe.test' not in str(action.get('/URI', ''))


def test_long_commit_subjects_do_not_break_pdf_layout(snapshot):
    value = deepcopy(snapshot)
    value['commits']['data']['commits'][0]['message'] = 'Long subject ' * 1000
    assert '[shortened]' in pdf_text(render_report(value))
