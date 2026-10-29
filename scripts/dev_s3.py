from contextlib import closing
from threading import Event
from urllib.parse import urlsplit

from moto.server import ThreadedMotoServer
from smflw_api.settings import get_settings
from smflw_api.storage import get_s3_client

settings = get_settings()
endpoint = urlsplit(settings.s3_endpoint_url or "")
if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1" or not endpoint.port:
    raise SystemExit("Local S3 requires S3_ENDPOINT_URL=http://127.0.0.1:9000 in .env")

server = ThreadedMotoServer(ip_address="127.0.0.1", port=endpoint.port, verbose=False)
server.start()
try:
    with closing(get_s3_client(settings)) as client:
        options = {}
        if settings.aws_region != "us-east-1":
            options["CreateBucketConfiguration"] = {
                "LocationConstraint": settings.aws_region
            }
        client.create_bucket(Bucket=settings.image_bucket, **options)
        client.put_bucket_cors(
            Bucket=settings.image_bucket,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedOrigins": [
                            "http://127.0.0.1:5173",
                            "http://localhost:5173",
                        ],
                        "AllowedMethods": ["POST"],
                        "AllowedHeaders": ["*"],
                    }
                ],
            },
        )
    print(
        f"Local S3 ready: {settings.s3_endpoint_url} / {settings.image_bucket}",
        flush=True,
    )
    Event().wait()
except KeyboardInterrupt:
    pass
finally:
    server.stop()
