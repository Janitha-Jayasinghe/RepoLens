"""Branded vector PDF reports from trusted server-held analytics snapshots."""
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Flowable

BLACK = colors.Color(0, 0, 0)
WHITE = colors.Color(1, 1, 1)
ORANGE = colors.Color(1, 95 / 255, 0)
FONT_LOCK = Lock()


def register_fonts():
    with FONT_LOCK:
        if 'RepoLens' not in pdfmetrics.getRegisteredFontNames():
            root = Path(reportlab.__file__).parent / 'fonts'
            pdfmetrics.registerFont(TTFont('RepoLens', str(root / 'Vera.ttf')))
            pdfmetrics.registerFont(TTFont('RepoLens-Bold', str(root / 'VeraBd.ttf')))
            pdfmetrics.registerFontFamily('RepoLens', normal='RepoLens', bold='RepoLens-Bold', italic='RepoLens', boldItalic='RepoLens-Bold')


def number(value):
    return f'{value:,}'


def date(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc).strftime('%b %d, %Y %H:%M UTC')


class HorizontalBars(Flowable):
    def __init__(self, rows, formatter=number, width=499):
        Flowable.__init__(self)
        self.rows = rows
        self.formatter = formatter
        self.width = width
        self.height = 24 + 23 * len(rows)

    def draw(self):
        canvas = self.canv
        maximum = max((value for _, value in self.rows), default=0)
        left, plot = 120, self.width - 260
        canvas.saveState()
        canvas.setFont('RepoLens', 8)
        for index, (name, value) in enumerate(self.rows):
            y = self.height - 24 - index * 23
            canvas.setFillColor(BLACK)
            label = name
            while pdfmetrics.stringWidth(label, 'RepoLens', 8) > 110 and len(label) > 3:
                label = label[:-4] + '...'
            canvas.drawString(0, y + 3, label)
            canvas.setFillColor(ORANGE)
            if maximum and value:
                canvas.rect(left, y, plot * value / maximum, 12, fill=1, stroke=0)
            canvas.setFillColor(BLACK)
            canvas.drawRightString(self.width, y + 3, self.formatter(value))
        canvas.restoreState()


class DailyBars(Flowable):
    def __init__(self, activity, width=499):
        Flowable.__init__(self)
        self.activity = activity
        self.width = width
        self.height = 190

    def draw(self):
        canvas = self.canv
        left, bottom, plot_height = 27, 28, 140
        plot_width = self.width - 35
        maximum = max((day['count'] for day in self.activity), default=0) or 1
        canvas.saveState()
        canvas.setFont('RepoLens', 7)
        for fraction in (0, 0.5, 1):
            y = bottom + plot_height * fraction
            canvas.setStrokeColor(BLACK); canvas.setStrokeAlpha(0.15); canvas.setLineWidth(0.5)
            canvas.line(left, y, self.width, y); canvas.setStrokeAlpha(1)
            canvas.setFillColor(BLACK); canvas.drawRightString(left - 5, y - 2, f'{maximum * fraction:g}')
        step = plot_width / max(1, len(self.activity))
        for index, day in enumerate(self.activity):
            canvas.setFillColor(ORANGE)
            if day['count']:
                canvas.rect(left + index * step + step * 0.12, bottom, step * 0.76, plot_height * day['count'] / maximum, fill=1, stroke=0)
        for index in sorted({0, len(self.activity) // 2, len(self.activity) - 1}):
            if index < 0:
                continue
            canvas.setFillColor(BLACK)
            label = self.activity[index]['date']
            canvas.drawCentredString(min(self.width - 26, max(left + 26, left + (index + 0.5) * step)), 10, label)
        canvas.restoreState()


class ScoreGauge(Flowable):
    def __init__(self, score):
        Flowable.__init__(self)
        self.score = score
        self.width, self.height = 120, 120

    def draw(self):
        canvas = self.canv
        canvas.saveState(); canvas.setLineWidth(7)
        canvas.setStrokeColor(BLACK); canvas.setStrokeAlpha(0.15); canvas.circle(60, 60, 46, fill=0, stroke=1); canvas.setStrokeAlpha(1)
        canvas.setStrokeColor(ORANGE)
        if self.score is None:
            canvas.setDash(3, 4); canvas.circle(60, 60, 46, fill=0, stroke=1); canvas.setDash()
        elif self.score:
            canvas.arc(14, 14, 106, 106, startAng=90, extent=-3.6 * self.score)
        canvas.setFillColor(BLACK); canvas.setFont('RepoLens-Bold', 25)
        canvas.drawCentredString(60, 60, str(self.score) if self.score is not None else 'N/A')
        canvas.setFont('RepoLens', 8); canvas.drawCentredString(60, 43, 'out of 100' if self.score is not None else 'Incomplete')
        canvas.restoreState()


class ReportBuilder:
    def __init__(self, snapshot):
        register_fonts()
        self.snapshot = snapshot
        self.fallback_used = False
        self.glyphs = pdfmetrics.getFont('RepoLens').face.charToGlyph
        self.styles = {
            'body': ParagraphStyle('Body', fontName='RepoLens', fontSize=9, leading=14, textColor=BLACK, spaceAfter=9, alignment=TA_LEFT, splitLongWords=True),
            'small': ParagraphStyle('Small', fontName='RepoLens', fontSize=7.5, leading=11, textColor=BLACK, spaceAfter=7, splitLongWords=True),
            'title': ParagraphStyle('Title', fontName='RepoLens-Bold', fontSize=26, leading=33, textColor=BLACK, spaceAfter=14),
            'heading': ParagraphStyle('Heading', fontName='RepoLens-Bold', fontSize=16, leading=21, textColor=ORANGE, spaceAfter=12, keepWithNext=True),
            'cell': ParagraphStyle('Cell', fontName='RepoLens', fontSize=8, leading=12, textColor=BLACK, splitLongWords=True),
            'header': ParagraphStyle('Header', fontName='RepoLens-Bold', fontSize=8, leading=12, textColor=WHITE),
        }
        self.story = []

    def text(self, value):
        result = []
        for character in str(value):
            code = ord(character)
            if character in '\n\t' or code in self.glyphs:
                result.append(character)
            elif code >= 32:
                result.append(f'[U+{code:04X}]'); self.fallback_used = True
            else:
                result.append(' ')
        return escape(''.join(result)).replace('\n', '<br/>')

    def p(self, value, style='body'):
        return Paragraph(self.text(value), self.styles[style])

    def add(self, value, style='body'):
        self.story.append(self.p(value, style))

    def link(self, url, label=None):
        try:
            parsed = urlsplit(url)
            safe = parsed.scheme == 'https' and parsed.hostname in ('github.com', 'api.github.com') and not parsed.username and not parsed.password
        except ValueError:
            safe = False
        label = self.text(label or url)
        if not safe:
            return Paragraph(label, self.styles['cell'])
        return Paragraph(f'<link href="{escape(url, {chr(34): "&quot;"})}" color="#000000">{label}</link>', self.styles['cell'])

    def table(self, headers, rows, widths):
        content = [[self.p(header, 'header') for header in headers]]
        for row in rows:
            content.append([item if isinstance(item, Paragraph) else self.p(item, 'cell') for item in row])
        table = Table(content, colWidths=widths, repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), BLACK), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8), ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8), ('LINEBELOW', (0, 1), (-1, -1), 0.3, BLACK)]))
        self.story.extend([table, Spacer(1, 14)])

    def section(self, title):
        self.story.append(PageBreak()); self.add(title, 'heading')

    def provenance(self, data):
        if data.get('source_url'):
            self.story.append(self.link(data['source_url'], 'GitHub source: ' + data['source_url']))
        self.add('Section retrieved: ' + date(data['analyzed_at']), 'small')

    def build(self):
        snapshot = self.snapshot
        overview = snapshot['overview']; repo = overview['repository']
        self.add('RepoLens', 'title'); self.add('REPOSITORY ANALYTICS REPORT', 'heading')
        self.add(repo['full_name'], 'title')
        if repo.get('description'):
            self.add(repo['description'])
        self.story.append(self.link(overview['source_url'], overview['source_url']))
        self.add('Analysis snapshot completed: ' + date(snapshot['analyzed_at']))
        self.add('Overview retrieved: ' + date(overview['analyzed_at']), 'small')
        self.add('Snapshot ID: ' + str(snapshot['id']), 'small')
        self.add('Independent GitHub snapshots with explicit coverage limits. This report is not a repository ranking or an objective source-code quality assessment.')
        rows = [('Stars', number(repo['stargazers_count'])), ('Forks', number(repo['forks_count'])), ('Open issues + pull requests', number(repo['open_issues_count']))]
        for label, key, formatter in [('Subscribers', 'subscribers_count', number), ('Repository size', 'size', lambda value: number(value) + ' KB')]:
            if repo.get(key) is not None:
                rows.append((label, formatter(repo[key])))
        self.table(['Statistic', 'GitHub-reported value'], rows, [250, 249])
        details = [('Owner', repo['owner']['login']), ('Default branch', repo['default_branch']), ('Created', date(repo['created_at']))]
        if repo.get('pushed_at'):
            details.append(('Last push', date(repo['pushed_at'])))
        if repo.get('language'):
            details.append(('Primary language', repo['language']))
        if repo.get('license'):
            details.append(('Detected license', repo['license']['name']))
        if repo.get('topics'):
            details.append(('Topics', ', '.join(repo['topics'])))
        self.table(['Repository detail', 'Value'], details, [150, 349])
        self.add('The combined open count above includes pull requests. Unknown optional metadata is omitted, never replaced with zero.', 'small')
        omitted = [name for name in ('languages', 'contributors', 'commits', 'health') if snapshot[name]['status'] != 'available']
        if omitted:
            self.add('Omitted analytics: ' + ', '.join(omitted) + '. These sections were unavailable at collection time; no figures are inferred.', 'small')
        section = snapshot['languages']
        if section['status'] == 'available':
            data = section['data']; self.section('Language analytics')
            self.add('Total detected language bytes: ' + number(data['total_bytes']))
            languages = sorted(data['languages'].items(), key=lambda pair: pair[1], reverse=True)
            if data['total_bytes']:
                bars = languages[:10]
                self.story.append(HorizontalBars([(self.text(name), value) for name, value in bars], lambda value: number(value) + ' bytes'))
                self.add('Chart: up to 10 largest detected languages. The table preserves all returned language byte counts.', 'small')
                self.table(['Language', 'Detected bytes', 'Share'], [(name, number(value), f'{value / data["total_bytes"] * 100:.2f}%') for name, value in languages], [225, 150, 124])
            else:
                self.add('GitHub detected no language bytes; no distribution is calculated.')
            self.provenance(data)
        section = snapshot['contributors']
        if section['status'] == 'available':
            data = section['data']; self.section('Contributor sample')
            self.add(data['coverage_note'])
            if data['contributors']:
                self.story.append(HorizontalBars([(self.text(item['login']), item['contributions']) for item in data['contributors']]))
                self.table(['Rank', 'GitHub profile', 'Contributions'], [(str(index + 1), self.link(item['html_url'], item['login']), number(item['contributions'])) for index, item in enumerate(data['contributors'])], [50, 300, 149])
            else:
                self.add('No contributors were returned by GitHub.')
            self.add('Additional pages reported: ' + ('yes' if data['has_more'] else 'no') + '. Returned contributors are not the complete contributor population.', 'small')
            self.provenance(data)
        section = snapshot['commits']
        if section['status'] == 'available':
            data = section['data']; self.section('Commit activity')
            self.add(data['coverage_note'])
            self.add(f'Selected UTC window: {date(data["range_start"])} to {date(data["range_end"])}. Fetched unique commits: {number(data["fetched_count"])}.')
            if data['complete'] and data['activity'] is not None:
                if data['fetched_count']:
                    self.story.append(DailyBars(data['activity']))
                else:
                    self.add('The selected range was exhausted with no matching commits.')
            else:
                self.add('Daily activity chart omitted: the bounded commit history is incomplete. Missing days are not shown as zero.')
            recent = data['commits'][:10]
            if recent:
                self.add(f'Recent {len(recent)} of {data["fetched_count"]} fetched commits; not all-time history. Long subjects are shortened; full messages are linked on GitHub.', 'small')
                self.table(['Commit', 'Message / author', 'Committed (UTC)'], [(self.link(item['html_url'], item['sha'][:10]), ((item['message'].splitlines()[0][:300] + (' [shortened]' if len(item['message'].splitlines()[0]) > 300 else '')) if item['message'].splitlines() else '(No message)') + '\nAuthor: ' + (item.get('author_name') or item.get('author_login') or 'Unlinked author'), date(item['committed_at'])) for item in recent], [90, 275, 134])
            self.provenance(data)
        section = snapshot['health']
        if section['status'] == 'available':
            data = section['data']; self.section('Maintenance-health assessment')
            self.story.append(ScoreGauge(data['score']))
            self.add('Methodology: ' + data['methodology_version'] + '. This is a maintenance-signal heuristic, not an objective source-code quality, correctness, or security score.')
            if data['score'] is None:
                self.add(f'Assessment incomplete. No overall score. Verified points: {data["observed_points"]}/{data["available_weight"]} assessed weight. Possible bounds: {data["lower_bound"]}-{data["upper_bound"]}/100; not a prediction.')
            else:
                self.add(f'Maintenance-signal score: {data["score"]}/100. All six factors assessed.')
            self.table(['Factor', 'Points / weight', 'Explanation'], [(item['label'], 'Unscored / ' + str(item['weight']) if item['score'] is None else f'{item["score"]} / {item["weight"]}', item['explanation']) for item in data['factors']], [135, 85, 279])
            for item in data['factors']:
                self.add(item['label'] + ' rule: ' + item['rule'], 'small')
            for suggestion in data['maintenance_suggestions']:
                self.add('Maintenance suggestion: ' + suggestion, 'small')
            for suggestion in data['data_suggestions']:
                self.add('Evidence gap: ' + suggestion, 'small')
            for limit in data['limitations']:
                self.add(limit, 'small')
            self.add('Assessment retrieved: ' + date(data['analyzed_at']), 'small')
            self.add('Evidence source links:', 'small')
            for url in dict.fromkeys(url for item in data['factors'] for url in item['source_urls']):
                self.story.append(self.link(url))
        self.story.append(Spacer(1, 12))
        if self.fallback_used:
            self.add('Font coverage note: unsupported characters are preserved as Unicode code-point tokens such as [U+1F596]. No metrics are altered.', 'small')
        self.add('Generated: ' + datetime.now(timezone.utc).strftime('%b %d, %Y %H:%M UTC'), 'small')
        stream = BytesIO()
        document = SimpleDocTemplate(stream, pagesize=A4, leftMargin=48, rightMargin=48, topMargin=52, bottomMargin=45, title='RepoLens - ' + repo['full_name'], author='RepoLens', allowSplitting=1)
        def decorate(canvas, doc):
            canvas.saveState(); canvas.setFillColor(WHITE); canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
            # The canvas callback runs before content, so the white paper cannot cover the flowables.
            canvas.setFillColor(BLACK); canvas.setFont('RepoLens-Bold', 8); canvas.drawString(48, A4[1] - 27, 'REPOLENS / REPOSITORY ANALYTICS')
            canvas.setStrokeColor(ORANGE); canvas.setLineWidth(1.4); canvas.line(48, A4[1] - 37, A4[0] - 48, A4[1] - 37)
            canvas.setFont('RepoLens', 7); canvas.drawString(48, 25, repo['full_name']); canvas.drawRightString(A4[0] - 48, 25, f'Page {doc.page}'); canvas.restoreState()
        document.build(self.story, onFirstPage=decorate, onLaterPages=decorate)
        return stream.getvalue()


def render_report(snapshot):
    return ReportBuilder(snapshot).build()
