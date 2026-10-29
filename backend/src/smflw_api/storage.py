import io
from contextlib import closing
from uuid import UUID, uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

from smflw_api.settings import Settings

MAX_BYTES = 5 * 1024 * 1024
MEDIA_TYPES = ("image/jpeg", "image/png", "image/webp")


def get_s3_client(settings: Settings):
    options = {}
    if settings.s3_endpoint_url:
        options = {
            "endpoint_url": settings.s3_endpoint_url,
            "aws_access_key_id": "local",
            "aws_secret_access_key": "local",
        }
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        **options,
    )


def create_upload(
    settings: Settings,
    content_type: str,
    size_bytes: int,
    owner_id: UUID,
) -> dict:
    upload_id = uuid4()
    try:
        with closing(get_s3_client(settings)) as client:
            ticket = client.generate_presigned_post(
                Bucket=settings.image_bucket,
                Key=f"uploads/{owner_id}/{upload_id}",
                Fields={"Content-Type": content_type},
                Conditions=[
                    {"Content-Type": content_type},
                    ["content-length-range", size_bytes, size_bytes],
                ],
                ExpiresIn=300,
            )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            503, "Storage is temporarily unavailable. Please try again."
        ) from exc
    return {"upload_id": upload_id, **ticket}


def read_image(
    settings: Settings,
    upload_id: UUID,
    owner_id: UUID,
) -> tuple[bytes, str]:
    try:
        with closing(get_s3_client(settings)) as client:
            response = client.get_object(
                Bucket=settings.image_bucket,
                Key=f"uploads/{owner_id}/{upload_id}",
            )
            with closing(response["Body"]) as body:
                if not 0 < response["ContentLength"] <= MAX_BYTES:
                    raise HTTPException(413, "The image must be no larger than 5 MB.")
                data = body.read(MAX_BYTES + 1)
            media_type = response.get("ContentType", "")
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {"NoSuchKey", "404", "AccessDenied"}:
            raise HTTPException(
                404, "Image not found. Please upload it again."
            ) from exc
        raise HTTPException(503, "Storage is temporarily unavailable.") from exc
    except BotoCoreError as exc:
        raise HTTPException(503, "Storage is temporarily unavailable.") from exc
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "The image must be no larger than 5 MB.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 16_000_000 or max(image.size) > 8000:
                raise HTTPException(
                    413,
                    "Resize the image to at most 16 megapixels "
                    "and 8000 pixels per side.",
                )
            if (
                media_type not in MEDIA_TYPES
                or Image.MIME.get(image.format) != media_type
            ):
                raise HTTPException(400, "The file format does not match the image.")
            if getattr(image, "is_animated", False):
                raise HTTPException(
                    400, "Choose a still image instead of an animation."
                )
            image.load()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise HTTPException(
            400, "Unable to read this image. Please choose another image."
        ) from exc
    return data, media_type
