FROM google/cloud-sdk:slim

# Install Python 3, venv, and curl (needed by uv installer and generated scripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager used by generated setup scripts).
# --break-system-packages: this is a container (Debian PEP 668 externally-managed),
# so installing into the system environment is intentional and safe here.
RUN pip3 install --no-cache-dir --break-system-packages uv

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
