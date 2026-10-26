// clangd -j=1 needs no CPU-sized auxiliary pools on school Chromebooks.
addToLibrary({ emscripten_num_logical_cores: () => 2 })
