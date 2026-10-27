# Run prepare-sdk.sh and prepare-dependencies.ts before building.
ARG TOOLCHAIN_IMAGE=ubuntu:24.04
FROM ${TOOLCHAIN_IMAGE}
USER root
# Retain softfp for VEXcode/PROS 4.1 and hard for EZ-Template with PROS 4.2.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make clang gcc-arm-none-eabi libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib ca-certificates && rm -rf /var/lib/apt/lists/* \
 && for root in /usr/lib/arm-none-eabi/newlib /usr/lib/gcc/arm-none-eabi/*; do \
      find "$root/arm" "$root/thumb" -mindepth 1 -maxdepth 1 ! -name v7-a+simd -exec rm -rf {} + \
      && find "$root/arm" -mindepth 1 -exec rm -rf {} + \
      && find "$root/thumb/v7-a+simd" -mindepth 1 -maxdepth 1 ! -name softfp ! -name hard -exec rm -rf {} +; \
    done \
 && rm -rf /usr/share/doc /usr/share/man /usr/share/info
COPY vendor/sdk /opt/vex/sdk
COPY vendor/deps /opt/v5x/deps
COPY vendor/library-sources /tmp/library-sources
COPY rebuild-libraries.py /tmp/rebuild-libraries.py
RUN python3 /tmp/rebuild-libraries.py && rm -rf /tmp/library-sources /tmp/rebuild-libraries.py
# Debug sections only slow the cold link (okapilib.a drops from 30 MB to 3 MB); the firmware never uses them.
RUN find /opt/v5x/deps -name '*.a' -exec arm-none-eabi-strip --strip-debug {} +
COPY v5x-build v5x-cxx v5x-server /usr/local/bin/
COPY vexcode.mk /opt/v5x/vexcode.mk
RUN chmod +x /usr/local/bin/v5x-build /usr/local/bin/v5x-cxx /usr/local/bin/v5x-server
RUN (id -u builder >/dev/null 2>&1 || useradd --create-home builder) && mkdir -p /home/builder/workspace && chown -R builder:builder /home/builder/workspace
USER builder
WORKDIR /home/builder/workspace
EXPOSE 8080
CMD ["/usr/local/bin/v5x-server"]
