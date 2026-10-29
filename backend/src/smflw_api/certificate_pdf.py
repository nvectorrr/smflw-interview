"""PDF presentation of immutable certificate evidence."""

import io

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from smflw_api.certificate_records import (
    Certificate,
    HumanCertificateRecord,
    validate_record_integrity,
)


def render_certificate(record: Certificate, verification_url: str) -> bytes:
    """One-page operational record with a restrained, typographic hierarchy."""
    validate_record_integrity(record)
    human = isinstance(record, HumanCertificateRecord)
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    pdf.setTitle(f"Verification record / {record.certificate_id}")
    pdf.setAuthor(record.issuer)
    pdf.setSubject(
        "Final human verification" if human else "Automated visual assessment"
    )
    width, _ = A4
    left, right = 42, width - 42
    ink = colors.HexColor("#1B1C1E")
    gray = colors.HexColor("#606268")
    line = colors.HexColor("#CFD0D2")

    def text(x, y, value, size=9, font="Helvetica", color=ink):
        pdf.setFillColor(color)
        pdf.setFont(font, size)
        pdf.drawString(x, y, value)

    def rule(y):
        pdf.setStrokeColor(line)
        pdf.setLineWidth(0.55)
        pdf.line(left, y, right, y)

    def label(x, y, value):
        text(x, y, value, 7, "Helvetica-Bold", gray)

    def fitted(x, y, value, max_width, size=9, font="Courier", color=ink):
        # Long references retain every character while respecting their column.
        size = min(size, max_width / max(pdf.stringWidth(value, font, 1), 1))
        text(x, y, value, size, font, color)

    text(left, 790, "HD / NOT", 19, "Helvetica-Bold")
    label(right - 145, 796, "VISUAL INTELLIGENCE / RECORDS")
    text(right - 145, 781, "HUMAN REVIEW" if human else "MODEL ASSESSMENT", 8)
    rule(763)
    label(left, 736, "CERTIFICATE / 02" if human else "CERTIFICATE / 01")
    text(left, 688, "Human verification." if human else "Visual assessment.", 38)
    text(
        left,
        663,
        "Final determination by an authorized team supervisor."
        if human
        else "Recorded determination from automated image analysis.",
        10,
        color=gray,
    )
    fitted(left, 643, str(record.certificate_id), right - left, 9)

    pdf.setFillColor(ink)
    pdf.rect(left, 528, right - left, 94, fill=1, stroke=0)
    text(
        left + 18,
        602,
        "01 / FINAL HUMAN VERDICT" if human else "01 / MODEL VERDICT",
        7,
        "Helvetica-Bold",
        colors.white,
    )
    text(
        left + 18,
        561,
        "HOT DOG" if record.is_hot_dog else "NOT HOT DOG",
        33,
        "Helvetica-Bold",
        colors.white,
    )
    text(
        left + 18,
        542,
        f"is_hot_dog = {str(record.is_hot_dog).lower()}",
        8,
        "Courier",
        colors.HexColor("#CFD0D2"),
    )

    label(left, 505, "02 / ASSESSMENT METADATA")
    label(left, 484, "ISSUED / UTC")
    text(left, 468, record.issued_at.strftime("%Y-%m-%d  %H:%M:%S UTC"), 9, "Courier")
    label(left + 260, 484, "ORIGINAL CLASSIFIER")
    # Wrap even long custom model identifiers without dropping evidence.
    model_lines = []
    current = ""
    for character in record.classifier_model:
        if pdf.stringWidth(current + character, "Courier", 7) > right - left - 260:
            model_lines.append(current)
            current = ""
        current += character
    model_lines.append(current)
    for index, value in enumerate(model_lines):
        text(left + 260, 470 - index * 8, value, 7, "Courier")
    rule(434)
    label(left, 415, "03 / ORIGINAL IMAGE FINGERPRINT")
    text(left, 397, "SHA-256 / exact uploaded bytes", 8, color=gray)
    text(left, 377, record.image_sha256[:32], 11, "Courier")
    text(left, 362, record.image_sha256[32:], 11, "Courier")
    rule(347)

    label(left, 327, "04 / EVIDENCE CHAIN")
    if human:
        label(left, 307, "ORIGINAL CERTIFICATE")
        text(left, 292, str(record.original_certificate_id), 9, "Courier")
        label(left, 273, "REVIEW REFERENCE")
        text(left, 258, str(record.review_id), 9, "Courier")
    else:
        text(
            left, 306, "The file fingerprint binds this verdict to one exact image.", 9
        )
        text(
            left,
            289,
            "Verification compares the stored record and its integrity hash.",
            9,
        )
        text(
            left,
            272,
            "The recorded model verdict remains part of the evidence chain.",
            9,
        )
    rule(242)

    qr = QrCodeWidget(verification_url, barLevel="M")
    x0, y0, x1, y1 = qr.getBounds()
    qr_size = 88
    drawing = Drawing(
        qr_size,
        qr_size,
        transform=[qr_size / (x1 - x0), 0, 0, qr_size / (y1 - y0), 0, 0],
    )
    drawing.add(qr)
    renderPDF.draw(drawing, pdf, left - 5, 143)
    label(left + 104, 221, "05 / SERVICE VERIFICATION")
    text(left + 104, 201, "Scan to inspect the authoritative record.", 10)
    text(
        left + 104,
        183,
        "Compare your file against the recorded image fingerprint.",
        8,
        color=gray,
    )
    fitted(left + 104, 164, verification_url, right - left - 104, 7, "Helvetica")
    pdf.linkURL(verification_url, (left, 143, right, 231), relative=0, thickness=0)
    label(left, 128, "RECORD INTEGRITY / SHA-256")
    fitted(left, 113, record.record_sha256, right - left, 8)
    rule(99)
    text(
        left,
        82,
        "HUMAN VERIFIED. FINAL AND NOT SUBJECT TO APPEAL WITHIN THIS SERVICE."
        if human
        else "AUTOMATED ASSESSMENT. THE MODEL RESULT MAY BE INCORRECT.",
        7.5,
        "Helvetica-Bold",
    )
    text(
        left,
        67,
        "Service-issued evidence; no external accreditation. "
        "This PDF is not digitally signed.",
        7.5,
        color=gray,
    )
    rule(51)
    label(left, 34, "HOT DOG OR NOT / VERIFICATION OFFICE")
    label(right - 50, 34, "01 / 01")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()
