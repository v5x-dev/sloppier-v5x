#!/usr/bin/env bash
# Build a V5-focused clangd with native Wasm suspension, rather than Asyncify.
set -euo pipefail
language_dir=$(cd "$(dirname "$0")" && pwd)
build_root=${V5X_LANGUAGE_BUILD_ROOT:-"${XDG_CACHE_HOME:-$HOME/.cache}/v5x-clangd-build"}
build_jobs=${V5X_LANGUAGE_BUILD_JOBS:-4}
mkdir -p "$build_root"
if [[ ! -d "$build_root/emsdk" ]]; then
  git clone --depth 1 --branch 4.0.22 https://github.com/emscripten-core/emsdk.git "$build_root/emsdk"
fi
cd "$build_root/emsdk"
./emsdk install 4.0.22
./emsdk activate 4.0.22
source ./emsdk_env.sh
if [[ ! -d "$build_root/llvm-project" ]]; then
  git clone --depth 1 --filter=blob:none --sparse --branch llvmorg-21.1.0 https://github.com/llvm/llvm-project.git "$build_root/llvm-project"
fi
cd "$build_root/llvm-project"
git sparse-checkout set llvm clang clang-tools-extra cmake third-party
if git apply --check "$language_dir/wait-stdin.patch" 2>/dev/null; then
  git apply "$language_dir/wait-stdin.patch"
else
  git apply --reverse --check "$language_dir/wait-stdin.patch"
fi
cmake -G Ninja -S llvm -B build-native \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DLLVM_ENABLE_PROJECTS=clang -DLLVM_TARGETS_TO_BUILD=ARM \
  -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_ZLIB=OFF
cmake --build build-native --target llvm-tblgen clang-tblgen -j"$build_jobs"
# Compiler builtin headers are the only embedded filesystem data. ARM libc and
# C++ headers are the separate, cached SDK archives used by both runtimes.
headers="$build_root/llvm-project/clang/lib/Headers"
# ThinLTO lets the linker inline parser helpers across LLVM archives and remove
# code that clangd never reaches, reducing browser compilation and parse work.
emcmake cmake -G Ninja -S llvm -B build-jspi \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-pthread -Dwait4=__syscall_wait4" \
  -DCMAKE_EXE_LINKER_FLAGS="-O3 -Wl,--mllvm=-import-instr-limit=5 -pthread -sENVIRONMENT=worker -sNO_INVOKE_RUN -sINITIAL_MEMORY=64MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=1GB -sSTACK_SIZE=256kB -sEXPORTED_RUNTIME_METHODS=FS,callMain -sMODULARIZE -sEXPORT_ES6 -sWASM_BIGINT -sJSPI -sPTHREAD_POOL_SIZE=8 --js-library=$language_dir/runtime-library.js --embed-file=$headers@/usr/include" \
  -DLLVM_TARGET_ARCH=wasm32-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE=arm-none-eabi \
  -DLLVM_TARGETS_TO_BUILD=ARM -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra" \
  -DLLVM_TABLEGEN="$build_root/llvm-project/build-native/bin/llvm-tblgen" \
  -DCLANG_TABLEGEN="$build_root/llvm-project/build-native/bin/clang-tblgen" \
  -DLLVM_ENABLE_LTO=Thin -DLLVM_BUILD_STATIC=ON -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DCLANGD_TIDY_CHECKS=OFF -DCLANG_TIDY_ENABLE_STATIC_ANALYZER=OFF \
  -DCLANGD_ENABLE_REMOTE=OFF -DCLANGD_BUILD_XPC=OFF \
  -DCLANG_ENABLE_OBJC_REWRITER=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_LIBXML2=OFF \
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF -DCLANG_ENABLE_ARCMT=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF -DLLVM_ENABLE_PIC=OFF
cmake --build build-jspi --target clangd -j"$build_jobs"
printf 'Built runtime: %s\n' "$build_root/llvm-project/build-jspi/bin/clangd.js"
