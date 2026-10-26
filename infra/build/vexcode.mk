# Generic VEXcode V5 build, using the VEX SDK and ARM target libraries.
SDK := /opt/vex/sdk/vexv5
TOOLCHAIN := /usr
CXX := /usr/local/bin/v5x-cxx
OBJCOPY := $(TOOLCHAIN)/bin/arm-none-eabi-objcopy
SOURCES := $(shell find src -name '*.cpp')
OBJECTS := $(patsubst src/%.cpp,build/%.o,$(SOURCES))
FLAGS := -target thumbv7-none-eabi -march=armv7-a -fshort-enums -DVexV5 -U__INT32_TYPE__ -U__UINT32_TYPE__ -D__INT32_TYPE__=long -D__UINT32_TYPE__='unsigned long' -mfpu=neon -mfloat-abi=softfp -Os -std=gnu++17 -fno-threadsafe-statics -ffunction-sections -fdata-sections -fno-exceptions -fno-rtti -Iinclude -I$(SDK)/include -I$(SDK)/gcc/include/c++/4.9.3 -I$(SDK)/gcc/include/c++/4.9.3/arm-none-eabi/armv7-ar/thumb -I$(SDK)/gcc/include
all: build/program.bin
build/%.o: src/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(FLAGS) -MMD -MP -c $< -o $@
build/program.elf: $(OBJECTS)
	$(TOOLCHAIN)/bin/arm-none-eabi-ld -nostdlib -T$(SDK)/lscript.ld -R$(SDK)/stdlib_0.lib -L$(SDK) -L$(SDK)/gcc/libs --gc-sections $(OBJECTS) --start-group -lv5rt -lstdc++ -lc -lm -lgcc --end-group -o $@
build/program.bin: build/program.elf
	$(OBJCOPY) -O binary $< $@
-include $(OBJECTS:.o=.d)
