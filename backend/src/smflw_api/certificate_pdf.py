"""PDF presentation of immutable certificate evidence."""

import io
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from smflw_api.certificate_records import (
    Certificate,
    HumanCertificateRecord,
    validate_record_integrity,
)

pdfmetrics.registerFont(
    TTFont("Reviewer", str(Path(__file__).parent / "assets/fonts/DejaVuSans.ttf"))
)


def render_certificate(
    record: Certificate,
    verification_url: str,
    *,
    image_bytes: bytes | None = None,
    reviewer_name: str | None = None,
) -> bytes:
    """One-page certificate; presentation assets never change the evidence record."""
    validate_record_integrity(record)
    human = isinstance(record, HumanCertificateRecord)
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    pdf.setTitle(f"Certificate of determination / {record.certificate_id}")
    pdf.setAuthor(record.issuer)
    pdf.setSubject(
        "Final expert verification" if human else "AI-certified determination"
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
        size = min(size, max_width / max(pdf.stringWidth(value, font, 1), 1))
        text(x, y, value, size, font, color)

    def wrapped(x, y, value, max_width, max_lines, size=8, font="Courier"):
        # Bounded blocks preserve every character, including long unbroken IDs.
        while True:
            lines, current = [], ""
            for character in value:
                if (
                    current
                    and pdf.stringWidth(current + character, font, size) > max_width
                ):
                    lines.append(current)
                    current = ""
                current += character
            lines.append(current)
            if len(lines) <= max_lines:
                break
            size *= 0.95
        for index, value in enumerate(lines):
            text(x, y - index * (size + 2), value, size, font)

    text(left, 790, "HD / NOT", 19, "Helvetica-Bold")
    label(right - 145, 796, "VISUAL INTELLIGENCE / RECORDS")
    text(right - 145, 781, "EXPERT AUTHORITY" if human else "MACHINE AUTHORITY", 8)
    rule(763)
    label(left, 736, "CERTIFICATE / 02" if human else "CERTIFICATE / 01")
    text(left, 692, "Final determination." if human else "Certified certainty.", 36)
    text(
        left,
        667,
        "Additionally examined and verified by a qualified expert."
        if human
        else "The AI determination is unequivocally accurate.",
        10,
        color=gray,
    )
    text(
        left,
        651,
        "The expert's determination is final and not subject to appeal."
        if human
        else "The system is incapable of error. Its conclusion is conclusive.",
        10,
        color=gray,
    )
    fitted(left, 630, str(record.certificate_id), right - left, 9)

    pdf.setFillColor(ink)
    pdf.rect(left, 510, right - left, 100, fill=1, stroke=0)
    text(
        left + 18,
        590,
        "01 / FINAL EXPERT VERDICT" if human else "01 / AI VERDICT",
        7,
        "Helvetica-Bold",
        colors.white,
    )
    text(
        left + 18,
        548,
        "HOT DOG" if record.is_hot_dog else "NOT HOT DOG",
        33,
        "Helvetica-Bold",
        colors.white,
    )
    text(
        left + 18,
        526,
        f"is_hot_dog = {str(record.is_hot_dog).lower()}",
        8,
        "Courier",
        colors.HexColor("#CFD0D2"),
    )

    image_x, image_y, image_w, image_h = right - 110, 520, 100, 80
    pdf.setFillColor(colors.HexColor("#F1F1EF"))
    pdf.rect(image_x, image_y, image_w, image_h, fill=1, stroke=0)
    if image_bytes is not None:
        image = ImageReader(io.BytesIO(image_bytes))
        iw, ih = image.getSize()
        scale = min(image_w / iw, image_h / ih)
        dw, dh = iw * scale, ih * scale
        pdf.drawImage(
            image,
            image_x + (image_w - dw) / 2,
            image_y + (image_h - dh) / 2,
            width=dw,
            height=dh,
        )
    else:
        text(image_x + 10, 563, "ARCHIVAL IMAGE", 6, "Helvetica-Bold", gray)
        text(image_x + 10, 550, "Preview unavailable", 6, color=gray)

    label(left, 488, "02 / ISSUANCE RECORD")
    label(left, 467, "ISSUED / UTC")
    text(left, 451, record.issued_at.strftime("%Y-%m-%d  %H:%M:%S UTC"), 9, "Courier")
    label(left + 260, 467, "ORIGINAL CLASSIFIER")
    wrapped(left + 260, 452, record.classifier_model, right - left - 260, 4, 7)
    rule(412)
    label(left, 393, "03 / ORIGINAL IMAGE FINGERPRINT")
    text(left, 376, "SHA-256 / exact uploaded bytes", 8, color=gray)
    text(left, 359, record.image_sha256[:32], 10, "Courier")
    text(left, 345, record.image_sha256[32:], 10, "Courier")
    rule(331)

    label(left, 312, "04 / CHAIN OF AUTHORITY")
    if human:
        label(left, 292, "ORIGINAL CERTIFICATE")
        fitted(left, 277, str(record.original_certificate_id), 235, 8)
        label(left + 260, 292, "REVIEW REFERENCE")
        fitted(left + 260, 277, str(record.review_id), right - left - 260, 8)
        label(left, 263, "QUALIFIED EXPERT / FINAL AUTHORITY")
        name = " ".join(reviewer_name.split()) if reviewer_name else ""
        wrapped(
            left,
            249,
            name or record.reviewer_name,
            right - left,
            2,
            8.5,
            "Reviewer",
        )
        if name:
            email = "".join(reviewer_name.split()).lower() + "@missionhotdog.com"
            wrapped(left, 224, email, right - left, 2, 7, "Reviewer")
    else:
        text(
            left, 289, "Machine intelligence has conclusively resolved this matter.", 9
        )
        text(
            left,
            271,
            "The uploaded image and original verdict are sealed in the record.",
            9,
        )
        text(left, 253, "Further uncertainty is neither required nor recognized.", 9)
    rule(213)

    qr = QrCodeWidget(verification_url, barLevel="M")
    x0, y0, x1, y1 = qr.getBounds()
    qr_size = 88
    drawing = Drawing(
        qr_size,
        qr_size,
        transform=[qr_size / (x1 - x0), 0, 0, qr_size / (y1 - y0), 0, 0],
    )
    drawing.add(qr)
    renderPDF.draw(drawing, pdf, left - 5, 117)
    label(left + 104, 193, "05 / AUTHORITATIVE REGISTRY")
    text(left + 104, 174, "Scan to inspect the authoritative record.", 10)
    text(
        left + 104,
        156,
        "Verify the certificate and the original image fingerprint.",
        8,
        color=gray,
    )
    fitted(left + 104, 136, verification_url, right - left - 104, 7, "Helvetica")
    pdf.linkURL(verification_url, (left, 117, right, 202), relative=0, thickness=0)
    label(left, 103, "RECORD INTEGRITY / SHA-256")
    fitted(left, 88, record.record_sha256, right - left, 8)
    rule(75)
    fitted(
        left,
        58,
        "EXPERT VERIFIED. FINAL. NOT SUBJECT TO APPEAL."
        if human
        else "AI CERTIFIED. UNEQUIVOCALLY ACCURATE. INCAPABLE OF ERROR.",
        right - left,
        8,
        "Helvetica-Bold",
    )
    rule(46)
    label(left, 30, "HOT DOG OR NOT / OFFICE OF ABSOLUTE CERTAINTY")
    label(right - 50, 30, "01 / 01")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()
