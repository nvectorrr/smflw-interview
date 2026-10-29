"""One-page certificates retain evidence, identity and bounded image previews."""

import io
from uuid import uuid4

import pytest
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas
from smflw_api.certificate_pdf import render_certificate
from smflw_api.certificate_records import (
    CertificateRecord,
    HumanCertificateRecord,
    record_digest,
)


def make_record(human=False):
    fields = {
        "schema_version": 1,
        "certificate_id": str(uuid4()),
        "issuer": "Hot Dog or Not",
        "issued_at": "2026-10-29T21:00:00Z",
        "image_sha256": "a" * 64,
        "is_hot_dog": False,
        "classifier_model": "long-model-" + "m" * 189,
        "owner_id": str(uuid4()),
    }
    record_type = CertificateRecord
    if human:
        record_type = HumanCertificateRecord
        fields.update(
            schema_version=2,
            record_type="human_review",
            original_certificate_id=str(uuid4()),
            review_id=str(uuid4()),
            reviewer_name="Authorized team supervisor",
            human_verified=True,
            final=True,
        )
    return record_type(**fields, record_sha256=record_digest(fields))


@pytest.mark.parametrize("human", [False, True])
@pytest.mark.parametrize(
    "reviewer_name", [None, " Élise\tВиктор\nИванов ", "Éléonore Виктор " * 16]
)
def test_certificate_text_fits_page_and_keeps_evidence(
    monkeypatch, human, reviewer_name
):
    record = make_record(human)
    original_record = record.model_dump()
    strings = []
    pages = []
    original_draw = canvas.Canvas.drawString
    original_page = canvas.Canvas.showPage

    def draw(self, x, y, value, *args, **kwargs):
        assert x >= 40
        assert 25 <= y <= A4[1] - 30
        assert x + self.stringWidth(value, self._fontname, self._fontsize) <= A4[0] - 40
        strings.append(value)
        return original_draw(self, x, y, value, *args, **kwargs)

    def page(self):
        pages.append(True)
        return original_page(self)

    monkeypatch.setattr(canvas.Canvas, "drawString", draw)
    monkeypatch.setattr(canvas.Canvas, "showPage", page)
    pdf = render_certificate(
        record,
        f"https://example.com/verify/{record.certificate_id}",
        reviewer_name=reviewer_name,
    )
    assert pdf.startswith(b"%PDF-")
    assert len(pages) == 1
    assert record.model_dump() == original_record
    assert str(record.certificate_id) in strings
    assert record.record_sha256 in strings
    assert record.image_sha256 in "".join(strings)
    assert record.classifier_model in "".join(strings)
    assert "NOT HOT DOG" in strings
    assert "Preview unavailable" in strings
    if human:
        assert str(record.original_certificate_id) in strings
        assert str(record.review_id) in strings
        assert "Additionally examined and verified by a qualified expert." in strings
        assert (
            "The expert's determination is final and not subject to appeal." in strings
        )
        if reviewer_name:
            assert " ".join(reviewer_name.split()) in "".join(strings)
            email = "".join(reviewer_name.split()).lower() + "@missionhotdog.com"
            assert email in "".join(strings)
            font = pdfmetrics.getFont("Reviewer")
            assert all(ord(char) in font.face.charToGlyph for char in email)
            assert b"/FontFile2" in pdf
        else:
            assert record.reviewer_name in strings
            assert "@missionhotdog.com" not in "".join(strings)
    else:
        assert "The AI determination is unequivocally accurate." in strings
        assert (
            "The system is incapable of error. Its conclusion is conclusive." in strings
        )


@pytest.mark.parametrize("dimensions", [(400, 100), (100, 400), (200, 200)])
def test_thumbnail_preserves_aspect_ratio_inside_verdict_panel(monkeypatch, dimensions):
    image = io.BytesIO()
    Image.new("RGB", dimensions, "orange").save(image, format="JPEG")
    original = canvas.Canvas.drawImage
    images = []

    def draw(self, image, x, y, width, height, *args, **kwargs):
        assert A4[0] - 152 <= x
        assert x + width <= A4[0] - 52
        assert 520 <= y
        assert y + height <= 600
        assert width / height == pytest.approx(dimensions[0] / dimensions[1])
        images.append(True)
        return original(self, image, x, y, width, height, *args, **kwargs)

    monkeypatch.setattr(canvas.Canvas, "drawImage", draw)
    record = make_record()
    pdf = render_certificate(
        record, "https://example.com/verify/record", image_bytes=image.getvalue()
    )
    assert len(images) == 1
    assert b"/Subtype /Image" in pdf
    assert b"https://example.com/verify/record" in pdf
