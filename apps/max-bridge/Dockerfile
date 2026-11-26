# Voxly MAX bridge — personal MAX account sessions (PyMax / maxapi-python).
# ADR-025. Auth: Bearer VOXLY_SERVICE_TOKEN. Pattern mirrors gramjs-bridge.

FROM python:3.12-slim

WORKDIR /voxly/apps/max-bridge

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY apps/max-bridge/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/max-bridge/src ./src

ENV PYTHONUNBUFFERED=1 \
    MAX_BRIDGE_PORT=3010 \
    MAX_SESSION_DIR=/data/max-sessions

VOLUME ["/data/max-sessions"]
EXPOSE 3010

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3010"]
