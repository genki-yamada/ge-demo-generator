FROM google/cloud-sdk:slim

# Install Python 3, venv, and curl (needed by uv installer and generated scripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
      python3-pip \
      curl \
      jq \
      make \
      git \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager used by generated setup scripts).
# --break-system-packages: this is a container (Debian PEP 668 externally-managed),
# so installing into the system environment is intentional and safe here.
RUN pip3 install --no-cache-dir --break-system-packages uv

# Run in $HOME so the generated script's relative `cd ${dirName}` lands its .env at
# $HOME/${dirName}/.env — the exact path entrypoint.sh persists/restores (DEMO_DIR==demo.id).
# Makes the CWD==$HOME contract explicit rather than relying on the base image default.
WORKDIR /root

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
