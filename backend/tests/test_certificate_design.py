"""PDF typography remains on one page even with maximum-length model identifiers."""

from uuid import uuid4

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from smflw_api.certificate_pdf import render_certificate
from smflw_api.certificate_records import (
    CertificateRecord,
    HumanCertificateRecord,
    record_digest,
)


@pytest.mark.parametrize("human", [False, True])
def test_certificate_text_fits_page_and_keeps_evidence(monkeypatch, human):
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
    record = record_type(**fields, record_sha256=record_digest(fields))
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
        record, f"https://example.com/verify/{record.certificate_id}"
    )
    assert pdf.startswith(b"%PDF-")
    assert len(pages) == 1
    assert str(record.certificate_id) in strings
    assert record.record_sha256 in strings
    assert "NOT HOT DOG" in strings
    if human:
        assert str(record.original_certificate_id) in strings
        assert str(record.review_id) in strings
