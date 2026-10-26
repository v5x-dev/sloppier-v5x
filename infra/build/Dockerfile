# Run prepare-sdk.sh and prepare-dependencies.ts before building.
ARG TOOLCHAIN_IMAGE=ubuntu:24.04
FROM ${TOOLCHAIN_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 make clang gcc-arm-none-eabi libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib ca-certificates && rm -rf /var/lib/apt/lists/*
# Completion runs clangd beside builds; a separate layer keeps toolchain layers reusable.
RUN apt-get update && apt-get install -y --no-install-recommends clangd && rm -rf /var/lib/apt/lists/*
COPY vendor/sdk /opt/vex/sdk
COPY vendor/deps /opt/v5x/deps
COPY v5x-build v5x-cxx v5x-server /usr/local/bin/
COPY vexcode.mk /opt/v5x/vexcode.mk
RUN chmod +x /usr/local/bin/v5x-build /usr/local/bin/v5x-cxx /usr/local/bin/v5x-server
RUN (id -u builder >/dev/null 2>&1 || useradd --create-home builder) && mkdir -p /home/builder/workspace && chown -R builder:builder /home/builder/workspace
USER builder
WORKDIR /home/builder/workspace
EXPOSE 8080
CMD ["/usr/local/bin/v5x-server"]
